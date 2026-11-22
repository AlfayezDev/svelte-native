export { useHeader, useToolbar } from "../fabric/navigation.js";
import { type Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
import { type ScreenOptions } from "../fabric/navigation.js";
type $$ComponentProps = ScreenOptions & {
    children?: Snippet;
} & ClassProps;
declare const Screen: import("svelte").Component<$$ComponentProps, {}, "">;
type Screen = ReturnType<typeof Screen>;
export default Screen;
