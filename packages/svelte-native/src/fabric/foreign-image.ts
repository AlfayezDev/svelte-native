/**
 * The props normalisation of `expo-image`'s React component (`Image.tsx`, `ExpoImage.tsx`, `utils.ts`,
 * `utils/resolveSources.tsx`), without React: sources become the arrays of `{ uri, ... }` the native view reads, the
 * deprecated React Native props map to the current ones, and the native view gets its colour and style props the way the
 * library's component hands them over. `tests/foreign-image.test.ts` runs the library's own functions on the same
 * inputs. Nothing here imports `expo-image`: the native view is mounted by name (`expoViewName("ExpoImage")`).
 */
import { flattenStyle } from "./foreign.ts";

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
export type ImageContentPositionObject = { top?: Position; bottom?: Position; left?: Position; right?: Position };
export type ImageContentPosition = string | ImageContentPositionObject;
export type ImageTransition = {
  duration?: number;
  timing?: "ease-in-out" | "ease-in" | "ease-out" | "linear";
  effect?: string | null;
};
export type SFSymbolEffect = string | { effect: string; [option: string]: unknown };
/** A loaded image the native module returned (`Image.loadAsync`): the registry id of the shared object stands for it. */
type ImageRefLike = { nativeRefType: "image"; __expo_shared_object_id__?: number };
export type ImageSourceProp = ImageSource | ImageRefLike | string | number | null | undefined | readonly (ImageSource | string | number | null | undefined)[];
/** `resolveAssetSource`: what a `require`d image is (`{ uri, width, height, scale }`), or null for a number the registry does not know. */
export type ResolveAsset = (asset: number) => ImageSource | null | undefined;

const BLURHASH = /^(blurhash:\/)+[\w#$%*+,\-.:;=?@[\]^_{}|~]+(\/[\d.]+)*$/;

/** `blurhash:/<hash>/<width>/<height>`, or a bare hash that has the shape of one (any other string is a URL). */
export const isBlurhashString = (text: string): boolean => BLURHASH.test(text);
/** A thumbhash needs its scheme: base64 strings would otherwise read as blurhashes, as in the library. */
export const isThumbhashString = (text: string): boolean => text.startsWith("thumbhash:/");
export const isSFSymbolString = (text: string): boolean => text.startsWith("sf:");

const hashToUri = (type: "blurhash" | "thumbhash", hash: string): string => `${type}:/${encodeURI(hash).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;

export function resolveBlurhashString(text: string): ImageSource {
  const [blurhash = "", width = "", height = ""] = text.replace(/^blurhash:\//, "").split("/");
  return { uri: hashToUri("blurhash", blurhash), width: parseInt(width, 10) || 16, height: parseInt(height, 10) || 16 };
}

export function resolveThumbhashString(text: string): ImageSource {
  // A thumbhash may contain slashes, which would break the URL's path when one comes first.
  return { uri: hashToUri("thumbhash", text.replace(/^thumbhash:\//, "").replace(/\//g, "\\")) };
}

/** One source: a string (URL, blurhash, thumbhash, `sf:` symbol), a `require`d asset, or an object (with an optional `blurhash`/`thumbhash` that becomes a URI). */
export function resolveSource(source: ImageSource | string | number | null | undefined, resolveAsset: ResolveAsset): ImageSource | null {
  if (typeof source === "string") {
    if (isBlurhashString(source)) return resolveBlurhashString(source);
    if (isThumbhashString(source)) return resolveThumbhashString(source);
    if (isSFSymbolString(source)) return { uri: `sf:/${source.slice(3)}` };
    return { uri: source };
  }
  if (typeof source === "number") return resolveAsset(source) ?? null;
  if (typeof source === "object" && source !== null && (source.blurhash || source.thumbhash)) {
    const { blurhash, thumbhash, ...rest } = source;
    const resolved = thumbhash ? resolveThumbhashString(thumbhash) : resolveBlurhashString(blurhash as string);
    return { ...resolved, ...rest };
  }
  return source ?? null;
}

const isImageRef = (value: unknown): value is ImageRefLike => typeof value === "object" && value !== null && (value as ImageRefLike).nativeRefType === "image";

/** The `source` the native view reads: an array of sources, or the registry id of a loaded image. */
export function resolveSources(sources: ImageSourceProp, resolveAsset: ResolveAsset): ImageSource[] | number | undefined {
  if (Array.isArray(sources)) return sources.map((source) => resolveSource(source, resolveAsset)).filter(Boolean) as ImageSource[];
  if (isImageRef(sources)) return sources.__expo_shared_object_id__;
  return [resolveSource(sources as ImageSource | string | number | null | undefined, resolveAsset)].filter(Boolean) as ImageSource[];
}

/** `contentFit`, or the one that the React Native `resizeMode` stands for (`stretch` is `fill`, `center` is `scale-down`, `repeat` was dropped). */
export function resolveContentFit(contentFit?: ImageContentFit, resizeMode?: ImageResizeMode, isSFSymbol?: boolean): ImageContentFit {
  if (contentFit) return contentFit;
  switch (resizeMode) {
    case "contain":
    case "cover":
    case "none":
      return resizeMode;
    case "stretch":
      return "fill";
    case "center":
      return "scale-down";
    case "repeat":
      return "cover";
    default:
      // SF Symbols keep their aspect ratio.
      return isSFSymbol ? "contain" : "cover";
  }
}

const center: ImageContentPositionObject = { top: "50%", left: "50%" };
const positions: Record<string, ImageContentPositionObject> = {
  center,
  top: { top: 0, left: "50%" },
  right: { top: "50%", right: 0 },
  bottom: { bottom: 0, left: "50%" },
  left: { top: "50%", left: 0 },
  "top center": { top: 0, left: "50%" },
  "top right": { top: 0, right: 0 },
  "top left": { top: 0, left: 0 },
  "right center": { top: "50%", right: 0 },
  "right top": { top: 0, right: 0 },
  "right bottom": { bottom: 0, right: 0 },
  "bottom center": { bottom: 0, left: "50%" },
  "bottom right": { bottom: 0, right: 0 },
  "bottom left": { bottom: 0, left: 0 },
  "left center": { top: "50%", left: 0 },
  "left top": { top: 0, left: 0 },
  "left bottom": { bottom: 0, left: 0 },
};

/** A position given as words becomes the object the native code reads; an unknown word is the centre. */
export function resolveContentPosition(contentPosition?: ImageContentPosition): ImageContentPositionObject {
  if (typeof contentPosition === "string") {
    const resolved = Object.hasOwn(positions, contentPosition) ? positions[contentPosition] : undefined;
    if (!resolved) console.warn(`[expo-image]: Content position "${contentPosition}" is invalid`);
    return resolved ?? center;
  }
  return contentPosition ?? center;
}

/** A number is a cross dissolve of that many milliseconds; `fadeDuration` (React Native's prop) is the same when `transition` is not given. */
export function resolveTransition(transition?: ImageTransition | number | null, fadeDuration?: number): ImageTransition | null {
  if (typeof transition === "number") return { duration: transition };
  if (!transition && typeof fadeDuration === "number") return { duration: fadeDuration };
  return transition ?? null;
}

/** `sfEffect` as a list of effect objects, whatever the caller wrote (a name, an object, or a list of either). */
export function resolveSfEffect(effect: SFSymbolEffect | readonly SFSymbolEffect[] | null | undefined): { effect: string }[] | null {
  if (effect === null || effect === undefined) return null;
  return (Array.isArray(effect) ? effect : [effect]).map((item: SFSymbolEffect) => (typeof item === "string" ? { effect: item } : item));
}

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
  accessibilityLabel?: string;
  alt?: string;
  [prop: string]: unknown;
};

/**
 * The props of the native `ExpoImage` view for a set of component props. The style's `resizeMode`, `fontWeight`, `color` and
 * `fontSize` are read here and do not reach the view (they stand for `contentFit` and the SF symbol's weight, colour and size); its
 * `tintColor` is the view's `tintColor` prop (the host converts both colours; the explicit prop wins, as in the library).
 */
export function expoImageProps(props: ExpoImageProps, resolveAsset: ResolveAsset): Record<string, unknown> {
  const { style, source, placeholder, contentFit, contentPosition, transition, fadeDuration, resizeMode: resizeModeProp, defaultSource, loadingIndicatorSource, sfEffect, tintColor, accessibilityLabel, alt, ...rest } = props;
  const { resizeMode: resizeModeStyle, fontWeight, color, fontSize, tintColor: styleTint, ...restStyle } = flattenStyle(style);
  const resolvedSource = resolveSources(source, resolveAsset);
  const isSFSymbol = Array.isArray(resolvedSource) && resolvedSource.some((item) => item?.uri?.startsWith("sf:/"));
  // An SF symbol's font size sets its point size and the size of the view that holds it.
  const resolvedStyle = isSFSymbol && fontSize ? { width: fontSize, height: fontSize, ...restStyle } : restStyle;
  return {
    ...rest,
    accessibilityLabel: accessibilityLabel ?? alt,
    style: resolvedStyle,
    source: resolvedSource,
    placeholder: resolveSources(placeholder ?? defaultSource ?? loadingIndicatorSource, resolveAsset),
    contentFit: resolveContentFit(contentFit, (resizeModeProp ?? resizeModeStyle) as ImageResizeMode | undefined, isSFSymbol),
    contentPosition: resolveContentPosition(contentPosition),
    transition: resolveTransition(transition, fadeDuration),
    sfEffect: resolveSfEffect(sfEffect),
    tintColor: (isSFSymbol && color && !tintColor ? color : tintColor) || styleTint,
    symbolWeight: isSFSymbol ? (typeof fontWeight === "number" ? String(fontWeight) : fontWeight) : null,
    symbolSize: isSFSymbol && fontSize ? fontSize : null,
  };
}
