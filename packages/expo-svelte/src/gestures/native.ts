/**
 * The native side of the gesture host: react-native-gesture-handler's TurboModule, the one-time engine hook, and the
 * deferral RNGH's detector uses (`ghQueueMicrotask`, a `setImmediate`) so that every handler of a commit has its tag before
 * any relation is sent (the batch that does it lives in `fabric/gestures.ts`). Nothing here loads until the first node with a `gesture` attribute.
 */
import { requireOptionalNativeModule } from "../fabric/deps-expo.ts";
import { turboModuleRegistry } from "../fabric/deps-rn.ts";

/**
 * The calls the detector makes (`NativeRNGestureHandlerModule` of RNGH 3: the config and the relations of a handler are two calls,
 * `setGestureHandlerConfig` and `configureRelations`; RNGH 2's `updateGestureHandler` and its two JS-responder calls are gone);
 * the rest of the module is for RNGH's components.
 */
export type GestureHandlerModule = {
  createGestureHandler(handlerName: string, handlerTag: number, config: object): void;
  attachGestureHandler(handlerTag: number, viewTag: number, actionType: number): void;
  setGestureHandlerConfig(handlerTag: number, config: object): void;
  configureRelations(handlerTag: number, relations: object): void;
  dropGestureHandler(handlerTag: number): void;
  flushOperations(): void;
  /** Gives the UI runtime `_setGestureStateSync` (what `GestureStateManager` calls there); false when the runtime was not found. */
  installUIRuntimeBindings(): boolean;
};

let module_: GestureHandlerModule | null = null;
/** RNGH's TurboModule, resolved on first use; on iOS and Android alike `flushOperations` is what runs the queued calls. */
export function nativeModule(): GestureHandlerModule {
  module_ ??= turboModuleRegistry().getEnforcing<GestureHandlerModule>("RNGestureHandlerModule");
  return module_;
}

let uiInstalled = false;
/**
 * RNGH 3 installs its own `_setGestureStateSync` on the UI runtime (the state manager of a worklet callback calls it; Reanimated's
 * `setGestureState` no longer reaches RNGH's module), from the module's native side, which needs the UI runtime of `react-native-worklets`
 * handed to it in a global for the length of the call: `reanimatedWrapper.ts` of RNGH does the same when it loads, and defers it by a microtask.
 * Called when the first gesture runs on the UI thread (the host has loaded Worklets by then); `holder` is Worklets' `getUIRuntimeHolder`.
 */
export function installUiRuntimeBindings(holder: () => object): void {
  if (uiInstalled) return;
  const scope = globalThis as { __RNGH_UI_WORKLET_RUNTIME_HOLDER?: object };
  scope.__RNGH_UI_WORKLET_RUNTIME_HOLDER = holder();
  uiInstalled = true;
  try {
    if (!nativeModule().installUIRuntimeBindings()) {
      console.warn("[expo-svelte gestures] Failed to install the UI runtime bindings of react-native-gesture-handler: GestureStateManager will not work in worklet callbacks.");
    }
  } finally {
    scope.__RNGH_UI_WORKLET_RUNTIME_HOLDER = undefined;
  }
}

let enabled = false;
/**
 * Android: `SvelteEngine.enableGestures()` installs RNGH's root helper on the engine's root view (and gives every engine view the id and
 * context RNGH reads); it runs once, before the first `attachGestureHandler`. Without the engine module (iOS, where RNGH adds its own
 * root recogniser to the surface at the first attach) there is nothing to do. The engine answers `false` when RNGH is not in the build or
 * the engine itself is not installed, and throws when its main thread does not answer.
 */
export function enableNative(): void {
  if (enabled) return;
  const engine = requireOptionalNativeModule<{ enableGestures?: () => boolean }>("SvelteEngine");
  if (engine?.enableGestures?.() === false) throw new Error("[expo-svelte gestures] SvelteEngine.enableGestures() answered false: react-native-gesture-handler is not part of this build (is the package autolinked?) or the engine is not installed.");
  enabled = true;
}

/** RNGH's `ghQueueMicrotask`: a `setImmediate` (the host polyfills it), else a microtask. */
export const defer: (task: () => void) => void = typeof setImmediate === "function" ? setImmediate.bind(null) : queueMicrotask.bind(null);
