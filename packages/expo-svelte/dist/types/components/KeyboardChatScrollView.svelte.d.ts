import type { Snippet } from "svelte";
import type { ScrollViewInstance as NativeScrollView, ScrollViewProps } from "react-native";
import type { ClassProps } from "../classes.js";
import type { GestureProps } from "../gestures/types.js";
type $$ComponentProps = Omit<ScrollViewProps, "children" | "ref"> & GestureProps & ClassProps & {
    children?: Snippet;
    /**
     * When the content lifts with the keyboard. `"always"`: whatever the scroll position. `"whenAtEnd"`: only when the last message is in view (within 20 dp of
     * the end), so a thread scrolled up to older messages stays where it is. `"never"`: never; the room is still made at the bottom.
     */
    keyboardLiftBehavior?: "always" | "whenAtEnd" | "never";
    /** The distance, in dp, between the bottom of the scroll view and the bottom of the screen (a tab bar, an inset): the content lifts by the keyboard's height less this. */
    offset?: number;
    /** Called when the end of the content comes into view (`true`) or leaves it (`false`), and once when the scroll view has been laid out. */
    onEndVisible?: (visible: boolean) => void;
    /** Receives the host handle: React Native's ScrollView instance (`scrollTo`, `scrollToEnd`, `measure`) plus `dispatchCommand`, or null on unmount. */
    ref?: (instance: NativeScrollView | null) => void;
};
declare const KeyboardChatScrollView: import("svelte").Component<$$ComponentProps, {}, "">;
type KeyboardChatScrollView = ReturnType<typeof KeyboardChatScrollView>;
export default KeyboardChatScrollView;
