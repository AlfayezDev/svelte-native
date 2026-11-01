# Registering the CI runner on the OVH host

What the user runs, in order. Nothing in the repository registers a runner, creates a token or touches the repository's settings; every
command below is yours to run, and each step says what it changes. `<TOKEN>` is a placeholder: the registration token is typed at a hidden
prompt on the host, so it is never in a shell history, an argument list or a file.

The runner is a dedicated user `svelte-qa` on the OVH host (`ssh ovh-root`), the label is `svelte-qa-emulator`, the repository is
`https://github.com/AlfayezDev/rasheed`. What the setup script does, in full: `bash apps/platform/qa/ci/setup-runner.sh --help`.

## 0. Before

- Nobody should be using the emulator in step 6 (the PC tools' emulator is replaced by the service). Check on this PC with `fuser -v /tmp/svelte-qa-emulator.lock` (agents' runs) and on the host with `ssh ovh-root tmux ls`.
- The host needs 30 GB free (`ssh ovh-root df -h /`): Gradle caches, the runner's workspace and the AVD take 20 to 30 GB.
- Repository type: the workflow only reacts to `push` and `workflow_dispatch`, never to `pull_request`, so code from a fork never reaches the runner. Keep it so on a public repository; on a private one there is nothing more to do.

## 1. Put the script on the host

From a checkout of the branch (this PC):

```
git archive --format=tar HEAD package.json apps/platform/qa/ci | ssh ovh-root 'rm -rf /srv/svelte-qa-setup && mkdir -p /srv/svelte-qa-setup && tar -x -C /srv/svelte-qa-setup'
```

Changes: creates `/srv/svelte-qa-setup`.

## 2. Read what it will do

```
ssh ovh-root 'bash /srv/svelte-qa-setup/apps/platform/qa/ci/setup-runner.sh --dry-run --no-register'
```

Changes: nothing. Every `+` line is a command it would run, every `would write` a file it would create.

## 3. Prepare the host (no token needed)

```
ssh ovh-root 'bash /srv/svelte-qa-setup/apps/platform/qa/ci/setup-runner.sh --no-register'
```

Changes: apt packages (git curl jq unzip xz-utils tmux acl openjdk-17-jdk-headless g++); user `svelte-qa`; `/opt/svelte-qa/toolchain` (node, pnpm,
bun 1.3.14); the missing Android SDK packages in `/opt/android-sdk` (build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1; downloads go over IPv4
because dl.google.com answers 404 to this host's IPv6 address); the AVD `svelte-qa` in `/var/lib/svelte-qa/avd`; the units
`svelte-qa-emulator.service` and `svelte-qa-emulator-watchdog.service`; `/etc/sudoers.d/svelte-qa` (the runner may start, stop and restart that
one unit); `/etc/tmpfiles.d/svelte-qa.conf` (`/run/svelte-qa`, the shared emulator lock); `/opt/svelte-qa/bin/emulator.sh`. The emulator that
the PC tools run as root in tmux is left alone: the service is enabled but not started while it runs.

## 4. Create a registration token

In the repository: **Settings > Actions > Runners > New self-hosted runner**, copy the token from the `./config.sh --url ... --token <TOKEN>`
line (it lasts an hour). Or, with your `gh` login: `gh api -X POST repos/AlfayezDev/rasheed/actions/runners/registration-token --jq .token`.

## 5. Register the runner

```
ssh -t ovh-root 'RUNNER_URL=https://github.com/AlfayezDev/rasheed bash /srv/svelte-qa-setup/apps/platform/qa/ci/setup-runner.sh'
registration token: <paste TOKEN; nothing is echoed>
```

Changes: downloads the latest `actions/runner`, registers `ovh-svelte-qa` with the label `svelte-qa-emulator` (plus the default `self-hosted`,
`Linux`, `X64`), writes the runner's `.env` and `.path`, installs and starts its systemd service (`actions.runner.*`). It runs again safely: a
registered runner is left as it is (`--reconfigure` replaces the registration and needs a fresh token). Pin the runner version with
`RUNNER_VERSION=<x.y.z>` and its checksum with `RUNNER_SHA256=<sha256>` in front of `bash` if you want.

## 6. Move the emulator to the service (when nobody is using it)

```
ssh ovh-root 'bash /srv/svelte-qa-setup/apps/platform/qa/ci/setup-runner.sh --no-register --takeover'
```

Changes: stops the root emulator (tmux session `svelte-emu`) and starts `svelte-qa-emulator.service` and its watchdog in its place. The AVD is a
new one with the same settings as the old one (pixel_6, 1080x2400, 420 dpi, 3 GB, software GL), so the Android parity references still apply;
its app data starts empty. Then point the PC tools at the service:

| PC tool today | Replace with |
| ------------- | ------------ |
| `ovh_emulator.sh start` (tmux emulator) | `ssh ovh-root /opt/svelte-qa/bin/emulator.sh start`, then the tunnel and `adb connect localhost:5555` as before |
| `ovh_emulator.sh stop` | `ssh ovh-root /opt/svelte-qa/bin/emulator.sh stop` |
| restarting for a fresh instance | `ssh ovh-root /opt/svelte-qa/bin/emulator.sh restart`, while holding the lock: `node qa/native-qa.ts hold --device localhost:5555 -- ssh ovh-root /opt/svelte-qa/bin/emulator.sh restart` |
| `emu_watchdog.sh` | stop it (`pkill -f emu_watchdog.sh`): the host runs the watchdog now |

From this PC `qa/ci/emulator-remote.sh <command>` is the same as `ssh ovh-root /opt/svelte-qa/bin/emulator.sh <command>` (`QA_EMULATOR_HOST` names another host).

The harness on the PC takes the emulator lock on the host automatically while the ssh tunnel to it is up (or with `NATIVE_QA_LOCK_HOST=ovh-root`).

## 7. Check

```
ssh ovh-root 'systemctl --no-pager status "actions.runner.*" svelte-qa-emulator svelte-qa-emulator-watchdog | grep -E "●|Active"'
ssh ovh-root 'sudo -u svelte-qa /opt/svelte-qa/bin/emulator.sh status'          # unit=active boot=1 adb=device rss=N GB
node apps/platform/qa/native-qa.ts hold --device localhost:5555 -- echo "lock taken on the host"
```

**Settings > Actions > Runners** shows `ovh-svelte-qa`, Idle, with the labels `self-hosted`, `Linux`, `X64`, `svelte-qa-emulator`.

## 8. Optional

- The smoke app (dispatch only) needs the proprietary Samsung Pay SDK: `scp apps/platform/libs/samsungpay.jar ovh-root:/var/lib/svelte-qa/secrets/ && ssh ovh-root chown svelte-qa: /var/lib/svelte-qa/secrets/samsungpay.jar`. Without it the smoke stage fails with the harness's own message; turn the `smoke` input off for a dispatch without it.
- The update scenario (dispatch only, the `updates` input, off by default) publishes to an EAS Update channel (`qa`, or `updates_channel`) and needs an Expo access token with write access to that project in the repository secret `EXPO_TOKEN`; the workflow gives it to the lane step only. eas-cli is fetched by `npx` at run time, so the host needs network access to npm and EAS. A push never runs it.
- The signed-in phase of `parity` and `a11y` (dispatch only) signs in as the QA account of the development database, which is published with a fixed code for one dedicated address (`apps/database/module/src/identity.rs`): put the address and the code in the repository secrets `RASHEED_QA_EMAIL` and `RASHEED_QA_CODE`. The harness keeps both out of every message and file. Without them the phase does not run, the lane says so (`no QA account`) and the two gates that count its screens (`parity.signedIn.missing`, `a11y.signedIn.missing`) are not judged; a push never signs in and never judges them, because the quick lane compares the pinned screens in fewer variants than the pin lists.
- Run the unit job on this runner instead of a GitHub-hosted one: `gh variable set QA_UNIT_RUNS_ON --body '["self-hosted","svelte-qa-emulator"]'`. It needs g++ (step 3 installs it) and downloads two things itself: a JDK 17 (`actions/setup-java`, into the runner's tool cache) and, with `qa/ci/host-tools.sh`, kotlinc 2.1.20 and the `org.json` jar, each against a pinned sha256, into `~svelte-qa/.cache/native-qa-host-tools` (kept between runs, so once). Both need network access to github.com and repo1.maven.org; the Kotlin and C++ host checks (`run.sh`, the package tests that compile `*Host.kt`) fail, not skip, without them.
- Make the checks block merges: Settings > Branches > the rule > require the status checks `Unit tests, typecheck, lint` and `Android emulator lane`.
- A first run: push, or after the workflow is on the default branch, `gh workflow run native-qa.yml --ref <branch>`. The first build on the new runner takes 15 to 30 minutes.

## Day 2

- The runner updates itself. After a change to `qa/ci/emulator.sh` or to the unit files in `setup-runner.sh`, repeat steps 1 and 3 (the watchdog runs the copy in `/opt/svelte-qa/bin`; the lane runs the one in the checkout).
- Logs: `journalctl -u 'actions.runner.*' -f`, `journalctl -u svelte-qa-emulator -f`, `journalctl -u svelte-qa-emulator-watchdog -f`.
- Who holds the emulator: `ssh ovh-root fuser -v /run/svelte-qa/emulator.lock`. A lock left by a session that died frees itself within 5 minutes; a stuck holder can be ended by killing its process (`fuser -k` ends the process that is running a lab too, so look first).

## Cleanup

Disk (`ssh ovh-root du -sh /var/lib/svelte-qa/* /opt/svelte-qa`):

```
# the runner's workspace temp and old logs
ssh ovh-root 'rm -rf /var/lib/svelte-qa/runner/_work/_temp/* && find /var/lib/svelte-qa/runner/_diag -name "*.log" -mtime +14 -delete'
# Gradle: stop its daemons, drop the caches that a build refills (the next build is a cold one: 15 to 30 minutes)
ssh ovh-root 'pkill -u svelte-qa -f GradleDaemon; rm -rf /var/lib/svelte-qa/gradle/caches /var/lib/svelte-qa/gradle/daemon'
# the workspace itself (the next run clones again and builds from nothing)
ssh ovh-root 'rm -rf /var/lib/svelte-qa/runner/_work/rasheed'
# the emulator's data (the next boot is a first boot; reinstall happens on its own)
ssh ovh-root 'systemctl stop svelte-qa-emulator && rm -rf /var/lib/svelte-qa/avd/svelte-qa.avd/*.qcow2 && systemctl start svelte-qa-emulator'
```

Take the runner away, keeping the host's other uses (the SDK and the apt packages stay; the PC tools can keep using the SDK):

```
# a removal token: Settings > Actions > Runners > ovh-svelte-qa > Remove runner
ssh -t ovh-root 'bash /srv/svelte-qa-setup/apps/platform/qa/ci/setup-runner.sh --uninstall'      # prompts for the removal token
ssh -t ovh-root 'bash /srv/svelte-qa-setup/apps/platform/qa/ci/setup-runner.sh --uninstall --purge'   # and deletes the user, the workspace, the AVD, /opt/svelte-qa
```

Then restore the PC tools' root emulator with their own `ovh_emulator.sh start`, and remove `/srv/svelte-qa-setup`.
