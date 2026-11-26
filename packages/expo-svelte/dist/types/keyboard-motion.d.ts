import { type SharedValue } from "./animation.js";
import type { KeyboardState } from "./insets.svelte.js";
export type { KeyboardState } from "./insets.svelte.js";
/** The keyboard's motion as shared values (see `createKeyboardMotion`). */
export type KeyboardMotion = {
    /** How much of the screen the keyboard covers now, in dp: 0 closed, its full height open, and what it is at each frame between. */
    height: SharedValue<number>;
    /** `height` over the height the keyboard opens to: 0 closed, 1 open. */
    progress: SharedValue<number>;
    /** `"opening"` and `"closing"` from the start of a move to its end. */
    state: SharedValue<KeyboardState>;
};
/**
 * The keyboard's height and progress as shared values that move with every frame of its animation, written on the UI thread by the engine (Android; the
 * Reanimated patch `0004` makes the engine Reanimated's keyboard source), so a worklet of `animatedStyle` or `animatedProps` reads them as the keyboard
 * moves, whatever the JavaScript thread is doing. Call it while a component initialises, as `createSharedValue`; the subscription ends with the component.
 * Without the engine's frames (iOS) the values go to the keyboard's height when its animation starts, with a 250 ms timing.
 */
export declare function createKeyboardMotion(): KeyboardMotion;
