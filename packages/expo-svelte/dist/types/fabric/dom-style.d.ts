/** What a CSS value has turned into: a number of dp (a length, a plain number), a percentage, or an angle in degrees. */
export type Unit = "" | "%" | "deg";
/** One function of a transform list: React Native's name for it, the unit its value has, and the value. `translate(10px, 5px)` is two of them. */
export type TransformOp = {
    name: string;
    unit: Unit;
    value: number;
};
export type NativeTransform = Record<string, number | string>;
export type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type Size = {
    width: number;
    height: number;
};
/** A CSS number with its unit, or null. `1e-7px` is read as a number with the unit `px`, not as `1e` and `-7px`. */
export declare function parseQuantity(text: string): {
    value: number;
    unit: string;
} | null;
/** A length in dp (`12px`, `12`) or a percentage (`50%`), as the number and its unit; null for anything else (`em`, `calc()`, `auto`). */
export declare function parseLength(text: string | number): {
    value: number;
    unit: "" | "%";
} | null;
export type ParsedTransform = {
    ops: TransformOp[];
    unsupported: string[];
};
/** A CSS transform list (`translate(0px, 20px) scale(0.5)`, or `none`) as React Native's operations, and the functions it could not read (they are left out). */
export declare function parseTransform(text: string): ParsedTransform;
/** One operation as an entry of React Native's `transform` array: `{ translateX: 10 }`, `{ translateX: "50%" }`, `{ rotate: "45deg" }`. */
export declare function nativeEntry(op: TransformOp): NativeTransform;
export declare const nativeTransform: (ops: readonly TransformOp[]) => NativeTransform[];
/** React Native's `transform` (an array of entries, or a CSS string) as the CSS function list that `getComputedStyle(node).transform` gives: `translateX(10px) scale(2)`, or `none`. */
export declare function transformToCss(transform: unknown): string;
/** The entries of a node's `transform` as operations (what a keyframe's list is made of), from the array or the string React Native accepts. */
export declare function transformOps(transform: unknown): TransformOp[];
/** The entries of a `transform` array (what a worklet writes: `{ translateX: 10 }`, `{ scale: 2 }`, `{ rotate: "45deg" }`) as operations. */
export declare function entriesToOps(entries: readonly Record<string, number | string>[]): TransformOp[];
/**
 * A `transformOrigin` (a string such as `top left`, `50% 50%` or `10px 20px`, or React Native's array form) as the point it names in a box of `size`, in px from the box's top left.
 * Nothing, or a value that is not one, is the centre, which is where React Native and CSS put it.
 */
export declare function parseOrigin(origin: unknown, size: Size): {
    x: number;
    y: number;
};
/**
 * Where a transform puts a box: its translation and its scale about `origin` (a point of the box, in px from its top left), as `getBoundingClientRect` reports the box of a transformed
 * element. A rotation, a skew and a perspective are not applied (the box stays the one it was).
 */
export declare function transformRect(box: Rect, ops: readonly TransformOp[], origin: {
    x: number;
    y: number;
}): Rect;
/** A style (an object, or arrays of them, with falsy entries) as one object, later entries winning; a shared value or any other object that is not a plain record is skipped. */
export declare function flattenStyle(style: unknown, into?: Record<string, unknown>): Record<string, unknown>;
/** The style a node's own attributes give it (`style`, `nativeStyle`, the style of `class`), flattened. */
export declare function naturalStyle(props: Readonly<Record<string, unknown>>): Record<string, unknown>;
/** The inline-style property names a node's `style` has accessors for (`NativeNode.style`): the ones Svelte's transitions and `animate:` write. */
export declare const inlineProperties: readonly string[];
/**
 * Puts what was written to a node's inline `style` (CSS strings by property) over the style the node has: `position`, `overflow` and `pointerEvents` (`element.inert`), a `width` and
 * `height` in px, and a `transform` that is added to the node's own (Svelte's `animate:` keeps a leaving item where it was with `position: absolute` and a translation, and the item
 * may be scaled itself). Any other property written is kept on the node and not applied.
 */
export declare function applyInlineStyle(props: Record<string, unknown>, inline: Readonly<Record<string, string>>): void;
/** The style a node has now, flattened: its own (`naturalStyle`) with what was written to its inline `style` over it. */
export declare function effectiveStyle(props: Readonly<Record<string, unknown>>, inline: Readonly<Record<string, string>> | null): Record<string, unknown>;
export type ComputedStyle = Record<string, string> & {
    opacity: string;
    transform: string;
    transformOrigin: string;
    width: string;
    height: string;
};
/**
 * What `getComputedStyle(node)` gives Svelte's transitions and `flip`: the values they read, as the strings the DOM gives, from the node's own style (and its inline `style`: the style
 * of its `class` is in it) and its layout. The size is read when `width`, `height` or `transformOrigin` is: it asks the host to commit what is pending first, which a transition that
 * reads none of them (`fade`, `fly`) never costs.
 */
export declare function computedStyleOf(props: Readonly<Record<string, unknown>>, inline: Readonly<Record<string, string>> | null, size: () => Size | null): ComputedStyle;
/** A `DOMRect` as far as Svelte's `flip` and `crossfade` read it (`left`, `top`, `right`, `bottom`, `width`, `height`). */
export declare function domRect({ x, y, width, height }: Rect): DOMRectReadOnly;
