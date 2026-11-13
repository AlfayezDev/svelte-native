import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { ForeignObjectProps } from "react-native-svg";
type $$ComponentProps = Omit<ForeignObjectProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const ForeignObject: import("svelte").Component<$$ComponentProps, {}, "">;
type ForeignObject = ReturnType<typeof ForeignObject>;
export default ForeignObject;
