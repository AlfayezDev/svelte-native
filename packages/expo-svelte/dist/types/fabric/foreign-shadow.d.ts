export type CornerRadii = {
    topLeft: number;
    topRight: number;
    bottomLeft: number;
    bottomRight: number;
};
type Style = Record<string, unknown>;
/** `getCornerRadiiFromStyle`: undefined for a style with neither a background nor a radius, else the four radii (start and end swap in a right-to-left layout). */
export declare function cornerRadiiFromStyle(style: unknown, rtl: boolean): CornerRadii | undefined;
export type ShadowParams = {
    color?: unknown;
    opacity?: number;
    radius?: number;
    offset?: [number, number];
};
/**
 * `shadowStyle`: the same shadow on every platform. iOS draws a radius twice as large as design tools and CSS do, so it is halved there.
 */
export declare function shadowStyle({ color, opacity, radius, offset }: ShadowParams, platform?: "android" | "ios"): Style;
export type Insets = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};
/**
 * Where the native view sits in the container: Yoga positions an absolute child from the container's padding box, inside the border, so a container that keeps
 * its border widths would leave the border to a ring the native view does not cover. The insets are the widths, negative, so the view fills the border box
 * and paints the border where the style puts it. The widths are resolved as Yoga resolves a border edge (`Style::computeLeftEdge`): a side beats `borderWidth`;
 * for the left and right edges the start and end widths beat the side ones, by the layout direction. Only the widths that take room count: the block ones are
 * painted and not laid out (`YogaStylableProps` has no `borderBlock*Width`).
 */
export declare function borderInsets(style: Style, rtl: boolean): Insets;
/**
 * What Android's `ShadowedView` hands to its two views. The library's native view is the box itself, so its children are mounted by React
 * Native and hear no touches in JavaScript; here the box is a container of the engine's views and the native view (shadow, background,
 * border and corner radii, no children) fills it behind them. `content` is the container's style, `box` the native view's, `inset` where it sits
 * in the container (`borderInsets`), `shadow` its shadow props (the wrapper's native props are top-level) and `cornerRadii` what the wrapper computes from the style.
 */
export declare function shadowedParts(style: unknown, rtl: boolean): {
    content: Style;
    box: Style;
    inset: Insets;
    shadow: Style;
    cornerRadii: CornerRadii;
};
/** `I18nManager.isRTL`, from React Native's own module. */
export declare function isRightToLeft(): boolean;
export {};
