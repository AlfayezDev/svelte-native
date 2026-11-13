import { createSubscriber } from "svelte/reactivity";
import type * as ReactNative from "react-native";

/**
 * `svelte/motion` on the device (Metro resolves the import here, `withSvelteNative`; this file's own import of it is Svelte's). `Spring`, `Tween`, `spring` and `tweened` are
 * Svelte's own: they run on `requestAnimationFrame` and `performance.now`, which React Native has. `prefersReducedMotion` is not: Svelte builds it from `matchMedia`, which
 * React Native lacks (the module would throw when it is imported), so it is replaced with one that reads the system's reduce motion setting.
 */

// Svelte's module builds `prefersReducedMotion` as the module loads, from `window.matchMedia`. React Native has none, so one that matches nothing is there for that one call and gone after it;
// the object it made is not exported (the one below is). It is a call and not an import because an import cannot be put between two others, and the stand-in must not outlive this line.
const host = (globalThis as { window?: { matchMedia?: unknown } }).window ?? (globalThis as { matchMedia?: unknown });
const stand = host.matchMedia === undefined;
if (stand) host.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
let svelte: typeof import("svelte/motion");
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required here, between the stand-in's two lines
  svelte = require("svelte/motion") as typeof import("svelte/motion");
} finally {
  if (stand) delete host.matchMedia;
}

export const { Spring, Tween, spring, tweened } = svelte;

/** React Native's accessibility info, loaded on first use. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
const accessibility = () => (require("react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo") as { default: typeof ReactNative.AccessibilityInfo }).default;

// The setting is asked for once as the module loads, so the first read in a screen has an answer; a reader asks again when it subscribes, and the system's change event keeps it current.
let reduced = false;
const ask = (done?: () => void) => {
  accessibility().isReduceMotionEnabled().then((value) => {
    reduced = value;
    done?.();
  }, () => {});
};
ask();

const subscribe = createSubscriber((update) => {
  ask(update);
  const subscription = accessibility().addEventListener("reduceMotionChanged", (value) => {
    reduced = value;
    update();
  });
  return () => subscription.remove();
});

/**
 * Whether the user has asked the system to reduce motion (iOS: Reduce Motion; Android: animations turned off), reactive like Svelte's `prefersReducedMotion`: a template, `$derived`
 * or `$effect` that reads `current` runs again when the setting changes. It is `false` until the system has answered, which is a moment after the app starts.
 */
export const prefersReducedMotion = {
  get current(): boolean {
    subscribe();
    return reduced;
  },
} as unknown as typeof svelte.prefersReducedMotion;
