import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { packageRoot } from "../package-root.ts";
import type { Reader } from "./resolve.ts";
import { blobUtilProblems, expoModulesCoreProblems, kitProblems, lottieProblems, mapsProblems, nitroProblems, pdfProblems, quickBase64Problems, reanimatedProblems, riveProblems, rnghProblems, videoProblems, workletsProblems } from "./shapes.ts";

/** The directory of the library's patch files, in the repository and in an app's `node_modules` alike. */
export const patchesDirectory = resolve(packageRoot, "patches");

export type PatchSpec = {
  /** The patched package's name. */
  package: string;
  /** What the patch changes, in a line. */
  does: string;
  /** Where the package is found when an app does not depend on it itself: the installed package whose own dependency it is. */
  via?: string;
  /** The library carries this package (`vendor/`, `vendor-patches/`), already patched: the doctor looks in the copy, and no app declares the patch. */
  vendored?: true;
  /** The problems in the installed package, from its files and the patch file (an empty list means the patch is in). */
  inspect(installed: Reader, patch: string): string[];
};

/** One entry per file of `patches/`, in the order of the package names. A test keeps this list and the directory in step. */
export const patchSpecs: readonly PatchSpec[] = [
  { package: "@sveltejs/kit", does: "SvelteKit leaves the `+mobile.svelte` files of a route directory alone", inspect: kitProblems },
  { package: "expo-modules-core", via: "expo", does: "Expo modules register lazily and the common ones are prewarmed (Android start)", inspect: expoModulesCoreProblems },
  { package: "lottie-react-native", vendored: true, does: "Lottie's events are delivered one by one (Android) and a load or failure before the emitter exists is kept (iOS)", inspect: lottieProblems },
  { package: "react-native-blob-util", vendored: true, does: "the release build type names the optimizing Proguard file: Android Gradle plugin 9 refuses the default one (Android)", inspect: blobUtilProblems },
  { package: "react-native-gesture-handler", vendored: true, does: "the root gesture recognizer can be registered for the screens the library presents, and the podspec finds the Worklets copy beside it (iOS)", inspect: rnghProblems },
  { package: "react-native-maps", vendored: true, does: "the map's discrete events are delivered one by one, its streams still coalesce (Android); its iOS plugin points the Podfile at the library's copy", inspect: mapsProblems },
  { package: "react-native-nitro-modules", vendored: true, does: "Nitro installs its JSI bindings through the overload React Native 0.87 and later call (iOS)", inspect: nitroProblems },
  { package: "react-native-pdf", vendored: true, does: "the pdf view's one event, which carries every message, no longer coalesces, and react-native is found from the app's directory (Android)", inspect: pdfProblems },
  { package: "react-native-quick-base64", vendored: true, does: "the module finds the JavaScript runtime without `RCTCxxBridge`, which React Native 0.88 removed (iOS)", inspect: quickBase64Problems },
  { package: "react-native-reanimated", vendored: true, does: "the engine's views are written natively and opacity/translate/scale skip React Native's prop path (Android), the Android synchronous update is on by default, the keyboard's events come from the engine's frames, and Worklets is the copy beside it", inspect: reanimatedProblems },
  { package: "react-native-video", vendored: true, does: "only progress and bandwidth events coalesce; every other video event is delivered (Android)", inspect: videoProblems },
  { package: "react-native-worklets", vendored: true, does: "the UI runtime asks for a frame only while a callback waits, with no idle per-frame loop", inspect: workletsProblems },
  { package: "rive-react-native", vendored: true, does: "the Rive view sends its events through the event dispatcher, not the old event emitter that a bridgeless app reports for every event (Android)", inspect: riveProblems },
];

export type PatchFile = { package: string; version: string; file: string; path: string };

/** The patch files of a directory, named `<package>@<version>.patch` (a scoped package's slash is `__`). */
export function patchFiles(directory = patchesDirectory): PatchFile[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".patch"))
    .sort()
    .map((file) => {
      const stem = file.slice(0, -".patch".length);
      const at = stem.lastIndexOf("@");
      if (at <= 0) throw new Error(`${file}: a patch is named <package>@<version>.patch`);
      return { package: stem.slice(0, at).replaceAll("__", "/"), version: stem.slice(at + 1), file, path: resolve(directory, file) };
    });
}

/** The key `patchedDependencies` uses for a patch. */
export const patchKey = (patch: Pick<PatchFile, "package" | "version">): string => `${patch.package}@${patch.version}`;
