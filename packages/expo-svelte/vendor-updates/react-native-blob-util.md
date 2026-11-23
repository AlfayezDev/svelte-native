# react-native-blob-util

- **Current**: 0.24.9
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/RonRadtke/react-native-blob-util
- **Copy**: `vendor/react-native-blob-util/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The file and network layer react-native-pdf reads its files with; on only with react-native-pdf.

## Coupled with

react-native-pdf.

## Version policy

The newest release react-native-pdf works with (its README or peer range).

## Local changes

`0001-the-optimizing-proguard-file.patch` (Android): the release build type names `proguard-android-optimize.txt`; Android Gradle plugin 9 (React Native 0.88, Expo SDK 58) refuses the default file the version names, which carries `-dontoptimize` (the 1.x line, a Kotlin rewrite, has the same one-line change). Doctor shape: `blobUtilProblems`. The copy leaves out `windows`.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- Turned on by react-native-pdf (`requires`); nothing in the library calls it directly.

## What to look at in its source

- It is a file system and HTTP library: read its native diff for new network or file access, and for anything that runs at start-up.

## Native dependencies downloaded at build time

`org.apache.commons:commons-lang3:3.20.0`.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/pdf`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
