import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { UseProps } from "#vendor/react-native-svg";
type $$ComponentProps = Omit<UseProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const Use: import("svelte").Component<$$ComponentProps, {}, "">;
type Use = ReturnType<typeof Use>;
export default Use;
