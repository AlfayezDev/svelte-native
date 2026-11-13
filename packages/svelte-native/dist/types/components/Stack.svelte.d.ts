import { type Snippet } from "svelte";
import { type StackDefaults } from "../navigator-context.js";
import type { NativeLocation } from "../router.svelte-module.js";
type $$ComponentProps = StackDefaults & {
    children?: Snippet;
    loading?: Snippet<[NativeLocation]>;
};
declare const Stack: import("svelte").Component<$$ComponentProps, {}, "">;
type Stack = ReturnType<typeof Stack>;
export default Stack;
