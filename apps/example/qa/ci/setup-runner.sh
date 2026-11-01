#!/usr/bin/env bash
# setup-runner.sh — makes the OVH host (Ubuntu 26.04) the CI runner of the Svelte Native emulator lane. Run it by hand, as root,
# ON the host, from a checkout of this repository (it installs qa/ci/emulator.sh from the checkout it sits in):
#
#   sudo -E RUNNER_URL=https://github.com/<owner>/<repo> RUNNER_TOKEN=<registration token> bash apps/platform/qa/ci/setup-runner.sh
#
# Nothing here runs unless you run it. The registration token is read from the environment (or asked for on a terminal), handed to
# the runner's config.sh as ACTIONS_RUNNER_INPUT_TOKEN so it never appears in a process list, and written nowhere.
# Registration tokens last an hour: create it (Settings > Actions > Runners > New self-hosted runner) right before.
#
# What it sets up, each step only when it is not already so (run it again whenever something changed):
#   user      svelte-qa (system user, home /var/lib/svelte-qa, group kvm). Runs the runner, the emulator and the watchdog.
#   packages  apt: git curl jq unzip xz-utils tmux util-linux acl openjdk-17-jdk-headless
#   toolchain /opt/svelte-qa/toolchain: node (the repo's version), pnpm (the repo's packageManager), bun $BUN_VERSION
#   sdk       $ANDROID_HOME (default /opt/android-sdk, shared with the existing emulator): platform-tools, emulator, platform 36,
#             build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1, the x86_64 API 36 image. dl.google.com answers 404 to this host's
#             IPv6 address, so every download goes over IPv4 (curl -4, -Djava.net.preferIPv4Stack=true)
#   avd       svelte-qa in /var/lib/svelte-qa/avd with the settings of the emulator the PC tools start (pixel_6, 1080x2400, 420 dpi,
#             3 GB, swiftshader_indirect: the parity references are of that screen)
#   units     svelte-qa-emulator.service (the emulator, so it outlives a job), svelte-qa-emulator-watchdog.service (restarts it past
#             SOFT_GB of qemu RSS between runs), /etc/sudoers.d/svelte-qa (the runner may start/stop/restart that one unit),
#             /etc/tmpfiles.d/svelte-qa.conf (/run/svelte-qa, where the shared emulator lock lives)
#   runner    /var/lib/svelte-qa/runner, registered with the label svelte-qa-emulator, as a systemd service
#
# Flags (or the same words in the environment):
#   --dry-run      print what would change, change nothing (needs no token)
#   --no-register  everything but the runner (to prepare the host before there is a token)
#   --reconfigure  register again (replaces the runner of the same name); needs a token
#   --takeover     stop the emulator the PC tools run as root in tmux (session svelte-emu) and start the service in its place
#   --uninstall    remove the runner registration (needs a *removal* token), the services, the sudoers and tmpfiles files
#   --purge        with --uninstall: also delete the user, /var/lib/svelte-qa (workspace, AVD, caches) and /opt/svelte-qa
# The SDK and the apt packages are never removed: the SDK is shared with the PC tools' emulator.
#
# Environment: RUNNER_URL, RUNNER_TOKEN, RUNNER_NAME (ovh-svelte-qa), RUNNER_LABELS (svelte-qa-emulator), RUNNER_VERSION (latest),
# RUNNER_USER (svelte-qa), STATE_DIR (/var/lib/svelte-qa), OPT_DIR (/opt/svelte-qa), ANDROID_HOME (/opt/android-sdk),
# NODE_VERSION, PNPM_VERSION (both read from the checkout's package.json), BUN_VERSION (1.3.14), SOFT_GB (11), HARD_GB (18).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../../.." && pwd)

RUNNER_USER=${RUNNER_USER:-svelte-qa}
STATE_DIR=${STATE_DIR:-/var/lib/svelte-qa}
OPT_DIR=${OPT_DIR:-/opt/svelte-qa}
ANDROID_HOME=${ANDROID_HOME:-/opt/android-sdk}
RUNNER_NAME=${RUNNER_NAME:-ovh-svelte-qa}
RUNNER_LABELS=${RUNNER_LABELS:-svelte-qa-emulator}
RUNNER_VERSION=${RUNNER_VERSION:-latest}
BUN_VERSION=${BUN_VERSION:-1.3.14}
SOFT_GB=${SOFT_GB:-11}
HARD_GB=${HARD_GB:-18}
LOCK_DIR=/run/svelte-qa
AVD_NAME=svelte-qa
SDK_TOOLS_BUILDS=${SDK_TOOLS_BUILDS:-"13114758 12700392 11076708"}
JVM_IPV4=-Djava.net.preferIPv4Stack=true

DRY_RUN=${DRY_RUN:-0}
REGISTER=1
RECONFIGURE=0
TAKEOVER=0
UNINSTALL=0
PURGE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-register) REGISTER=0 ;;
    --reconfigure) RECONFIGURE=1 ;;
    --takeover) TAKEOVER=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --purge) PURGE=1 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# run <command...>: runs it, or prints it in a dry run.
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '   + %s\n' "$*"; else "$@"; fi
}

# put <path> <mode> <owner:group>: writes stdin to the file unless it already holds exactly that.
put() {
  local path=$1 mode=$2 owner=$3 tmp
  tmp=$(mktemp)
  cat > "$tmp"
  if [ -f "$path" ] && cmp -s "$tmp" "$path"; then
    note "unchanged: $path"
  elif [ "$DRY_RUN" = 1 ]; then
    note "would write: $path"
  else
    install -D -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$tmp" "$path"
    note "wrote: $path"
  fi
  rm -f "$tmp"
}

as_user() { runuser -u "$RUNNER_USER" -- env HOME="$STATE_DIR" ANDROID_HOME="$ANDROID_HOME" ANDROID_SDK_ROOT="$ANDROID_HOME" ANDROID_AVD_HOME="$STATE_DIR/avd" JAVA_TOOL_OPTIONS="$JVM_IPV4" "$@"; }

json_get() { python3 - "$REPO_ROOT/package.json" "$1" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
value = data
for key in sys.argv[2].split("."):
    value = value.get(key, "") if isinstance(value, dict) else ""
print(value)
PY
}

NODE_VERSION=${NODE_VERSION:-$(json_get engines.node 2>/dev/null || true)}
NODE_VERSION=${NODE_VERSION:-25.0.0}
PNPM_VERSION=${PNPM_VERSION:-$(json_get packageManager 2>/dev/null | sed 's/^pnpm@//; s/+.*//' || true)}
PNPM_VERSION=${PNPM_VERSION:-12.3.4}

preflight() {
  say "preflight"
  [ "$DRY_RUN" = 1 ] || [ "$(id -u)" = 0 ] || die "run as root (sudo -E ...)"
  [ -r /etc/os-release ] && . /etc/os-release
  [ "${ID:-}" = ubuntu ] || note "warning: ${PRETTY_NAME:-this OS} is not Ubuntu; the apt steps may not fit"
  if [ ! -e /dev/kvm ]; then
    if [ "$DRY_RUN" = 1 ]; then note "warning: /dev/kvm is missing (a real run stops here)"; else die "/dev/kvm is missing: the emulator needs hardware virtualisation"; fi
  fi
  local free_gb
  free_gb=$(df -BG --output=avail / | tail -n 1 | tr -dc '0-9')
  if [ "${free_gb:-0}" -lt 30 ]; then
    if [ "$DRY_RUN" = 1 ]; then note "warning: only ${free_gb:-0} GB free on / (a real run stops here)"; else die "only ${free_gb:-0} GB free on /: Gradle, the workspace and the AVD need 30 GB"; fi
  fi
  [ -f "$REPO_ROOT/package.json" ] && [ -f "$SCRIPT_DIR/emulator.sh" ] || die "run this from a checkout of the repository (package.json and qa/ci/emulator.sh not found)"
  note "node $NODE_VERSION, pnpm $PNPM_VERSION, bun $BUN_VERSION; user $RUNNER_USER; state $STATE_DIR"
  if [ "$UNINSTALL" = 0 ] && [ "$REGISTER" = 1 ] && { [ ! -f "$STATE_DIR/runner/.runner" ] || [ "$RECONFIGURE" = 1 ]; }; then
    : "${RUNNER_URL:?set RUNNER_URL=https://github.com/<owner>/<repo>}"
    if [ -z "${RUNNER_TOKEN:-}" ] && [ "$DRY_RUN" = 0 ]; then
      [ -t 0 ] || die "set RUNNER_TOKEN (a registration token, valid for an hour), or run on a terminal to type it"
      read -rsp "registration token: " RUNNER_TOKEN; echo
      export RUNNER_TOKEN
    fi
  fi
}

install_packages() {
  say "packages"
  local missing=()
  for pkg in ca-certificates git curl jq unzip xz-utils tmux util-linux acl openjdk-17-jdk-headless; do
    dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
  done
  if [ "${#missing[@]}" = 0 ]; then note "all installed"; return; fi
  run apt-get update -y
  run apt-get install -y --no-install-recommends "${missing[@]}"
}

create_user() {
  say "user $RUNNER_USER"
  if id "$RUNNER_USER" >/dev/null 2>&1; then
    note "exists"
    id -nG "$RUNNER_USER" | tr ' ' '\n' | grep -qx kvm || run usermod -aG kvm "$RUNNER_USER"
  else
    run useradd --system --create-home --home-dir "$STATE_DIR" --shell /bin/bash --groups kvm "$RUNNER_USER"
  fi
  run install -d -m 0755 -o "$RUNNER_USER" -g "$RUNNER_USER" "$STATE_DIR" "$STATE_DIR/avd" "$STATE_DIR/gradle" "$STATE_DIR/runner"
  run install -d -m 0700 -o "$RUNNER_USER" -g "$RUNNER_USER" "$STATE_DIR/secrets"
  run install -d -m 0755 "$OPT_DIR" "$OPT_DIR/bin" "$OPT_DIR/toolchain"
}

# /run/svelte-qa is the home of the lock every machine takes (native-qa: "Devices and locks"): a directory of its own, not sticky
# like /tmp, whose lock file anybody can open.
lock_directory() {
  say "emulator lock directory"
  put /etc/tmpfiles.d/svelte-qa.conf 0644 root:root <<EOF
d $LOCK_DIR 2775 root $RUNNER_USER -
f $LOCK_DIR/emulator.lock 0666 root $RUNNER_USER -
EOF
  run systemd-tmpfiles --create /etc/tmpfiles.d/svelte-qa.conf
}

fetch() { curl -4 -fsSL --retry 3 -o "$2" "$1"; }

install_toolchain() {
  say "toolchain"
  local tool=$OPT_DIR/toolchain node_dir=$OPT_DIR/toolchain/node-v$NODE_VERSION
  if [ -x "$node_dir/bin/node" ]; then note "node $NODE_VERSION present"; else
    if [ "$DRY_RUN" = 1 ]; then note "would download node-v$NODE_VERSION-linux-x64 from nodejs.org"; else
      local tmp; tmp=$(mktemp -d)
      fetch "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" "$tmp/node.tar.xz"
      tar -xJf "$tmp/node.tar.xz" -C "$tmp"
      rm -rf "$node_dir"; mv "$tmp/node-v$NODE_VERSION-linux-x64" "$node_dir"; rm -rf "$tmp"
    fi
  fi
  run ln -sfn "$node_dir" "$tool/node"
  if [ -x "$node_dir/bin/pnpm" ] && [ "$(PATH="$node_dir/bin:$PATH" "$node_dir/bin/pnpm" --version 2>/dev/null)" = "$PNPM_VERSION" ]; then note "pnpm $PNPM_VERSION present"; else
    PATH="$node_dir/bin:$PATH" run npm install --global --prefix "$node_dir" "pnpm@$PNPM_VERSION"
  fi
  local bun_dir=$tool/bun-v$BUN_VERSION
  if [ -x "$bun_dir/bun" ]; then note "bun $BUN_VERSION present"; else
    if [ "$DRY_RUN" = 1 ]; then note "would download bun-v$BUN_VERSION"; else
      local tmp; tmp=$(mktemp -d)
      fetch "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64.zip" "$tmp/bun.zip"
      unzip -q "$tmp/bun.zip" -d "$tmp"
      install -D -m 0755 "$tmp/bun-linux-x64/bun" "$bun_dir/bun"; rm -rf "$tmp"
    fi
  fi
  run ln -sfn "$bun_dir" "$tool/bun"
}

install_sdk() {
  say "android sdk at $ANDROID_HOME"
  local sdkmanager=$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager
  if [ ! -x "$sdkmanager" ]; then
    if [ "$DRY_RUN" = 1 ]; then note "would download the command line tools"; else
      local tmp build; tmp=$(mktemp -d)
      for build in $SDK_TOOLS_BUILDS; do
        if fetch "https://dl.google.com/android/repository/commandlinetools-linux-${build}_latest.zip" "$tmp/tools.zip"; then note "cmdline-tools build $build"; break; fi
      done
      [ -s "$tmp/tools.zip" ] || die "could not download the Android command line tools over IPv4"
      mkdir -p "$ANDROID_HOME/cmdline-tools"; rm -rf "$ANDROID_HOME/cmdline-tools/latest"
      unzip -q "$tmp/tools.zip" -d "$tmp"; mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"; rm -rf "$tmp"
    fi
  fi
  local -A wanted=(
    ["platform-tools"]=platform-tools
    ["emulator"]=emulator
    ["platforms;android-36"]=platforms/android-36
    ["build-tools;36.0.0"]=build-tools/36.0.0
    ["ndk;27.1.12297006"]=ndk/27.1.12297006
    ["cmake;3.22.1"]=cmake/3.22.1
    ["system-images;android-36;google_apis;x86_64"]=system-images/android-36/google_apis/x86_64
  )
  local package missing=()
  for package in "${!wanted[@]}"; do [ -d "$ANDROID_HOME/${wanted[$package]}" ] || missing+=("$package"); done
  if [ "${#missing[@]}" = 0 ]; then note "all packages present"; else
    note "installing: ${missing[*]}"
    if [ "$DRY_RUN" = 0 ]; then
      yes 2>/dev/null | JAVA_TOOL_OPTIONS=$JVM_IPV4 "$sdkmanager" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
      JAVA_TOOL_OPTIONS=$JVM_IPV4 "$sdkmanager" --sdk_root="$ANDROID_HOME" --install "${missing[@]}"
    fi
  fi
  # Gradle may want to add a component on its own; the runner user may write the SDK, root keeps owning it.
  run setfacl -R -m "u:$RUNNER_USER:rwX,d:u:$RUNNER_USER:rwX" "$ANDROID_HOME"
  # Same reason: nothing of a build may need a second download path.
  put "$STATE_DIR/gradle/gradle.properties" 0644 "$RUNNER_USER:$RUNNER_USER" <<EOF
systemProp.java.net.preferIPv4Stack=true
org.gradle.daemon=true
EOF
}

ini_set() {
  local file=$1 key=$2 value=$3
  if grep -q "^$key *=" "$file"; then sed -i "s|^$key *=.*|$key = $value|" "$file"; else printf '%s = %s\n' "$key" "$value" >> "$file"; fi
}

create_avd() {
  say "avd $AVD_NAME"
  local config=$STATE_DIR/avd/$AVD_NAME.avd/config.ini
  if [ -f "$config" ]; then note "exists"; return; fi
  if [ "$DRY_RUN" = 1 ]; then note "would create $AVD_NAME (pixel_6, API 36 google_apis x86_64)"; return; fi
  echo no | as_user "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n "$AVD_NAME" -k "system-images;android-36;google_apis;x86_64" -d pixel_6
  # The settings of the emulator the PC tools start: the Android parity references are 1080x2400 at 420 dpi.
  ini_set "$config" hw.ramSize 3072
  ini_set "$config" hw.cpu.ncore 4
  ini_set "$config" hw.gpu.enabled yes
  ini_set "$config" hw.gpu.mode swiftshader_indirect
  ini_set "$config" hw.keyboard yes
  ini_set "$config" hw.lcd.density 420
  ini_set "$config" hw.lcd.width 1080
  ini_set "$config" hw.lcd.height 2400
  ini_set "$config" disk.dataPartition.size 6442450944
  chown -R "$RUNNER_USER:$RUNNER_USER" "$STATE_DIR/avd"
}

install_units() {
  say "systemd units, sudoers, emulator.sh"
  run install -D -m 0755 "$SCRIPT_DIR/emulator.sh" "$OPT_DIR/bin/emulator.sh"
  put /etc/systemd/system/svelte-qa-emulator.service 0644 root:root <<EOF
[Unit]
Description=Svelte QA Android emulator (AVD $AVD_NAME, adb on 127.0.0.1:5555)
After=network.target

[Service]
User=$RUNNER_USER
Group=$RUNNER_USER
SupplementaryGroups=kvm
WorkingDirectory=$STATE_DIR
Environment=HOME=$STATE_DIR ANDROID_HOME=$ANDROID_HOME ANDROID_SDK_ROOT=$ANDROID_HOME ANDROID_AVD_HOME=$STATE_DIR/avd
ExecStart=$ANDROID_HOME/emulator/emulator -avd $AVD_NAME -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot-save -accel on -memory 3072 -cores 4 -port 5554
Restart=on-failure
RestartSec=10
TimeoutStopSec=60
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
  put /etc/systemd/system/svelte-qa-emulator-watchdog.service 0644 root:root <<EOF
[Unit]
Description=Svelte QA emulator watchdog (restarts past ${SOFT_GB} GB of qemu RSS between runs, past ${HARD_GB} GB at once)
After=svelte-qa-emulator.service

[Service]
User=$RUNNER_USER
Group=$RUNNER_USER
Environment=HOME=$STATE_DIR ANDROID_HOME=$ANDROID_HOME NATIVE_QA_LOCK_FILE=$LOCK_DIR/emulator.lock SOFT_GB=$SOFT_GB HARD_GB=$HARD_GB
ExecStart=$OPT_DIR/bin/emulator.sh watchdog
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF
  # The runner restarts the emulator for a fresh instance; that unit and nothing else.
  local sudoers
  sudoers=$(mktemp)
  cat > "$sudoers" <<EOF
$RUNNER_USER ALL=(root) NOPASSWD: /usr/bin/systemctl start svelte-qa-emulator.service, /usr/bin/systemctl stop svelte-qa-emulator.service, /usr/bin/systemctl restart svelte-qa-emulator.service
EOF
  if [ "$DRY_RUN" = 0 ]; then visudo -cf "$sudoers" >/dev/null || die "the sudoers rule does not validate"; fi
  put /etc/sudoers.d/svelte-qa 0440 root:root < "$sudoers"
  rm -f "$sudoers"
  run systemctl daemon-reload
  run systemctl enable svelte-qa-emulator.service svelte-qa-emulator-watchdog.service
}

# The PC tools run the emulator as root in a tmux session (ovh_emulator.sh); two emulators cannot share ports 5554/5555.
start_emulator() {
  say "emulator service"
  if [ "$DRY_RUN" = 0 ] && tmux has-session -t svelte-emu 2>/dev/null; then
    if [ "$TAKEOVER" = 1 ]; then
      note "stopping the root emulator in tmux session svelte-emu"
      "$ANDROID_HOME/platform-tools/adb" -s emulator-5554 emu kill >/dev/null 2>&1 || true
      sleep 3; tmux kill-session -t svelte-emu 2>/dev/null || true
    else
      note "the emulator of the PC tools is running (tmux session svelte-emu as root): not starting the service."
      note "when nobody is using it: rerun with --takeover, then point the PC tools at the service (RUNBOOK.md, step 6)"
      return
    fi
  fi
  if [ "$DRY_RUN" = 0 ] && systemctl is-active --quiet svelte-qa-emulator.service; then note "service already running"; else run systemctl start svelte-qa-emulator.service; fi
  run systemctl start svelte-qa-emulator-watchdog.service
}

install_runner() {
  say "actions runner"
  local dir=$STATE_DIR/runner version=$RUNNER_VERSION
  if [ "$REGISTER" = 0 ]; then note "skipped (--no-register)"; return; fi
  if [ ! -x "$dir/config.sh" ]; then
    if [ "$DRY_RUN" = 1 ]; then note "would download actions/runner $version into $dir"; else
      if [ "$version" = latest ]; then version=$(curl -4 -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//'); fi
      note "actions/runner $version"
      local tmp; tmp=$(mktemp -d)
      fetch "https://github.com/actions/runner/releases/download/v$version/actions-runner-linux-x64-$version.tar.gz" "$tmp/runner.tar.gz"
      if [ -n "${RUNNER_SHA256:-}" ]; then echo "$RUNNER_SHA256  $tmp/runner.tar.gz" | sha256sum -c - >/dev/null || die "runner download does not match RUNNER_SHA256"; fi
      tar -xzf "$tmp/runner.tar.gz" -C "$dir"; rm -rf "$tmp"
      chown -R "$RUNNER_USER:$RUNNER_USER" "$dir"
      "$dir/bin/installdependencies.sh" || note "warning: installdependencies.sh failed; the runner may not start (see its message)"
    fi
  else
    note "runner files present"
  fi

  if [ -f "$dir/.runner" ] && [ "$RECONFIGURE" = 0 ]; then note "already registered ($(jq -r .agentName "$dir/.runner" 2>/dev/null || echo '?'))"; else
    note "registering $RUNNER_NAME with the labels $RUNNER_LABELS at ${RUNNER_URL:-<RUNNER_URL>}"
    if [ "$DRY_RUN" = 0 ]; then
      systemctl stop 'actions.runner.*' 2>/dev/null || true
      # The token goes in by environment: it is in no argument list.
      ACTIONS_RUNNER_INPUT_TOKEN=$RUNNER_TOKEN runuser --preserve-environment -u "$RUNNER_USER" -- \
        env HOME="$STATE_DIR" bash -c "cd '$dir' && ./config.sh --unattended --url '$RUNNER_URL' --name '$RUNNER_NAME' --labels '$RUNNER_LABELS' --work _work --replace"
    fi
  fi
  # config.sh snapshots the environment of the user who runs it into .env and .path, so these are written after it: .path is the
  # whole PATH of the service (runsvc.sh exports its content), .env the variables every job gets.
  local node_bin=$OPT_DIR/toolchain/node/bin bun_bin=$OPT_DIR/toolchain/bun
  put "$dir/.env" 0644 "$RUNNER_USER:$RUNNER_USER" <<EOF
ANDROID_HOME=$ANDROID_HOME
ANDROID_SDK_ROOT=$ANDROID_HOME
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
GRADLE_USER_HOME=$STATE_DIR/gradle
NATIVE_QA_LOCK_FILE=$LOCK_DIR/emulator.lock
NODE_OPTIONS=--dns-result-order=ipv4first
LANG=C.UTF-8
EOF
  put "$dir/.path" 0644 "$RUNNER_USER:$RUNNER_USER" <<EOF
$node_bin:$bun_bin:$ANDROID_HOME/platform-tools:$OPT_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EOF

  if [ ! -f "$dir/.service" ]; then
    run bash -c "cd '$dir' && ./svc.sh install '$RUNNER_USER'"
  else
    note "service installed: $(cat "$dir/.service")"
  fi
  run bash -c "cd '$dir' && ./svc.sh start || true"
}

uninstall() {
  say "uninstall"
  local dir=$STATE_DIR/runner
  if [ -f "$dir/.service" ]; then
    run bash -c "cd '$dir' && ./svc.sh stop; ./svc.sh uninstall"
  fi
  if [ -f "$dir/.runner" ]; then
    [ "$DRY_RUN" = 1 ] || : "${RUNNER_TOKEN:?a removal token is needed to unregister the runner (Settings > Actions > Runners > the runner > Remove)}"
    ACTIONS_RUNNER_INPUT_TOKEN=${RUNNER_TOKEN:-} run runuser --preserve-environment -u "$RUNNER_USER" -- bash -c "cd '$dir' && ./config.sh remove --unattended"
  fi
  run systemctl disable --now svelte-qa-emulator-watchdog.service svelte-qa-emulator.service || true
  run rm -f /etc/systemd/system/svelte-qa-emulator.service /etc/systemd/system/svelte-qa-emulator-watchdog.service /etc/sudoers.d/svelte-qa /etc/tmpfiles.d/svelte-qa.conf
  run rm -rf "$LOCK_DIR" "$OPT_DIR/bin"
  run systemctl daemon-reload
  if [ "$PURGE" = 1 ]; then
    run rm -rf "$OPT_DIR"
    run userdel --remove "$RUNNER_USER"
    run rm -rf "$STATE_DIR"
  else
    note "kept: $STATE_DIR (workspace, AVD, caches), $OPT_DIR/toolchain, the user $RUNNER_USER; --purge removes them"
  fi
}

report() {
  say "done"
  note "runner:   systemctl status 'actions.runner.*'   (journalctl -u 'actions.runner.*' -f)"
  note "emulator: sudo -u $RUNNER_USER $OPT_DIR/bin/emulator.sh status"
  note "lock:     ls -l $LOCK_DIR/emulator.lock; fuser -v $LOCK_DIR/emulator.lock"
}

if [ "$UNINSTALL" = 1 ]; then
  [ "$DRY_RUN" = 1 ] || [ "$(id -u)" = 0 ] || die "run as root (sudo -E ...)"
  uninstall
  exit 0
fi
preflight
install_packages
create_user
lock_directory
install_toolchain
install_sdk
create_avd
install_units
start_emulator
install_runner
report
