// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- a script of `declare module`s (the vendored packages' names, VENDORING.md): it cannot be imported, only referenced
/// <reference path="./vendor-types-ui.d.ts" />
import { onDestroy } from "svelte";
import type * as Reanimated from "#vendor/react-native-reanimated";
import type * as Worklets from "#vendor/react-native-worklets";
import { lazyObject } from "./lazy-object.ts";
import { loadReanimated, onReanimatedLoaded } from "./fabric/reanimated-load.ts";

// The main entry (`@alfayez/svelte-native`) re-exports everything here.
export { default as AnimatedView } from "./components/AnimatedView.svelte";
export type { SharedValue } from "#vendor/react-native-reanimated";

/**
 * Reanimated and worklets load on the first call into this module (or on the first animated node the Fabric host
 * mounts), not when a screen that imports it is evaluated. Until then each export is a stub that triggers the load;
 * from then on the exports are Reanimated's own functions, re-assigned through these live bindings, so a worklet that
 * captures `withTiming` or `ReduceMotion` after any animation API ran carries the real, UI-runtime-capable value.
 * A worklet created before any call would capture a stub, which the UI runtime rejects as a remote function: create
 * shared values (or call `runOnUISync`) before defining such worklets, as the lab does.
 */
const rea = (): typeof Reanimated => loadReanimated().reanimated;
const wk = (): typeof Worklets => loadReanimated().worklets;

export let withTiming = ((...args: Parameters<typeof Reanimated.withTiming>) => rea().withTiming(...args)) as typeof Reanimated.withTiming;
export let withSpring = ((...args: Parameters<typeof Reanimated.withSpring>) => rea().withSpring(...args)) as typeof Reanimated.withSpring;
export let withRepeat = ((...args: Parameters<typeof Reanimated.withRepeat>) => rea().withRepeat(...args)) as typeof Reanimated.withRepeat;
export let withSequence = ((...args: Parameters<typeof Reanimated.withSequence>) => rea().withSequence(...args)) as typeof Reanimated.withSequence;
export let withDelay = ((...args: Parameters<typeof Reanimated.withDelay>) => rea().withDelay(...args)) as typeof Reanimated.withDelay;
export let cancelAnimation = ((...args: Parameters<typeof Reanimated.cancelAnimation>) => rea().cancelAnimation(...args)) as typeof Reanimated.cancelAnimation;
export let runOnUISync = ((...args: Parameters<typeof Worklets.runOnUISync>) => wk().runOnUISync(...args)) as typeof Worklets.runOnUISync;
export let runOnUIAsync = ((...args: Parameters<typeof Worklets.runOnUIAsync>) => wk().runOnUIAsync(...args)) as typeof Worklets.runOnUIAsync;
/** Worklets' own: `runOnJS(fn)(...args)` from a UI-thread callback, and the same call from either thread. Gesture callbacks use them to reach Svelte state. */
export let runOnJS = ((...args: Parameters<typeof Worklets.runOnJS>) => wk().runOnJS(...args)) as typeof Worklets.runOnJS;
export let scheduleOnRN = ((...args: Parameters<typeof Worklets.scheduleOnRN>) => wk().scheduleOnRN(...args)) as typeof Worklets.scheduleOnRN;

/** Property reads resolve on first use (`Easing.inOut(Easing.ease)`, `ReduceMotion.System`); after the load these are Reanimated's objects. */
export let Easing: typeof Reanimated.Easing = lazyObject(() => rea().Easing);
export let ReduceMotion: typeof Reanimated.ReduceMotion = lazyObject(() => rea().ReduceMotion);

onReanimatedLoaded(({ reanimated, worklets }) => {
  withTiming = reanimated.withTiming; withSpring = reanimated.withSpring; withRepeat = reanimated.withRepeat; withSequence = reanimated.withSequence;
  withDelay = reanimated.withDelay; cancelAnimation = reanimated.cancelAnimation; Easing = reanimated.Easing; ReduceMotion = reanimated.ReduceMotion;
  runOnUISync = worklets.runOnUISync; runOnUIAsync = worklets.runOnUIAsync; runOnJS = worklets.runOnJS; scheduleOnRN = worklets.scheduleOnRN;
});

export function createSharedValue<Value>(initial: Value): Reanimated.SharedValue<Value> {
  const value = rea().makeMutable(initial);
  onDestroy(() => cancelAnimation(value));
  return value;
}
