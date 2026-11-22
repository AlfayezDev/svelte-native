/**
 * The development checks of the gesture host, run before a gesture's handlers are created or updated. None is on in a release
 * build (`__DEV__` false), where a gesture that passed them in development behaves the same.
 */
import { closureEntries } from "./closure.ts";
import { CallbackType, type GestureType } from "./rngh.js";

const dev = () => typeof __DEV__ !== "undefined" && __DEV__;

// In environments where the worklets Babel plugin does not run, "none of the callbacks are worklets" would be wrong advice for
// every gesture. The plugin is on when a function marked as a worklet in this file carries a hash (RNGH does the same).
function emptyWorklet() {
  "worklet";
}
const wasBabelPluginEnabled = (emptyWorklet as unknown as { __workletHash?: number }).__workletHash !== undefined;

/** `Gesture.Pan()`, as the app wrote it, for messages. */
export const gestureName = (gesture: GestureType): string => `Gesture.${gesture.handlerName.replace(/GestureHandler$/, "").replace(/^NativeView$/, "Native")}()`;

/**
 * RNGH's `checkGestureCallbacksForWorklets`: a gesture runs on the UI thread only when every callback is a worklet and
 * `.runOnJS(true)` is not set; some of each is an error, and none at all is worth a word because the callbacks were probably meant
 * to be worklets (the babel plugin only workletizes inline callbacks of a `Gesture.X().onY(...)` chain).
 */
export function checkGestureCallbacksForWorklets(gesture: GestureType): void {
  if (!dev() || gesture.config.runOnJS) return;
  const flags = gesture.handlers.isWorklet;
  const someNotWorklets = flags.includes(false);
  const someWorklets = flags.includes(true);
  if (someNotWorklets && someWorklets) {
    console.error(`[expo-svelte gestures] Some of the callbacks in ${gestureName(gesture)} are worklets and some are not. Either make sure that all callbacks are marked as 'worklet' if you wish to run them on the UI thread, or use '.runOnJS(true)' on the gesture explicitly to run all callbacks on the JS thread.`);
  }
  if (!someWorklets && someNotWorklets && wasBabelPluginEnabled) {
    console.warn(`[expo-svelte gestures] None of the callbacks in ${gestureName(gesture)} are worklets. If you wish to run them on the JS thread use '.runOnJS(true)' on the gesture to make this explicit. Otherwise, mark the callbacks as 'worklet' to run them on the UI thread (only inline callbacks of a Gesture.X().onY(...) chain, with Gesture imported under that name, are marked automatically).`);
  }
}

const CALLBACKS = [
  ["onBegin", CallbackType.BEGAN], ["onStart", CallbackType.START], ["onUpdate", CallbackType.UPDATE], ["onChange", CallbackType.CHANGE],
  ["onEnd", CallbackType.END], ["onFinalize", CallbackType.FINALIZE],
  ["onTouchesDown", CallbackType.TOUCHES_DOWN], ["onTouchesMove", CallbackType.TOUCHES_MOVE], ["onTouchesUp", CallbackType.TOUCHES_UP], ["onTouchesCancelled", CallbackType.TOUCHES_CANCEL],
] as const;

/** A Svelte signal (`$state`, `$derived`): the compiled closure holds the signal object, whose fields these are. */
const isSignal = (value: unknown): boolean => typeof value === "object" && value !== null && ["f", "v", "reactions", "wv"].every((field) => field in value);

/**
 * A worklet captures what it uses by value and runs on another runtime. Svelte compiles a read of `$state`, `$derived` or a prop
 * into `$.get(signal)` and `$$props.name`, so the closure of such a callback holds the Svelte namespace and the signal, neither
 * of which the UI runtime can read. This finds them in `__closure` (the worklets plugin writes it, in development and release alike)
 * and throws with the callback, the variable and the way out, instead of leaving a stale copy or a serialisation error.
 */
export function checkUiClosures(gesture: GestureType): void {
  if (!dev() || !gesture.shouldUseReanimated) return;
  const handlers = gesture.handlers as unknown as Record<string, unknown> & { isWorklet: boolean[] };
  for (const [name, type] of CALLBACKS) {
    const callback = handlers[name];
    const entries = typeof callback === "function" && handlers.isWorklet[type] ? closureEntries(callback as { __closure?: unknown; __initData?: { code?: string } }) : [];
    if (!entries.length) continue;
    const signals = entries.filter(([, value]) => isSignal(value)).map(([key]) => key);
    const has = (key: string) => entries.some(([entry]) => entry === key);
    const reads = [
      ...signals.map((key) => `the state "${key}"`),
      ...(has("$$props") ? ["the component's props ($props)"] : []),
      ...(!signals.length && !has("$$props") && has("$") ? ["Svelte's compiled runtime ($)"] : []),
    ];
    if (!reads.length) continue;
    throw new Error(`[expo-svelte gestures] The ${name} callback of ${gestureName(gesture)} runs on the UI thread but reads ${reads.join(" and ")}. Svelte compiles that read into a call on its own signal, which the UI runtime cannot use. Copy the value into a SharedValue (createSharedValue) and read that, or run the gesture on the JS thread with .runOnJS(true), where callbacks read live state.`);
  }
}
