import { configureRemote } from "expo-svelte/remote";

/**
 * Points the app's remote functions at another SvelteKit server, from the lab page (`?origin=<origin>` or the host field). Only a build that has the
 * lab on does it; anything else, a link included, leaves the app's host as its config says. Returns whether it changed the host.
 */
export function applyLabOrigin(origin: string | null | undefined, labEnabled: boolean): boolean {
  if (!labEnabled || !origin) return false;
  configureRemote({ origin });
  return true;
}
