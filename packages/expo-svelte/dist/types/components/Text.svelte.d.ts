import type { Snippet } from "svelte";
import type { PressConfig } from "../elements.js";
import type { ClassProps } from "../classes.js";
import type { TextProps } from "react-native";
import type { GestureProps } from "../gestures/types.js";
type $$ComponentProps = Omit<TextProps, "children"> & PressConfig & GestureProps & {
    children?: Snippet;
} & ClassProps;
declare const Text: import("svelte").Component<$$ComponentProps, {}, "">;
type Text = ReturnType<typeof Text>;
export default Text;
