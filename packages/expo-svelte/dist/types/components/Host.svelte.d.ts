import { type Snippet } from "svelte";
import type { ClassProps } from "../classes.js";
type $$ComponentProps = {
    name: string;
    attributes?: object;
    children?: Snippet;
} & ClassProps;
declare const Host: import("svelte").Component<$$ComponentProps, {}, "">;
type Host = ReturnType<typeof Host>;
export default Host;
