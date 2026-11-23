# expo-image

- **Current**: 58.0.18
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/expo/expo
- **Copy**: `vendor/expo-image/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `ExpoImage`; its config plugin runs from the copy with the options the app gives it.

## Coupled with

The Expo SDK: `expo` and `expo-constants` (the library's peers), `expo-modules-core` (and the library's pnpm patch of it, `patches/expo-modules-core@58.1.0.patch`), and the other Expo modules carried here (expo-blur, expo-image, expo-linear-gradient, expo-video; expo-conic-gradient follows its own releases but must build against the SDK's `expo-modules-core`).

## Version policy

The version the Expo SDK of the library's `expo` peer gives (`npx expo install expo-image` in a scratch app of that SDK prints it): within an SDK, its latest patch; with a new SDK, the SDK's version, in the same pull request as the SDK bump and the other Expo modules. A copy from another SDK does not build: Expo modules compile against the app's `expo-modules-core`.

## Local changes

None.

## What the library relies on

- `src/components/ExpoImage.svelte`, `src/fabric/foreign-image.ts`, and the places that know its view (`src/classes.ts`, `src/fabric/animation.ts`, `src/fetch/rn.ts`).
- Its plugin, `app.plugin.js`, run by `withLibraries`.
- Its native module name (`ExpoBlur`, `ExpoImage`, `ExpoLinearGradient`, `ConicGradient`, `ExpoVideo`) is listed in `src/fabric/foreign-libraries.ts`, which tells a component which library its view belongs to: a renamed module must be renamed there.

## What to look at in its source

- The copy leaves out `prebuilds`; keep it out (58 has no `plugin/tsconfig.tsbuildinfo` any more, and the script refuses an exclude that matches nothing).
- `local-maven-repo/` provenance.
- Props of the native view that `Image.tsx` converts before they reach it: `svgVariables` (numbers become text: `resolveSvgVariables` in `src/fabric/foreign-image.ts`), `transition` (`skipOnCacheHit` since 58). `tests/foreign/image.test.ts` bundles the library's own `utils` for comparison, with `expo` and `react-native` replaced by stand-ins (58 takes `Platform` and `SharedRef` from `expo` and `Image.resolveAssetSource` from `react-native`).

## Native dependencies downloaded at build time

Android: Glide and its integrations (`com.github.bumptech.glide:*`, AVIF, OkHttp), `com.caverock:androidsvg-aar`, the APNG/GIF plugin. iOS: `SDWebImage` (`~> 5.21.0`) and its AVIF, SVG and WebP coders (`ios/ExpoImage.podspec`). Image decoders parse untrusted data: check their advisories.

## Proof

- `tests/foreign/` for the component, `tests/cli/library-linking.test.ts` (Expo search paths).
- The package's screen of the example app (`apps/example/src/routes/native-views/image`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
