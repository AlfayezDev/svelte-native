# expo-blur

- **Current**: 57.0.3
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/expo/expo
- **Copy**: `vendor/expo-blur/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `ExpoBlurView` (the library's own `BlurView` is native code of `svelte-core`, not this package).

## Coupled with

The Expo SDK: `expo` and `expo-constants` (the library's peers), `expo-modules-core` (and the library's pnpm patch of it, `patches/expo-modules-core@57.0.23.patch`), and the other Expo modules carried here (expo-blur, expo-image, expo-linear-gradient, expo-video; expo-conic-gradient follows its own releases but must build against the SDK's `expo-modules-core`).

## Version policy

The version the Expo SDK of the library's `expo` peer gives (`npx expo install expo-blur` in a scratch app of that SDK prints it): within an SDK, its latest patch; with a new SDK, the SDK's version, in the same pull request as the SDK bump and the other Expo modules. A copy from another SDK does not build: Expo modules compile against the app's `expo-modules-core`.

## Local changes

None.

## What the library relies on

- `src/components/ExpoBlurView.svelte`, `src/fabric/foreign-blur.ts`.
- The blur host check (`native/svelte-core/android/src/test/blur.sh`) compares the library's blur with this copy's sources.
- Its native module name (`ExpoBlur`, `ExpoImage`, `ExpoLinearGradient`, `ConicGradient`, `ExpoVideo`) is listed in `src/fabric/foreign-libraries.ts`, which tells a component which library its view belongs to: a renamed module must be renamed there.

## What to look at in its source

- `local-maven-repo/` (Expo's precompiled Android artifacts): their provenance, like any binary.

## Native dependencies downloaded at build time

`com.github.Dimezis:BlurView:version-3.1.0`, from JitPack (built from a GitHub tag by JitPack): check the tag's source.

## Proof

- `tests/foreign/` for the component, `tests/cli/library-linking.test.ts` (Expo search paths).
- No screen of the example app uses it: the QA app's foreign lab does (`apps/qa/src/routes/__dev/foreign`, `apps/qa/src/lib/native/dev/LibrarySet.svelte`), on Android and iOS; and the example app with `libraries: {}` on both platforms has none of its classes, symbols or pods.
