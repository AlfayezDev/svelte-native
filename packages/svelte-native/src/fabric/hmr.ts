/**
 * The Fabric development loop: hot remount and the on-screen error surface.
 *
 * Without React Fast Refresh, Metro applies an update by re-running the edited module and every module between it and
 * the nearest `module.hot.accept()`. The generated Fabric entry accepts at the top, so each edit re-runs the entry,
 * which calls `createFabricApp` again with the fresh root component, and its accept handler calls `remountSurfaces()`:
 * every running surface is unmounted and started again on the same root tag with the same props and navigation state.
 */
import { hmrState } from "../hmr-state.ts";
import { hostFinishing, hostNavigation, navigationAdopted, startSurface, stopSurface } from "./host.ts";
import ErrorScreen from "./ErrorScreen.svelte";

const dev = () => typeof __DEV__ !== "undefined" && __DEV__;

/**
 * The launch props with the navigation state of the process that died. Android's host passes it as `initialProps.navigation`; iOS's gives it
 * to the navigation module, which hands it over once (a surface that starts again in the same runtime, in development, has it in its props
 * already). From here on the two are one path: `Root.svelte` reads `navigation`, `createRouter` adopts it. `hosted` is true when the iOS host
 * gave a state, which it forgets once the surface has started (and is told whether the router adopted it).
 */
function withHostNavigation(initialProps?: Record<string, unknown>): { props: Record<string, unknown> | undefined; hosted: boolean } {
  if (initialProps?.navigation !== undefined) return { props: initialProps, hosted: false };
  const navigation = hostNavigation();
  return navigation === undefined ? { props: initialProps, hosted: false } : { props: { ...initialProps, navigation }, hosted: true };
}

/** Starts the registered app on a surface. In development a throw during mount or the first flush becomes the error screen; in release it propagates. */
export function launchSurface(rootTag: number, initialProps?: Record<string, unknown>): void {
  const state = hmrState();
  if (!state.app) throw new Error("No Fabric app is registered: createFabricApp has not run");
  // A surface that starts while another still runs (a recreated Activity whose old surface stops after the new one starts): the new root router takes the running one's navigation, as it does after a stop.
  if ([...state.surfaces.keys()].some((running) => running !== rootTag)) state.restore ??= state.navigation?.();
  const { props, hosted } = withHostNavigation(initialProps);
  state.surfaces.set(rootTag, props);
  state.adoption = undefined;
  try {
    startSurface(rootTag, state.app.App, { ...state.app.props, ...props });
    // The root router left in `adoption` what it did with the state the surface started with; the host that gave the state hears it now, once the first commit is done.
    if (hosted) navigationAdopted(state.adoption);
    state.adoption = undefined;
  } catch (error) {
    if (!dev()) throw error;
    console.error(error);
    showError(error, [rootTag]);
  }
}

/**
 * The host stopped a surface (a recreated Android Activity, a torn-down root). The last one to go leaves its router's navigation
 * state for the next surface to adopt, unless the app is closing for good (the user left; Android's `isFinishing`): the next
 * launch starts from its own first screen.
 */
export function stopApplication(rootTag: number): void {
  const state = hmrState();
  state.surfaces.delete(rootTag);
  if (state.surfaces.size === 0) state.restore = hostFinishing() ? undefined : state.navigation?.();
  stopSurface(rootTag);
}

/** Unmounts every surface and starts it again with the latest registered app, keeping the navigation state (every stack and tabs selection). */
export function remountSurfaces(): void {
  const state = hmrState();
  const surfaces = [...state.surfaces];
  if (surfaces.length === 0) return;
  console.log(`[Svelte HMR] remount ${surfaces.length} surface${surfaces.length === 1 ? "" : "s"}`);
  state.restore = state.navigation?.();
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
