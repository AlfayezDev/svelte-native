import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { MarkerProps } from "#vendor/react-native-svg";
type $$ComponentProps = Omit<MarkerProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const Marker: import("svelte").Component<$$ComponentProps, {}, "">;
type Marker = ReturnType<typeof Marker>;
export default Marker;
