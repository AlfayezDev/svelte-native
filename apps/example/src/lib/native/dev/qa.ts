import { requireOptionalNativeModule } from "expo-modules-core";

/** `SvelteQA` (apps/example/modules/svelte-qa-ios): present in iOS builds, and every function but `recordBoot` refuses to run outside the QA app. */
export type SvelteQA = {
  enabled: boolean;
  /** The `[Svelte boot]` phases of this launch and the `console.error` count so far; the module writes `Documents/boot-report.json` once the first frame is out. */
  recordBoot(summary: string, jsErrors: number): void;
  /** What is installed: the SHA-256 of `main.jsbundle` and of the executable, which the harness compares with its build record. */
  buildIdentity(): Promise<BuildIdentity>;
  /** The app's window as a PNG at `path`: size in pixels, the bytes and the SHA-256 of the file. */
  capture(path: string): Promise<{ width: number; height: number; scale: number; bytes: number; sha256: string }>;
  /** The accessibility elements of the window in VoiceOver's discovery order (JSON text). */
  accessibilityTree(): Promise<string>;
  /** The view controllers the stack, sheets and tabs built (navigation bars and their items, sheet detents, tab items) as JSON text. */
  uikitState(): Promise<string>;
  /** Actions of a user, performed by the app on itself: scroll the first scroll view of the screen on top to `y` points from rest, type into its search field, move its sheet to a detent, press escape on it, focus its first text input. */
  scrollTo(y: number): Promise<{ rest: number; offset: number; adjustedTop: number }>;
  typeSearch(text: string): Promise<{ active: boolean; text: string }>;
  selectDetent(index: number): Promise<Record<string, unknown>>;
  escape(): Promise<boolean>;
  focusTextInput(): Promise<{ focused: boolean; fieldFrame: number[]; keyboardFrame: number[]; overlap: number }>;
  blur(): Promise<void>;
  /** The gesture recognizers on the view with React Native tag `tag` and on every view above it (JSON text); what the `gestures-*` probes read. */
  gestureRecognizers(tag: number): Promise<string>;
  /** Forces the interface style of the app's windows (the native chrome follows it); `unspecified` gives control back to the system. */
  setInterfaceStyle(style: "light" | "dark" | "unspecified"): Promise<void>;
};

export type BuildIdentity = { jsbundleSha256: string; executableSha256: string };

export const qaModule = requireOptionalNativeModule<SvelteQA>("SvelteQA");
