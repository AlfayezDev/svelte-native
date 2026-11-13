import type { Snippet } from "svelte";
import type { ViewProps } from "react-native";
import { type ClassProps } from "../classes.js";
import { type Edge } from "../fabric/insets.js";
type $$ComponentProps = Omit<ViewProps, "children"> & {
    children?: Snippet;
    edges?: readonly Edge[];
} & ClassProps;
declare const SafeAreaView: import("svelte").Component<$$ComponentProps, {}, "">;
type SafeAreaView = ReturnType<typeof SafeAreaView>;
export default SafeAreaView;
