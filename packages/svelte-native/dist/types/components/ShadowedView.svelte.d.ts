import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** Receives the host handle of the container, or null on unmount. */
    ref?: (handle: unknown) => void;
} & ClassProps;
declare const ShadowedView: import("svelte").Component<$$ComponentProps, {}, "">;
type ShadowedView = ReturnType<typeof ShadowedView>;
export default ShadowedView;
