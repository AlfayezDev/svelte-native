/** What the `gesture` attribute takes: a gesture built with `Gesture.Tap()`, `Gesture.Pan()`, ..., or composed with `Gesture.Race`, `Gesture.Simultaneous`, `Gesture.Exclusive`. */
export type GestureAttribute = import("./rngh.js").ComposedGesture | import("./rngh.js").GestureType;
/** The attribute as a props type, for the primitives that forward it to their host element. Removing it, or setting it to `undefined`, detaches the gesture. */
export type GestureProps = {
    /** A gesture from `expo-svelte` (`Gesture.Tap()`, ...). The view keeps its own native view (`collapsable` is forced to `false`). One gesture object drives one view. */
    gesture?: GestureAttribute;
};
export type { GestureEventPayload, HandlerStateChangeEventPayload, HitSlop, GestureTouchEvent, GestureUpdateEvent, GestureStateChangeEvent, TouchData } from "#vendor/react-native-gesture-handler/types/handlers/gestureHandlerCommon";
export type { FlingGestureHandlerEventPayload, LongPressGestureHandlerEventPayload, NativeViewGestureHandlerPayload, PanGestureHandlerEventPayload, PinchGestureHandlerEventPayload, RotationGestureHandlerEventPayload, TapGestureHandlerEventPayload, } from "#vendor/react-native-gesture-handler/types/handlers/GestureHandlerEventPayload";
export type { GestureStateManagerType } from "#vendor/react-native-gesture-handler/types/handlers/gestures/gestureStateManager";
