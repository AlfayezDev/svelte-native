// The pure modules of react-native-gesture-handler 3.3.0 the gesture host reuses: the gesture builders and their config
// classes, the handler registries, the hit slop normaliser and the constants. They import no `react-native`, no `createHandler` and
// no Reanimated (24 modules, measured with an esbuild metafile; tests/gestures/isolation.test.ts keeps it so). Metro resolves
// these deep paths to RNGH's `src`, like `reanimated-internals.js` does for Reanimated.
// Never import from here (or add): `index`, `components/*`, `handlers/createHandler`, any `*GestureHandler` component,
// `GestureDetector/*`, `eventReceiver`, `reanimatedWrapper`, `gestureStateManager`, `findNodeHandle`, `v3/*`.
// Plain JavaScript beside a hand-written `.d.ts`, so the type checker reads RNGH's declarations and never compiles its source.
export { GestureObjects } from "react-native-gesture-handler/src/handlers/gestures/gestureObjects";
export { BaseGesture } from "react-native-gesture-handler/src/handlers/gestures/gesture";
export { CallbackType } from "react-native-gesture-handler/src/CallbackType";
export { normalizeHitSlop } from "react-native-gesture-handler/src/handlers/hitSlop";
export { MountRegistry } from "react-native-gesture-handler/src/mountRegistry";
export { findHandler, registerHandler, unregisterHandler } from "react-native-gesture-handler/src/handlers/handlersRegistry";
export { State, Directions, PointerType, TouchEventType, ActionType } from "./constants.js";
