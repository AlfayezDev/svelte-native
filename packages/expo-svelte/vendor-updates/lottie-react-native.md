# lottie-react-native

- **Current**: 7.5.0
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/lottie-react-native/lottie-react-native
- **Copy**: `vendor/lottie-react-native/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `LottieView`.

## Coupled with

React Native's version (its peer range).

## Version policy

Its newest release whose peer range includes the library's React Native and that supports the New Architecture.

## Local changes

`0001-deliver-every-event-one-by-one.patch`: its events are delivered one by one on Android (none coalesces), and a load or failure before the event emitter exists is kept on iOS. Doctor shape: `lottieProblems`.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- `src/fabric/foreign-lottie.ts`, `src/components/LottieView.svelte`; its events are pinned by `tests/upstream/foreign-native-events.test.ts`.

## What to look at in its source

- The event classes the patch changes; a new event class must not coalesce either.
- 7.5 adds `applyOpacityToLayersAndroid` (view config, `LottieView.svelte` default `false` as in the library's `defaultProps`) and a `source` that may be a number; its peers are `react >=19.2` and `react-native >=0.84`.

## Native dependencies downloaded at build time

The pod `lottie-ios` 4.6.0 and `com.airbnb.android:lottie:6.7.1`: the animation runtimes, with their own releases.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/lottie`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
