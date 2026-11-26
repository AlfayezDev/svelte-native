export type Edge = "top" | "right" | "bottom" | "left";
export type Frame = {
    x: number;
    y: number;
    width: number;
    height: number;
};
/**
 * Values in dp. `keyboardHeight` is how much of the overlay the keyboard covers (the height it is going to have, from the start of its animation); `keyboardAnimating` says it
 * is moving (Android; iOS does not send it); `frame` is the overlay in window coordinates.
 */
export type InsetsEvent = {
    top: number;
    right: number;
    bottom: number;
    left: number;
    keyboardHeight: number;
    keyboardVisible: boolean;
    keyboardAnimating?: boolean;
    frame: Frame;
};
/** Subscribes to insets changes and delivers the current value first when the engine already has one. Returns the unsubscribe function, or null without the engine module. */
export declare function subscribeInsets(listener: (event: InsetsEvent) => void): (() => void) | null;
type StyleValue = unknown;
/** Flattens a React Native style (arrays, falsy entries) into one object; sufficient for the padding keys the components read. */
export declare function flattenStyle(style: StyleValue): Record<string, unknown>;
/**
 * The `transform` of a view that sticks to the keyboard (without the engine's frames), for the `own` transform its style has: the keyboard's `translateY` first, then the view's own
 * entries. A transform list applies the later entries before the earlier ones (React Native multiplies the matrices in order), so a translation put first is outside the rest: a view
 * with `scale: 0.95` is moved by the whole of the keyboard's height, not by 95% of it. The style's own transform used to be replaced by the keyboard's (two styles with a `transform` each,
 * of which the flattening keeps the last). A transform written as a string (`"scale(0.95)"`) follows a translation written as a string too.
 */
export declare function keyboardTransform(own: unknown, translateY: number): unknown;
/** `[style, padding]` for a SafeAreaView: each selected edge's padding is the style's own padding for that side plus the inset, like safe-area-context's padding mode. */
export declare function safeAreaStyle(style: StyleValue, insets: Pick<InsetsEvent, Edge>, edges?: readonly Edge[]): StyleValue[];
export type AvoidBehavior = "padding" | "height" | "position" | undefined;
/**
 * How far the keyboard overlaps the view, React Native's `_relativeKeyboardHeight`. `viewY` and `viewHeight` are the view's
 * window frame, `rootHeight` the overlay's height and `keyboardHeight` what the keyboard covers of it, so the keyboard's
 * top edge is `rootHeight - keyboardHeight`. For "height" the view has already shrunk by `previous` (what is applied to it now: 0 while it is disabled, whatever the overlap was), which is added back.
 */
export declare function keyboardOverlap(args: {
    viewY: number;
    viewHeight: number;
    rootHeight: number;
    keyboardHeight: number;
    offset?: number;
    behavior?: AvoidBehavior;
    previous?: number;
}): number;
/** The style a KeyboardAvoidingView wraps its content in for `bottom` px of overlap (the outer view of "padding" and "height"; the inner container of "position" uses `{ bottom }`). */
export declare function avoidingStyle(behavior: AvoidBehavior, style: StyleValue, bottom: number, initialHeight: number): StyleValue;
export {};
