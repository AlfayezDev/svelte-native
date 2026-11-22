# react-native-view-shot

- **Current**: 5.1.0
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

None. The copy leaves out the repository's tooling that the tarball carries (`.claude`, `.github`, `CLAUDE.md`, `coverage`, `example-expo`, tests).

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- `src/fabric/foreign-capture.ts`, `src/components/ViewShot.svelte`; the iOS capture contract (`tests/native-host/contracts/capture-ios.test.ts`, `tests/upstream/view-shot-ios.test.ts`).

## What to look at in its source

- New files the tarball carries that an app never needs: add them to the excludes.

## Native dependencies downloaded at build time

None.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/view-shot`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
