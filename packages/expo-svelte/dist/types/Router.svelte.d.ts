import { type Snippet } from "svelte";
import { type NativeLocation, type Router as RouterHandle } from "./router.svelte-module.js";
type $$ComponentProps = {
    router: RouterHandle;
    loading?: Snippet<[NativeLocation]>;
};
declare const Router: import("svelte").Component<$$ComponentProps, {}, "">;
type Router = ReturnType<typeof Router>;
export default Router;
