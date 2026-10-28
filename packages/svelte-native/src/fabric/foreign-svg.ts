/**
 * react-native-svg on the Svelte host (SPEC.md, "react-native-svg"): the view configs of its 29 Fabric components, the props each
 * element class of the library hands its native component, and the handles that call its native module. The extraction is the
 * library's own (`src/lib/extract/*`, imported by deep path: no React, no component class), so an element here sends what the
 * library's element sends for the same props. What the library does with React children is in `foreign-svg-extract.ts`, the text
 * and the stops are collected by the Svelte components and the host (`setForeignText`).
 */
import extractProps, { extract, propsAndStyles, withoutXY } from "react-native-svg/src/lib/extract/extractProps";
import extractResponder from "react-native-svg/src/lib/extract/extractResponder";
import extractTransform, { extractTransformSvgView } from "react-native-svg/src/lib/extract/extractTransform";
import extractViewBox, { alignEnum, meetOrSliceTypes } from "react-native-svg/src/lib/extract/extractViewBox";
import extractOpacity from "react-native-svg/src/lib/extract/extractOpacity";
import extractBrush from "react-native-svg/src/lib/extract/extractBrush";
import extractPolyPoints from "react-native-svg/src/lib/extract/extractPolyPoints";
import units from "react-native-svg/src/lib/units";
import { maskType } from "react-native-svg/src/lib/maskType";
import { idPattern } from "react-native-svg/src/lib/util";
import { Platform, resolveAssetSource } from "./deps-rn.ts";
import { flattenStyle, turboModule, type Commandable } from "./foreign.ts";
import { setForeignText } from "./foreign-text.ts";
import "./foreign-svg-kinds.ts";
import {
  extractFeBlend, extractFeColorMatrix, extractFeComposite, extractFeFlood, extractFeGaussianBlur, extractFeMerge, extractFilter, extractFont, extractGradient, extractIn, extractText, type StopProps,
} from "./foreign-svg-extract.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the props of a component are an interface, which `Record<string, unknown>` does not take
export type Props = Record<string, any>;

/** The Fabric name of the `Svg` root: its own view on each platform. */
export const svgRootName = (): string => (Platform.OS === "android" ? "RNSVGSvgViewAndroid" : "RNSVGSvgView");

// What the host does with the text children of the text components (`setForeignText` in `host.ts`): a string between the tags of a
// `Text` or `TextPath` is a `TSpan` of its own, the only string in a `TSpan` is its `content`; the library's `extractText` does the same
// with the React children. A span made from a string carries what `<TSpan>{string}</TSpan>` sends.
const textContainers = new Set(["RNSVGText", "RNSVGTextPath"]);
setForeignText({
  mode: (viewName) => (textContainers.has(viewName) ? "container" : viewName === "RNSVGTSpan" ? "span" : null),
  span: (content) => ({ viewName: "RNSVGTSpan", props: tspanProps({}, content) }),
});

/** The instance the library's extractors read the Touchable handlers off (`extractResponder`): none here, the host's Pressability answers touches (`pressProps`). */
const noTouchable: Props = {};

const pressKeys = ["onPress", "onPressIn", "onPressOut", "onLongPress"] as const;
/**
 * What the library leaves to its Touchable mixin: the press handlers and their timing. The mixin reads them off the component's props; the
 * host's Pressability reads them off the node (`disabled`, `delay*`, `pressRectOffset`: none is a native prop, so none reaches the view).
 */
export function pressProps(props: Props): Props {
  const out: Props = {};
  for (const key of pressKeys) if (props[key]) out[key] = props[key];
  for (const key of ["disabled", "delayPressIn", "delayPressOut", "delayLongPress"]) if (props[key] != null) out[key] = props[key];
  if (props.pressRetentionOffset) out.pressRectOffset = props.pressRetentionOffset;
  return out;
}

/** `defaultProps` of a class: a prop that is `undefined` takes the default. */
export function withDefaults(props: Props, defaults: Props): Props {
  const full: Props = { ...props };
  for (const key in defaults) if (full[key] === undefined) full[key] = defaults[key];
  return full;
}

const hasProps = (object: object): boolean => {
  for (const _ in object) return true;
  return false;
};

/** `G`: the group, and what `Svg` wraps its children in. */
export function groupNativeProps(props: Props): Props {
  const prop = propsAndStyles(props);
  const extracted = extractProps(prop, noTouchable);
  const font = extractFont(prop);
  if (hasProps(font)) extracted.font = font;
  return { ...extracted, ...pressProps(props) };
}

export const pathNativeProps = (props: Props): Props => ({ ...extract(noTouchable, props), d: props.d, ...pressProps(props) });

export function rectNativeProps(props: Props): Props {
  const { x = 0, y = 0, width = 0, height = 0, rx, ry } = props;
  return { ...withoutXY(noTouchable, props), x, y, width, height, rx, ry, ...pressProps(props) };
}

export function circleNativeProps(props: Props): Props {
  const { cx = 0, cy = 0, r = 0 } = props;
  return { ...extract(noTouchable, props), cx, cy, r, ...pressProps(props) };
}

export function ellipseNativeProps(props: Props): Props {
  const { cx = 0, cy = 0, rx = 0, ry = 0 } = props;
  return { ...extract(noTouchable, props), cx, cy, rx, ry, ...pressProps(props) };
}

export function lineNativeProps(props: Props): Props {
  const { x1 = 0, y1 = 0, x2 = 0, y2 = 0 } = props;
  return { ...extract(noTouchable, props), x1, y1, x2, y2, ...pressProps(props) };
}

/** `Polygon` renders a `Path` whose `d` closes the points; `Polyline` leaves it open. The props go on to the `Path`, so a `d` of their own wins, as in the library. */
export function polyPathProps(props: Props, close: boolean): Props {
  const { points = "" } = props;
  const d = points && `M${extractPolyPoints(points as string)}${close ? "z" : ""}`;
  return { d, ...props };
}

/** `Text` (`container`) and `TSpan`: `children` are the host's (see `setForeignText`), so `content` is null here. */
export function textNativeProps(props: Props): Props {
  const prop = propsAndStyles(props);
  return { ...extractProps({ ...prop, x: null, y: null }, noTouchable), ...extractText(prop), ...pressProps(props) };
}
export const tspanProps = (props: Props, content?: string): Props => ({ ...textNativeProps(props), ...(content === undefined ? {} : { content }) });

/** `TextPath`: `null` when `href` is not an `#id`, in which case the library warns and renders a `TSpan` with the children. */
export function textPathNativeProps(props: Props): Props | null {
  const { xlinkHref, href = xlinkHref, startOffset = 0, method, spacing, side, alignmentBaseline, midLine, ...prop } = props as Props & { href?: string; xlinkHref?: string };
  const matched = href && href.match(idPattern);
  const match = matched && matched[1];
  if (!match) {
    console.warn(`Invalid \`href\` prop for \`TextPath\` element, expected a href like "#id", but got: "${String(href)}"`);
    return null;
  }
  return { ...withoutXY(noTouchable, prop), ...extractText({}), href: match, startOffset, method, spacing, side, alignmentBaseline, midLine, ...pressProps(props) };
}

/** `Use`: `href` is an `#id`; anything else is a warning and a `Use` of nothing, as in the library. */
export function useNativeProps(props: Props): Props {
  const { x = 0, y = 0, width = 0, height = 0, xlinkHref, href = xlinkHref } = props as Props & { href?: string; xlinkHref?: string };
  const matched = href && href.match(idPattern);
  const match = matched && matched[1];
  if (!match) console.warn(`Invalid \`href\` prop for \`Use\` element, expected a href like "#id", but got: "${String(href)}"`);
  return { ...withoutXY(noTouchable, props), href: match ?? undefined, x, y, width, height, ...pressProps(props) };
}

const spacesRegExp = /\s+/;
export function imageNativeProps(props: Props): Props {
  const { preserveAspectRatio = "xMidYMid meet", x = 0, y = 0, width = 0, height = 0, xlinkHref, href = xlinkHref, onLoad } = props as Props & { preserveAspectRatio?: string };
  const modes = preserveAspectRatio ? preserveAspectRatio.trim().split(spacesRegExp) : [];
  const align = modes[0];
  const meetOrSlice = modes[1];
  return {
    ...withoutXY(noTouchable, props),
    x, y, width, height, onLoad,
    meetOrSlice: meetOrSliceTypes[meetOrSlice as string] || 0,
    align: alignEnum[align as string] || "xMidYMid",
    src: !href ? null : resolveAssetSource(typeof href === "string" ? { uri: href } : (href as never)),
    ...pressProps(props),
  };
}

export const clipPathNativeProps = (props: Props): Props => ({ ...extract(noTouchable, props), ...pressProps(props) });

export function maskNativeProps(props: Props): Props {
  const { x, y, width, height, maskUnits, maskContentUnits, style } = withDefaults(props, { x: "0%", y: "0%", width: "100%", height: "100%" }) as Props & { maskUnits?: keyof typeof units; maskContentUnits?: keyof typeof units; style?: { maskType?: keyof typeof maskType } };
  return {
    ...withoutXY(noTouchable, props),
    x, y, width, height,
    maskUnits: maskUnits !== undefined ? units[maskUnits] : 0,
    maskContentUnits: maskContentUnits !== undefined ? units[maskContentUnits] : 1,
    maskType: maskType[(props.maskType as keyof typeof maskType) || style?.maskType || "luminance"],
    ...pressProps(props),
  };
}

export function patternNativeProps(given: Props): Props {
  const props = withDefaults(given, { x: "0%", y: "0%", width: "100%", height: "100%" });
  const { patternTransform, transform, id, x, y, width, height, patternUnits, patternContentUnits, viewBox, preserveAspectRatio } = props as Props & { patternUnits?: keyof typeof units; patternContentUnits?: keyof typeof units; viewBox?: string; preserveAspectRatio?: string };
  const matrix = extractTransform(patternTransform || transform || props);
  return {
    x, y, width, height,
    name: id,
    matrix,
    patternTransform: matrix,
    patternUnits: (patternUnits && units[patternUnits]) || 0,
    patternContentUnits: patternContentUnits ? units[patternContentUnits] : 1,
    ...extractViewBox({ viewBox, preserveAspectRatio }),
  };
}

export function markerNativeProps(given: Props): Props {
  const props = withDefaults(given, { refX: 0, refY: 0, orient: "0", markerWidth: 3, markerHeight: 3, markerUnits: "strokeWidth" });
  const { id, viewBox, preserveAspectRatio, refX, refY, markerUnits, orient, markerWidth, markerHeight } = props as Props & { viewBox?: string; preserveAspectRatio?: string };
  return { name: id, refX, refY, markerUnits, orient: String(orient), markerWidth, markerHeight, ...extractViewBox({ viewBox, preserveAspectRatio }) };
}

export const symbolNativeProps = (props: Props): Props => ({ name: props.id, ...extractViewBox(props as { viewBox?: string; preserveAspectRatio?: string }) });

export function foreignObjectNativeProps(props: Props): Props {
  const { x = "0%", y = "0%", width = "100%", height = "100%" } = props;
  return { ...withoutXY(noTouchable, props), x, y, width, height, ...pressProps(props) };
}

export function linearGradientNativeProps(given: Props, stops: readonly StopProps[]): Props {
  const props = withDefaults(given, { x1: "0%", y1: "0%", x2: "100%", y2: "0%" });
  const { x1, y1, x2, y2 } = props;
  return { x1, y1, x2, y2, ...extractGradient(props, stops) };
}

export function radialGradientNativeProps(given: Props, stops: readonly StopProps[]): Props {
  const props = withDefaults(given, { cx: "50%", cy: "50%", r: "50%" });
  const { rx, ry, r, cx, cy, fx = cx, fy = cy } = props;
  return { fx, fy, rx: rx || r, ry: ry || r, cx, cy, ...extractGradient(props, stops) };
}

export function filterNativeProps(props: Props): Props {
  const { id, x, y, width, height, filterUnits, primitiveUnits } = withDefaults(props, { x: "-10%", y: "-10%", width: "120%", height: "120%", filterUnits: "objectBoundingBox", primitiveUnits: "userSpaceOnUse" });
  return { name: id, x, y, width, height, filterUnits, primitiveUnits };
}

/** `styles.svg` of `Svg.tsx`. */
const defaultStyle = { backgroundColor: "transparent", borderWidth: 0 };

// The filter primitives. `FilterPrimitive` has no `defaultProps` of its own, so the defaults are each class's.
export const feBlendNativeProps = (props: Props): Props => {
  const full = withDefaults(props, { mode: "normal" });
  return { ...extractFilter(full), ...extractIn(full), ...extractFeBlend(full) };
};
export const feColorMatrixNativeProps = (props: Props): Props => {
  const full = withDefaults(props, { type: "matrix", values: "" });
  return { ...extractFilter(full), ...extractIn(full), ...extractFeColorMatrix(full) };
};
export const feCompositeNativeProps = (props: Props): Props => {
  const full = withDefaults(props, { k1: 0, k2: 0, k3: 0, k4: 0 });
  return { ...extractFilter(full), ...extractFeComposite(full) };
};
export const feFloodNativeProps = (props: Props): Props => {
  const full = withDefaults(props, { floodColor: "black", floodOpacity: 1 });
  return { ...extractFilter(full), ...extractFeFlood(full) };
};
export const feGaussianBlurNativeProps = (props: Props): Props => {
  const full = withDefaults(props, { stdDeviation: 0, edgeMode: "none" });
  return { ...extractFilter(full), ...extractIn(full), ...extractFeGaussianBlur(full) };
};
/** `FeOffset` spreads all its props onto the native view, as the library does. */
export const feOffsetNativeProps = (props: Props): Props => {
  const full = withDefaults(props, { dx: 0, dy: 0 });
  return { ...full, ...extractFilter(full), ...extractIn(full) };
};
export const feMergeNativeProps = (props: Props, ins: readonly (string | undefined)[]): Props => ({ ...extractFilter(props), ...extractFeMerge(ins) });

/** The props of the `Svg` root and of the `G` inside it. The root's props are everything the caller gave (the library spreads them onto the native view), reshaped as `Svg.render` does. */
export function svgNativeProps(given: Props): { root: Props; group: Props } {
  const { style, opacity, viewBox, onLayout, preserveAspectRatio = "xMidYMid meet", ...extracted } = given;
  const stylesAndProps = { ...(Array.isArray(style) ? Object.assign({}, ...style) : (style as object | undefined)), ...extracted } as Props;
  let { width, height } = stylesAndProps as { width?: number | string; height?: number | string };
  const { focusable, transform, font, fill, fillOpacity, fillRule, stroke, strokeWidth, strokeOpacity, strokeDasharray, strokeDashoffset, strokeLinecap, strokeLinejoin, strokeMiterlimit, position } = stylesAndProps;
  if (width === undefined && height === undefined && position !== "absolute") width = height = "100%";

  const props: Props = extracted;
  props.focusable = Boolean(focusable) && focusable !== "false";
  const rootStyles: unknown[] = [defaultStyle];
  if (style) rootStyles.push(style);

  let override = false;
  const overrideStyles: Props = {};
  const o = opacity != null ? extractOpacity(opacity as string | number) : NaN;
  if (!isNaN(o)) {
    override = true;
    overrideStyles.opacity = o;
  }
  if (width && height) {
    override = true;
    const w = parseInt(width as string, 10);
    const h = parseInt(height as string, 10);
    const doNotParseWidth = isNaN(w) || (width as string)[(width as string).length - 1] === "%";
    const doNotParseHeight = isNaN(h) || (height as string)[(height as string).length - 1] === "%";
    overrideStyles.width = doNotParseWidth ? width : w;
    overrideStyles.height = doNotParseHeight ? height : h;
    overrideStyles.flex = 0;
  }
  if (override) rootStyles.push(overrideStyles);
  props.style = rootStyles.length > 1 ? rootStyles : defaultStyle;
  if (width != null) props.bbWidth = width;
  if (height != null) props.bbHeight = height;
  extractResponder(props, props, noTouchable);

  const gStyle: Props = Object.assign({}, flattenStyle(style));
  if (transform) {
    if (gStyle.transform) {
      props.transform = gStyle.transform;
      gStyle.transform = undefined;
    }
    props.transform = extractTransformSvgView(props);
  }
  Object.assign(props, extractViewBox({ viewBox: viewBox as string | undefined, preserveAspectRatio: preserveAspectRatio as string }));
  return {
    root: props,
    group: { style: gStyle, font, fill, fillOpacity, fillRule, stroke, strokeWidth, strokeOpacity, strokeDasharray, strokeDashoffset, strokeLinecap, strokeLinejoin, strokeMiterlimit, onLayout },
  };
}

let warnedUnimplemented = false;
/** `warnUnimplementedFilter` of `lib/util.ts`: the filter elements that have no native view, once. */
export function warnUnimplementedFilter(): void {
  if (warnedUnimplemented) return;
  warnedUnimplemented = true;
  console.warn("Some of the used filters are not yet supported on native platforms. Please check the USAGE.md for more info. Not implemented filters:\n" + JSON.stringify([
    "FeComponentTransfer", "FeConvolveMatrix", "FeDiffuseLighting", "FeDisplacementMap", "FeFuncA", "FeFuncB", "FeFuncG", "FeFuncR", "FeImage", "FeMorphology", "FePointLight", "FeSpecularLighting", "FeSpotLight", "FeTile", "FeTurbulence",
  ], null, 2));
}

/** The brush props `setNativeProps` converts (`BrushProperties` of `lib/extract/colors.ts`). */
const brushProperties = ["fill", "stroke", "stopColor", "floodColor", "lightingColor"];

// The handles: what the library's element instances offer next to React Native's own (`Shape.tsx`, `Svg.tsx`).
export type SvgRect = { x: number; y: number; width: number; height: number };
export type SvgPoint = { x: number; y: number };
export type SvgMatrix = { a: number; b: number; c: number; d: number; e: number; f: number };
export type SvgBoundingBoxOptions = { fill?: boolean; stroke?: boolean; markers?: boolean; clipped?: boolean };

type RenderableModule = {
  isPointInFill(tag: number, options?: object): boolean;
  isPointInStroke(tag: number, options?: object): boolean;
  getTotalLength(tag: number): number;
  getPointAtLength(tag: number, options?: object): SvgPoint;
  getBBox(tag: number, options?: object): SvgRect;
  getCTM(tag: number): SvgMatrix;
  getScreenCTM(tag: number): SvgMatrix;
};
type ViewModule = { toDataURL(tag: number, options: object | undefined, callback: (base64: string) => void): void };
let renderable: RenderableModule | undefined;
let viewModule: ViewModule | undefined;

/**
 * The methods of an element's `ref`, on top of the host handle (`tag`, `measure`, `dispatchCommand`, ...). The geometry ones call the library's
 * TurboModule `RNSVGRenderableModule` with the view's tag, as `Shape.tsx` does; `toDataURL` is `RNSVGSvgViewModule`'s and `Svg`'s alone. The results
 * are plain objects: no `SVGMatrix` or `SVGPoint` classes. `matrix` is true for the elements whose `setNativeProps` also takes a transform (`G`, `Text`, `TSpan`, `TextPath`).
 */
export type SvgHandle = Commandable & {
  readonly host: Commandable;
  measure: (callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void) => void;
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
  setNativeProps(props: Props): void;
  getBBox(options?: SvgBoundingBoxOptions): SvgRect | undefined;
  getCTM(): SvgMatrix;
  getScreenCTM(): SvgMatrix;
  isPointInFill(point: { x?: number; y?: number }): boolean | undefined;
  isPointInStroke(point: { x?: number; y?: number }): boolean | undefined;
  getTotalLength(): number | undefined;
  getPointAtLength(length: number): SvgPoint;
};
/** The `ref` of `Svg`: also draws itself (`toDataURL`: a base64 PNG; `options` are `width`, `height`, `bbWidth`, `bbHeight`). */
export type SvgRootHandle = SvgHandle & { toDataURL(callback: (base64: string) => void, options?: object): void };
type HostHandle = Commandable & Partial<Pick<SvgHandle, "measure" | "measureInWindow" | "setNativeProps">>;

export function svgHandle(host: HostHandle, options: { matrix?: boolean } = {}): SvgHandle {
  const module = (): RenderableModule => (renderable ??= turboModule<RenderableModule>("RNSVGRenderableModule"));
  return {
    host,
    get tag() { return host.tag; },
    dispatchCommand: (name, args) => host.dispatchCommand(name, args),
    measure: (callback) => host.measure?.(callback),
    measureInWindow: (callback) => host.measureInWindow?.(callback),
    setNativeProps(props) {
      const next = { ...props };
      for (const key of brushProperties) if (key in next) next[key] = extractBrush(next[key]);
      if (options.matrix) {
        const matrix = !next.matrix && extractTransform(next);
        if (matrix) next.matrix = matrix;
      }
      host.setNativeProps?.(next);
    },
    getBBox: (options = {}) => {
      const { fill = true, stroke = true, markers = true, clipped = true } = options;
      return module().getBBox(host.tag, { fill, stroke, markers, clipped });
    },
    getCTM: () => module().getCTM(host.tag),
    getScreenCTM: () => module().getScreenCTM(host.tag),
    isPointInFill: (point) => module().isPointInFill(host.tag, point),
    isPointInStroke: (point) => module().isPointInStroke(host.tag, point),
    getTotalLength: () => module().getTotalLength(host.tag),
    getPointAtLength: (length) => module().getPointAtLength(host.tag, { length }),
  };
}

export function svgRootHandle(host: HostHandle): SvgRootHandle {
  return {
    ...svgHandle(host),
    toDataURL: (callback, options) => {
      if (!callback) return;
      (viewModule ??= turboModule<ViewModule>("RNSVGSvgViewModule")).toDataURL(host.tag, options, callback);
    },
  };
}
