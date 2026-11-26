#!/usr/bin/env bash
# The reference of the box styles lab (qa/README "Box styles"): the QA app's own native build with `entry.js`, a plain React Native app, as its JavaScript bundle. The Svelte
# host never runs, so the engine is never installed and React Native's own mounting draws every view. Needs the QA app's APK (`native-qa build --abi x86_64`) and the project
# `native-qa build` generated (apps/qa/android: its debug keystore signs the APK, which keeps the QA app's signature, so it installs over the QA app and back).
# Usage: build.sh <the QA app's APK> <output APK>   (from any directory)
set -euo pipefail
apk=$(realpath "${1:?usage: build.sh <the QA app APK> <output APK>}"); out=$(realpath -m "${2:?usage: build.sh <the QA app APK> <output APK>}")
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; qa="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
# Expo's CLI runs from this directory, which has a Metro config of its own (a plain one): `apps/qa/metro.config.cjs` is the Svelte app's, `withExpoSvelte`, which replaces React Native's
# initialization with the library's, and an `export:embed` run in `apps/qa` would use it.
cli="$(cd "$qa" && node --print "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })")"
(cd "$here" && node "$cli" export:embed --platform android --dev false --minify false --reset-cache --entry-file entry.js \
  --bundle-output "$work/index.android.bundle" --assets-dest "$work/res")
# The bundle goes into a copy of the APK in place of the Svelte app's, as Hermes bytecode (the release runtime has no compiler: it loads bytecode only).
hermesc="$(dirname "$(cd "$qa" && node --print "require.resolve('hermes-compiler/package.json', { paths: [require.resolve('react-native/package.json')] })")")/hermesc/linux64-bin/hermesc"
"$hermesc" -O -emit-binary -out "$work/index.android.hbc" "$work/index.android.bundle"
python3 - "$apk" "$work/index.android.hbc" "$work/unsigned.apk" <<'PY'
import sys, zipfile
src, bundle, dst = sys.argv[1:]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
    for item in zin.infolist():
        if item.filename.startswith("META-INF/"):
            continue  # the signature is made again
        data = open(bundle, "rb").read() if item.filename == "assets/index.android.bundle" else zin.read(item.filename)
        zout.writestr(item, data, compress_type=item.compress_type)
PY
tools="$(ls -d "${ANDROID_HOME:?ANDROID_HOME}"/build-tools/* | sort -V | tail -1)"
"$tools/zipalign" -f -p 4 "$work/unsigned.apk" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$qa/android/app/debug.keystore" --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey --out "$out" "$work/aligned.apk"
ls -l "$out"
