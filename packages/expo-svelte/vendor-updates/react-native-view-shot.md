# react-native-view-shot

- **Current**: 6.1.1
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/gre/react-native-view-shot
- **Copy**: `vendor/react-native-view-shot/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `ViewShot` (capture a view to an image).

## Coupled with

React Native's version (its peer range).

## Version policy

Its newest release whose peer range includes the library's React Native and that supports the New Architecture.

## Local changes

None. The copy leaves out the repository's tooling that the tarball carries (`.github`, `CLAUDE.md`, `example-expo`, `babel.config.cjs`, tests; 5.1.0 also carried `.claude`, `coverage` and `babel.config.js`, which 6 does not).

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- `src/fabric/foreign-capture.ts`, `src/components/ViewShot.svelte`; the iOS capture contract (`tests/native-host/contracts/capture-ios.test.ts`, `tests/upstream/view-shot-ios.test.ts`).

## What to look at in its source

- New files the tarball carries that an app never needs: add them to the excludes.
- `validateOptions` of `src/index.tsx`, which `src/fabric/foreign-capture.ts` ports (6: finite numbers, a bad boolean falls back to its default, `webp` and the deprecated `webm`, a bad option is reported in every build); the Android format table of `Capture.kt` and `CaptureRules`; iOS `releaseCapture` (6 deletes only a regular file directly inside `tmp/ReactNative`, `tests/upstream/view-shot-ios.test.ts`). The tarball has a `Package.swift` (SwiftPM autolinking of React Native 0.87 and later) that CocoaPods ignores.

## Native dependencies downloaded at build time

None.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/view-shot`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
