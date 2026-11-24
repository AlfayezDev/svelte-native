import type { Snippet } from "svelte";
import type { ScrollViewInstance as NativeScrollView, ScrollViewProps } from "react-native";
import type { ClassProps } from "../classes.js";
import type { GestureProps } from "../gestures/types.js";
type $$ComponentProps = Omit<ScrollViewProps, "children" | "ref"> & GestureProps & ClassProps & {
    children?: Snippet;
    /** The distance, in dp, to keep between the keyboard and the bottom of the input. */
    bottomOffset?: number;
    /** Room, in dp, added at the bottom of the scrollable area while the keyboard is up. */
    extraKeyboardSpace?: number;
    /** Leave the scroll position where it is when the keyboard closes. */
    disableScrollOnKeyboardHide?: boolean;
    /** `false` turns the scrolling and the room off. */
    enabled?: boolean;
    /** Receives the host handle: React Native's ScrollView instance (`scrollTo`, `scrollToEnd`, `measure`) plus `dispatchCommand`, or null on unmount. */
    ref?: (instance: NativeScrollView | null) => void;
};
declare const KeyboardAwareScrollView: import("svelte").Component<$$ComponentProps, {}, "">;
type KeyboardAwareScrollView = ReturnType<typeof KeyboardAwareScrollView>;
export default KeyboardAwareScrollView;
