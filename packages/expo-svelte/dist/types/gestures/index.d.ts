import type { GestureObjects } from "./rngh.js";
type Builders = Omit<typeof GestureObjects, "ForceTouch">;
/** `Gesture.Tap()`, `Pan()`, `Pinch()`, `Rotation()`, `Fling()`, `LongPress()`, `Native()`, `Manual()`, `Hover()` and the compositions `Race`, `Simultaneous`, `Exclusive`: RNGH's builders, unchanged. */
export declare const Gesture: Builders;
/** `GestureStateManager.create(handlerTag)` for a worklet; touch callbacks are handed a manager already. It works on the UI thread only. */
export declare const GestureStateManager: typeof import("./animated.js").GestureStateManager;
export { default as GestureDetector } from "../components/GestureDetector.svelte";
export { gesture } from "./action.js";
export { State, Directions, PointerType, TouchEventType, ActionType } from "./constants.js";
export { runOnJS, scheduleOnRN } from "../animation.js";
export type * from "./types.js";
export type { ComposedGesture, GestureType, GestureRef } from "./rngh.js";
