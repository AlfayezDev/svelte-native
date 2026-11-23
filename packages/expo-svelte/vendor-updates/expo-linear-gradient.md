# expo-linear-gradient

- **Current**: 58.0.4
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/expo/expo
- **Copy**: `vendor/expo-linear-gradient/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `LinearGradient`.

## Coupled with

The Expo SDK: `expo` and `expo-constants` (the library's peers), `expo-modules-core` (and the library's pnpm patch of it, `patches/expo-modules-core@58.1.0.patch`), and the other Expo modules carried here (expo-blur, expo-image, expo-linear-gradient, expo-video; expo-conic-gradient follows its own releases but must build against the SDK's `expo-modules-core`).

## Version policy

The version the Expo SDK of the library's `expo` peer gives (`npx expo install expo-linear-gradient` in a scratch app of that SDK prints it): within an SDK, its latest patch; with a new SDK, the SDK's version, in the same pull request as the SDK bump and the other Expo modules. A copy from another SDK does not build: Expo modules compile against the app's `expo-modules-core`.

## Local changes

None.

## What the library relies on

- `src/components/LinearGradient.svelte`, `src/fabric/foreign-gradient.ts`.
- Its native module name (`ExpoBlur`, `ExpoImage`, `ExpoLinearGradient`, `ConicGradient`, `ExpoVideo`) is listed in `src/fabric/foreign-libraries.ts`, which tells a component which library its view belongs to: a renamed module must be renamed there.

## What to look at in its source

- `local-maven-repo/` provenance.

## Native dependencies downloaded at build time

None.

## Proof

- `tests/foreign/` for the component, `tests/cli/library-linking.test.ts` (Expo search paths).
- The package's screen of the example app (`apps/example/src/routes/native-views/linear-gradient`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
