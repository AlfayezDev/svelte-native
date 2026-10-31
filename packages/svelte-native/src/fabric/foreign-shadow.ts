/**
 * `react-native-fast-shadow` 0.1 without React (`ShadowedView.android.tsx`, `utils.ts`). Android's views draw shadows only
 * through `elevation`; `FastShadowView` is a `ReactViewGroup` that paints a blurred nine-patch shadow behind its own
 * background, from the corner radii the wrapper reads off the style. iOS and the web draw shadows themselves, so there the
 * library's `ShadowedView` is a `View`.
 */
import { flattenStyle } from "./foreign.ts";

export type CornerRadii = { topLeft: number; topRight: number; bottomLeft: number; bottomRight: number };
type Style = Record<string, unknown>;

const radiusProps = [
  "borderRadius", "borderTopLeftRadius", "borderTopStartRadius", "borderTopRightRadius", "borderTopEndRadius", "borderBottomLeftRadius",
  "borderBottomStartRadius", "borderBottomRightRadius", "borderBottomEndRadius",
] as const;

/** `getCornerRadiiFromStyle`: undefined for a style with neither a background nor a radius, else the four radii (start and end swap in a right-to-left layout). */
export function cornerRadiiFromStyle(style: unknown, rtl: boolean): CornerRadii | undefined {
  const s = flattenStyle(style) as Record<string, number | undefined> & { backgroundColor?: unknown };
  if (!s.backgroundColor && !radiusProps.some((prop) => s[prop] !== undefined)) return undefined;
  return {
    topLeft: (rtl ? s.borderTopEndRadius : s.borderTopStartRadius) ?? s.borderTopLeftRadius ?? s.borderRadius ?? 0,
    topRight: (rtl ? s.borderTopStartRadius : s.borderTopEndRadius) ?? s.borderTopRightRadius ?? s.borderRadius ?? 0,
    bottomLeft: (rtl ? s.borderBottomEndRadius : s.borderBottomStartRadius) ?? s.borderBottomLeftRadius ?? s.borderRadius ?? 0,
    bottomRight: (rtl ? s.borderBottomStartRadius : s.borderBottomEndRadius) ?? s.borderBottomRightRadius ?? s.borderRadius ?? 0,
  };
}

export type ShadowParams = { color?: unknown; opacity?: number; radius?: number; offset?: [number, number] };

/**
 * `shadowStyle`: the same shadow on every platform. iOS draws a radius twice as large as design tools and CSS do, so it is halved there.
 */
export function shadowStyle({ color, opacity, radius, offset }: ShadowParams, platform: "android" | "ios" = currentPlatform()): Style {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius && (platform === "ios" ? radius / 2 : radius),
    shadowOffset: offset && { width: offset[0], height: offset[1] },
  };
}

const shadowKeys = new Set(["shadowColor", "shadowOpacity", "shadowRadius", "shadowOffset"]);
// What makes the shadowed box look like one: the native view paints its shadow behind these, so they move to it.
const boxKeys = new Set([
  "backgroundColor", "borderStyle", "borderCurve", ...radiusProps, "borderStartStartRadius", "borderStartEndRadius", "borderEndStartRadius", "borderEndEndRadius",
  "borderColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "borderStartColor", "borderEndColor",
  "borderBlockColor", "borderBlockStartColor", "borderBlockEndColor",
]);
// The container keeps the widths too (they take room in the layout); the native view draws the borders, and is placed outside the container's padding box by them (`borderInsets`).
const widthKeys = new Set([
  "borderWidth", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStartWidth", "borderEndWidth",
  "borderBlockWidth", "borderBlockStartWidth", "borderBlockEndWidth",
]);

export type Insets = { left: number; top: number; right: number; bottom: number };

/**
 * Where the native view sits in the container: Yoga positions an absolute child from the container's padding box, inside the border, so a container that keeps
 * its border widths would leave the border to a ring the native view does not cover. The insets are the widths, negative, so the view fills the border box
 * and paints the border where the style puts it. The widths are resolved as Yoga resolves a border edge (`Style::computeLeftEdge`): a side beats `borderWidth`;
 * for the left and right edges the start and end widths beat the side ones, by the layout direction. Only the widths that take room count: the block ones are
 * painted and not laid out (`YogaStylableProps` has no `borderBlock*Width`).
 */
export function borderInsets(style: Style, rtl: boolean): Insets {
  const width = (key: string): number | undefined => (typeof style[key] === "number" && style[key] >= 0 ? style[key] : undefined);
  const all = width("borderWidth");
  const left = (rtl ? width("borderEndWidth") : width("borderStartWidth")) ?? width("borderLeftWidth") ?? all ?? 0;
  const right = (rtl ? width("borderStartWidth") : width("borderEndWidth")) ?? width("borderRightWidth") ?? all ?? 0;
  const top = width("borderTopWidth") ?? all ?? 0;
  const bottom = width("borderBottomWidth") ?? all ?? 0;
  const inset = (value: number) => (value ? -value : 0);
  return { left: inset(left), top: inset(top), right: inset(right), bottom: inset(bottom) };
}

/**
 * What Android's `ShadowedView` hands to its two views. The library's native view is the box itself, so its children are mounted by React
 * Native and hear no touches in JavaScript; here the box is a container of the engine's views and the native view (shadow, background,
 * border and corner radii, no children) fills it behind them. `content` is the container's style, `box` the native view's, `inset` where it sits
 * in the container (`borderInsets`), `shadow` its shadow props (the wrapper's native props are top-level) and `cornerRadii` what the wrapper computes from the style.
 */
export function shadowedParts(style: unknown, rtl: boolean): { content: Style; box: Style; inset: Insets; shadow: Style; cornerRadii: CornerRadii } {
  const flat = flattenStyle(style);
  const content: Style = {};
  const box: Style = {};
  const shadow: Style = {};
  for (const key of Object.keys(flat)) {
    const value = flat[key];
    if (value === undefined) continue;
    if (shadowKeys.has(key)) shadow[key] = value;
    else if (boxKeys.has(key)) box[key] = value;
    else {
      content[key] = value;
      if (widthKeys.has(key)) box[key] = value;
    }
  }
  return { content, box, inset: borderInsets(flat, rtl), shadow, cornerRadii: cornerRadiiFromStyle(flat, rtl) ?? { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 } };
}

const currentPlatform = (): "android" | "ios" =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("react-native/Libraries/Utilities/Platform") as { default: { OS: string } }).default.OS === "ios" ? "ios" : "android";

/** `I18nManager.isRTL`, from React Native's own module. */
export function isRightToLeft(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("react-native/Libraries/ReactNative/I18nManager") as { default: { isRTL: boolean } }).default.isRTL;
}
