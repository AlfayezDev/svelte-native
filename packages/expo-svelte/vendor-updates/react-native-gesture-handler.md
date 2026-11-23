# react-native-gesture-handler

- **Current**: 3.3.0
- **Linked**: every app
- **Upstream**: https://github.com/software-mansion/react-native-gesture-handler
- **Copy**: `vendor/react-native-gesture-handler/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The gestures host: the library reuses its legacy gesture builders (`Gesture.Pan()` and the rest), config classes, handler registries and constants, replaces its React `GestureDetector` with a host module, and links its native recognizers. RNGH 3's own API (the hooks, `NativeDetector`, `VirtualDetector`, `Touchable`, the components) is React's and is not used.

## Coupled with

react-native-reanimated (gesture callbacks run as worklets), react-native-worklets (3.x finds the UI runtime through Worklets' stable C++ API, `worklets/Compat/StableApi.h`, from 0.8.0: the Android build links the Worklets project and the iOS podspec asks for the `RNWorklets` pod) and React Native's version.

## Version policy

The version Expo's `bundledNativeModules.json` names for the SDK (`~3.3.0` for SDK 58: 3.3.0). The 2.x line (2.32.0, SDK 57) was left at the move to 3: its native module protocol differs (below).

## Local changes

- `0001-root-recognizer-for-presented-screens.patch` (iOS): the root gesture recognizer can be registered for the screens the library presents (`currentManager`, `registerRootViewGestureRecognizerIfAttachedBelow:`, and the walk to the touch-handler view stops at any view that holds React Native's touch handler). 3.x already stops at react-native-screens' modals; the patch is the engine's own presented views.
- `0002-worklets-is-the-copy-beside-it.patch` (iOS): `scripts/gesture_handler_utils.rb` looks for the Worklets copy beside it before asking Node for `react-native-worklets`, which an app does not install: without it the podspec builds without the Worklets stable API and `GestureStateManager` fails on the UI runtime.

Doctor shape: `rnghProblems` in `src/doctor/shapes.ts`.

## What the library relies on

- `src/gestures/rngh.js`: deep imports of its pure modules (24 modules, no `react-native`: the constants, `CallbackType`, `handlers/hitSlop`, the builders and registries); `tests/gestures/isolation.test.ts` keeps the set. The file lists the paths that must never be imported (`v3/*` among them).
- `src/gestures/constants.js`, `src/fabric/gestures.ts`, `src/fabric/responder.ts`: its state and event constants and its native event shape.
- The native module's protocol (`src/gestures/native.ts`): `createGestureHandler`, `attachGestureHandler`, `setGestureHandlerConfig`, `configureRelations`, `dropGestureHandler`, `flushOperations`, `installUIRuntimeBindings`; `tests/gestures/golden.test.ts` compares the call sequences with RNGH's own `attachHandlers`, `updateHandlers` and `dropHandlers` (`fixtures/capture-golden.mjs`).
- The UI-thread state manager: `globalThis._setGestureStateSync`, installed by the module's native side (`src/gestures/animated.ts`).
- The Android engine reads its classes: `RNGestureHandlerRootHelper(context, wrappedView, moduleId)` (and `onNativeDispatchStart`, `onNativeDispatchEnd`), `RNGestureHandlerModule.registries` and `getModule`, `NativeViewGestureHandler.NativeViewGestureHandlerHook`; the host check (`native/svelte-core/android/src/test/engine.sh`) reads the copy's `PanGestureHandler.kt`.
- The iOS screens ask the manager (patch 0001) and compare a pan recogniser's delegate with `RNGestureHandler` (`SvelteStackView.mm`).

## What to look at in its source

- A change to a module `rngh.js` imports, or a new import from one of them into `react-native` or Reanimated: the isolation test fails; the fix is in `rngh.js`, not the test.
- The legacy `GestureDetector` (`src/handlers/gestures/GestureDetector/`: `attachHandlers.ts`, `updateHandlers.ts`, `dropHandlers.ts`, `utils.ts`, `useAnimatedGesture.ts`) and `handlers/utils.ts`: the host is a port of them; the golden vectors and `tests/gestures/config.test.ts` fail when they change.
- `react-native.config.js` (component descriptors, CMake path) and `codegenConfig` against `src/vendored.ts` and the autolinking fixtures.
- The iOS root recognizer code the patch changes (`RNGestureHandlerManager.mm`), and `RNRootViewGestureRecognizer`.

## Native dependencies downloaded at build time

`androidx.appcompat:appcompat:1.7.0` and `androidx.core:core-ktx:1.16.0` (the same as 2.32.0's), and nothing from a podspec or a CMake file.

## Proof

- `tests/gestures/` (golden, events, isolation, responder), `tests/upstream/react-native-gesture-handler-patch.test.ts`, the engine host check.
- The gestures screen on both platforms, and the iPhone gestures run of the QA harness (edge swipes, sheets) when a device is available.
