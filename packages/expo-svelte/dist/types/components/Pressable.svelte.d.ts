import type { Snippet } from "svelte";
import type { PressConfig } from "../elements.js";
import type { ClassProps } from "../classes.js";
import type { PressableProps } from "react-native";
import type { GestureProps } from "../gestures/types.js";
type $$ComponentProps = Omit<PressableProps, "children"> & PressConfig & GestureProps & {
    children?: Snippet;
} & ClassProps;
declare const Pressable: import("svelte").Component<$$ComponentProps, {}, "">;
type Pressable = ReturnType<typeof Pressable>;
export default Pressable;
