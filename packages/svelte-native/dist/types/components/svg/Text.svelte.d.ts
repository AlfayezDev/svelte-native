import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { TextProps } from "react-native-svg";
type $$ComponentProps = Omit<TextProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const Text: import("svelte").Component<$$ComponentProps, {}, "">;
type Text = ReturnType<typeof Text>;
export default Text;
