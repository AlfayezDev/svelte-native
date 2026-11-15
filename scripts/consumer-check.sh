#!/usr/bin/env bash
# Proves that an app outside this repository can install and build the library.
#
#   scripts/consumer-check.sh [tarball|git|starter|all]      (default: all)
#
# It copies the template app (examples/minimal) to a scratch directory outside the repository and outside any pnpm workspace, so nothing
# resolves through this repository, then does what the package README ("Install in an app", "Apply the patches") tells an app to do:
#
#   tarball   the library is `pnpm pack`ed and installed as a tarball (`pnpm add <tgz>`): exactly what `files` in package.json ships
#   git       the library is installed as a pnpm git dependency of this repository's own commit:
#               pnpm add "git+file://<repo>#<commit>&path:packages/svelte-native"
#             apps install it from the private repository the same way:
#               pnpm add "git+ssh://git@github.com/AlfayezDev/svelte-native.git#<tag>&path:packages/svelte-native"
#
#   starter   the path the guide (docs/10-getting-started/20-creating-a-project.md) gives a person, from a SvelteKit project and not from the template:
#               pnpm dlx sv create <app> --template minimal --types ts --no-add-ons --install pnpm
#               pnpm add "git+file://<repo>#<commit>&path:packages/svelte-native"      (the first install: Svelte is still the registry's)
#               pnpm exec svelte-native init                                              (the install and the doctor are part of it)
#             and then what the guide promises: init again changes nothing, `pnpm check` has no error, `pnpm build` builds the web app, and the
#             native stages below. Svelte comes from pkg.pr.new, as it does for a person (SV_VERSION is the sv release asked for, 1.3.0).
#
# The tarball and git modes install the custom-renderer Svelte from the tarball vendored in vendor/ (no registry, no preview server), then run the stages
# below in order. Each stage prints its result; its log is `<scratch>/<mode>/logs/NN-<stage>.log`.
#
#   scratch   the scratch directory is outside this repository and outside any pnpm workspace
#   source    tarball: pnpm pack, and the tarball holds the native modules, the patches and the module config
#             git: the commit to install, and a warning if the working tree differs from it (the commit is what is installed)
#   template  examples/minimal copied, without its patchedDependencies block (the app before "Apply the patches")
#   install   pnpm add <library> <svelte>
#   patches   the patch files copied as the README says, the block declared, pnpm install; every patch is in the lockfile
#   doctor    pnpm exec svelte-native doctor: no failed check
#   sv        (starter) sv create, every question answered by a flag
#   add       (starter) pnpm add of the library: what the first install of an sv project does
#   init      (starter) pnpm exec svelte-native init: the files, pnpm install and the doctor, which must pass
#   again     (starter) init a second time: no file changes
#   check     (starter) pnpm check: svelte-check finds no error
#   web       (starter) pnpm build: the web app still builds, and its build holds no native route
#   sync      pnpm exec svelte-native sync: .svelte-native/entry.ts and the route table
#   bundle    expo export:embed for Android, the way React Native's Gradle plugin bundles; nothing in the source map is from this repository
#   prebuild  expo prebuild --platform android --no-install: the config plugin ran; nothing generated points into this repository
#   gradle    ./gradlew :app:assembleRelease for one ABI
#   apk       the APK: path, size, sha256, and it holds the engine, the Hermes bundle and the app id
#
# Exit status: 0 when every stage of every mode passed; 1 otherwise. A stage that fails stops its mode (the later stages are not run) unless
# KEEP_GOING=1, which runs every stage that does not need the failed one and prints a table at the end. On success the scratch directory is
# removed unless KEEP=1; on failure it stays.
#
# Environment:
#   WORK=<dir>        where the scratch directories go (default ${TMPDIR:-/tmp}/svelte-native-consumer-check); must be outside any pnpm workspace
#   KEEP=1            keep the scratch directories after a successful run
#   KEEP_GOING=1      carry on past a failed stage
#   ABI=x86_64        the ABI Gradle builds (x86_64, arm64-v8a)
#   SKIP_BUILD=1      stop before prebuild and Gradle (the JavaScript side only)
#   SV_VERSION=1.3.0  the release of sv the starter mode runs
#   APK_OUT=<dir>     copy the APK to <dir>/consumer-<mode>-<abi>.apk
#   GIT_URL=<url>     the repository of the git mode (default git+file://<this checkout>); GIT_REF=<branch|tag|commit> (default HEAD's commit)
#   CAP="<prefix>"    prefix for every heavy command; default `systemd-run --user --scope --quiet -p CPUQuota=600% -p MemoryHigh=16G nice -n 19 ionice -c3`
#                     when systemd-run works, else `nice -n 19`; CAP= (empty) runs them bare
#   OFFLINE=1         pnpm --offline and Gradle --offline (the stores and caches must already hold everything)
#   AFTER_INSTALL=<shell>  a command run in the app after "patches" (before "doctor"), as a stage of its own: for experiments on the installed copy
#   STRIP_SHIM=1      DIAGNOSTIC. Node refuses TypeScript under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), which is how the
#                     library's CLI, Metro config, Expo plugin and transformer are shipped until they are compiled. This loads a hook that
#                     strips the types itself, in every Node process the stages start (Gradle's included), to see what else would fail.
#                     It proves nothing about the shipped package: leave it off for the real check.
#   JAVA_HOME, ANDROID_HOME   the JDK (17) and the Android SDK (with the NDK and CMake the build needs); default /usr/lib/jvm/java-17-openjdk and ~/Android/sdk
set -uo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
package=$repo/packages/svelte-native
template=$repo/examples/minimal
work=${WORK:-${TMPDIR:-/tmp}/svelte-native-consumer-check}
abi=${ABI:-x86_64}
modes=()
case "${1:-all}" in
  tarball) modes=(tarball) ;;
  git) modes=(git) ;;
  starter) modes=(starter) ;;
  all) modes=(tarball git starter) ;;
  *) echo "usage: scripts/consumer-check.sh [tarball|git|starter|all]" >&2; exit 2 ;;
esac
sv_version=${SV_VERSION:-1.3.0}

# ---- the capped runner -------------------------------------------------------------------------------------------------------------------
if [ "${CAP+set}" = set ]; then
  read -r -a cap_prefix <<<"$CAP"
elif command -v systemd-run >/dev/null 2>&1 && systemd-run --user --scope --quiet true >/dev/null 2>&1; then
  cap_prefix=(systemd-run --user --scope --quiet -p CPUQuota=600% -p MemoryHigh=16G nice -n 19 ionice -c3)
else
  cap_prefix=(nice -n 19)
fi
cap() { "${cap_prefix[@]}" "$@"; }
pnpm_flags=(--prefer-offline)
gradle_flags=()
if [ "${OFFLINE:-}" = 1 ]; then pnpm_flags=(--offline); gradle_flags=(--offline); fi

# ---- the toolchain -----------------------------------------------------------------------------------------------------------------------
if [ -z "${JAVA_HOME:-}" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -q '"17\.'; then
  [ -x /usr/lib/jvm/java-17-openjdk/bin/java ] && export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
fi
export ANDROID_HOME=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/sdk}}
export ANDROID_SDK_ROOT=$ANDROID_HOME
export CI=1 EXPO_NO_TELEMETRY=1 SENTRY_DISABLE_AUTO_UPLOAD=true

# ---- stages ------------------------------------------------------------------------------------------------------------------------------
declare -A status      # "<mode>/<stage>" -> ok | FAILED | skipped
abort=0
declare -a table       # "<mode> <stage> <result> <seconds>"
failed=0
mode=
mode_dir=
app=
logs=
tarballs=
step=0

die() { echo "error: $*" >&2; exit 1; }
dev_spec() { node -e 'const p=require(process.argv[1]);console.log((p.devDependencies||{})[process.argv[2]]||"")' "$app/package.json" "$1"; }
spec_of() { node -e 'const p=require(process.argv[1]);console.log((p.dependencies||{})[process.argv[2]]||"")' "$app/package.json" "$1"; }

# run_stage <name> <needs, space separated or ""> <function>: records the result in status[] and always returns 0. It must not be called from
# an `if`, `&&` or `||` condition: bash would then ignore `set -e` in the stage's subshell, and a failing command in the middle of a stage
# would not fail it.
run_stage() {
  local name=$1 needs=$2 fn=$3 need log started code
  step=$((step + 1))
  log=$logs/$(printf '%02d' "$step")-$name.log
  for need in $needs; do
    if [ "${status[$mode/$need]:-}" != ok ]; then
      echo "== $mode: $name ... skipped (needs $need)"
      status[$mode/$name]=skipped
      table+=("$mode $name skipped -")
      return 0
    fi
  done
  started=$SECONDS
  printf '== %s: %s ... ' "$mode" "$name"
  ( set -euo pipefail; cd "$mode_dir"; "$fn" ) >"$log" 2>&1
  code=$?
  if [ "$code" -eq 0 ]; then
    echo "ok ($((SECONDS - started)) s)"
    status[$mode/$name]=ok
    table+=("$mode $name ok $((SECONDS - started))")
    return 0
  fi
  echo "FAILED (exit $code, $((SECONDS - started)) s) -> $log"
  tail -n 25 "$log" | sed 's/^/   | /'
  if grep -q ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING "$log"; then
    echo "   note: Node refuses TypeScript under node_modules; a Node-side entry of the library is shipped as TypeScript"
  fi
  status[$mode/$name]=FAILED
  table+=("$mode $name FAILED $((SECONDS - started))")
  failed=1
  return 0
}

# stage <name> <needs> <function> [hard]: a failed stage ends the mode when it is hard (the later stages stand on it) or KEEP_GOING is not 1.
stage() {
  run_stage "$1" "$2" "$3"
  if [ "${status[$mode/$1]}" = FAILED ] && { [ "${4:-}" = hard ] || [ "${KEEP_GOING:-}" != 1 ]; }; then abort=1; fi
  return 0
}

st_scratch() {
  case "$mode_dir/" in "$repo"/*) die "the scratch directory $mode_dir is inside the repository" ;; esac
  local dir=$mode_dir
  while [ "$dir" != / ]; do
    [ -e "$dir/pnpm-workspace.yaml" ] && die "$dir/pnpm-workspace.yaml: the scratch directory is inside a pnpm workspace"
    dir=$(dirname "$dir")
  done
  echo "scratch: $mode_dir (outside $repo, no pnpm-workspace.yaml above it)"
  echo "node $(node --version), pnpm $(pnpm --version), java: $("${JAVA_HOME:+$JAVA_HOME/bin/}java" -version 2>&1 | head -1), ANDROID_HOME=$ANDROID_HOME"
}

st_source_tarball() {
  cd "$package"
  cap pnpm pack --pack-destination "$tarballs"
  local tgz
  tgz=$(ls "$tarballs"/alfayez-svelte-native-*.tgz)
  echo "packed: $tgz ($(stat -c %s "$tgz") bytes, $(tar tzf "$tgz" | wc -l) files)"
  local listing
  listing=$(tar tzf "$tgz")
  for required in package/package.json package/expo-module.config.json package/README.md package/patches/expo-modules-core@57.0.23.patch package/native/svelte-core/android/build.gradle package/native/svelte-core/android/build.gradle; do
    grep -qx "$required" <<<"$listing" || die "the tarball has no $required"
  done
  grep -q '^package/native/.*/test/' <<<"$listing" && die "the tarball carries a native test directory"
  echo "the tarball holds the native modules, the module config and $(grep -c '^package/patches/.*\.patch$' <<<"$listing") patches"
}

st_source_git() {
  git -C "$repo" cat-file -e "$git_ref^{commit}" 2>/dev/null || [ "${GIT_URL:-}" != "" ] || die "$git_ref is not a commit of $repo"
  echo "installing: $git_url#$git_ref&path:packages/svelte-native"
  local dirty
  dirty=$(git -C "$repo" status --porcelain -- packages/svelte-native vendor)
  [ -z "$dirty" ] || { echo "warning: uncommitted changes in the library; the git dependency installs the commit, not the working tree:"; echo "$dirty"; }
}

st_svelte() {
  local tgz
  tgz=$(ls "$repo"/vendor/svelte-*.tgz)
  [ "$(wc -w <<<"$tgz")" -eq 1 ] || die "expected one vendored svelte tarball in vendor/"
  cp "$tgz" "$tarballs/"
  tar xzOf "$tgz" package/package.json | node -e 'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));if(p.name!=="svelte")process.exit(1);console.log("svelte "+p.version)'
  local listing
  listing=$(tar tzf "$tgz")
  grep -qx 'package/src/renderer/index.js' <<<"$listing" || die "the vendored svelte has no renderer"
}

st_template() {
  mkdir -p "$app"
  tar -C "$template" -cf - --exclude=node_modules --exclude=.svelte-native --exclude=android --exclude=ios --exclude=.expo . | tar -C "$app" -xf -
  # The app before "Apply the patches": the block is the last of the file, set aside and declared by the "patches" stage.
  awk '/^patchedDependencies:/ { exit } { print }' "$template/pnpm-workspace.yaml" >"$app/pnpm-workspace.yaml"
  awk '/^patchedDependencies:/ { found = 1 } found { print }' "$template/pnpm-workspace.yaml" >"$mode_dir/patched-dependencies.yaml"
  [ -s "$mode_dir/patched-dependencies.yaml" ] || die "examples/minimal/pnpm-workspace.yaml has no patchedDependencies block"
  awk 'NR > 1 && NF && !/^ / { exit 1 }' "$mode_dir/patched-dependencies.yaml" || die "patchedDependencies must be the last block of examples/minimal/pnpm-workspace.yaml"
  # Nothing the app is made of reaches into this repository: no relative path out of it, no workspace/link/file specifier, no import of the library by path.
  if grep -rnE '\.\./|packages/svelte-native|apps/(example|qa)' "$app/src" "$app/metro.config.cjs" "$app/app.json"; then die "the template points into the repository"; fi
  if grep -nE '"(workspace|link|file):' "$app/package.json"; then die "the template's package.json has a workspace:, link: or file: specifier"; fi
  echo "template: $(find "$app" -type f | wc -l) files, $(($(wc -l <"$mode_dir/patched-dependencies.yaml") - 1)) patches to declare"
}

st_install() {
  cd "$app"
  local library
  if [ "$mode" = tarball ]; then library=$(ls "$tarballs"/alfayez-svelte-native-*.tgz); else library="$git_url#$git_ref&path:packages/svelte-native"; fi
  echo "+ pnpm add $library $(ls "$tarballs"/svelte-*.tgz)"
  cap pnpm add "${pnpm_flags[@]}" "$library" "$(ls "$tarballs"/svelte-*.tgz)"
  echo "package.json: \"@alfayez/svelte-native\": \"$(spec_of @alfayez/svelte-native)\""
  echo "package.json: \"svelte\": \"$(spec_of svelte)\""
  [ -f node_modules/@alfayez/svelte-native/package.json ] || die "node_modules/@alfayez/svelte-native is missing"
  [ -f node_modules/@alfayez/svelte-native/expo-module.config.json ] || die "the installed library has no expo-module.config.json"
  if [ "$mode" = git ]; then grep -m1 "resolution: {commit" pnpm-lock.yaml | sed 's/^ */lockfile: /'; fi
}

st_patches() {
  cd "$app"
  # README, "Apply the patches": copy the files, declare them, install again.
  mkdir -p patches/svelte-native
  cp node_modules/@alfayez/svelte-native/patches/*.patch patches/svelte-native/
  echo "copied $(ls patches/svelte-native | wc -l) patch files"
  cat "$mode_dir/patched-dependencies.yaml" >>pnpm-workspace.yaml
  # Declaring the patches changes the lockfile; with CI=1 pnpm would refuse ("frozen installation"), so the first install after the declaration is not frozen.
  cap pnpm install --no-frozen-lockfile "${pnpm_flags[@]}"
  local declared key
  declared=$(sed -n 's/^  "\{0,1\}\([^":]*[^":]\)"\{0,1\}: patches.*/\1/p' "$mode_dir/patched-dependencies.yaml")
  [ -n "$declared" ] || die "no patch declared"
  for key in $declared; do
    grep -qF "$key" <(sed -n '/^patchedDependencies:/,/^$/p' pnpm-lock.yaml) || die "$key is not in the lockfile's patchedDependencies"
    echo "patched: $key"
  done
}

st_hook() {
  cd "$app"
  echo "+ $AFTER_INSTALL"
  bash -c "$AFTER_INSTALL"
}

st_doctor() {
  cd "$app"
  cap pnpm exec svelte-native doctor
}

# What a person types: every question of `sv create` answered by a flag, so that nothing is asked.
st_sv() {
  cd "$mode_dir"
  cap pnpm dlx "sv@$sv_version" create app --template minimal --types ts --no-add-ons --install pnpm </dev/null
  [ -f "$app/package.json" ] || die "sv create did not make $app/package.json"
  grep -q '"@sveltejs/kit"' "$app/package.json" || die "the sv project has no SvelteKit"
  echo "sv $sv_version: $(dev_spec @sveltejs/kit) and svelte $(dev_spec svelte), the registry builds"
}

# The first install: Svelte is the registry's, the peers are missing and nothing is declared. It must succeed and leave a CLI that runs.
st_add() {
  cd "$app"
  local library="$git_url#$git_ref&path:packages/svelte-native"
  echo "+ pnpm add $library"
  cap pnpm add "${pnpm_flags[@]}" "$library"
  [ -f node_modules/@alfayez/svelte-native/package.json ] || die "node_modules/@alfayez/svelte-native is missing"
  # init has to run in a project that is not set up yet: no Svelte renderer, no Metro, no patches.
  cap pnpm exec svelte-native init --dry-run | sed -n '1,6p'
  [ -z "$(cd "$app" && ls patches 2>/dev/null)" ] || die "init --dry-run wrote patches"
}

# The command of the guide. It installs and runs the doctor itself.
st_init() {
  cd "$app"
  cap pnpm exec svelte-native init
  [ -f .svelte-native/entry.ts ] || echo "(the entry is written by sync, below)"
  for file in metro.config.cjs app.json src/routes/+layout.mobile.svelte src/routes/+mobile.svelte src/routes/details/+mobile.svelte patches/svelte-native; do
    [ -e "$file" ] || die "init did not write $file"
  done
  grep -q "svelteNative" vite.config.ts || die "init did not change vite.config.ts"
  echo "package.json: svelte $(dev_spec svelte), @sveltejs/kit $(dev_spec @sveltejs/kit)"
  grep -m1 "resolution: {commit" pnpm-lock.yaml | sed 's/^ */lockfile: /'
}

# Running it again changes nothing: not a file of the project, whatever the tool wrote the first time.
st_again() {
  cd "$app"
  local before after
  before=$(find . \( -path ./node_modules -o -path ./.svelte-kit -o -path ./.svelte-native -o -path ./out \) -prune -o -type f -print0 | sort -z | xargs -0 sha256sum)
  cap pnpm exec svelte-native init --no-install | tee "$mode_dir/again.out"
  grep -q "Nothing to change" "$mode_dir/again.out" || die "the second init did not say that nothing changed"
  after=$(find . \( -path ./node_modules -o -path ./.svelte-kit -o -path ./.svelte-native -o -path ./out \) -prune -o -type f -print0 | sort -z | xargs -0 sha256sum)
  [ "$before" = "$after" ] || { diff <(echo "$before") <(echo "$after") || true; die "the second init changed a file"; }
  echo "unchanged: $(echo "$after" | wc -l) files"
}

# svelte-check follows the imports into the library's own source: a type of the library that a SvelteKit project's tsconfig cannot hold shows up here.
st_check() {
  cd "$app"
  cap pnpm check
}

st_web() {
  cd "$app"
  cap pnpm build
  [ -d .svelte-kit/output ] || die "the web build left no .svelte-kit/output"
  if grep -rl "details/+mobile\|+layout.mobile" .svelte-kit/output; then die "the web build holds a native route"; fi
  echo "web build: $(find .svelte-kit/output -type f | wc -l) files, no native route in it"
}

st_sync() {
  cd "$app"
  cap pnpm exec svelte-native sync
  [ -f .svelte-native/entry.ts ] || die ".svelte-native/entry.ts was not written"
  ls .svelte-native
}

st_bundle() {
  cd "$app"
  mkdir -p out "$mode_dir/metro-tmp"
  # NODE_ENV=production and a Metro cache of its own, as qa/test/bundle.test.ts bundles.
  NODE_ENV=production TMPDIR="$mode_dir/metro-tmp" cap pnpm exec expo export:embed --platform android --dev false --minify false --reset-cache \
    --entry-file .svelte-native/entry.ts --bundle-output out/index.android.bundle --sourcemap-output out/index.android.bundle.map --assets-dest out/assets
  node - "$app/out/index.android.bundle.map" "$app/out/index.android.bundle" "$repo" <<'JS'
const fs = require("node:fs");
const [map, bundle, repo] = process.argv.slice(2);
const sources = JSON.parse(fs.readFileSync(map, "utf8")).sources;
const text = fs.readFileSync(map, "utf8");
const inRepo = sources.filter((source) => source.includes(`${repo}/`));
if (text.includes(`${repo}/`)) { console.error(`the source map mentions ${repo}`); process.exit(1); }
const need = ["src/routes/+mobile.svelte", "src/routes/+layout.mobile.svelte", "src/routes/details/+mobile.svelte", "@alfayez/svelte-native/src/router.svelte.ts", "@alfayez/svelte-native/src/fabric/index.ts"];
const missing = need.filter((suffix) => !sources.some((source) => source.endsWith(suffix)));
if (missing.length) { console.error(`not in the bundle: ${missing.join(", ")}`); process.exit(1); }
console.log(`bundle: ${fs.statSync(bundle).size} bytes, ${sources.length} modules, none from ${repo} (${inRepo.length})`);
JS
}

st_prebuild() {
  cd "$app"
  cap pnpm exec expo prebuild --platform android --no-install
  grep -q "Svelte native: headless autolinking excludes" android/settings.gradle || die "the config plugin did not write android/settings.gradle"
  grep -rqs "SvelteNativeHeadlessMainPackage" android/app/src/main/java || die "the config plugin did not write MainApplication.kt"
  if grep -rIl --exclude-dir=build --exclude-dir=.gradle --exclude-dir=.cxx "$repo" android; then die "files under android/ point into $repo"; fi
  echo "android/ generated by the plugin, nothing in it points into the repository"
}

st_gradle() {
  cd "$app/android"
  [ -d "$ANDROID_HOME/platforms" ] || die "ANDROID_HOME=$ANDROID_HOME has no platforms/"
  # A single-use daemon: nothing is left running, and another Gradle build of this machine is not disturbed.
  cap ./gradlew :app:assembleRelease "-PreactNativeArchitectures=$abi" --console=plain "-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1g" \
    --max-workers=4 --no-daemon "${gradle_flags[@]}"
  if grep -rIl --exclude-dir=.gradle --exclude-dir=.cxx --include=*.gradle --include=*.json --include=*.properties --include=*.kt --include=*.java "$repo" . ; then
    die "the Android project points into $repo"
  fi
}

st_apk() {
  local apk=$app/android/app/build/outputs/apk/release/app-release.apk
  [ -f "$apk" ] || die "no APK at $apk"
  echo "apk:    $apk"
  echo "size:   $(stat -c %s "$apk") bytes"
  echo "sha256: $(sha256sum "$apk" | cut -d' ' -f1)"
  local listing
  listing=$(unzip -l "$apk")
  for entry in "lib/$abi/libsvelteengine.so" assets/index.android.bundle classes.dex; do
    grep -q " $entry\$" <<<"$listing" || die "the APK has no $entry"
  done
  echo "the APK holds lib/$abi/libsvelteengine.so, assets/index.android.bundle and classes.dex"
  local aapt2
  aapt2=$(ls "$ANDROID_HOME"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)
  if [ -n "$aapt2" ]; then
    "$aapt2" dump badging "$apk" | grep -E "^package:|^native-code:" || true
  fi
  if [ -n "${APK_OUT:-}" ]; then
    mkdir -p "$APK_OUT"
    cp "$apk" "$APK_OUT/consumer-$mode-$abi.apk"
    echo "copied to $APK_OUT/consumer-$mode-$abi.apk"
  fi
}

# ---- one mode ----------------------------------------------------------------------------------------------------------------------------
run_mode() {
  mode=$1
  mode_dir=$work/$mode
  app=$mode_dir/app
  logs=$mode_dir/logs
  tarballs=$mode_dir/tarballs
  step=0
  rm -rf "$mode_dir"
  mkdir -p "$logs" "$tarballs"
  echo
  echo "######## $mode ########"
  git_url=${GIT_URL:-git+file://$repo}
  git_ref=${GIT_REF:-$(git -C "$repo" rev-parse HEAD)}
  abort=0
  stage scratch "" st_scratch hard
  if [ $abort = 0 ]; then
    if [ "$mode" = tarball ]; then stage source scratch st_source_tarball hard; else stage source scratch st_source_git hard; fi
  fi
  if [ "$mode" = starter ]; then
    if [ $abort = 0 ]; then stage sv source st_sv hard; fi
    if [ $abort = 0 ]; then stage add sv st_add hard; fi
    if [ $abort = 0 ]; then stage init add st_init hard; fi
    if [ $abort = 0 ]; then stage again init st_again; fi
    if [ $abort = 0 ]; then stage check init st_check; fi
    if [ $abort = 0 ]; then stage web init st_web; fi
    patches_stage=init
  else
    if [ $abort = 0 ]; then stage svelte source st_svelte hard; fi
    if [ $abort = 0 ]; then stage template svelte st_template hard; fi
    if [ $abort = 0 ]; then stage install template st_install hard; fi
    if [ $abort = 0 ]; then stage patches install st_patches hard; fi
    patches_stage=patches
  fi
  if [ $abort = 0 ] && [ -n "${AFTER_INSTALL:-}" ]; then stage hook $patches_stage st_hook hard; fi
  if [ $abort = 0 ] && [ "$mode" != starter ]; then stage doctor patches st_doctor; fi
  if [ $abort = 0 ]; then stage sync $patches_stage st_sync; fi
  if [ $abort = 0 ]; then stage bundle $patches_stage st_bundle; fi
  if [ $abort = 0 ] && [ "${SKIP_BUILD:-}" != 1 ]; then stage prebuild $patches_stage st_prebuild; fi
  if [ $abort = 0 ] && [ "${SKIP_BUILD:-}" != 1 ]; then stage gradle prebuild st_gradle; fi
  if [ $abort = 0 ] && [ "${SKIP_BUILD:-}" != 1 ]; then stage apk gradle st_apk; fi
  return 0
}

# ---- the diagnostic hook -----------------------------------------------------------------------------------------------------------------
if [ "${STRIP_SHIM:-}" = 1 ]; then
  mkdir -p "$work"
  cat >"$work/strip-ts.mjs" <<'JS'
// DIAGNOSTIC (consumer-check.sh STRIP_SHIM=1): Node refuses TypeScript under node_modules; strip the types for it, in this process and its children.
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && /\.[cm]?ts$/.test(url) && url.includes("/node_modules/")) {
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "strip", sourceUrl: url });
      return { format: url.endsWith(".cts") ? "commonjs" : "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
JS
  export NODE_OPTIONS="${NODE_OPTIONS:-} --import=$work/strip-ts.mjs --disable-warning=ExperimentalWarning"
  echo "STRIP_SHIM=1: Node strips TypeScript under node_modules (diagnostic; the shipped package is not what is being checked)"
fi

echo "repository: $repo @ $(git -C "$repo" rev-parse --short HEAD) ($(git -C "$repo" rev-parse --abbrev-ref HEAD))"
echo "modes: ${modes[*]}   abi: $abi   heavy commands: ${cap_prefix[*]:-(bare)}"
for m in "${modes[@]}"; do run_mode "$m"; done

# ---- the result --------------------------------------------------------------------------------------------------------------------------
echo
echo "######## result ########"
printf '%-8s %-9s %-8s %s\n' mode stage result seconds
for row in "${table[@]}"; do read -r a b c d <<<"$row"; printf '%-8s %-9s %-8s %s\n' "$a" "$b" "$c" "$d"; done
if [ "$failed" -eq 0 ]; then
  echo "consumer-check: ok"
  if [ "${KEEP:-}" = 1 ]; then echo "kept: $work"; else for m in "${modes[@]}"; do rm -rf "${work:?}/$m"; done; rm -f "$work/strip-ts.mjs"; rmdir "$work" 2>/dev/null || true; fi
  exit 0
fi
echo "consumer-check: FAILED (the scratch directories and logs are kept in $work)"
exit 1
