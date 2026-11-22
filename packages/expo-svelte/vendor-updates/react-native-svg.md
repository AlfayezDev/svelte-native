# react-native-svg

- **Current**: 15.16.0
- **Linked**: every app
- **Upstream**: https://github.com/react-native-community/react-native-svg
- **Copy**: `vendor/react-native-svg/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The SVG components (`src/components/svg/`) and inline `<svg>` in markup (`src/svg.ts`, `src/lower-html.ts`).

## Coupled with

The Expo SDK, which names the version `npx expo install react-native-svg` gives.

## Version policy

The version the library's Expo SDK gives; between SDKs, its patch releases.

## Local changes

None.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed); its 29 Fabric component descriptors are in the autolinking entry.
- Its color and prop processing, pinned by `tests/upstream/react-native-svg-colors.test.ts`.

## What to look at in its source

- New or renamed native components and props.
- 15.16 imports `codegenNativeComponent` from `react-native` (the Metro shim of `src/fabric/react-native-lite.ts` exports it), drops its `warn-once` dependency and `Touchable`, and adds the TurboModule `RNSVGSoundModule` (`playTouchSound`, `AudioManager.FX_KEY_CLICK`, behind `onPress` of a touchable element).

## Native dependencies downloaded at build time

None.

## Proof

- `tests/foreign/svg/` and the upstream pins; the SVG screens on both platforms.
