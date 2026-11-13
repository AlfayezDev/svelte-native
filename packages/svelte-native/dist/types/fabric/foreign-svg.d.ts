import { type Commandable } from "./foreign.js";
import "./foreign-svg-kinds.js";
import { type StopProps } from "./foreign-svg-extract.js";
export type Props = Record<string, unknown>;
/** The Fabric name of the `Svg` root: its own view on each platform. */
export declare const svgRootName: () => string;
/**
 * What the library leaves to its Touchable mixin: the press handlers and their timing. The mixin reads them off the component's props; the
 * host's Pressability reads them off the node (`disabled`, `delay*`, `pressRectOffset`: none is a native prop, so none reaches the view).
 */
export declare function pressProps(props: Props): Props;
/** `defaultProps` of a class: a prop that is `undefined` takes the default. */
export declare function withDefaults(props: Props, defaults: Props): Props;
/** `G`: the group, and what `Svg` wraps its children in. */
export declare function groupNativeProps(props: Props): Props;
export declare const pathNativeProps: (props: Props) => Props;
export declare function rectNativeProps(props: Props): Props;
export declare function circleNativeProps(props: Props): Props;
export declare function ellipseNativeProps(props: Props): Props;
export declare function lineNativeProps(props: Props): Props;
/** `Polygon` renders a `Path` whose `d` closes the points; `Polyline` leaves it open. The props go on to the `Path`, so a `d` of their own wins, as in the library. */
export declare function polyPathProps(props: Props, close: boolean): Props;
/** `Text` (`container`) and `TSpan`: `children` are the host's (see `setForeignText`), so `content` is null here. */
export declare function textNativeProps(props: Props): Props;
export declare const tspanProps: (props: Props, content?: string) => Props;
/** `TextPath`: `null` when `href` is not an `#id`, in which case the library warns and renders a `TSpan` with the children. */
export declare function textPathNativeProps(props: Props): Props | null;
/** `Use`: `href` is an `#id`; anything else is a warning and a `Use` of nothing, as in the library. */
export declare function useNativeProps(props: Props): Props;
export declare function imageNativeProps(props: Props): Props;
export declare const clipPathNativeProps: (props: Props) => Props;
export declare function maskNativeProps(props: Props): Props;
export declare function patternNativeProps(given: Props): Props;
export declare function markerNativeProps(given: Props): Props;
export declare const symbolNativeProps: (props: Props) => Props;
export declare function foreignObjectNativeProps(props: Props): Props;
export declare function linearGradientNativeProps(given: Props, stops: readonly StopProps[]): Props;
export declare function radialGradientNativeProps(given: Props, stops: readonly StopProps[]): Props;
export declare function filterNativeProps(props: Props): Props;
export declare const feBlendNativeProps: (props: Props) => Props;
export declare const feColorMatrixNativeProps: (props: Props) => Props;
export declare const feCompositeNativeProps: (props: Props) => Props;
export declare const feFloodNativeProps: (props: Props) => Props;
export declare const feGaussianBlurNativeProps: (props: Props) => Props;
/** `FeOffset` spreads all its props onto the native view, as the library does. */
export declare const feOffsetNativeProps: (props: Props) => Props;
export declare const feMergeNativeProps: (props: Props, ins: readonly (string | undefined)[]) => Props;
/** The props of the `Svg` root and of the `G` inside it. The root's props are everything the caller gave (the library spreads them onto the native view), reshaped as `Svg.render` does. */
export declare function svgNativeProps(given: Props): {
    root: Props;
    group: Props;
};
/** `warnUnimplementedFilter` of `lib/util.ts`: the filter elements that have no native view, once. */
export declare function warnUnimplementedFilter(): void;
export type SvgRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type SvgPoint = {
    x: number;
    y: number;
};
export type SvgMatrix = {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
};
export type SvgBoundingBoxOptions = {
    fill?: boolean;
    stroke?: boolean;
    markers?: boolean;
    clipped?: boolean;
};
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
    isPointInFill(point: {
        x?: number;
        y?: number;
    }): boolean | undefined;
    isPointInStroke(point: {
        x?: number;
        y?: number;
    }): boolean | undefined;
    getTotalLength(): number | undefined;
    getPointAtLength(length: number): SvgPoint;
};
/** The `ref` of `Svg`: also draws itself (`toDataURL`: a base64 PNG; `options` are `width`, `height`, `bbWidth`, `bbHeight`). */
export type SvgRootHandle = SvgHandle & {
    toDataURL(callback: (base64: string) => void, options?: object): void;
};
type HostHandle = Commandable & Partial<Pick<SvgHandle, "measure" | "measureInWindow" | "setNativeProps">>;
export declare function svgHandle(host: HostHandle, options?: {
    matrix?: boolean;
}): SvgHandle;
export declare function svgRootHandle(host: HostHandle): SvgRootHandle;
export {};
