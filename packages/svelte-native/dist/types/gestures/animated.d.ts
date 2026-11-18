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
import { type SharedValue } from "#vendor/react-native-reanimated";
import { WorkletEventHandler } from "../fabric/reanimated-internals.js";
import type { GestureType } from "./rngh.js";
type Event = Record<string, any>;
type Callbacks = Record<string, any>;
/** The numbers above by the names RNGH's `State`, `TouchEventType` and `CALLBACK_TYPE` give them: what the test that pins them reads. */
export declare const copiedConstants: {
    State: {
        UNDETERMINED: number;
        FAILED: number;
        BEGAN: number;
        CANCELLED: number;
        ACTIVE: number;
        END: number;
    };
    TouchEventType: {
        UNDETERMINED: number;
        TOUCHES_DOWN: number;
        TOUCHES_MOVE: number;
        TOUCHES_UP: number;
        TOUCHES_CANCELLED: number;
    };
    CALLBACK_TYPE: {
        UNDEFINED: number;
        BEGAN: number;
        START: number;
        UPDATE: number;
        CHANGE: number;
        END: number;
        FINALIZE: number;
        TOUCHES_DOWN: number;
        TOUCHES_MOVE: number;
        TOUCHES_UP: number;
        TOUCHES_CANCELLED: number;
    };
};
/** `GestureStateManager.create`: the handle a touch callback uses to begin, activate, fail or end the gesture from the UI thread. */
declare function createStateManager(handlerTag: number): {
    handlerTag: number;
    begin: () => void;
    activate: () => void;
    fail: () => void;
    end: () => void;
};
/** What `GestureStateManager` is in RNGH: `create(handlerTag)` inside a worklet, for code that is not handed the manager. */
export declare const GestureStateManager: {
    create: typeof createStateManager;
};
/** What one detector owns on the UI thread: the event registration and the shared values its worklet reads. */
export type UiPath = {
    /** The view tag the events are keyed by. */
    tag: number;
    handler: WorkletEventHandler<Event>;
    sharedHandlers: SharedValue<Callbacks[] | null>;
    lastUpdateEvent: SharedValue<(Event | undefined)[]>;
};
/** `useSharedValue` twice and `useEvent` (a `WorkletEventHandler`) for the node's tag; the handlers are shared with `shareHandlers`. */
export declare function createUiPath(tag: number): UiPath;
/** The gestures were attached again (a different shape or thread): a new worklet over the same shared values, as `useEvent(..., rebuild)` does. */
export declare function rebuildUiPath(path: UiPath): void;
export declare function disposeUiPath(path: UiPath): void;
/**
 * Hands the callbacks of the gestures that run on the UI thread to the worklet (`animatedHandlers.value = ...`). Reanimated
 * serialises them on assignment; when it cannot, the error says which callback it was, found by sending them one at a time.
 */
export declare function shareHandlers(path: UiPath, attached: readonly GestureType[]): void;
export {};
