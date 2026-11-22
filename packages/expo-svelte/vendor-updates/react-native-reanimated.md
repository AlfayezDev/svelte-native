# react-native-reanimated

- **Current**: 4.5.1
- **Linked**: every app
- **Upstream**: https://github.com/software-mansion/react-native-reanimated
- **Copy**: `vendor/react-native-reanimated/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The animation host: animated styles and props, CSS animations and transitions, layout animations.

## Coupled with

react-native-worklets (Reanimated's `compatibility.json` names the Worklets versions each release supports; its peer is `0.10.x` today) and React Native (`0.83 - 0.86` today).

## Version policy

The newest 4.x that supports the library's React Native, moved with a Worklets version its compatibility table names.

## Local changes

`0001-engine-views-and-direct-props.patch` (Android: the engine's views are written natively, and opacity, translate and scale skip React Native's prop path), `0002-worklets-is-the-copy-beside-it.patch` (`scripts/validate-worklets-version.js` finds the Worklets copy beside it), `0003-android-synchronous-props-on-by-default.patch` (`src/featureFlags/staticFlags.json`: `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS` on). Doctor shape: `reanimatedProblems`.

## What the library relies on

- `src/fabric/reanimated-internals.js`: deep imports of internals Reanimated does not export (`updateProps`, `InlinePropManager`, `CSSManager`, `ViewDescriptorsSet` and others); a moved or renamed one breaks the bundle.
- `src/animation.ts`, `src/fabric/animation.ts`, `src/components/AnimatedView.svelte`.
- The transformer resolves `react-native-reanimated/plugin` to the copy (which re-exports the Worklets plugin).

## What to look at in its source

- The Android prop path patch 0001 changes: it is the library's performance fix, re-derive it with care and measure.
- `compatibility.json` and the peer ranges.

## Native dependencies downloaded at build time

None of its own beyond React Native's.

## Proof

- The animation tests (`tests/foreign/animation*`, the transitions tests), the animation screens on both platforms, the emulator lane's parity and a11y gates.
- Android frame timing of an animating screen against the current version (the patch's purpose).
