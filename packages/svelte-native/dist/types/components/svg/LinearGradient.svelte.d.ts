import { type Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { LinearGradientProps } from "react-native-svg";
type $$ComponentProps = Omit<LinearGradientProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const LinearGradient: import("svelte").Component<$$ComponentProps, {}, "">;
type LinearGradient = ReturnType<typeof LinearGradient>;
export default LinearGradient;
