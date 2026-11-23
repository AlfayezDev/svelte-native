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
/** `validateOptions`: the library's defaults and checks; a bad option falls back to its default and is reported (the library warns, as it has done in every build since 6). */
export declare function validateCaptureOptions(input: CaptureOptions | undefined, platform: Platform): {
    options: CaptureOptions;
    errors: string[];
};
/** A host handle (`ref` of a view), or the React tag it carries. */
export type CaptureTarget = {
    readonly tag: number;
} | number | null | undefined;
/**
 * Draws a view and answers where the image is (`result`). The view must exist as a native view: a `View` with nothing to draw is
 * flattened away unless it says `collapsable={false}` (`ViewShot` does).
 */
export declare function captureRef(target: CaptureTarget, options?: CaptureOptions): Promise<string>;
/** Captures the whole window (the module's `captureScreen`). */
export declare function captureScreen(options?: CaptureOptions): Promise<string>;
/** Deletes a `tmpfile` result; a URI that is not a string is ignored (with a development warning). */
export declare function releaseCapture(uri: string): void;
export {};
