# react-native-maps

- **Current**: 1.27.2
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/react-native-maps/react-native-maps
- **Copy**: `vendor/react-native-maps/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `MapView` and `Marker`; its config plugin runs from the copy (`androidGoogleMapsApiKey`, `iosGoogleMapsApiKey`).

## Coupled with

React Native's version (its peer range).

## Version policy

Its newest release whose peer range includes the library's React Native and that supports the New Architecture.

## Local changes

`0001-deliver-discrete-events-one-by-one.patch` (Android: discrete events never coalesce, streams still do) and `0002-the-podfile-finds-the-copy.patch` (its iOS plugin writes a Podfile path to the library's copy, not to an installed package). Doctor shape: `mapsProblems`.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- `src/components/MapView.svelte`, `src/components/Marker.svelte`, `src/fabric/foreign.ts`; events pinned by `tests/upstream/foreign-native-events.test.ts`.
- Its plugin requires `@expo/config-plugins` by name, which resolves through the app's hoisting (VENDORING.md).

## What to look at in its source

- It references CoreLocation (the user location), which is why it stays optional: App Store Connect asks every app whose binary references CoreLocation for a usage text.
- The Podfile code its plugin writes (patch 0002) and the event classes (patch 0001).

## Native dependencies downloaded at build time

Android: Google Play services maps, base and location at the versions its `build.gradle` sets. iOS: Apple Maps by default; `GoogleMaps` 9.4.0 and `Google-Maps-iOS-Utils` 6.1.0 only with the Google provider (`iosGoogleMapsApiKey`).

## Proof

- iOS with `iosGoogleMapsApiKey` set: `pod install` takes `react-native-maps/Google` from the copy.
- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/map`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
