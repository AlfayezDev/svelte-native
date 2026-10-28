import { getEnforcing } from "react-native/Libraries/TurboModule/TurboModuleRegistry";

/**
 * What the `gestures-*` probes (`probe.ts`) need of the lab page `/__dev/gesture-probe`: the tags of the views it draws, and react-native-gesture-handler's
 * native module called the way the library's JavaScript calls it (`createGestureHandler`, `attachGestureHandler`, `flushOperations`), so that iOS can be
 * checked on its own, without the Svelte detector.
 */

type HandlerModule = {
  createGestureHandler(handlerName: string, handlerTag: number, config: Record<string, unknown>): void;
  attachGestureHandler(handlerTag: number, viewTag: number, actionType: number): void;
  updateGestureHandler(handlerTag: number, config: Record<string, unknown>): void;
  dropGestureHandler(handlerTag: number): void;
  flushOperations(): void;
};

/** The view tags the page reported, by name. */
export const gestureProbe: { tags: Record<string, number>; events: string[] } = { tags: {}, events: [] };

let module: HandlerModule | null = null;
let nextHandlerTag = 90_000;

/** The JavaScript function action type of the library's new API: the events go to `onGestureHandlerEvent`, which nothing here listens to. */
const JS_FUNCTION_NEW_API = 4;

/** Creates a handler of `handlerName` and attaches it to the view with `viewTag`; returns the handler's tag. */
export function attachHandler(viewTag: number, handlerName = "PanGestureHandler", config: Record<string, unknown> = {}): number {
  module ??= getEnforcing<HandlerModule>("RNGestureHandlerModule");
  const handlerTag = (nextHandlerTag += 1);
  module.createGestureHandler(handlerName, handlerTag, config);
  module.attachGestureHandler(handlerTag, viewTag, JS_FUNCTION_NEW_API);
  module.flushOperations();
  return handlerTag;
}

export function updateHandler(handlerTag: number, config: Record<string, unknown>): void {
  module ??= getEnforcing<HandlerModule>("RNGestureHandlerModule");
  module.updateGestureHandler(handlerTag, config);
  module.flushOperations();
}

export function dropHandler(handlerTag: number): void {
  module ??= getEnforcing<HandlerModule>("RNGestureHandlerModule");
  module.dropGestureHandler(handlerTag);
  module.flushOperations();
}
