import type { Snippet } from "svelte";
import { type SvgExtras } from "./handle.js";
import type { SymbolProps } from "react-native-svg";
type $$ComponentProps = Omit<SymbolProps, "children"> & {
    children?: Snippet;
} & SvgExtras;
declare const Symbol: import("svelte").Component<$$ComponentProps, {}, "">;
type Symbol = ReturnType<typeof Symbol>;
export default Symbol;
