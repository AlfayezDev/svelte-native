# expo-conic-gradient

- **Current**: 0.2.1
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/jakex7/expo-conic-gradient
- **Copy**: `vendor/expo-conic-gradient/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `ConicGradient`.

## Coupled with

The Expo SDK: `expo` and `expo-constants` (the library's peers), `expo-modules-core` (and the library's pnpm patch of it, `patches/expo-modules-core@57.0.23.patch`), and the other Expo modules carried here (expo-blur, expo-image, expo-linear-gradient, expo-video; expo-conic-gradient follows its own releases but must build against the SDK's `expo-modules-core`).

## Version policy

Its newest release that builds against the `expo-modules-core` of the library's Expo SDK.

## Local changes

None.

## What the library relies on

- `src/components/ConicGradient.svelte`.
- Its native module name (`ExpoBlur`, `ExpoImage`, `ExpoLinearGradient`, `ConicGradient`, `ExpoVideo`) is listed in `src/fabric/foreign-libraries.ts`, which tells a component which library its view belongs to: a renamed module must be renamed there.

## What to look at in its source

- A third-party Expo module (not Expo's): read its whole diff; check that the target supports the SDK's `expo-modules-core`.

## Native dependencies downloaded at build time

None.

## Proof

- `tests/foreign/` for the component, `tests/cli/library-linking.test.ts` (Expo search paths).
- The package's screen of the example app (`apps/example/src/routes/native-views/conic-gradient`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
