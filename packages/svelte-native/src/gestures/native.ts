/**
 * The native side of the gesture host: react-native-gesture-handler's TurboModule, the one-time engine hook, and the
 * deferral RNGH's detector uses (`ghQueueMicrotask`, a `setImmediate`) so that every handler of a commit has its tag before
 * any relation is sent (the batch that does it lives in `fabric/gestures.ts`). Nothing here loads until the first node with a `gesture` attribute.
 */
import { requireOptionalNativeModule } from "../fabric/deps-expo.ts";
import { turboModuleRegistry } from "../fabric/deps-rn.ts";

/** The calls the detector makes (`NativeRNGestureHandlerModule`); the rest of the module is for RNGH's components. */
export type GestureHandlerModule = {
  createGestureHandler(handlerName: string, handlerTag: number, config: object): void;
  attachGestureHandler(handlerTag: number, viewTag: number, actionType: number): void;
  updateGestureHandler(handlerTag: number, config: object): void;
  dropGestureHandler(handlerTag: number): void;
  flushOperations(): void;
  /** React Native's JS responder that blocks the native ones (iOS: the root recognisers wait; Android: a no-op for an engine root, see SPEC.md "Gestures"). */
  handleSetJSResponder(viewTag: number, blockNativeResponder: boolean): void;
  handleClearJSResponder(): void;
};

let module_: GestureHandlerModule | null = null;
/** RNGH's TurboModule, resolved on first use; on iOS and Android alike `flushOperations` is what runs the queued calls. */
export function nativeModule(): GestureHandlerModule {
  module_ ??= turboModuleRegistry().getEnforcing<GestureHandlerModule>("RNGestureHandlerModule");
  return module_;
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
  if (engine?.enableGestures?.() === false) throw new Error("[svelte-native gestures] SvelteEngine.enableGestures() answered false: react-native-gesture-handler is not part of this build (is the package autolinked?) or the engine is not installed.");
  enabled = true;
}

/** RNGH's `ghQueueMicrotask`: a `setImmediate` (the host polyfills it), else a microtask. */
export const defer: (task: () => void) => void = typeof setImmediate === "function" ? setImmediate.bind(null) : queueMicrotask.bind(null);
