import { type Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import type { KeyboardAvoidingViewProps } from "react-native";
type $$ComponentProps = Omit<KeyboardAvoidingViewProps, "children"> & {
    children?: Snippet;
} & ClassProps;
declare const KeyboardAvoidingView: import("svelte").Component<$$ComponentProps, {}, "">;
type KeyboardAvoidingView = ReturnType<typeof KeyboardAvoidingView>;
export default KeyboardAvoidingView;
