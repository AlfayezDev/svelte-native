import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { TSpanProps } from "react-native-svg";
type $$ComponentProps = Omit<TSpanProps, "children"> & {
    children?: Snippet;
    /** @internal `SvgXml` sets it: the library's XML renderer gives a `TSpan` an array of children even for one string, so the string is a span of its own and not the `content`. */
    childrenAsArray?: boolean;
} & SvgExtras;
declare const TSpan: import("svelte").Component<$$ComponentProps, {}, "">;
type TSpan = ReturnType<typeof TSpan>;
export default TSpan;
