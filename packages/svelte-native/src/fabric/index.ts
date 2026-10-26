import { mark } from "../boot-marks.ts";
import type { Component } from "svelte";
import { hmrState } from "../hmr-state.ts";
import { launchSurface, stopApplication } from "./hmr.ts";

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
 * `props` are the root component's props: the real app passes `{ routes }` (the generated route table) to its layout,
 * and the layout creates the router and session. Deep links need nothing here: the
 * router and session read `Linking.getInitialURL()` themselves.
 */
export function createFabricApp<Props extends Record<string, unknown>>(App: Component<Props>, props: Props, appKey = "main"): void {
  mark("app");
  // Held on `globalThis`, not in this module: a hot update re-runs the entry, which registers the fresh component here.
  hmrState().app = { App: App as unknown as Component<Record<string, unknown>>, props };
  registry().registerRunnable(appKey, (parameters: { rootTag: number; initialProps?: Record<string, unknown> }) => {
    launchSurface(parameters.rootTag, parameters.initialProps);
  });
  (globalThis as { __svelteFabricStop?: (rootTag: number) => void }).__svelteFabricStop = stopApplication;
}
mark("fabric");
