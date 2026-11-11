import { mark } from "../boot-marks.ts";
import type { Component, Snippet } from "svelte";
// Registers the class resolver and loads the app's class table (`class` on components); see `css/load-table.ts`.
import "../css/load-table.ts";
import { hmrState } from "../hmr-state.ts";
import Root from "../Root.svelte";
import type { StackNode } from "../route-tree.ts";
import { launchSurface, stopApplication } from "./hmr.ts";
import { saveNavigation } from "./host.ts";

export { fabricStats, flush } from "./host.ts";
export { remountSurfaces, showError } from "./hmr.ts";

/**
 * Registers the surface entry as an AppRegistry *runnable*: React Native's host calls
 * `AppRegistry.runApplication("main", …)` and the runnable renders the Svelte component straight
 * into the Fabric surface. `renderApplication` and React never run.
 */
type Registry = { registerRunnable(appKey: string, run: (parameters: { rootTag: number; initialProps?: Record<string, unknown> }) => void): string };
// Whichever AppRegistry the boot installed: our own (init.ts) or React Native's (InitializeCore).
const registry = () => (globalThis as { RN$AppRegistry?: Registry }).RN$AppRegistry ?? (() => { throw new Error("No AppRegistry: the boot module did not run"); })();

/**
 * With a route `tree` (the generated table) the app is its root layout: `App` is the shell around the root navigator, receives
 * it as `children`, and finds the router with `useRouter()`. Without one, `App` is the root component and `props` are its
 * props (the lab's spike roots). Deep links need nothing here: the router reads `Linking.getInitialURL()` itself.
 */
export function createFabricApp(Shell: Component<{ children: Snippet }>, props: { tree: StackNode; initial?: string }, appKey?: string): void;
export function createFabricApp<Props extends Record<string, unknown>>(App: Component<Props>, props: Props, appKey?: string): void;
export function createFabricApp(App: Component<never>, props: Record<string, unknown>, appKey = "main"): void {
  mark("app");
  // Held on `globalThis`, not in this module: a hot update re-runs the entry, which registers the fresh component here.
  const state = hmrState();
  state.app = "tree" in props
    ? { App: Root as unknown as Component<Record<string, unknown>>, props: { ...props, shell: App } }
    : { App: App as unknown as Component<Record<string, unknown>>, props };
  state.save = saveNavigation;
  registry().registerRunnable(appKey, (parameters: { rootTag: number; initialProps?: Record<string, unknown> }) => {
    launchSurface(parameters.rootTag, parameters.initialProps);
  });
  (globalThis as { __svelteFabricStop?: (rootTag: number) => void }).__svelteFabricStop = stopApplication;
}
mark("fabric");
