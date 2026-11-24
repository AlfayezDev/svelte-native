import { onDestroy } from "svelte";
import { createSharedValue, withTiming, type SharedValue } from "./animation.ts";
import { pixelRatio } from "./fabric/deps-rn.ts";
import { subscribeInsets } from "./fabric/insets.ts";
import { keyboardDriven } from "./keyboard-drive.ts";
import type { KeyboardState } from "./insets.svelte.ts";

export type { KeyboardState } from "./insets.svelte.ts";

/** The keyboard's motion as shared values (see `createKeyboardMotion`). */
export type KeyboardMotion = {
  /** How much of the screen the keyboard covers now, in dp: 0 closed, its full height open, and what it is at each frame between. */
  height: SharedValue<number>;
  /** `height` over the height the keyboard opens to: 0 closed, 1 open. */
  progress: SharedValue<number>;
  /** `"opening"` and `"closing"` from the start of a move to its end. */
  state: SharedValue<KeyboardState>;
};

/** Reanimated's keyboard subscription, a deep import that loads Reanimated: only once the engine's frames are wanted (the shared values above have loaded it already). */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const reanimated = (): typeof import("./fabric/reanimated-internals.js") => require("./fabric/reanimated-internals.js") as typeof import("./fabric/reanimated-internals.js");

/** The kinds the engine's frames come in (`KeyboardDrive`): the keyboard is about to move to a height, it is at one on the way, it has stopped at one. */
const START = 1;
const END = 3;

/**
 * The keyboard's height and progress as shared values that move with every frame of its animation, written on the UI thread by the engine (Android; the
 * Reanimated patch `0004` makes the engine Reanimated's keyboard source), so a worklet of `animatedStyle` or `animatedProps` reads them as the keyboard
 * moves, whatever the JavaScript thread is doing. Call it while a component initialises, as `createSharedValue`; the subscription ends with the component.
 * Without the engine's frames (iOS) the values go to the keyboard's height when its animation starts, with a 250 ms timing.
 */
export function createKeyboardMotion(): KeyboardMotion {
  const height = createSharedValue(0);
  const progress = createSharedValue(0);
  const state = createSharedValue<KeyboardState>("closed");
  if (!keyboardDriven()) {
    const stop = subscribeInsets((event) => {
      height.value = withTiming(event.keyboardVisible ? event.keyboardHeight : 0, { duration: 250 });
      progress.value = withTiming(event.keyboardVisible ? 1 : 0, { duration: 250 });
      state.value = event.keyboardVisible ? "open" : "closed";
    });
    onDestroy(() => stop?.());
    return { height, progress, state };
  }
  const opened = createSharedValue(0);
  const density = pixelRatio().get();
  const listener = reanimated().subscribeForKeyboardEvents((kind: number, px: number) => {
    "worklet";
    // The engine counts in px, the integers the window reports, so no frame is rounded to a dp.
    const dp = px / density;
    if (kind === START) {
      if (dp > 0) opened.value = dp;
      state.value = dp > 0 ? "opening" : "closing";
      return;
    }
    height.value = dp;
    progress.value = kind === END ? (dp > 0 ? 1 : 0) : opened.value > 0 ? Math.abs(dp / opened.value) : 0;
    if (kind === END) state.value = dp > 0 ? "open" : "closed";
  }, { isStatusBarTranslucentAndroid: true, isNavigationBarTranslucentAndroid: true });
  onDestroy(() => reanimated().unsubscribeFromKeyboardEvents(listener));
  return { height, progress, state };
}
