# react-native-animateable-text

- **Current**: 0.19.3
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/axelra-ag/react-native-animateable-text
- **Copy**: `vendor/react-native-animateable-text/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `AnimateableText` (text whose content Reanimated animates).

## Coupled with

React Native's version (its C++ copies React Native's text internals) and react-native-reanimated (animated text props).

## Version policy

Its newest release whose peer range includes the library's React Native and that supports the New Architecture.

## Local changes

None.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- The autolinking entry's overrides in `src/optional-libraries.ts`: `libraryName: "JBAnimatedText"` (its `react-native.config.js`), the component descriptor `CParagraphComponentDescriptor` and `cmakeListsPath`.
- `src/components/AnimateableText.svelte`.

## What to look at in its source

- Its C++ mirrors React Native's paragraph component: a React Native update can break it before the package has a release for it. Check the release's supported React Native first.

## Native dependencies downloaded at build time

None.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/animateable-text`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
