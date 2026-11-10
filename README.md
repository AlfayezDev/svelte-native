# Svelte Native

Svelte 5 components that run as native Android and iOS apps on React Native's Fabric, with no React reconciler and no WebView. The library compiles Svelte with a pinned custom-renderer build, runs it in Hermes and drives Fabric's shadow tree and Yoga directly. The build and release pipeline stays Expo.

## Try it (early preview)

Svelte Native is a way to write Android and iOS apps as Svelte 5 components that run natively: no React, no WebView, and Expo's build pipeline underneath. It is an early preview for a few friends, so expect rough edges, and please report them.

**You need**

- Node 24 LTS (24.3 or newer), Node 22.17 or newer, or Node 26 or newer, and pnpm 12.3.4 or newer. **Not Node 25**: a fresh install takes React Native tools that exclude it, and `pnpm add` stops with `ERR_PNPM_UNSUPPORTED_ENGINE` ([troubleshooting](docs/60-appendix/20-troubleshooting.md#pnpm-stops-during-install)). `svelte-native doctor` checks both once the library is installed.
- Read access to this private repository over SSH: be a collaborator, with your SSH key on your GitHub account (`ssh -T git@github.com` should greet you by name).
- To run on Android: Android Studio's SDK (platform 36, NDK 27.1.12297006, CMake 3.22.1), a JDK 17, and a phone with USB debugging or an emulator. To run on iOS: a Mac with Xcode, and a simulator or an iPhone.
- It builds your own native app (a debug build that loads its JavaScript from Metro), not Expo Go: Expo Go cannot load the library's native modules.

**Quick start**

```sh
npx sv create my-app
cd my-app
pnpm add "git+ssh://git@github.com/AlfayezDev/svelte-native.git#v0.4.0-rc.3&path:packages/svelte-native"
pnpm exec svelte-native init
pnpm android        # or: pnpm ios
```

`npx sv create` makes a SvelteKit project (minimal, TypeScript, pnpm). `pnpm add` installs the library from a release tag (`v0.4.0-rc.3` here; use the newest). `svelte-native init` then turns the project into a Svelte Native one: the dependencies, the patches, the Metro and Expo config, the Vite plugin and a first native screen, followed by `pnpm install` and the doctor. Run it with `--dry-run` first to see the plan, and again whenever you like: it changes nothing a second time. The first `pnpm android` / `pnpm ios` builds the native app, which can take ten minutes or more the first time. The web app is still there: `pnpm dev`.

If `pnpm add` stops with `ERR_PNPM_GIT_RESOLVE_FAILED` (pnpm fetches GitHub dependencies over HTTPS even for an SSH address), tell git once to use SSH for this account: `git config --global url."git@github.com:AlfayezDev/".insteadOf "https://github.com/AlfayezDev/"`.

**The guide** is in [docs/](docs/10-getting-started/10-introduction.md), and published at <https://svelte-native.alfayez.dev>. It has the shape of SvelteKit's: getting started (what it is, creating a project, project structure, coming from the web), core concepts (routing, styling, loading data, state), a page for every component, native features (native libraries and views, SVG, animation, gestures, platform APIs, updates), building and releasing, troubleshooting, and a reference for the command line, the configuration and every module. `apps/docs` is the site; [its README](apps/docs/README.md) says how to add a page.

**The showcase** is `apps/example`, one short screen per feature (its [README](apps/example/README.md) lists them). From a checkout: `pnpm install --frozen-lockfile`, then `pnpm --dir apps/example android` or `ios`. A [release](https://github.com/AlfayezDev/svelte-native/releases) may also have a prebuilt Android APK attached, when a release has one (`adb install -r <file>.apk`).

**Not working yet**

- No Fast Refresh: a save remounts the app's root, and component state is lost.
- Tried on one Android phone (a Samsung A16) and an Android emulator, and one iPhone (an SE, 3rd generation); phones only, no tablet or foldable layouts, no tvOS.
- Screen readers (TalkBack, VoiceOver) are covered by automated checks, not yet by a person using them.
- Not supported: Svelte's DOM transitions and DOM-based libraries, React widgets, and the Expo dev client.
- EAS Build on Expo's servers is not tried, and push notification delivery is not tested end to end.
- The Svelte compiler is an unmerged pull request, [pinned](https://github.com/sveltejs/svelte/pull/18042) to one commit; the Svelte you install is that build, not the registry's, and the web side of the app runs on a pinned SvelteKit prerelease (3.1.1).
- Expo SDK 57 and React Native 0.86 only.
- `@example/svelte-native` is a placeholder name and will change before a public release.

**Found a bug?** [Open an issue](https://github.com/AlfayezDev/svelte-native/issues/new?template=bug.yml); the form asks for what is needed, including the output of `pnpm exec svelte-native doctor`. If an install fails, start with [troubleshooting](docs/60-appendix/20-troubleshooting.md).

## Layout

| Path | What it is |
| ---- | ---------- |
| `packages/svelte-native` | The library, `@example/svelte-native`: renderer, router, Metro and Vite integration, Expo config plugin, gestures, view-library wrappers, updates client, remote functions, and its six native modules in `native/` (the Android engine, the iOS screens, insets, navigation and capture modules, the updates module), linked by the package's one `expo-module.config.json`. Apps install it as a git dependency of this repository ([its README](packages/svelte-native/README.md), "Install in an app"). Its tests are in `tests/`. Start with [its README](packages/svelte-native/README.md). |
| `apps/qa` | The QA app (the development lab) and the QA harness (`node qa/native-qa.ts`). It depends on the library through the workspace (`@example/svelte-native`), as an app outside the repository would, and links its native modules from `node_modules/@example/svelte-native`. It has the development lab (`src/lib/native/dev`, `src/routes/__dev`), the three QA-only local Expo modules in `modules/` (the touch injector, the iOS QA module, the view bench), and the QA harness in `qa/` (`node qa/native-qa.ts`, see [qa/README.md](apps/qa/qa/README.md)). |
| `apps/example` | The showcase app (`@svelte-native/example`, "Svelte Native"): a readable tour of the library, one short screen per feature, written like an app that installs the library and importing only its public entries. It has no lab, no QA modules and no harness. Run it with `pnpm --dir apps/example android\|ios`; [its README](apps/example/README.md) lists the features and their routes. |
| `patches/` | pnpm patches of the third-party libraries the QA app links (listed in `pnpm-workspace.yaml`). The SvelteKit patch is in `packages/svelte-native/patches/`. |
| `vendor/` | The Svelte build the library needs (an unmerged custom-renderer pull request, commit `216f258`, 5.56.7), vendored so installs do not depend on a preview registry. The package names `svelte` as a peer dependency; this repository's example and package install the tarball by `file:`. |

## Install and check

Node 25, pnpm 12.3.4 (the `packageManager` field) and Bun 1.3 (the tests run on Bun).

```sh
pnpm install --frozen-lockfile
pnpm lint         # biome, then eslint in the package and the apps
pnpm typecheck    # svelte-check in the package and the apps, tsc for the harness
pnpm test         # the package's tests, then the harness's
```

The Kotlin and C++ host checks (`packages/svelte-native/tests`, `packages/svelte-native/native/svelte-engine/android/src/test/run.sh`) need a JDK, `kotlinc` and `g++`, and skip themselves without them (they fail under `CI=1`). Building the apps and running the device suites additionally need the Android SDK or Xcode and a device; see the QA README.

## CI

Four workflows in `.github/workflows/`. The static checks and the consumer build run on GitHub-hosted `ubuntu-latest` runners; only the emulator lane needs a machine of ours.

| Workflow | Runs when | What it does | Expected time |
| -------- | --------- | ------------ | ------------- |
| `ci.yml` | every push to main, every pull request, by hand; `release.yml` calls it | Five jobs side by side, then the aggregate status `CI`. **Lint and types**: `biome check .` at the root, eslint, `svelte-check` and `tsc` of the library, the QA app, the harness and the showcase. **Library and showcase tests**: `bun test --timeout 60000` in `packages/svelte-native` (with JDK 17 and the pinned kotlinc for the Kotlin host checks; includes the test that `dist/node/` is not stale), then `pnpm build` and a check that it changed nothing, then the showcase's `pnpm test`. **QA harness tests**: `bun test --timeout 120000 qa` in `apps/qa`. **Engine host checks**: the engine's Kotlin and C++ checks (`run.sh`, g++ with sanitizers, kotlinc). **Documentation site**: `pnpm --dir apps/docs build`, which prerenders `docs/` and fails on a broken link between pages (nothing is deployed). | about 10 to 15 min |
| `consumer.yml` | pushes to `main` and pull requests that touch `packages/**`, `examples/**`, `vendor/**` or `scripts/consumer-check.sh`; by hand (choose the ABI) | `scripts/consumer-check.sh` once per mode (`tarball`, `git`, `starter`), each on its own runner. The first two install the library into a copy of `examples/minimal` outside the repository and apply the patches. `starter` follows "Try it": `sv create`, `pnpm add` of this checkout's commit, `svelte-native init` (and again, which must change nothing), `pnpm check` and the web build. All three then run `doctor` and `sync`, bundle with Metro, run `expo prebuild` and build a release APK with Gradle (JDK 17, Android SDK 36, NDK 27.1.12297006, CMake 3.22.1). The consumer jobs run on Node 24 LTS, not on the repository's Node: they are apps, and `svelte-native doctor` holds an app to the range a fresh install accepts (24.3 or newer, 22.17 or newer, 26 or newer; not 25). The APKs are uploaded as artifacts (7 days); a failed run uploads the stage logs. | about 20 to 40 min (the first run builds with a cold Gradle cache) |
| `native-qa.yml` | every push to a branch except documentation-only ones; by hand (full lane, crash volume) | The Android emulator lane of the QA harness on the self-hosted runner `svelte-qa-emulator`. **Off until the runner is registered and the repository variable `QA_EMULATOR_RUNNER` is `true`** (until then no job of it runs): [`apps/qa/qa/ci/RUNBOOK.md`](apps/qa/qa/ci/RUNBOOK.md). What it runs and how to read it: [`apps/qa/qa/README.md`](apps/qa/qa/README.md), "CI". | 55 to 70 min a push |
| `release.yml` | a tag `v*` | `ci.yml`, then a GitHub Release: the changelog section of the version as notes, the `pnpm pack` tarball and its `SHA256SUMS` attached. See "Release". | about 15 min |

The times are estimates until the first runs: the job commands took 28 s (lint and types), 113 s (library and showcase), 118 s (harness) and 26 s (engine host) on 6 capped cores of a desktop, and the consumer build 100 s of Gradle per mode with a warm cache; a hosted runner of a private repository has 2 vCPUs and 7 GB, so expect several times that, plus about two minutes of setup and install per job.

Run the same commands from a checkout: `pnpm install --frozen-lockfile`, then the commands of `ci.yml` (`AGENTS.md`, "Checks"). With `CI=1`, as the workflow sets it, the Kotlin and C++ host checks fail instead of skipping when a tool is missing; `eval "$(bash apps/qa/qa/ci/host-tools.sh)"` puts the pinned kotlinc and the `org.json` jar in the shell. `scripts/consumer-check.sh all` is the consumer build (it caps its heavy commands with `systemd-run` when it can; `CAP=` turns that off, as on a runner of its own). Node (`engines.node`), pnpm (`packageManager`) and Bun (`.github/actions/setup/action.yml`) are pinned once and read from there by every job, except that `consumer.yml` runs on Node 24 (see its row above); the third-party actions are pinned by commit SHA.

A failed run: the job log names the step; `ci.yml` runs every check of a job even when an earlier one failed, so one run lists everything that is wrong. A stale `dist/node/` is fixed with `pnpm --dir packages/svelte-native build` and a commit of `packages/svelte-native/dist/node/`. The stage logs of a failed consumer build are the `consumer-<mode>-logs` artifact. Branch rules (the status to require is `CI`) and the repository settings are in the RUNBOOK, step 10.

## Release

A release is a tag `v<version>` on a commit of `main` that is green in `ci.yml` and `consumer.yml`. Apps depend on the tag (`pnpm add "git+ssh://git@github.com/AlfayezDev/svelte-native.git#v<version>&path:packages/svelte-native"`); the GitHub Release is its notes and a convenience tarball. A machine that reaches the private repository only with an SSH key needs one git setting first, because pnpm resolves a `github.com` dependency over HTTPS whatever the specifier says: `git config --global url."git@github.com:AlfayezDev/".insteadOf "https://github.com/AlfayezDev/"` (without it `pnpm add` stops with `ERR_PNPM_GIT_RESOLVE_FAILED`; the package README, "Install in an app", has the details).

1. Set `"version"` in `packages/svelte-native/package.json` (`0.3.0`; a pre-release is `0.3.0-rc.1`, which the release marks as a pre-release).
2. In `packages/svelte-native/CHANGELOG.md`, move what is under `## Unreleased` under a new heading `## 0.3.0 - YYYY-MM-DD` and leave `## Unreleased` empty. The text under the version's heading is the release notes verbatim (`scripts/release-notes.sh 0.3.0` prints it).
3. If the Node-side code changed, `pnpm --dir packages/svelte-native build` and commit `dist/node/` (CI fails on a stale one).
4. Commit (`Release 0.3.0`), push `main`, and wait for `CI` and `Consumer` to go green on that commit.
5. Tag that commit and push the tag:

   ```sh
   git tag -a v0.3.0 -m "@example/svelte-native 0.3.0"
   git push origin v0.3.0
   ```

`release.yml` then runs the CI checks, refuses a tag that is not `v` plus the package's version or whose version has no changelog section, and creates the Release with the notes and `example-svelte-native-0.3.0.tgz`. A re-run of the workflow for the same tag replaces the notes and the files. A release made by mistake: `gh release delete v0.3.0 --cleanup-tag`, fix, tag again (do not move a tag an app may have installed: release `0.3.1` instead).
