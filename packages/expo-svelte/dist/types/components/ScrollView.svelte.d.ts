import type { Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import type { ScrollViewInstance as NativeScrollView, ScrollViewProps } from "react-native";
import type { HostHandle } from "../fabric/host.js";
import type { GestureProps } from "../gestures/types.js";
type $$ComponentProps = Omit<ScrollViewProps, "children"> & GestureProps & {
    children?: Snippet;
    /** Receives the host handle: React Native's ScrollView instance (`scrollTo`, `scrollToEnd`, `measure`) plus `dispatchCommand`, or null on unmount. */
    ref?: (instance: (NativeScrollView & Pick<HostHandle, "dispatchCommand">) | null) => void;
} & ClassProps;
declare const ScrollView: import("svelte").Component<$$ComponentProps, {}, "">;
type ScrollView = ReturnType<typeof ScrollView>;
export default ScrollView;
