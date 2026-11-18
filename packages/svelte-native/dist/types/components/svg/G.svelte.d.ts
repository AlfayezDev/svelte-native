import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { GProps } from "#vendor/react-native-svg";
type $$ComponentProps = Omit<GProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const G: import("svelte").Component<$$ComponentProps, {}, "">;
type G = ReturnType<typeof G>;
export default G;
