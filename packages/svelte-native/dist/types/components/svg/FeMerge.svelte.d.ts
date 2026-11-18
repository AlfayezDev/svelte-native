import { type Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { FeMergeProps, FilterPrimitiveCommonProps } from "#vendor/react-native-svg";
type $$ComponentProps = Omit<FeMergeProps, "children"> & {
    children?: Snippet;
} & FilterPrimitiveCommonProps & SvgExtras;
declare const FeMerge: import("svelte").Component<$$ComponentProps, {}, "">;
type FeMerge = ReturnType<typeof FeMerge>;
export default FeMerge;
