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
  return (loaded ??= (require("react-native/Libraries/Components/Keyboard/Keyboard") as { default: KeyboardModule }).default);
}

whenBooted(keyboard);
