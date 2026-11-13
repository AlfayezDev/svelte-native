import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** Receives the host handle (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
} & ClassProps;
declare const BlurTargetView: import("svelte").Component<$$ComponentProps, {}, "">;
type BlurTargetView = ReturnType<typeof BlurTargetView>;
export default BlurTargetView;
