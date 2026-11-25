/**
 * The box styles the Android engine draws (React Native's own drawables, or the engine's one drawable for a fill and a border of one width and one colour) and the transform origin (SPEC.md, "Box styles"; qa/README "Box styles"): one
 * tile per case, plain style objects. The lab page (`src/routes/__dev/styles`) draws them with the engine; `qa/styles-reference/entry.js` draws the same objects
 * with React Native's own views (a plain React Native app), so the two can be laid side by side. Plain data and no import: both bundlers take this file.
 */
export type Tile = {
  id: string;
  /** What the box is: a `View` (the default), an `Image` (of `imageUri`), a `ScrollView` (with a bar and a block of its own as content) or a `Text` (of `text`). */
  kind?: "view" | "image" | "scroll" | "text";
  /** The style of the box under test. Its size is its own (`width`, `height`); the tile centres it. */
  style: Record<string, unknown>;
  /** A child of the box: a bar across its top, to show what `overflow: hidden` clips and what a shadow does not. */
  bar?: Record<string, unknown>;
  /** The words of a `Text` tile. */
  text?: string;
  /** The tile that is changed with `setNativeProps` 300 ms after it mounts (the lab page only; the reference draws the end state as a static style: `style` with these laid over it). */
  after?: Record<string, unknown>;
  /** The animated tile: Reanimated turns the box to these values (the lab page only; the reference draws the end state as a static style). `radius` is `borderRadius`, in dp. */
  to?: { rotate?: string; scale?: number; radius?: number };
};

export type Mode = "shadow" | "border" | "origin" | "uniform" | "rect" | "views";
export const modes: Mode[] = ["shadow", "border", "origin", "uniform", "rect", "views"];

/** A 252 x 168 px PNG of four flat quadrants (blue, orange, green, purple): the size of a 96 x 64 dp image on a 420 dpi screen, so nothing scales it. */
export const imageUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPwAAACoCAIAAABL1hTRAAABdElEQVR42u3UUQ2AIBiFUWQGsIRPtMIIFKEJZSzgsxnYjPG7cU6Eu293O683EeE+ihFCZBMgehA9iB5ED6IH0YPoQfQgehA9iB5ED6IH0YPoET2IHkQPogfRg+hB9CB6ED2IHkQPogfRg+hB9IgeRA+iB9GD6EH0IHoQPYgeRA+iB9GD6EH0IHpED6IH0YPoQfQgehA9iB5ED6IH0YPoQfQgehA9ogfRg+hB9CB6ED2IHkQPogfRg+hB9CB6ED2IHtGD6EH0IHoQPYgeRA9/sc/arBBi9McInh5ED6IH0YPoQfQgekQPogfRg+hB9CB6ED2IHkQPogfRg+hB9CB6ED2IHtGD6EH0IHoQPYgeRA+iB9GD6EH0IHoQPYgeRI/oQfQgehA9iB5ED6IH0YPoQfQgehA9iB5ED6JH9CB6ED2IHkQPogfRg+hB9CB6ED2IHkQPogfRI3oQPYgeRA+iB9GD6EH0IHoQPYgeRA+iB9GD6FnbB4pOB8YxREf8AAAAAElFTkSuQmCC";
const scrollBar = { height: 24, backgroundColor: "#e4e4e7" } as const;
const scrollBlock = { height: 120, backgroundColor: "#2563eb" } as const;

const input = { width: 150, height: 44, borderRadius: 8, borderWidth: 1, borderColor: "#d4d4d8", backgroundColor: "#ffffff" };
const box = { width: 64, height: 64, backgroundColor: "#2563eb" };
/** A marker in the box's corner: where the origin is, which the eye can follow. */
const marker = { position: "absolute", top: 0, left: 0, width: 16, height: 16, backgroundColor: "#f97316" } as const;

/** The focus ring of an input (`ring` below), and the input the lab page gives it at run time: the same box, with a line of text, in the two states. */
export const focusRing = "0 0 0 1px #66666f, 0 0 0 4px rgba(9,9,11,0.07)";
export const runtimeInput = { ...input, justifyContent: "center", paddingHorizontal: 12 } as const;
export const runtimeLabel = { color: "#71717a", fontSize: 14 } as const;

export const tiles: Record<Mode, Tile[]> = {
  shadow: [
    { id: "ring", style: { ...input, boxShadow: focusRing } },
    { id: "ring-off", style: { ...input, boxShadow: "0 0 0 0 transparent" } },
    { id: "inset", style: { ...input, boxShadow: "inset 0 0 0 1px #66666f" } },
    { id: "card", style: { width: 150, height: 84, borderRadius: 16, backgroundColor: "#ffffff", overflow: "hidden", boxShadow: "0 10px 30px -10px rgba(9,9,11,0.18)" }, bar: { height: 24, backgroundColor: "#e4e4e7" } },
    { id: "subtle", style: { width: 150, height: 44, borderRadius: 6, backgroundColor: "#ffffff", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" } },
    { id: "layers", style: { width: 150, height: 56, borderRadius: 12, borderWidth: 2, borderColor: "#18181b", backgroundColor: "#fef3c7", boxShadow: "inset 0 0 0 3px #f59e0b, 0 2px 8px rgba(9,9,11,0.35), 6px 6px 0 -2px #f97316" } },
    { id: "objects", style: { width: 150, height: 56, borderRadius: 10, backgroundColor: "#ffffff", boxShadow: [{ offsetX: 2, offsetY: 4, blurRadius: 6, spreadDistance: 1, color: "rgba(0,0,0,0.4)" }, { offsetX: 0, offsetY: 0, blurRadius: 10, color: "#3b82f6", inset: true }] } },
    // What the engine's plain background draws (a view with no shadow and nothing a `GradientDrawable` cannot draw): a filled box with rounded corners, an input's border, a square border.
    { id: "fill", style: { width: 150, height: 56, borderRadius: 8, backgroundColor: "#ffffff" } },
    { id: "plain", style: { ...input } },
    { id: "rect", style: { width: 150, height: 44, borderWidth: 1, borderColor: "#d4d4d8", backgroundColor: "#ffffff" } },
  ],
  border: [
    { id: "dashed", style: { width: 150, height: 56, borderWidth: 2, borderStyle: "dashed", borderColor: "#ef4444", backgroundColor: "#ffffff" } },
    { id: "dashed-round", style: { width: 150, height: 56, borderRadius: 12, borderWidth: 2, borderStyle: "dashed", borderColor: "#ef4444", backgroundColor: "#ffffff" } },
    { id: "dotted", style: { width: 150, height: 56, borderWidth: 3, borderStyle: "dotted", borderColor: "#3b82f6", backgroundColor: "#ffffff" } },
    { id: "dotted-round", style: { width: 150, height: 56, borderRadius: 14, borderWidth: 3, borderStyle: "dotted", borderColor: "#3b82f6", backgroundColor: "#ffffff" } },
    { id: "sides", style: { width: 150, height: 56, borderWidth: 6, borderTopColor: "#ef4444", borderRightColor: "#22c55e", borderBottomColor: "#3b82f6", borderLeftColor: "#f59e0b", backgroundColor: "#ffffff" } },
    { id: "sides-round", style: { width: 150, height: 56, borderRadius: 16, borderWidth: 6, borderTopColor: "#ef4444", borderRightColor: "#22c55e", borderBottomColor: "#3b82f6", borderLeftColor: "#f59e0b", backgroundColor: "#ffffff" } },
    { id: "bottom-color", style: { width: 150, height: 56, borderRadius: 10, borderWidth: 4, borderColor: "#d4d4d8", borderBottomColor: "#ef4444", backgroundColor: "#ffffff" } },
    { id: "sides-width", style: { width: 150, height: 56, borderTopWidth: 1, borderBottomWidth: 6, borderLeftWidth: 3, borderColor: "#18181b", backgroundColor: "#ffffff" } },
    { id: "dashed-sides", style: { width: 150, height: 56, borderRadius: 8, borderWidth: 3, borderStyle: "dashed", borderTopColor: "#ef4444", borderBottomColor: "#3b82f6", borderLeftColor: "#22c55e", borderRightColor: "#f59e0b", backgroundColor: "#ffffff" } },
    { id: "start-end", style: { width: 150, height: 56, borderWidth: 5, borderColor: "#d4d4d8", borderStartColor: "#7c3aed", borderEndColor: "#0d9488", backgroundColor: "#ffffff" } },
    { id: "no-color", style: { width: 150, height: 56, borderRadius: 8, borderWidth: 3, borderStyle: "dashed", backgroundColor: "#ffffff" } },
    { id: "solid", style: { width: 150, height: 56, borderRadius: 8, borderWidth: 3, borderColor: "#18181b", backgroundColor: "#ffffff" } },
  ],
  // The boundary of the engine's one drawable (a fill and a solid border of one width and one colour, no shadow) and React Native's: a uniform border at the edges of what the drawable copies.
  uniform: [
    { id: "corners", style: { width: 150, height: 56, borderTopLeftRadius: 4, borderTopRightRadius: 16, borderBottomRightRadius: 28, borderBottomLeftRadius: 0, borderWidth: 2, borderColor: "#18181b", backgroundColor: "#fef3c7" } },
    { id: "hairline", style: { width: 150, height: 56, borderRadius: 8, borderWidth: 0.38, borderColor: "#18181b", backgroundColor: "#ffffff" } },
    { id: "hairline-rect", style: { width: 150, height: 56, borderWidth: 0.38, borderColor: "#18181b", backgroundColor: "#ffffff" } },
    { id: "translucent", style: { width: 150, height: 56, borderRadius: 12, borderWidth: 6, borderColor: "rgba(37,99,235,0.5)", backgroundColor: "#fef3c7" } },
    { id: "translucent-rect", style: { width: 150, height: 56, borderWidth: 6, borderColor: "rgba(37,99,235,0.5)", backgroundColor: "#fef3c7" } },
    { id: "transparent-border", style: { width: 150, height: 56, borderRadius: 10, borderWidth: 4, borderColor: "transparent", backgroundColor: "#2563eb" } },
    { id: "pill", style: { width: 150, height: 56, borderRadius: 999, borderWidth: 2, borderColor: "#18181b", backgroundColor: "#ffffff" } },
    { id: "thick-round", style: { width: 150, height: 56, borderRadius: 8, borderWidth: 12, borderColor: "#7c3aed", backgroundColor: "#ffffff" } },
    { id: "ellipse", style: { width: 150, height: 56, borderRadius: 40, borderWidth: 3, borderColor: "#18181b", backgroundColor: "#fef3c7" } },
    { id: "clip", style: { width: 150, height: 84, borderRadius: 16, borderWidth: 4, borderColor: "#18181b", backgroundColor: "#ffffff", overflow: "hidden" }, bar: { height: 24, backgroundColor: "#e4e4e7" } },
    { id: "clip-rect", style: { width: 150, height: 84, borderWidth: 2.5, borderColor: "#18181b", backgroundColor: "#ffffff", overflow: "hidden" }, bar: { height: 24, backgroundColor: "#e4e4e7" } },
    { id: "elevation", style: { width: 150, height: 56, borderRadius: 12, borderWidth: 2, borderColor: "#18181b", backgroundColor: "#ffffff", elevation: 8 } },
  ],
  // Borders of square corners the engine's drawable draws in one: a divider (a bottom border only), sides with their own widths and colours, dashes and dots, the clip to the padding box.
  rect: [
    { id: "divider", style: { width: 150, height: 44, backgroundColor: "#ffffff", borderBottomWidth: 0.38, borderBottomColor: "#d4d4d8" } },
    // an animated radius on a divider: a bottom border with round corners is not the engine drawable's, so the box is built again when the radius appears
    { id: "radius-divider", style: { width: 150, height: 56, backgroundColor: "#ffffff", borderBottomWidth: 4, borderBottomColor: "#18181b" }, to: { radius: 16 } },
    { id: "side-left", style: { width: 150, height: 44, backgroundColor: "#ffffff", borderLeftWidth: 4, borderLeftColor: "#7c3aed" } },
    // `setNativeProps` after mount: `borderColor` colours every side, a side's own colour, the dashes and the shadow are taken (the engine kept the border's first colour, ignored the rest)
    { id: "native-props", style: { width: 150, height: 56, backgroundColor: "#ffffff", borderWidth: 3, borderColor: "#3b82f6" }, after: { borderColor: "#22c55e", borderTopColor: "#ef4444", borderStyle: "dashed", boxShadow: "0 4px 8px rgba(0,0,0,0.3)" } },
    { id: "widths", style: { width: 150, height: 56, backgroundColor: "#ffffff", borderLeftWidth: 2, borderRightWidth: 5, borderTopWidth: 4, borderBottomWidth: 1, borderColor: "#0d9488" } },
    { id: "colours-translucent", style: { width: 150, height: 56, backgroundColor: "#ffffff", borderWidth: 5, borderTopColor: "rgba(239,68,68,0.5)", borderRightColor: "#22c55e", borderBottomColor: "#3b82f6", borderLeftColor: "#f59e0b" } },
    { id: "colours-no-width", style: { width: 150, height: 44, backgroundColor: "#ffffff", borderBottomWidth: 4, borderTopColor: "#ef4444", borderLeftColor: "#f59e0b", borderBottomColor: "#3b82f6" } },
    { id: "dashed", style: { width: 150, height: 56, backgroundColor: "#ffffff", borderWidth: 2, borderStyle: "dashed", borderColor: "#ef4444" } },
    { id: "dotted", style: { width: 150, height: 56, backgroundColor: "#ffffff", borderWidth: 3, borderStyle: "dotted", borderColor: "#3b82f6" } },
    { id: "dashed-widths", style: { width: 150, height: 56, backgroundColor: "#ffffff", borderTopWidth: 2, borderBottomWidth: 4, borderLeftWidth: 1, borderStyle: "dashed", borderColor: "#18181b" } },
    { id: "dashed-colours", style: { width: 150, height: 56, backgroundColor: "#ffffff", borderWidth: 3, borderStyle: "dashed", borderColor: "#3b82f6", borderTopColor: "#ef4444" } },
    { id: "clip-widths", style: { width: 150, height: 84, backgroundColor: "#ffffff", borderTopWidth: 6, borderBottomWidth: 2, borderLeftWidth: 3, borderRightWidth: 1, borderColor: "#18181b", overflow: "hidden" }, bar: { height: 24, backgroundColor: "#e4e4e7" } },
  ],
  // The other kinds of view that take the same box styles (a shadow, a border, `overflow`), the radius that is animated, and radii that overflow.
  views: [
    { id: "image-shadow", kind: "image", style: { width: 96, height: 64, borderRadius: 16, boxShadow: "0 6px 10px rgba(0,0,0,0.4)" } },
    { id: "image-border", kind: "image", style: { width: 96, height: 64, borderRadius: 12, borderWidth: 3, borderColor: "#18181b" } },
    { id: "radius-sides", style: { width: 150, height: 56, backgroundColor: "#ffffff", borderTopWidth: 2, borderBottomWidth: 6, borderLeftWidth: 3, borderColor: "#18181b" }, to: { radius: 16 } },
    { id: "scroll-shadow", kind: "scroll", style: { width: 150, height: 84, borderRadius: 16, backgroundColor: "#ffffff", boxShadow: "0 6px 12px rgba(9,9,11,0.3)" } },
    // 8 dp is 21 px: a whole number, so that the content container, which Yoga puts at a fraction inside the border, is rounded the same way (see SPEC "Not done": the engine rounds a frame's edges, React Native its origin and its size)
    { id: "scroll-border", kind: "scroll", style: { width: 150, height: 84, borderRadius: 16, borderWidth: 8, borderColor: "#18181b", backgroundColor: "#ffffff" } },
    // 128 dp is 336 px and 8 dp of padding 21: a text box whose layout width is a whole number of pixels. The engine lays a text out at the integer part of the width inside the insets, React Native at its ceiling, which moves right-aligned text (right to left) by a pixel in a box of 130 dp (SPEC "Not done")
    { id: "text-shadow", kind: "text", text: "A text longer than its box", style: { width: 128, height: 30, paddingHorizontal: 8, borderRadius: 12, backgroundColor: "#fef3c7", overflow: "hidden", boxShadow: "0 4px 8px rgba(0,0,0,0.3)", fontSize: 16, color: "#18181b" } },
    // 3 dp of border and 5 dp of padding are 21 px together, the whole pixel the text layout width needs
    { id: "text-border", kind: "text", text: "Clipped text, longer than its box", style: { width: 128, height: 30, paddingHorizontal: 5, borderRadius: 12, borderWidth: 3, borderColor: "#18181b", backgroundColor: "#fef3c7", overflow: "hidden", fontSize: 15, color: "#18181b" } },
    { id: "radius-react", style: { width: 96, height: 64, backgroundColor: "#ffffff", borderWidth: 2, borderColor: "#18181b", overflow: "hidden", boxShadow: "0 4px 8px rgba(0,0,0,0.3)" }, bar: { height: 24, backgroundColor: "#2563eb" }, to: { radius: 24 } },
    { id: "radius-engine", style: { width: 96, height: 64, backgroundColor: "#ffffff", borderWidth: 2, borderColor: "#18181b", overflow: "hidden", elevation: 6 }, bar: { height: 24, backgroundColor: "#2563eb" }, to: { radius: 24 } },
    { id: "radius-plain", style: { width: 96, height: 64, backgroundColor: "#ffffff", overflow: "hidden" }, bar: { height: 24, backgroundColor: "#2563eb" }, to: { radius: 24 } },
    { id: "mixed-overflow", style: { width: 150, height: 56, borderTopLeftRadius: 40, borderBottomLeftRadius: 40, borderTopRightRadius: 10, borderBottomRightRadius: 0, backgroundColor: "#2563eb" } },
    { id: "elevation-plain", style: { width: 150, height: 56, borderRadius: 12, backgroundColor: "#ffffff", elevation: 8 } },
  ],
  origin: [
    { id: "centre", style: { ...box, transform: [{ rotate: "25deg" }] }, bar: marker },
    { id: "top-left", style: { ...box, transform: [{ rotate: "25deg" }], transformOrigin: "top left" }, bar: marker },
    { id: "bottom-right", style: { ...box, transform: [{ rotate: "-25deg" }], transformOrigin: "bottom right" }, bar: marker },
    { id: "percent", style: { ...box, transform: [{ scale: 1.4 }], transformOrigin: "25% 75%" }, bar: marker },
    { id: "length", style: { ...box, transform: [{ rotate: "45deg" }], transformOrigin: "10px 20px" }, bar: marker },
    { id: "array", style: { ...box, transform: [{ rotate: "-30deg" }, { scale: 0.8 }], transformOrigin: ["100%", "0%", 0] }, bar: marker },
    { id: "moved", style: { ...box, transform: [{ translateX: 12 }, { rotate: "20deg" }], transformOrigin: "left center" }, bar: marker },
    { id: "animated", style: { ...box, transformOrigin: "top left" }, bar: marker, to: { rotate: "40deg" } },
    { id: "animated-scale", style: { ...box, transformOrigin: "100% 100%" }, bar: marker, to: { scale: 1.5 } },
    { id: "animated-centre", style: { ...box }, bar: marker, to: { rotate: "40deg" } },
  ],
};

/** The style a tile has once its animation ends: the box's own, with the transform the animation reached written as one. */
export function endStyle(tile: Tile): Record<string, unknown> {
  if (tile.after !== undefined) return { ...tile.style, ...tile.after };
  if (tile.to === undefined) return tile.style;
  const transform = [...(tile.to.rotate === undefined ? [] : [{ rotate: tile.to.rotate }]), ...(tile.to.scale === undefined ? [] : [{ scale: tile.to.scale }])];
  return { ...tile.style, ...(transform.length === 0 ? {} : { transform }), ...(tile.to.radius === undefined ? {} : { borderRadius: tile.to.radius }) };
}

/** What a `ScrollView` tile holds: a bar and a block taller than the box, so the box's corners and border clip the content. */
export const scrollContent = [scrollBar, scrollBlock] as const;

/**
 * The styles of the reuse check (`/__dev/styles?reuse=<from>-<to>`): ten boxes in the style `from`, removed, then ten in the style `to` that the engine makes from the views it recycled. Whatever
 * a recycled view had (a border, a shadow, a radius, none of them) must not show in the next style: the screenshot equals the one of `?reuse=-<to>`, which has no recycled view.
 */
export const reuseStyles: Array<Record<string, unknown>> = [
  { width: 150, height: 56, borderRadius: 8, backgroundColor: "#ffffff" },
  { width: 150, height: 56, borderRadius: 8, borderWidth: 1, borderColor: "#d4d4d8", backgroundColor: "#ffffff" },
  { width: 150, height: 56, borderRadius: 12, borderWidth: 3, borderStyle: "dashed", borderColor: "#ef4444", backgroundColor: "#ffffff" },
  { width: 150, height: 56, borderRadius: 8, borderWidth: 1, borderColor: "#d4d4d8", backgroundColor: "#ffffff", boxShadow: focusRing },
  { width: 150, height: 56, borderRadius: 16, borderWidth: 6, borderTopColor: "#ef4444", borderRightColor: "#22c55e", borderBottomColor: "#3b82f6", borderLeftColor: "#f59e0b", backgroundColor: "#ffffff" },
  { width: 150, height: 56, borderRadius: 10, backgroundColor: "#ffffff", boxShadow: "inset 0 0 8px 2px rgba(59,130,246,0.8)" },
  { width: 150, height: 56, borderWidth: 2, borderColor: "#18181b", backgroundColor: "#fef3c7" },
  { width: 150, height: 56, borderRadius: 28, backgroundColor: "#ffffff", boxShadow: "0 6px 12px -2px rgba(0,0,0,0.3)" },
  // the engine's one drawable: a translucent border round, a border with a radius for each corner, a translucent border with square corners
  { width: 150, height: 56, borderRadius: 12, borderWidth: 6, borderColor: "rgba(37,99,235,0.5)", backgroundColor: "#fef3c7" },
  { width: 150, height: 56, borderTopLeftRadius: 4, borderTopRightRadius: 20, borderBottomRightRadius: 0, borderBottomLeftRadius: 28, borderWidth: 3, borderColor: "#18181b", backgroundColor: "#ffffff" },
  { width: 150, height: 56, borderWidth: 4, borderColor: "rgba(37,99,235,0.5)", backgroundColor: "#fef3c7" },
  // the engine's drawable for square corners: a divider, sides with their own widths and colours, dashes; and radii that differ with no border
  { width: 150, height: 56, backgroundColor: "#ffffff", borderBottomWidth: 4, borderBottomColor: "#18181b" },
  { width: 150, height: 56, backgroundColor: "#ffffff", borderWidth: 5, borderTopColor: "#ef4444", borderRightColor: "#22c55e", borderBottomColor: "#3b82f6", borderLeftColor: "#f59e0b" },
  { width: 150, height: 56, backgroundColor: "#ffffff", borderWidth: 2, borderStyle: "dashed", borderColor: "#ef4444" },
  { width: 150, height: 56, borderTopLeftRadius: 40, borderBottomLeftRadius: 40, borderTopRightRadius: 10, borderBottomRightRadius: 0, backgroundColor: "#2563eb" },
];

/**
 * The rows of the mount-cost lab (`?rows=300&border=<name>`): a row is a view with a fill, a text and these styles. `0` and `flat` have no border (the `GradientDrawable`: the controls), `1`, `divider`,
 * `sides` and `dashed` are drawn by the engine's drawable (`1` with round corners, the others square), `shadow`, `round-dashed` and `round-sides` by React Native's drawables.
 */
export const rowStyles: Record<string, Record<string, unknown>> = {
  "0": { borderRadius: 8 },
  "1": { borderRadius: 8, borderWidth: 1, borderColor: "#d4d4d8" },
  flat: {},
  divider: { borderBottomWidth: 0.38, borderBottomColor: "#d4d4d8" },
  sides: { borderWidth: 1, borderTopColor: "#ef4444", borderRightColor: "#22c55e", borderBottomColor: "#3b82f6", borderLeftColor: "#f59e0b" },
  dashed: { borderWidth: 1, borderStyle: "dashed", borderColor: "#d4d4d8" },
  shadow: { borderRadius: 8, boxShadow: "0 1px 2px rgba(0,0,0,0.1)" },
  "round-dashed": { borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: "#d4d4d8" },
  "round-sides": { borderRadius: 8, borderWidth: 1, borderTopColor: "#ef4444", borderRightColor: "#22c55e", borderBottomColor: "#3b82f6", borderLeftColor: "#f59e0b" },
};
