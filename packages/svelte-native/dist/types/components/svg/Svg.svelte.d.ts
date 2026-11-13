import type { Snippet } from "svelte";
import { type SvgRootHandle } from "../../fabric/foreign-svg.js";
import { type SvgRef } from "./handle.js";
import type { SvgProps } from "react-native-svg";
type $$ComponentProps = Omit<SvgProps, "children"> & {
    children?: Snippet;
    ref?: SvgRef<SvgRootHandle>;
    /** A worklet returning native props of the root (`{ bbWidth: 64 }`): Reanimated writes them on the UI thread. */
    animatedProps?: (() => Record<string, unknown>) | ReadonlyArray<() => Record<string, unknown>>;
};
declare const Svg: import("svelte").Component<$$ComponentProps, {}, "">;
type Svg = ReturnType<typeof Svg>;
export default Svg;
