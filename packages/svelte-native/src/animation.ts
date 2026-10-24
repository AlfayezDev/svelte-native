import { onDestroy } from "svelte";
import { cancelAnimation, makeMutable, type SharedValue } from "react-native-reanimated";

export { default as AnimatedView } from "./components/AnimatedView.svelte";
export { cancelAnimation, Easing, ReduceMotion, withTiming, withSpring, withRepeat, withSequence, withDelay } from "react-native-reanimated";
export type { SharedValue } from "react-native-reanimated";
export { runOnUISync, runOnUIAsync } from "react-native-worklets";

export function createSharedValue<Value>(initial: Value): SharedValue<Value> {
  const value = makeMutable(initial);
  onDestroy(() => cancelAnimation(value));
  return value;
}
