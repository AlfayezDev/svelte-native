import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import { type UntypedExpoViewHandle } from "../fabric/foreign-expo-view.js";
import type { ViewProps } from "react-native";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    module: string;
    view?: string;
    children?: Snippet;
    /** Receives the host handle with the view's native functions, or null on unmount. */
    ref?: (handle: UntypedExpoViewHandle | null) => void;
    [prop: string]: unknown;
} & ClassProps;
declare const ExpoView: import("svelte").Component<$$ComponentProps, {}, "">;
type ExpoView = ReturnType<typeof ExpoView>;
export default ExpoView;
