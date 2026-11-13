import type { Snippet } from "svelte";
import type { HostHandle } from "../fabric/host.js";
import type { ClassProps } from "../classes.js";
import type { ViewProps } from "react-native";
import type { GestureAttribute } from "../gestures/types.js";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** The gesture to recognise on this view; what `Gesture.Pan()`, `Gesture.Race(...)`, ... return. */
    gesture: GestureAttribute;
    /** Receives the host handle (`HostHandle` in `fabric/host.ts`), or null on unmount. */
    ref?: (handle: HostHandle | null) => void;
} & ClassProps;
declare const GestureDetector: import("svelte").Component<$$ComponentProps, {}, "">;
type GestureDetector = ReturnType<typeof GestureDetector>;
export default GestureDetector;
