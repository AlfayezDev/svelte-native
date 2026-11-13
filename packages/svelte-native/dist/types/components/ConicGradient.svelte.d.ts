import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    colors: readonly unknown[];
    locations?: readonly number[];
    center?: readonly [x: number, y: number];
    angle?: number;
    children?: Snippet;
    /** Receives the host handle of the container, or null on unmount. */
    ref?: (handle: unknown) => void;
} & ClassProps;
declare const ConicGradient: import("svelte").Component<$$ComponentProps, {}, "">;
type ConicGradient = ReturnType<typeof ConicGradient>;
export default ConicGradient;
