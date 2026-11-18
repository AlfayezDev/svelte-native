# react-native-gesture-handler

- **Current**: 2.32.0
- **Linked**: every app
- **Upstream**: https://github.com/software-mansion/react-native-gesture-handler
- **Copy**: `vendor/react-native-gesture-handler/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The gestures host: the library reuses its gesture builders, config classes, handler registries and constants, and links its native recognizers.

## Coupled with

react-native-reanimated (gesture callbacks run as worklets) and React Native's version.

## Version policy

The newest 2.x whose peer range includes the library's React Native. A 3.x is a project of its own.

## Local changes

`0001-root-recognizer-for-presented-screens.patch` (iOS): the root gesture recognizer can be registered for the screens the library presents. Doctor shape: `rnghProblems` in `src/doctor/shapes.ts`.

## What the library relies on

- `src/gestures/rngh.js`: deep imports of its pure modules (22 modules, no `react-native`); `tests/gestures/isolation.test.ts` keeps the set. The file lists the paths that must never be imported.
- `src/gestures/constants.js`, `src/fabric/gestures.ts`, `src/fabric/responder.ts`: its state and event constants and its native event shape.
- The Android engine's host check (`native/svelte-core/android/src/test/engine.sh`) reads the copy's sources.

## What to look at in its source

- A change to a module `rngh.js` imports, or a new import from one of them into `react-native` or Reanimated: the isolation test fails; the fix is in `rngh.js`, not the test.
- The iOS root recognizer code the patch changes.

## Native dependencies downloaded at build time

`androidx.appcompat:appcompat:1.7.0`.

## Proof

- `tests/gestures/` (golden, events, isolation, responder), `tests/upstream/react-native-gesture-handler-patch.test.ts`, the engine host check.
- The gestures screen on both platforms, and the iPhone gestures run of the QA harness (edge swipes, sheets) when a device is available.
