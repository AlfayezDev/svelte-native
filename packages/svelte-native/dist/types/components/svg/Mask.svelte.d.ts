import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { MaskProps } from "#vendor/react-native-svg";
type $$ComponentProps = Omit<MaskProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const Mask: import("svelte").Component<$$ComponentProps, {}, "">;
type Mask = ReturnType<typeof Mask>;
export default Mask;
