/**
 * Gestures: react-native-gesture-handler's builders, recognisers and arbitration on Svelte views.
 *
 * ```svelte
 * <script>
 *   import { AnimatedView, createSharedValue, withSpring } from "@alfayez/svelte-native/animation";
 *   import { Gesture } from "@alfayez/svelte-native/gestures";
 *   const x = createSharedValue(0);
 *   const pan = Gesture.Pan().onUpdate((e) => { x.value = e.translationX; }).onEnd(() => { x.value = withSpring(0); });
 * </script>
 * <AnimatedView gesture={pan} animatedStyle={() => { "worklet"; return { transform: [{ translateX: x.value }] }; }} />
 * ```
 *
 * Importing this module loads nothing: not the builders, not Reanimated. The first read of a `Gesture` property loads the
 * builders and Reanimated with worklets (so a worklet created afterwards captures the real functions), and the first node with a
 * `gesture` attribute loads the host (`fabric/gestures.ts`). An app that never imports this entry pays nothing at boot.
 */
import { loadReanimated } from "../fabric/reanimated-load.ts";
import { lazyObject } from "../lazy-object.ts";
import type { GestureObjects } from "./rngh.js";

// `ForceTouch` is iOS only and deprecated upstream.
type Builders = Omit<typeof GestureObjects, "ForceTouch">;
let builders: Builders | undefined;
function readBuilders(): Builders {
  if (builders) return builders;
  loadReanimated();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const supported: Partial<typeof GestureObjects> = { ...(require("./rngh.js") as typeof import("./rngh.js")).GestureObjects };
  delete supported.ForceTouch;
  builders = supported as Builders;
  return builders;
}

/** `Gesture.Tap()`, `Pan()`, `Pinch()`, `Rotation()`, `Fling()`, `LongPress()`, `Native()`, `Manual()`, `Hover()` and the compositions `Race`, `Simultaneous`, `Exclusive`: RNGH's builders, unchanged. */
export const Gesture: Builders = lazyObject(readBuilders);

/** `GestureStateManager.create(handlerTag)` for a worklet; touch callbacks are handed a manager already. It works on the UI thread only. */
export const GestureStateManager: typeof import("./animated.ts").GestureStateManager = lazyObject(() => {
  loadReanimated();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("./animated.ts") as typeof import("./animated.ts")).GestureStateManager;
});

export { default as GestureDetector } from "../components/GestureDetector.svelte";
export { gesture } from "./action.ts";
export { State, Directions, PointerType, TouchEventType, ActionType } from "./constants.js";
export { runOnJS, scheduleOnRN } from "../animation.ts";
export type * from "./types.ts";
export type { ComposedGesture, GestureType, GestureRef } from "./rngh.js";
