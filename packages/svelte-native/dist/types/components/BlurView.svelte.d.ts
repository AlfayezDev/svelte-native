import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import type { BlurTint } from "../fabric/foreign-blur.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    tint?: BlurTint;
    intensity?: number;
    children?: Snippet;
    /** Receives the host handle of the container, or null on unmount. */
    ref?: (handle: unknown) => void;
} & ClassProps;
declare const BlurView: import("svelte").Component<$$ComponentProps, {}, "">;
type BlurView = ReturnType<typeof BlurView>;
export default BlurView;
