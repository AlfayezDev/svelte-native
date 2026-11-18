/**
 * The UI-thread route: what `GestureDetector/useAnimatedGesture.ts` does for react-native-gesture-handler, without the hook.
 * Native sends a gesture attached with action type 1 to Reanimated as `onGestureHandlerStateChange`/`onGestureHandlerEvent`
 * events keyed by the view's tag; Reanimated runs one worklet per detector on the UI runtime, which finds the gesture by
 * `handlerTag` in a shared value of the attached gestures' callbacks and runs the one the event calls for. `useEvent` is
 * `new WorkletEventHandler(...)` plus a ref, so the registration here is the same code.
 *
 * The constants below are copies (`State`, `TouchEventType`, `CALLBACK_TYPE`): a worklet captures its closure by value, and
 * a re-exported module object is a poor thing to serialise; `copiedConstants` below lists them by RNGH's names, and the last test of
 * `tests/gestures/config.test.ts` compares that list with RNGH's own modules, bundled apart from this file.
 * Loaded after Reanimated (the host loads both on the first gesture), so the imports below are Reanimated's own functions.
 */
import { makeMutable, setGestureState, type SharedValue } from "#vendor/react-native-reanimated";
import { WorkletEventHandler } from "../fabric/reanimated-internals.js";
import { gestureName } from "./guards.ts";
import type { GestureType } from "./rngh.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- the payloads and callbacks cross the thread boundary untyped, as in RNGH */
// biome-ignore-start lint: ported from RNGH's useAnimatedGesture, kept as close to the original as possible
type Event = Record<string, any>;
type Callbacks = Record<string, any>;
const EVENT_NAMES = ["onGestureHandlerStateChange", "onGestureHandlerEvent"];

const STATE_UNDETERMINED = 0;
const STATE_FAILED = 1;
const STATE_BEGAN = 2;
const STATE_CANCELLED = 3;
const STATE_ACTIVE = 4;
const STATE_END = 5;
const TOUCH_UNDETERMINED = 0;
const TOUCH_DOWN = 1;
const TOUCH_MOVE = 2;
const TOUCH_UP = 3;
const TOUCH_CANCELLED = 4;
const CALLBACK_UNDEFINED = 0;
const CALLBACK_BEGAN = 1;
const CALLBACK_START = 2;
const CALLBACK_UPDATE = 3;
const CALLBACK_CHANGE = 4;
const CALLBACK_END = 5;
const CALLBACK_FINALIZE = 6;
const CALLBACK_TOUCHES_DOWN = 7;
const CALLBACK_TOUCHES_MOVE = 8;
const CALLBACK_TOUCHES_UP = 9;
const CALLBACK_TOUCHES_CANCELLED = 10;

/** The numbers above by the names RNGH's `State`, `TouchEventType` and `CALLBACK_TYPE` give them: what the test that pins them reads. */
export const copiedConstants = {
  State: { UNDETERMINED: STATE_UNDETERMINED, FAILED: STATE_FAILED, BEGAN: STATE_BEGAN, CANCELLED: STATE_CANCELLED, ACTIVE: STATE_ACTIVE, END: STATE_END },
  TouchEventType: { UNDETERMINED: TOUCH_UNDETERMINED, TOUCHES_DOWN: TOUCH_DOWN, TOUCHES_MOVE: TOUCH_MOVE, TOUCHES_UP: TOUCH_UP, TOUCHES_CANCELLED: TOUCH_CANCELLED },
  CALLBACK_TYPE: {
    UNDEFINED: CALLBACK_UNDEFINED, BEGAN: CALLBACK_BEGAN, START: CALLBACK_START, UPDATE: CALLBACK_UPDATE, CHANGE: CALLBACK_CHANGE, END: CALLBACK_END,
    FINALIZE: CALLBACK_FINALIZE, TOUCHES_DOWN: CALLBACK_TOUCHES_DOWN, TOUCHES_MOVE: CALLBACK_TOUCHES_MOVE, TOUCHES_UP: CALLBACK_TOUCHES_UP, TOUCHES_CANCELLED: CALLBACK_TOUCHES_CANCELLED,
  },
};

function getHandler(type: number, gesture: Callbacks) {
  "worklet";
  switch (type) {
    case CALLBACK_BEGAN: return gesture.onBegin;
    case CALLBACK_START: return gesture.onStart;
    case CALLBACK_UPDATE: return gesture.onUpdate;
    case CALLBACK_CHANGE: return gesture.onChange;
    case CALLBACK_END: return gesture.onEnd;
    case CALLBACK_FINALIZE: return gesture.onFinalize;
    case CALLBACK_TOUCHES_DOWN: return gesture.onTouchesDown;
    case CALLBACK_TOUCHES_MOVE: return gesture.onTouchesMove;
    case CALLBACK_TOUCHES_UP: return gesture.onTouchesUp;
    case CALLBACK_TOUCHES_CANCELLED: return gesture.onTouchesCancelled;
  }
}

function touchEventTypeToCallbackType(eventType: number): number {
  "worklet";
  switch (eventType) {
    case TOUCH_DOWN: return CALLBACK_TOUCHES_DOWN;
    case TOUCH_MOVE: return CALLBACK_TOUCHES_MOVE;
    case TOUCH_UP: return CALLBACK_TOUCHES_UP;
    case TOUCH_CANCELLED: return CALLBACK_TOUCHES_CANCELLED;
  }
  return CALLBACK_UNDEFINED;
}

function runWorklet(type: number, gesture: Callbacks, event: Event, ...args: unknown[]) {
  "worklet";
  const handler = getHandler(type, gesture);
  if (gesture.isWorklet[type]) {
    handler?.(event, ...args);
  } else if (handler) {
    console.warn("[svelte-native gestures] Animated gesture callback must be a worklet");
  }
}

function isStateChangeEvent(event: Event): boolean {
  "worklet";
  return event.oldState != null;
}

function isTouchEvent(event: Event): boolean {
  "worklet";
  return event.eventType != null;
}

/** `GestureStateManager.create`: the handle a touch callback uses to begin, activate, fail or end the gesture from the UI thread. */
function createStateManager(handlerTag: number) {
  "worklet";
  return {
    handlerTag,
    begin: () => { "worklet"; setGestureState(handlerTag, STATE_BEGAN); },
    activate: () => { "worklet"; setGestureState(handlerTag, STATE_ACTIVE); },
    fail: () => { "worklet"; setGestureState(handlerTag, STATE_FAILED); },
    end: () => { "worklet"; setGestureState(handlerTag, STATE_END); },
  };
}

/** What `GestureStateManager` is in RNGH: `create(handlerTag)` inside a worklet, for code that is not handed the manager. */
export const GestureStateManager = { create: createStateManager };

/** The worklet Reanimated runs for every gesture event of one view: `useAnimatedGesture`'s `callback`. */
function createCallback(sharedHandlersCallbacks: SharedValue<Callbacks[] | null>, lastUpdateEvent: SharedValue<(Event | undefined)[]>) {
  // Not every gesture needs a state manager: made on the first touch event of each.
  const stateControllers: ReturnType<typeof createStateManager>[] = [];
  return (event: Event) => {
    "worklet";
    const currentCallback = sharedHandlersCallbacks.value;
    if (!currentCallback) return;
    for (let i = 0; i < currentCallback.length; i++) {
      const gesture = currentCallback[i] as Callbacks;
      if (event.handlerTag !== gesture.handlerTag) continue;
      if (isStateChangeEvent(event)) {
        if (event.oldState === STATE_UNDETERMINED && event.state === STATE_BEGAN) {
          runWorklet(CALLBACK_BEGAN, gesture, event);
        } else if ((event.oldState === STATE_BEGAN || event.oldState === STATE_UNDETERMINED) && event.state === STATE_ACTIVE) {
          runWorklet(CALLBACK_START, gesture, event);
          lastUpdateEvent.value[gesture.handlerTag] = undefined;
        } else if (event.oldState !== event.state && event.state === STATE_END) {
          if (event.oldState === STATE_ACTIVE) runWorklet(CALLBACK_END, gesture, event, true);
          runWorklet(CALLBACK_FINALIZE, gesture, event, true);
        } else if ((event.state === STATE_FAILED || event.state === STATE_CANCELLED) && event.state !== event.oldState) {
          if (event.oldState === STATE_ACTIVE) runWorklet(CALLBACK_END, gesture, event, false);
          runWorklet(CALLBACK_FINALIZE, gesture, event, false);
        }
      } else if (isTouchEvent(event)) {
        if (!stateControllers[i] || stateControllers[i]?.handlerTag !== event.handlerTag) stateControllers[i] = createStateManager(event.handlerTag);
        if (event.eventType !== TOUCH_UNDETERMINED) runWorklet(touchEventTypeToCallbackType(event.eventType), gesture, event, stateControllers[i]);
      } else {
        runWorklet(CALLBACK_UPDATE, gesture, event);
        if (gesture.onChange && gesture.changeEventCalculator) {
          runWorklet(CALLBACK_CHANGE, gesture, gesture.changeEventCalculator?.(event, lastUpdateEvent.value[gesture.handlerTag]));
          lastUpdateEvent.value[gesture.handlerTag] = event;
        }
      }
    }
  };
}
// biome-ignore-end lint: ported from RNGH's useAnimatedGesture
/* eslint-enable @typescript-eslint/no-explicit-any */

/** What one detector owns on the UI thread: the event registration and the shared values its worklet reads. */
export type UiPath = {
  /** The view tag the events are keyed by. */
  tag: number;
  handler: WorkletEventHandler<Event>;
  sharedHandlers: SharedValue<Callbacks[] | null>;
  lastUpdateEvent: SharedValue<(Event | undefined)[]>;
};

/** `useSharedValue` twice and `useEvent` (a `WorkletEventHandler`) for the node's tag; the handlers are shared with `shareHandlers`. */
export function createUiPath(tag: number): UiPath {
  const sharedHandlers = makeMutable<Callbacks[] | null>(null);
  const lastUpdateEvent = makeMutable<(Event | undefined)[]>([]);
  const handler = new WorkletEventHandler<Event>(createCallback(sharedHandlers, lastUpdateEvent), EVENT_NAMES);
  handler.registerForEvents(tag);
  return { tag, handler, sharedHandlers, lastUpdateEvent };
}

/** The gestures were attached again (a different shape or thread): a new worklet over the same shared values, as `useEvent(..., rebuild)` does. */
export function rebuildUiPath(path: UiPath): void {
  path.handler.updateEventHandler(createCallback(path.sharedHandlers, path.lastUpdateEvent), EVENT_NAMES);
}

export function disposeUiPath(path: UiPath): void {
  path.handler.unregisterFromEvents(path.tag);
  path.sharedHandlers.value = null;
}

/**
 * Hands the callbacks of the gestures that run on the UI thread to the worklet (`animatedHandlers.value = ...`). Reanimated
 * serialises them on assignment; when it cannot, the error says which callback it was, found by sending them one at a time.
 */
export function shareHandlers(path: UiPath, attached: readonly GestureType[]): void {
  try {
    path.sharedHandlers.value = attached.filter((gesture) => gesture.shouldUseReanimated).map((gesture) => gesture.handlers as unknown as Callbacks);
  } catch (error) {
    const probe = makeMutable<unknown>(null);
    for (const gesture of attached) {
      for (const [name, callback] of Object.entries(gesture.handlers)) {
        if (typeof callback !== "function") continue;
        try { probe.value = { callback }; } catch {
          throw new Error(`[svelte-native gestures] Reanimated could not send the ${name} callback of ${gestureName(gesture)} to the UI thread: ${error instanceof Error ? error.message : String(error)}. A callback runs there only if everything it captures is a SharedValue, a number, a string, a plain object, another worklet or a function (called through runOnJS); otherwise run the gesture on the JS thread with .runOnJS(true).`, { cause: error });
        }
      }
    }
    throw error;
  }
}
