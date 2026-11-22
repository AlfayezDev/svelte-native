import { type Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { RadialGradientProps } from "#vendor/react-native-svg";
type $$ComponentProps = Omit<RadialGradientProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const RadialGradient: import("svelte").Component<$$ComponentProps, {}, "">;
type RadialGradient = ReturnType<typeof RadialGradient>;
export default RadialGradient;
