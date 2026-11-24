/**
 * The box styles the Android engine draws with React Native's own drawables and the transform origin (SPEC.md, "Box styles"; qa/README "Box styles"): one
 * tile per case, plain style objects. The lab page (`src/routes/__dev/styles`) draws them with the engine; `qa/styles-reference/entry.js` draws the same objects
 * with React Native's own views (a plain React Native app), so the two can be laid side by side. Plain data and no import: both bundlers take this file.
 */
export type Tile = {
  id: string;
  /** The style of the box under test. Its size is its own (`width`, `height`); the tile centres it. */
  style: Record<string, unknown>;
  /** A child of the box: a bar across its top, to show what `overflow: hidden` clips and what a shadow does not. */
  bar?: Record<string, unknown>;
  /** The animated tile: Reanimated turns the box to these values (the lab page only; the reference draws the end state as a static transform). */
  to?: { rotate?: string; scale?: number };
};

export type Mode = "shadow" | "border" | "origin";
export const modes: Mode[] = ["shadow", "border", "origin"];

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
  if (tile.to === undefined) return tile.style;
  const transform = [...(tile.to.rotate === undefined ? [] : [{ rotate: tile.to.rotate }]), ...(tile.to.scale === undefined ? [] : [{ scale: tile.to.scale }])];
  return { ...tile.style, transform };
}

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
];
