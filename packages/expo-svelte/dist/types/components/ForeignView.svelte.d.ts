import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    component: string;
    children?: Snippet;
    /** Receives the host handle (`tag`, `measure`, `dispatchCommand`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
    [prop: string]: unknown;
} & ClassProps;
declare const ForeignView: import("svelte").Component<$$ComponentProps, {}, "">;
type ForeignView = ReturnType<typeof ForeignView>;
export default ForeignView;
