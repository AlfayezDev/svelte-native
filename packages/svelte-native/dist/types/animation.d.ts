/// <reference path="./vendor-types-ui.d.ts" />
import type * as Reanimated from "#vendor/react-native-reanimated";
import type * as Worklets from "#vendor/react-native-worklets";
export { default as AnimatedView } from "./components/AnimatedView.svelte";
export type { SharedValue } from "#vendor/react-native-reanimated";
export declare let withTiming: typeof Reanimated.withTiming;
export declare let withSpring: typeof Reanimated.withSpring;
export declare let withRepeat: typeof Reanimated.withRepeat;
export declare let withSequence: typeof Reanimated.withSequence;
export declare let withDelay: typeof Reanimated.withDelay;
export declare let cancelAnimation: typeof Reanimated.cancelAnimation;
export declare let runOnUISync: typeof Worklets.runOnUISync;
export declare let runOnUIAsync: typeof Worklets.runOnUIAsync;
/** Worklets' own: `runOnJS(fn)(...args)` from a UI-thread callback, and the same call from either thread. Gesture callbacks use them to reach Svelte state. */
export declare let runOnJS: typeof Worklets.runOnJS;
export declare let scheduleOnRN: typeof Worklets.scheduleOnRN;
/** Property reads resolve on first use (`Easing.inOut(Easing.ease)`, `ReduceMotion.System`); after the load these are Reanimated's objects. */
export declare let Easing: typeof Reanimated.Easing;
export declare let ReduceMotion: typeof Reanimated.ReduceMotion;
export declare function createSharedValue<Value>(initial: Value): Reanimated.SharedValue<Value>;
