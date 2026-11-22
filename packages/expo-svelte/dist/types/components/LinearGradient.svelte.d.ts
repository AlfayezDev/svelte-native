import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import { type GradientPoint } from "../fabric/foreign-gradient.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    colors: readonly unknown[];
    locations?: readonly number[] | null;
    start?: GradientPoint | null;
    end?: GradientPoint | null;
    dither?: boolean;
    children?: Snippet;
    /** Receives the host handle of the container (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
} & ClassProps;
declare const LinearGradient: import("svelte").Component<$$ComponentProps, {}, "">;
type LinearGradient = ReturnType<typeof LinearGradient>;
export default LinearGradient;
