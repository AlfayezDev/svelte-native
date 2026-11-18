/**
 * One place that loads Reanimated and worklets (≈ 90 ms of boot on a mid-range phone: bundle evaluation plus a second
 * Hermes runtime). The Fabric host loads them on the first animated node, the public `animation` module on its first
 * call; whoever comes first notifies the other.
 */
import type * as Reanimated from "#vendor/react-native-reanimated";
import type * as Worklets from "#vendor/react-native-worklets";

export type ReanimatedModules = { reanimated: typeof Reanimated; worklets: typeof Worklets };

let modules: ReanimatedModules | null = null;
const listeners: ((modules: ReanimatedModules) => void)[] = [];

export function loadReanimated(): ReanimatedModules {
  if (modules) return modules;
  /* eslint-disable @typescript-eslint/no-require-imports */
  modules = { reanimated: require("#vendor/react-native-reanimated") as typeof Reanimated, worklets: require("#vendor/react-native-worklets") as typeof Worklets };
  /* eslint-enable @typescript-eslint/no-require-imports */
  for (const listener of listeners.splice(0)) listener(modules);
  return modules;
}

/** Runs now when Reanimated is already loaded, else right after it loads. */
export function onReanimatedLoaded(listener: (modules: ReanimatedModules) => void): void {
  if (modules) listener(modules);
  else listeners.push(listener);
}
