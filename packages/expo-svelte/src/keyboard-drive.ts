/**
 * The engine's keyboard followers, from JavaScript: a component registers its view by tag once (`keyboardDrive`, `native/svelte-core` `KeyboardDrive`), and the engine
 * moves it with each frame of the keyboard's animation on the main thread, with no JavaScript in between. Only the Android engine has them; anywhere else (iOS, the lab's
 * React Native mounting, a test without the module) `keyboardDriven()` is false and the components fall back to the insets store, which moves them once.
 */
// The namespace, not the name: a bundle whose `expo-modules-core` has no such export (a test of something else that reaches this file through `platform.ts`) builds, and finds no engine.
import * as core from "expo-modules-core";

type EndVisible = { tag: number; visible: boolean };
type Emitter = { addListener(name: string, listener: (event: EndVisible) => void): { remove(): void } };
type Engine = Partial<Emitter> & { keyboardDrive?: (tag: number, name: string, args: unknown[]) => boolean; keyboardMotionNext?: () => void };

let engine: Engine | null | undefined;
let driven: boolean | undefined;

const module = (): Engine | null => (engine ??= core.requireOptionalNativeModule?.<Engine>("SvelteEngine") ?? null);

/** Sends the engine a keyboard command for the view of `tag`; false when the engine is not installed (see the file's comment). Lengths are dp. */
export function driveKeyboard(tag: number, name: "follow" | "avoid" | "lift" | "aware" | "release" | "focus", args: unknown[] = []): boolean {
  return module()?.keyboardDrive?.(tag, name, args) ?? false;
}

/**
 * Says that the next subscription to Reanimated's keyboard events is the engine's own: it is given the frames as the engine has them (kind and px) and not what Reanimated's
 * `useAnimatedKeyboard` is given (state and dp). Synchronous, so the subscription that follows on this thread finds it.
 */
export function keyboardMotionNext(): void {
  module()?.keyboardMotionNext?.();
}

/** Whether the engine moves views with the keyboard. The first answer is kept: a command for a tag that is not any view's does nothing, and says whether the engine is installed. */
export function keyboardDriven(): boolean {
  return (driven ??= driveKeyboard(-1, "release"));
}

/** Calls `listener` when the scroll view of `tag` (registered with a `lift` command) has its end in view, and when it does not any more; once at first, when it has been laid out. Returns the unsubscribe function. */
export function onEndVisible(tag: number, listener: (visible: boolean) => void): () => void {
  const subscription = module()?.addListener?.("endVisible", (event) => { if (event.tag === tag) listener(event.visible); });
  return () => subscription?.remove();
}

/** Test hook: forget what was found, so the next call looks for the module again. */
export function resetKeyboardDrive(): void {
  engine = undefined;
  driven = undefined;
}
