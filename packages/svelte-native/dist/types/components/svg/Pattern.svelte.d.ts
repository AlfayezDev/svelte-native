import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { PatternProps } from "react-native-svg";
type $$ComponentProps = Omit<PatternProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const Pattern: import("svelte").Component<$$ComponentProps, {}, "">;
type Pattern = ReturnType<typeof Pattern>;
export default Pattern;
