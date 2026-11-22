# react-native-webview

- **Current**: 14.0.1
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/react-native-webview/react-native-webview
- **Copy**: `vendor/react-native-webview/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `WebView`.

## Coupled with

React Native's version (its peer range).

## Version policy

Its newest release whose peer range includes the library's React Native and that supports the New Architecture.

## Local changes

None. The copy leaves out `macos`, `windows` and `src/__tests__`.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- `src/components/WebView.svelte`, `src/fabric/foreign.ts`.

## What to look at in its source

- Permission handling for pages (camera, microphone, geolocation requests): a new default that grants or asks is a privacy change.
- Expo's own `@expo/dom-webview`, which `expo` brings, is separate and not this package.
- 14: the iOS prop `removeIosKeyboardObserver` (in the view config), no `isFileUploadSupported` in the module any more, Android `minSdkVersion` 24, the legacy `openFileChooser` overrides removed.

## Native dependencies downloaded at build time

`androidx.webkit:webkit` at the version its `build.gradle` sets; iOS uses WebKit.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/web-view`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
