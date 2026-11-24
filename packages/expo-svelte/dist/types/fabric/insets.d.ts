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
/** `[style, padding]` for a SafeAreaView: each selected edge's padding is the style's own padding for that side plus the inset, like safe-area-context's padding mode. */
export declare function safeAreaStyle(style: StyleValue, insets: Pick<InsetsEvent, Edge>, edges?: readonly Edge[]): StyleValue[];
export type AvoidBehavior = "padding" | "height" | "position" | undefined;
/**
 * How far the keyboard overlaps the view, React Native's `_relativeKeyboardHeight`. `viewY` and `viewHeight` are the view's
 * window frame, `rootHeight` the overlay's height and `keyboardHeight` what the keyboard covers of it, so the keyboard's
 * top edge is `rootHeight - keyboardHeight`. For "height" the view has already shrunk by `previous`, which is added back.
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
