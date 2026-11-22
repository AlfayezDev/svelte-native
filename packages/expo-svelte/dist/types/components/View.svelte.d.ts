import type { Snippet } from "svelte";
import type { PressHandlers } from "../elements.js";
import type { HostHandle } from "../fabric/host.js";
import type { ClassProps } from "../classes.js";
import type { ViewProps } from "react-native";
import type { GestureProps } from "../gestures/types.js";
type $$ComponentProps = Omit<ViewProps, "children"> & PressHandlers & GestureProps & {
    children?: Snippet;
    /** Receives the host handle (`HostHandle` in `fabric/host.ts`: `tag`, `measure`, `measureInWindow`, `dispatchCommand`, ...), or null on unmount. */
    ref?: (handle: HostHandle | null) => void;
} & ClassProps;
declare const View: import("svelte").Component<$$ComponentProps, {}, "">;
type View = ReturnType<typeof View>;
export default View;
