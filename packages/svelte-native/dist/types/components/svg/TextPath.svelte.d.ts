import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { TextPathProps } from "#vendor/react-native-svg";
type $$ComponentProps = Omit<TextPathProps, "children"> & {
    children?: Snippet;
    /** @internal `SvgXml` sets it, see `TSpan`; it only matters to the `TSpan` that draws a text path with a bad `href`. */
    childrenAsArray?: boolean;
} & SvgExtras;
declare const TextPath: import("svelte").Component<$$ComponentProps, {}, "">;
type TextPath = ReturnType<typeof TextPath>;
export default TextPath;
