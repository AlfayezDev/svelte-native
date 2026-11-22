# react-native-fast-shadow

- **Current**: 0.1.1
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/alan-eu/react-native-fast-shadow
- **Copy**: `vendor/react-native-fast-shadow/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `ShadowedView` (Android: a shadow drawn natively; iOS: React Native's own `View` and its layer shadow).

## Coupled with

React Native's version (its peer range).

## Version policy

Its newest release whose peer range includes the library's React Native and that supports the New Architecture.

## Local changes

None.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- `src/fabric/foreign-shadow.ts`, `src/components/ShadowedView.svelte`. It has no iOS code and no podspec.

## What to look at in its source

- A release that adds iOS code: it would need an iOS entry in `src/optional-libraries.ts`.

## Native dependencies downloaded at build time

None.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/shadow`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
