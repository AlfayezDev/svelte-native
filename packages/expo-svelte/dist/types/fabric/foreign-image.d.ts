export type ImageSource = {
    uri?: string;
    headers?: Record<string, string>;
    width?: number | null;
    height?: number | null;
    blurhash?: string;
    thumbhash?: string;
    cacheKey?: string;
    webMaxViewportWidth?: number;
    isAnimated?: boolean;
};
export type ImageContentFit = "cover" | "contain" | "fill" | "none" | "scale-down";
export type ImageResizeMode = "cover" | "contain" | "stretch" | "repeat" | "center" | "none";
type Position = number | string;
export type ImageContentPositionObject = {
    top?: Position;
    bottom?: Position;
    left?: Position;
    right?: Position;
};
export type ImageContentPosition = string | ImageContentPositionObject;
export type ImageTransition = {
    duration?: number;
    timing?: "ease-in-out" | "ease-in" | "ease-out" | "linear";
    effect?: string | null;
    /** Skips the transition when an image first appears from a cache hit (expo-image 58): `memory` for the in-memory cache, `all` for any cache hit. */
    skipOnCacheHit?: "none" | "memory" | "all" | null;
};
export type SFSymbolEffect = string | {
    effect: string;
    [option: string]: unknown;
};
/** A loaded image the native module returned (`Image.loadAsync`): the registry id of the shared object stands for it. */
type ImageRefLike = {
    nativeRefType: "image";
    __expo_shared_object_id__?: number;
};
export type ImageSourceProp = ImageSource | ImageRefLike | string | number | null | undefined | readonly (ImageSource | string | number | null | undefined)[];
/** `resolveAssetSource`: what a `require`d image is (`{ uri, width, height, scale }`), or null for a number the registry does not know. */
export type ResolveAsset = (asset: number) => ImageSource | null | undefined;
/** `blurhash:/<hash>/<width>/<height>`, or a bare hash that has the shape of one (any other string is a URL). */
export declare const isBlurhashString: (text: string) => boolean;
/** A thumbhash needs its scheme: base64 strings would otherwise read as blurhashes, as in the library. */
export declare const isThumbhashString: (text: string) => boolean;
export declare const isSFSymbolString: (text: string) => boolean;
export declare function resolveBlurhashString(text: string): ImageSource;
export declare function resolveThumbhashString(text: string): ImageSource;
/** One source: a string (URL, blurhash, thumbhash, `sf:` symbol), a `require`d asset, or an object (with an optional `blurhash`/`thumbhash` that becomes a URI). */
export declare function resolveSource(source: ImageSource | string | number | null | undefined, resolveAsset: ResolveAsset): ImageSource | null;
/** The `source` the native view reads: an array of sources, or the registry id of a loaded image. */
export declare function resolveSources(sources: ImageSourceProp, resolveAsset: ResolveAsset): ImageSource[] | number | undefined;
/** `contentFit`, or the one that the React Native `resizeMode` stands for (`stretch` is `fill`, `center` is `scale-down`, `repeat` was dropped). */
export declare function resolveContentFit(contentFit?: ImageContentFit, resizeMode?: ImageResizeMode, isSFSymbol?: boolean): ImageContentFit;
/** A position given as words becomes the object the native code reads; an unknown word is the centre. */
export declare function resolveContentPosition(contentPosition?: ImageContentPosition): ImageContentPositionObject;
/** A number is a cross dissolve of that many milliseconds; `fadeDuration` (React Native's prop) is the same when `transition` is not given. */
export declare function resolveTransition(transition?: ImageTransition | number | null, fadeDuration?: number): ImageTransition | null;
/** `sfEffect` as a list of effect objects, whatever the caller wrote (a name, an object, or a list of either). */
export declare function resolveSfEffect(effect: SFSymbolEffect | readonly SFSymbolEffect[] | null | undefined): {
    effect: string;
}[] | null;
/**
 * `svgVariables` as the native view takes them (`resolveSvgVariables` of expo-image 58's `Image.tsx`): the values of the SVG's CSS custom properties, numbers as strings. A key
 * that does not start with two dashes is not a custom property and is ignored by the native side, which a development build says.
 */
export declare function resolveSvgVariables(svgVariables: Record<string, string | number> | null | undefined): Record<string, string> | null;
/** What the Svelte component takes: expo-image's `ImageProps`, with the props a plain `View` takes next to them. */
export type ExpoImageProps = {
    style?: unknown;
    source?: ImageSourceProp;
    placeholder?: ImageSourceProp;
    contentFit?: ImageContentFit;
    contentPosition?: ImageContentPosition;
    transition?: ImageTransition | number | null;
    fadeDuration?: number;
    resizeMode?: ImageResizeMode;
    defaultSource?: ImageSource | null;
    loadingIndicatorSource?: ImageSource | null;
    sfEffect?: SFSymbolEffect | readonly SFSymbolEffect[] | null;
    tintColor?: string | null;
    /** Values of the CSS custom properties an SVG source refers to with `var()`; numbers are given as text. */
    svgVariables?: Record<string, string | number> | null;
    accessibilityLabel?: string;
    alt?: string;
    [prop: string]: unknown;
};
/**
 * The props of the native `ExpoImage` view for a set of component props. The style's `resizeMode`, `fontWeight`, `color` and
 * `fontSize` are read here and do not reach the view (they stand for `contentFit` and the SF symbol's weight, colour and size); its
 * `tintColor` is the view's `tintColor` prop (the host converts both colours; the explicit prop wins, as in the library). The style keeps the shadow of
 * its platform only: `elevation` on Android, `shadow...` on iOS.
 */
export declare function expoImageProps(props: ExpoImageProps, resolveAsset: ResolveAsset, platform?: "android" | "ios"): Record<string, unknown>;
type ImageCallbacks = {
    onLoadStart?: () => void;
    onLoad?: (event: never) => void;
    onProgress?: (event: never) => void;
    onError?: (event: never) => void;
    onLoadEnd?: () => void;
    onDisplay?: () => void;
};
type NativeImageEvent = {
    nativeEvent: unknown;
};
/**
 * The native event handlers of the view: the load, progress and error ones always (the library's wrapper hands them to the view whatever the caller gave, `onLoad` and
 * `onError` also tell `onLoadEnd`), `onDisplay` only when the caller gave one, as the wrapper passes it through `...props`.
 */
export declare function expoImageHandlers(callbacks: ImageCallbacks): Record<string, (event: NativeImageEvent) => void>;
export {};
