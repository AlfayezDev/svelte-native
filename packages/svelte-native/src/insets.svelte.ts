import { subscribeInsets, type Frame, type InsetsEvent } from "./fabric/insets.ts";

/**
 * Safe-area and keyboard insets in dp, reactive, fed by the engine (see `connectInsets`).
 * `frame` is the overlay in window coordinates (its height is the surface height).
 */
export const insets = $state<{ top: number; right: number; bottom: number; left: number; keyboardHeight: number; keyboardVisible: boolean; frame: Frame }>({
  top: 0, right: 0, bottom: 0, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 0, height: 0 },
});

let connected = false;

/** Applies one event; fields are compared one by one so an unchanged value triggers no effect. */
export function applyInsets(event: InsetsEvent): void {
  insets.top = event.top;
  insets.right = event.right;
  insets.bottom = event.bottom;
  insets.left = event.left;
  insets.keyboardHeight = event.keyboardHeight;
  insets.keyboardVisible = event.keyboardVisible;
  insets.frame.x = event.frame.x;
  insets.frame.y = event.frame.y;
  insets.frame.width = event.frame.width;
  insets.frame.height = event.frame.height;
}

/** Subscribes the store to the engine once; a no-op when the engine is not installed (retried on the next call). */
export function connectInsets(): void {
  if (connected) return;
  connected = subscribeInsets(applyInsets) !== null;
}

/** Test hook: forget the subscription so the next `connectInsets` subscribes again. */
export function resetInsets(): void { connected = false; }
