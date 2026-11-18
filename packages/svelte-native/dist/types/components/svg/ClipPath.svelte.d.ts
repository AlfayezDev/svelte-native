import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { ClipPathProps } from "#vendor/react-native-svg";
type $$ComponentProps = Omit<ClipPathProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const ClipPath: import("svelte").Component<$$ComponentProps, {}, "">;
type ClipPath = ReturnType<typeof ClipPath>;
export default ClipPath;
