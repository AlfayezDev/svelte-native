# rive-react-native

- **Current**: 9.7.1
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/rive-app/rive-react-native
- **Copy**: `vendor/rive-react-native/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `Rive` view.

## Coupled with

React Native's version (its peer range).

## Version policy

Its newest release whose peer range includes the library's React Native and that supports the New Architecture.

## Local changes

`0001-events-through-the-event-dispatcher.patch` (Android): the seven view events go through `UIManagerHelper`'s event dispatcher instead of `RCTEventEmitter.receiveEvent`, which a bridgeless app reports for every event; same names, not coalesced. Doctor shape: `riveProblems`.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- `src/fabric/foreign-rive.ts`, `src/components/Rive.svelte`; event names `topPlay` and the others match `src/fabric/view-configs.ts`.

## What to look at in its source

- Any new `getJSModule(RCTEventEmitter)` call in the Android view: the patch's reason applies to it too.
- The Rive runtime versions the package pins (below).

## Native dependencies downloaded at build time

The pod `RiveRuntime` and `app.rive:rive-android` at the versions the package pins (its podspec and `android/build.gradle`), plus AndroidX lifecycle, appcompat, startup and kotlinx-coroutines.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/rive`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
