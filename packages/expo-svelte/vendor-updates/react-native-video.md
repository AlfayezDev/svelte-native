# react-native-video

- **Current**: 6.19.3
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/TheWidlarzGroup/react-native-video
- **Copy**: `vendor/react-native-video/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `Video`; its config plugin runs from the copy.

## Coupled with

React Native's version (its peer range).

## Version policy

Its newest release whose peer range includes the library's React Native and that supports the New Architecture.

## Local changes

`0001-coalesce-only-progress-and-bandwidth.patch` (Android): only progress and bandwidth events coalesce; every other event is delivered. Doctor shapes: `videoProblems`, `videoEmitterProblems`.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- `src/fabric/foreign-video.ts`, `src/components/Video.svelte`, `src/lower-html.ts` (`<video>`); events pinned by `tests/upstream/foreign-native-events.test.ts`.

## What to look at in its source

- Its optional subspecs and plugin options: the ads SDKs (Google IMA) and the caching libraries must stay off unless an app asks; a change that turns one on by default is a red flag.

## Native dependencies downloaded at build time

AndroidX Media3; the iOS subspecs' `GoogleAds-IMA-iOS-SDK`, `SPTPersistentCache` and `DVAssetLoaderDelegate` only when an app enables ads or caching.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/video`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
