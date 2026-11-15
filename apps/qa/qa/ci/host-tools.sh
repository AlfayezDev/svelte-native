#!/usr/bin/env bash
# host-tools.sh — the tools the Kotlin and C++ host checks need and a CI runner does not come with: a pinned kotlinc and the org.json jar.
#
#   packages/svelte-native/native/svelte-core/android/src/test/engine.sh   g++ (C++20, sanitizers), kotlinc, java (gesture rules, capture, animated wire)
#   packages/svelte-native/tests/native-host/fixtures/*Host.kt, under `bun test`   kotlinc, java, and for the updates store the Android SDK's android.jar and org.json
#
# Without them those tests skip themselves, so the unit job fails on a missing tool instead (this script, and tests/native-host/native-tools.test.ts under CI=1).
#
# A JDK is not installed here (actions/setup-java in the workflow, openjdk-17-jdk-headless on the OVH runner), nor g++ (the hosted image has
# it; qa/ci/setup-runner.sh installs it on the OVH host). Each download is checked against the sha256 below and kept in the cache
# directory, so a runner whose home survives (the OVH one) downloads once:
#   kotlinc    https://github.com/JetBrains/kotlin/releases/download/v2.1.20/kotlin-compiler-2.1.20.zip  (JetBrains publishes the same sum as
#              kotlin-compiler-2.1.20.zip.sha256). 2.1.20 is the Kotlin the Android build compiles with (kotlin-compiler-embeddable 2.1.20)
#   org.json   https://repo1.maven.org/maven2/org/json/json/20250517/json-20250517.jar  (the real implementation Android provides at run time;
#              the sum is the one of the copy in Gradle's cache, and Maven Central's sha1 is d67181bbd819ccceb929b580a4e2fcb0c8b17cd8)
#
# In a workflow it adds kotlinc to GITHUB_PATH and sets ORG_JSON_JAR in GITHUB_ENV for the steps after it. From a terminal it prints the
# two lines to run:   eval "$(bash qa/ci/host-tools.sh)"
# Directory: $1, else $NATIVE_QA_HOST_TOOLS, else ~/.cache/native-qa-host-tools.
set -euo pipefail

KOTLIN_VERSION=2.1.20
KOTLIN_SHA256=a118197b0de55ffab2bc8d5cd03a5e39033cfb53383d6931bc761dec0784891a
KOTLIN_URL=https://github.com/JetBrains/kotlin/releases/download/v$KOTLIN_VERSION/kotlin-compiler-$KOTLIN_VERSION.zip
JSON_VERSION=20250517
JSON_SHA256=3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796
JSON_URL=https://repo1.maven.org/maven2/org/json/json/$JSON_VERSION/json-$JSON_VERSION.jar

DIR=${1:-${NATIVE_QA_HOST_TOOLS:-${XDG_CACHE_HOME:-$HOME/.cache}/native-qa-host-tools}}
KOTLINC_HOME=$DIR/kotlinc-$KOTLIN_VERSION
JSON_JAR=$DIR/json-$JSON_VERSION.jar

log() { echo "host-tools: $*" >&2; }
die() { log "$*"; exit 1; }

# fetch <url> <sha256> <target>: downloads next to the target, checks the sum, then renames, so a target is only ever a verified file.
fetch() {
  local url=$1 sum=$2 target=$3 tmp
  tmp=$(mktemp "$target.XXXXXX")
  log "downloading $url"
  curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 900 -o "$tmp" "$url" || { rm -f "$tmp"; die "cannot download $url"; }
  if ! echo "$sum  $tmp" | sha256sum -c --status -; then
    local got
    got=$(sha256sum "$tmp" | cut -d' ' -f1)
    rm -f "$tmp"
    die "$url has sha256 $got, not the pinned $sum"
  fi
  chmod 644 "$tmp"
  mv "$tmp" "$target"
}

mkdir -p "$DIR"

if [ ! -x "$KOTLINC_HOME/kotlinc/bin/kotlinc" ]; then
  command -v unzip >/dev/null || die "unzip is not installed"
  zip=$DIR/kotlin-compiler-$KOTLIN_VERSION.zip
  fetch "$KOTLIN_URL" "$KOTLIN_SHA256" "$zip"
  # Unpacked beside the final name and renamed, so a half-unpacked compiler is never taken for an installed one.
  staging=$(mktemp -d "$DIR/.kotlinc-staging.XXXXXX")
  unzip -q "$zip" -d "$staging" || { rm -rf "$staging"; die "cannot unpack $zip"; }
  chmod 755 "$staging"
  rm -rf "$KOTLINC_HOME"
  mv "$staging" "$KOTLINC_HOME"
  rm -f "$zip"
fi
[ -f "$JSON_JAR" ] || fetch "$JSON_URL" "$JSON_SHA256" "$JSON_JAR"

# What the tests will find, said now, in this step, rather than as skipped tests later.
kotlinc_bin=$KOTLINC_HOME/kotlinc/bin
PATH=$kotlinc_bin:$PATH
command -v java >/dev/null || die "java is not on the path (actions/setup-java, or openjdk-17-jdk-headless)"
command -v g++ >/dev/null || die "g++ is not on the path (build-essential)"
version=$(kotlinc -version 2>&1) || die "kotlinc does not run: $version"
case "$version" in *"$KOTLIN_VERSION"*) ;; *) die "kotlinc says '$version', not $KOTLIN_VERSION" ;; esac
log "$version; $(java -version 2>&1 | head -n 1); $(g++ --version | head -n 1)"
android_home=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/sdk}}
compgen -G "$android_home/platforms/*/android.jar" >/dev/null || log "warning: no platforms/*/android.jar under $android_home: the updates store checks will not run (ANDROID_HOME)"

if [ -n "${GITHUB_PATH:-}" ] && [ -n "${GITHUB_ENV:-}" ]; then
  echo "$kotlinc_bin" >> "$GITHUB_PATH"
  echo "ORG_JSON_JAR=$JSON_JAR" >> "$GITHUB_ENV"
else
  echo "export PATH=\"$kotlinc_bin:\$PATH\" ORG_JSON_JAR=\"$JSON_JAR\""
fi
