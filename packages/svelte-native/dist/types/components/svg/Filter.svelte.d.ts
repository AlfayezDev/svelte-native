import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { FilterProps } from "react-native-svg";
type $$ComponentProps = Omit<FilterProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const Filter: import("svelte").Component<$$ComponentProps, {}, "">;
type Filter = ReturnType<typeof Filter>;
export default Filter;
