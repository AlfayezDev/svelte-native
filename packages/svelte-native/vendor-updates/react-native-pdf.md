# react-native-pdf

- **Current**: 7.0.3
- **Linked**: when the app turns it on (`libraries`)
- **Upstream**: https://github.com/wonday/react-native-pdf
- **Copy**: `vendor/react-native-pdf/` (its `VENDOR.md` has the tarball's integrity, what was left out and the patches)

Follow `README.md` in this directory; this file is what is particular to this package.

## What the library uses it for

The optional `Pdf` view.

## Coupled with

React Native's version, and react-native-blob-util (which it reads its files with).

## Version policy

Its newest release whose peer range includes the library's React Native and that supports the New Architecture.

## Local changes

`0001-deliver-every-message.patch` (Android: the view's one event, which carries every message, does not coalesce) and `0002-find-react-native-from-the-app.patch` (`android/build.gradle` finds React Native from the app's directory upwards, since the copy is not beside it in `node_modules`). Doctor shape: `pdfProblems`.

## What the library relies on

- `src/fabric/view-configs.ts` (the native component's props and events, by name; `tests/upstream/foreign-view-configs.test.ts` reads the copy and fails on a prop or event that changed)
- `src/fabric/foreign-pdf.ts`, `src/components/Pdf.svelte`; it requires react-native-blob-util (`requires` in `src/optional-libraries.ts`).

## What to look at in its source

- `android/build.gradle`'s way of finding React Native (patch 0002).
- Its native PDF renderer (below): native code from another project.

## Native dependencies downloaded at build time

`com.github.zacharee:AndroidPdfViewer:4.0.1` (JitPack), `io.legere:pdfiumandroid:1.0.32` (PDFium binaries), `com.google.code.gson:gson`; iOS uses PDFKit.

## Proof

- `tests/upstream/foreign-view-configs.test.ts`, the component's tests under `tests/foreign/`, `tests/cli/vendored-autolinking.test.ts` (its autolinking entry against Expo's printed one).
- The package's screen of the example app (`apps/example/src/routes/native-views/pdf`) on Android and iOS from a cold start; the example app with `libraries: {}` on both platforms: none of its classes in the APK, none of its symbols or pods in the iOS build, and the screen throws the "turn it on" message.
