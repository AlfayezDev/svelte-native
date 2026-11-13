import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    tint?: string;
    intensity?: number;
    blurReductionFactor?: number;
    blurMethod?: "none" | "dimezisBlurView" | "dimezisBlurViewSdk31Plus";
    /** @deprecated Use `blurMethod`. */
    experimentalBlurMethod?: "none" | "dimezisBlurView" | "dimezisBlurViewSdk31Plus";
    /** The `ref` value of a `BlurTargetView` (its host handle), or its native tag. */
    blurTarget?: {
        tag: number;
    } | number | null;
    children?: Snippet;
    /** Receives the host handle of the container, or null on unmount. */
    ref?: (handle: unknown) => void;
} & ClassProps;
declare const ExpoBlurView: import("svelte").Component<$$ComponentProps, {}, "">;
type ExpoBlurView = ReturnType<typeof ExpoBlurView>;
export default ExpoBlurView;
