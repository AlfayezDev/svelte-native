/**
 * The JS-thread receiver: a port of react-native-gesture-handler's `eventReceiver.ts` on `RCTDeviceEventEmitter`
 * (the native side emits `onGestureHandlerEvent` and `onGestureHandlerStateChange` there for every gesture attached with
 * action type 4). The dispatch rules are RNGH's, line for line; `tests/gestures/events.test.ts` runs both on the same
 * event sequences. A gesture on the UI thread never arrives here: its events go to Reanimated (`animated.ts`).
 */
import { deviceEventEmitter } from "../fabric/deps-rn.ts";
import { findHandler, State, TouchEventType, type BaseGesture } from "./rngh.js";

/* eslint-disable @typescript-eslint/no-explicit-any -- the native payloads are untyped here as in RNGH */
type NativeEvent = { handlerTag: number; state?: number; oldState?: number; eventType?: number; [key: string]: any };
type Handler = BaseGesture<Record<string, unknown>>;
type StateManager = { begin(): void; activate(): void; fail(): void; end(): void; handlerTag: number };

const dev = () => typeof __DEV__ !== "undefined" && __DEV__;
const stateManagers = new Map<number, StateManager>();
const lastUpdateEvent = new Map<number, NativeEvent>();
let subscriptions: { remove(): void }[] = [];

/** The manager a JS-thread touch callback receives. `setGestureState` exists on the UI runtime only, so every call says so (RNGH's `setGestureState` warns the same on the JS thread). */
function jsStateManager(handlerTag: number): StateManager {
  const refuse = (call: string) => () => {
    if (dev()) console.warn(`[svelte-native gestures] GestureStateManager.${call}() works in worklet callbacks only: this gesture runs on the JS thread (a non-worklet callback or .runOnJS(true)), where the state of handler ${handlerTag} cannot be changed. Make every callback a worklet and drop .runOnJS(true).`);
  };
  return { handlerTag, begin: refuse("begin"), activate: refuse("activate"), fail: refuse("fail"), end: refuse("end") };
}

function onGestureHandlerEvent(event: NativeEvent): void {
  const handler = findHandler(event.handlerTag) as Handler | undefined;
  if (!handler) return;
  const callbacks = handler.handlers as any;
  if (event.oldState != null) {
    // A state change.
    if (event.oldState === State.UNDETERMINED && event.state === State.BEGAN) {
      callbacks.onBegin?.(event);
    } else if ((event.oldState === State.BEGAN || event.oldState === State.UNDETERMINED) && event.state === State.ACTIVE) {
      callbacks.onStart?.(event);
      lastUpdateEvent.set(callbacks.handlerTag, event);
    } else if (event.oldState !== event.state && event.state === State.END) {
      if (event.oldState === State.ACTIVE) callbacks.onEnd?.(event, true);
      callbacks.onFinalize?.(event, true);
      lastUpdateEvent.delete(callbacks.handlerTag);
    } else if ((event.state === State.FAILED || event.state === State.CANCELLED) && event.oldState !== event.state) {
      if (event.oldState === State.ACTIVE) callbacks.onEnd?.(event, false);
      callbacks.onFinalize?.(event, false);
      stateManagers.delete(event.handlerTag);
      lastUpdateEvent.delete(callbacks.handlerTag);
    }
  } else if (event.eventType != null) {
    // A touch event.
    let manager = stateManagers.get(event.handlerTag);
    if (!manager) stateManagers.set(event.handlerTag, manager = jsStateManager(event.handlerTag));
    switch (event.eventType) {
      case TouchEventType.TOUCHES_DOWN: callbacks.onTouchesDown?.(event, manager); break;
      case TouchEventType.TOUCHES_MOVE: callbacks.onTouchesMove?.(event, manager); break;
      case TouchEventType.TOUCHES_UP: callbacks.onTouchesUp?.(event, manager); break;
      case TouchEventType.TOUCHES_CANCELLED: callbacks.onTouchesCancelled?.(event, manager); break;
    }
  } else {
    // An update of an active gesture.
    callbacks.onUpdate?.(event);
    if (callbacks.onChange && callbacks.changeEventCalculator) {
      callbacks.onChange?.(callbacks.changeEventCalculator?.(event, lastUpdateEvent.get(callbacks.handlerTag)));
      lastUpdateEvent.set(callbacks.handlerTag, event);
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Subscribes once, at the first attach: both events arrive on the device emitter whatever the handler. */
export function startListening(): void {
  if (subscriptions.length) return;
  const emitter = deviceEventEmitter();
  subscriptions = [
    emitter.addListener("onGestureHandlerEvent", onGestureHandlerEvent as (event: never) => void),
    emitter.addListener("onGestureHandlerStateChange", onGestureHandlerEvent as (event: never) => void),
  ];
}

/** Drops what the receiver remembers of a handler (its state manager and last update) when the handler is dropped. */
export function forgetHandler(handlerTag: number): void {
  stateManagers.delete(handlerTag);
  lastUpdateEvent.delete(handlerTag);
}

/** What the receiver remembers, for the leak checks: a dropped handler leaves no state manager and no last update behind. */
export function receiverSize(): { stateManagers: number; lastUpdates: number } {
  return { stateManagers: stateManagers.size, lastUpdates: lastUpdateEvent.size };
}
