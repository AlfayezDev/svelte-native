import { whenBooted } from "./boot-marks.ts";

type KeyboardModule = { isVisible(): boolean; dismiss(): void };

let loaded: KeyboardModule | undefined;

/**
 * React Native's `Keyboard`. It knows whether the keyboard is up from listeners it registers when it is first loaded, so it has to
 * be loaded before the keyboard can come up, but not before the first frame: it imports LayoutAnimation, which imports UIManager.js,
 * whose module body reads the constants of every view manager (16 JNI calls, 21 ms of the JavaScript thread on the Galaxy A16).
 * It loads once, right after the first commit.
 */
export function keyboard(): KeyboardModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  loaded ??= (require("react-native/Libraries/Components/Keyboard/Keyboard") as { default: KeyboardModule }).default;
  return loaded;
}

whenBooted(keyboard);

type InputState = { focusInput(input: object): void; blurInput(input: object): void; blurTextInput(input: object): void; currentlyFocusedInput(): unknown };

let inputs: InputState | undefined;

/**
 * React Native's record of the focused text input (`TextInputState`), the one `Keyboard.dismiss()` blurs (and a `Modal` that opens over the
 * keyboard). React Native's `TextInput` keeps it from its focus and blur events; Expo Svelte's mounts the native view itself, so it keeps it the
 * same way, with its handle (`components/TextInput.svelte`). The command reaches the view through the handle (`fabric/renderer-stub.ts`). The
 * module is loaded at the first focus: `Keyboard` imports it as well, and is loaded right after the first commit.
 */
export function inputFocused(input: object): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  inputs ??= (require("react-native/Libraries/Components/TextInput/TextInputState") as { default: InputState }).default;
  inputs.focusInput(input);
}

/** The input lost focus: React Native's record no longer holds it (when it did). Nothing was recorded before a first focus. */
export function inputBlurred(input: object): void {
  inputs?.blurInput(input);
}

/** The input is being destroyed: when it is the focused one it is blurred, as React Native's `TextInput` does when it unmounts, so the keyboard goes with it. */
export function inputGone(input: object): void {
  if (inputs?.currentlyFocusedInput() === input) inputs.blurTextInput(input);
}
