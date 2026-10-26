/**
 * The Fabric development loop: hot remount and the on-screen error surface.
 *
 * Without React Fast Refresh, Metro applies an update by re-running the edited module and every module between it and
 * the nearest `module.hot.accept()`. The generated Fabric entry accepts at the top, so each edit re-runs the entry,
 * which calls `createFabricApp` again with the fresh root component, and its accept handler calls `remountSurfaces()`:
 * every running surface is unmounted and started again on the same root tag with the same props and navigation stack.
 */
import { hmrState } from "../hmr-state.ts";
import { startSurface, stopSurface } from "./host.ts";
import ErrorScreen from "./ErrorScreen.svelte";

const dev = () => typeof __DEV__ !== "undefined" && __DEV__;

/** Starts the registered app on a surface. In development a throw during mount or the first flush becomes the error screen; in release it propagates. */
export function launchSurface(rootTag: number, initialProps?: Record<string, unknown>): void {
  const state = hmrState();
  if (!state.app) throw new Error("No Fabric app is registered: createFabricApp has not run");
  state.surfaces.set(rootTag, initialProps);
  try {
    startSurface(rootTag, state.app.App, { ...state.app.props, ...initialProps });
  } catch (error) {
    if (!dev()) throw error;
    console.error(error);
    showError(error, [rootTag]);
  }
}

export function stopApplication(rootTag: number): void {
  hmrState().surfaces.delete(rootTag);
  stopSurface(rootTag);
}

/** Unmounts every surface and starts it again with the latest registered app, keeping the navigation stack. */
export function remountSurfaces(): void {
  const state = hmrState();
  const surfaces = [...state.surfaces];
  if (surfaces.length === 0) return;
  console.log(`[Svelte HMR] remount ${surfaces.length} surface${surfaces.length === 1 ? "" : "s"}`);
  state.restore = state.stack?.();
  try {
    for (const [rootTag] of surfaces) {
      try { stopSurface(rootTag); } catch (error) { console.error(error); }
    }
    for (const [rootTag, initialProps] of surfaces) launchSurface(rootTag, initialProps);
  } finally {
    state.restore = undefined;
  }
}

function describe(error: unknown): { title: string; message: string; frames: string[] } {
  const e = error instanceof Error ? error : new Error(String(error));
  const message = e.message || String(error);
  const lines = (e.stack ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const frames = lines.filter((line) => line !== message && !line.endsWith(message) && /^at |@/.test(line))
    .slice(0, 8).map((line) => line.replace(/\?[^\s):]*/g, "").slice(0, 160));
  return { title: e.name || "Error", message, frames };
}

/** Replaces every running surface with the error screen. Returns false when nothing could be shown (no surface yet, or the host failed). */
export function showError(error: unknown, rootTags: number[] = [...hmrState().surfaces.keys()]): boolean {
  if (rootTags.length === 0) return false;
  const details = describe(error);
  let shown = false;
  for (const rootTag of rootTags) {
    try {
      stopSurface(rootTag);
      startSurface(rootTag, ErrorScreen, { ...details, onReload: () => { setTimeout(remountSurfaces, 0); } });
      shown = true;
    } catch (inner) {
      console.error("Svelte Native could not mount the error screen", inner);
    }
  }
  return shown;
}
