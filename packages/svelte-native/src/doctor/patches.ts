import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { packageRoot } from "../package-root.ts";
import type { Reader } from "./resolve.ts";
import { expoModulesCoreProblems, kitProblems, lottieProblems, mapsProblems, pdfProblems, reanimatedProblems, rnghProblems, videoProblems, workletsProblems } from "./shapes.ts";

/** The directory of the library's patch files, in the repository and in an app's `node_modules` alike. */
export const patchesDirectory = resolve(packageRoot, "patches");

export type PatchSpec = {
  /** The patched package's name. */
  package: string;
  /** What the patch changes, in a line. */
  does: string;
  /** Where the package is found when an app does not depend on it itself: the installed package whose own dependency it is. */
  via?: string;
  /** The problems in the installed package, from its files and the patch file (an empty list means the patch is in). */
  inspect(installed: Reader, patch: string): string[];
};

/** One entry per file of `patches/`, in the order of the package names. A test keeps this list and the directory in step. */
export const patchSpecs: readonly PatchSpec[] = [
  { package: "@sveltejs/kit", does: "SvelteKit leaves the `+mobile.svelte` files of a route directory alone", inspect: kitProblems },
  { package: "expo-modules-core", via: "expo", does: "Expo modules register lazily and the common ones are prewarmed (Android start)", inspect: expoModulesCoreProblems },
  { package: "lottie-react-native", does: "Lottie's events are delivered one by one (Android) and a load or failure before the emitter exists is kept (iOS)", inspect: lottieProblems },
  { package: "react-native-maps", does: "the map's discrete events are delivered one by one, its streams still coalesce (Android)", inspect: mapsProblems },
  { package: "react-native-pdf", does: "the pdf view's one event, which carries every message, no longer coalesces (Android)", inspect: pdfProblems },
  { package: "react-native-video", does: "only progress and bandwidth events coalesce; every other video event is delivered (Android)", inspect: videoProblems },
];

/**
 * What the library's copies of third-party packages (`vendor/<name>`, VENDORING.md) carry of the library's own changes, by package: `scripts/vendor.ts` applies them (`vendor-patches/<name>/`) when it writes the
 * copy, so an app does not declare them and the doctor does not look for them in `patches/`. The doctor still reads the copy's files for the same shapes (`shapes.ts`), which finds a library that was
 * installed incomplete or changed after the install, and the tests (`tests/upstream/`) read the same shapes in the repository's copies. The patch files themselves are not in the installed package.
 */
export const vendoredPatchSpecs: Readonly<Record<string, Pick<PatchSpec, "does"> & { inspect(installed: Reader): string[] }>> = {
  "react-native-gesture-handler": { does: "the root gesture recognizer can be registered for the screens the library presents (iOS)", inspect: rnghProblems },
  "react-native-reanimated": { does: "the engine's views are written natively and opacity/translate/scale skip React Native's prop path (Android), the Android synchronous update is on by default, and Worklets is the copy beside it", inspect: reanimatedProblems },
  "react-native-worklets": { does: "the UI runtime asks for a frame only while a callback waits, with no idle per-frame loop", inspect: workletsProblems },
};

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
