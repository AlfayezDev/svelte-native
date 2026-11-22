import { type Frame, type InsetsEvent } from "./fabric/insets.js";
/**
 * Safe-area and keyboard insets in dp, reactive, fed by the engine (see `connectInsets`).
 * `frame` is the overlay in window coordinates (its height is the surface height).
 */
export declare const insets: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    keyboardHeight: number;
    keyboardVisible: boolean;
    frame: Frame;
};
/** Applies one event; fields are compared one by one so an unchanged value triggers no effect. */
export declare function applyInsets(event: InsetsEvent): void;
/** Subscribes the store to the engine once; a no-op when the engine is not installed (retried on the next call). */
export declare function connectInsets(): void;
/** Test hook: forget the subscription so the next `connectInsets` subscribes again. */
export declare function resetInsets(): void;
