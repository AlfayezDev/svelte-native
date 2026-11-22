import type { Component, Snippet } from "svelte";
import "../css/load-table.js";
import type { StackNode } from "../route-tree.js";
export { fabricStats, flush } from "./host.js";
export { remountSurfaces, showError } from "./hmr.js";
/**
 * With a route `tree` (the generated table) the app is its root layout: `App` is the shell around the root navigator, receives
 * it as `children`, and finds the router with `useRouter()`. Without one, `App` is the root component and `props` are its
 * props (the lab's spike roots). Deep links need nothing here: the router reads `Linking.getInitialURL()` itself.
 */
export declare function createFabricApp(Shell: Component<{
    children: Snippet;
}>, props: {
    tree: StackNode;
    initial?: string;
}, appKey?: string): void;
export declare function createFabricApp<Props extends Record<string, unknown>>(App: Component<Props>, props: Props, appKey?: string): void;
