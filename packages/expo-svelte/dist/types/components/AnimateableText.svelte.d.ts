import type { ClassProps } from "../classes.js";
import type { TextProps } from "react-native";
type $$ComponentProps = Omit<TextProps, "children" | "onPress" | "onLongPress"> & {
    text?: string;
    /** A worklet (or an array of them) returning `{ text }`: read shared values and run on the UI runtime. */
    animatedProps?: (() => {
        text?: string;
    }) | ReadonlyArray<() => {
        text?: string;
    }>;
    /** Receives the host handle (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
} & ClassProps;
declare const AnimateableText: import("svelte").Component<$$ComponentProps, {}, "">;
type AnimateableText = ReturnType<typeof AnimateableText>;
export default AnimateableText;
