/**
 * `react-native-view-shot` 6 without React (`index.tsx`). The library has no native view: its TurboModule `RNViewShot` takes a React
 * tag and draws the view that tag names. Which view that is depends on the platform.
 *
 * - iOS: React Native's own mounting makes every view (the engine does not replace it there), and the module finds it by tag, so the
 *   host's handles work as they are. What the module answers is passed on as it is (see `result` and `width` below), and the files of a
 *   `tmpfile` result that a process left are deleted when the next one starts (`native/svelte-core/ios/capture`).
 * - Android: the module resolves the tag through `FabricUIManager.addUIBlock` and React Native's mounting manager, which never saw the
 *   engine's views (SPEC.md, "How it hooks in": the delegate returns no mutations for them). A foreign view and what is inside it
 *   is React Native's, so the module resolves those; for every other tag the engine draws the view itself (`SvelteEngine.captureView`,
 *   `Capture.kt`), with the same options and the same results for the formats and results listed there.
 *
 * Nothing here imports the library.
 */
import { turboModule } from "./foreign.ts";
import { assertLibrary } from "./foreign-libraries.ts";

export type CaptureFormat = "jpg" | "png" | "webp" | "webm" | "raw";
export type CaptureResult = "tmpfile" | "base64" | "data-uri" | "zip-base64";
export type CaptureOptions = {
  /** Android: the file name of a `tmpfile` result, at least three characters. */
  fileName?: string;
  /**
   * The size of the image, scaled from the view's (both, or neither). Android: pixels. iOS: points, and the image is drawn at the screen's scale as the
   * library does (`UIGraphicsImageRendererFormat.scale = 0`): 40 x 30 is an 80 x 60 image on a 2x phone. The wrapper hands the numbers over untouched.
   */
  width?: number;
  height?: number;
  /** `png` (default), `jpg`, and on Android `webp` (`webm` is its deprecated name, with a warning) and `raw` (ARGB pixels, preceded by `width:height|`). */
  format?: CaptureFormat;
  /** 0 to 1, for the lossy formats. */
  quality?: number;
  /**
   * `tmpfile` (default: a file that lasts until the app exits or `releaseCapture`), `base64`, `data-uri`, and on Android `zip-base64`. The `tmpfile` answer is the
   * library's own: Android a `file://` URI, iOS the plain absolute path React Native made (`<tmp>/ReactNative/<uuid>.<ext>`). Hand it to `releaseCapture` as it
   * came (the module deletes only inside `tmp/ReactNative`, by that path), and prepend `file://` where a URI is wanted. A process that ended without exiting
   * (a swipe from the app switcher, a kill, a crash) leaves its files; the next process deletes them when it starts, on both platforms.
   */
  result?: CaptureResult;
  /** A scroll view: capture all its content instead of the visible part. */
  snapshotContentContainer?: boolean;
  /** Android: also capture a `SurfaceView` (video, map) in the tree. */
  handleGLSurfaceViewOnAndroid?: boolean;
  /** iOS: draw with `renderInContext` instead of `drawViewHierarchyInRect`. */
  useRenderInContext?: boolean;
};

type Platform = "android" | "ios";
const defaultOptions = { format: "png", quality: 1, result: "tmpfile", snapshotContentContainer: false, handleGLSurfaceViewOnAndroid: false } as const;

/** `validateOptions`: the library's defaults and checks; a bad option falls back to its default and is reported (the library warns, as it has done in every build since 6). */
export function validateCaptureOptions(input: CaptureOptions | undefined, platform: Platform): { options: CaptureOptions; errors: string[] } {
  const options: CaptureOptions = { ...defaultOptions, ...input };
  const errors: string[] = [];
  const positive = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value > 0;
  if ("width" in options && !positive(options.width)) { errors.push("option width should be a positive number"); delete options.width; }
  if ("height" in options && !positive(options.height)) { errors.push("option height should be a positive number"); delete options.height; }
  if (typeof options.quality !== "number" || !Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1) { errors.push("option quality should be a number between 0.0 and 1.0"); options.quality = defaultOptions.quality; }
  if (typeof options.snapshotContentContainer !== "boolean") { errors.push("option snapshotContentContainer should be a boolean"); options.snapshotContentContainer = defaultOptions.snapshotContentContainer; }
  if (typeof options.handleGLSurfaceViewOnAndroid !== "boolean") { errors.push("option handleGLSurfaceViewOnAndroid should be a boolean"); options.handleGLSurfaceViewOnAndroid = defaultOptions.handleGLSurfaceViewOnAndroid; }
  const formats = platform === "android" ? ["png", "jpg", "webp", "webm", "raw"] : ["png", "jpg"];
  if (!formats.includes(options.format ?? "")) {
    errors.push(`option format '${options.format}' is not in valid formats: ${formats.join(" | ")}`);
    options.format = defaultOptions.format;
  } else if (options.format === "webm") {
    errors.push("option format 'webm' is deprecated and will be removed in a future version. Use 'webp' instead (the encoded data has always been WEBP, only the extension was misnamed).");
  }
  const results = platform === "android" ? ["tmpfile", "base64", "data-uri", "zip-base64"] : ["tmpfile", "base64", "data-uri"];
  if (!results.includes(options.result ?? "")) {
    errors.push(`option result '${options.result}' is not a valid result: ${results.join(" | ")}`);
    options.result = defaultOptions.result;
  }
  return { options, errors };
}

type ViewShotModule = {
  captureRef(tag: number, options: CaptureOptions): Promise<string>;
  captureScreen(options: CaptureOptions): Promise<string>;
  releaseCapture(uri: string): void;
};
/** The engine's Android module, which draws the views React Native's mounting manager does not know; null as a promise answer for a tag that is not one of them. */
type CaptureEngine = { captureView?(tag: number, options: CaptureOptions): Promise<string | null> };
const engine = (): CaptureEngine | null => (globalThis as { expo?: { modules?: { SvelteEngine?: CaptureEngine } } }).expo?.modules?.SvelteEngine ?? null;
const viewShot = (): ViewShotModule => turboModule<ViewShotModule>("RNViewShot");
const platform = (): Platform =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("react-native/Libraries/Utilities/Platform") as { default: { OS: string } }).default.OS === "android" ? "android" : "ios";

/** A host handle (`ref` of a view), or the React tag it carries. */
export type CaptureTarget = { readonly tag: number } | number | null | undefined;

const report = (errors: string[]) => {
  if (errors.length > 0) console.warn(`react-native-view-shot: bad options:\n${errors.map((error) => `- ${error}`).join("\n")}`);
};

/**
 * Draws a view and answers where the image is (`result`). The view must exist as a native view: a `View` with nothing to draw is
 * flattened away unless it says `collapsable={false}` (`ViewShot` does).
 */
export async function captureRef(target: CaptureTarget, options?: CaptureOptions): Promise<string> {
  assertLibrary("react-native-view-shot");
  const tag = typeof target === "number" ? target : target?.tag;
  if (typeof tag !== "number" || !tag) throw new Error(`react-native-view-shot: no view to capture (${String(target)}): pass the handle a view's ref gives`);
  const system = platform();
  const checked = validateCaptureOptions(options, system);
  report(checked.errors);
  if (system === "android") {
    const drawn = await engine()?.captureView?.(tag, checked.options);
    if (typeof drawn === "string") return drawn;
  }
  return viewShot().captureRef(tag, checked.options);
}

/** Captures the whole window (the module's `captureScreen`). */
export function captureScreen(options?: CaptureOptions): Promise<string> {
  assertLibrary("react-native-view-shot");
  const checked = validateCaptureOptions(options, platform());
  report(checked.errors);
  return viewShot().captureScreen(checked.options);
}

/** Deletes a `tmpfile` result; a URI that is not a string is ignored (with a development warning). */
export function releaseCapture(uri: string): void {
  assertLibrary("react-native-view-shot");
  if (typeof uri !== "string") {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`Invalid argument to releaseCapture. Got: ${String(uri)}`);
  } else {
    viewShot().releaseCapture(uri);
  }
}
