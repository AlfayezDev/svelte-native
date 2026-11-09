import { openLaunchURL, type NativeRouter } from "@example/svelte-native";

/** What the link the app was launched with says: it names a screen of the lab (`standin://__dev/screens`), anything else, or there is none. */
export function launchKind(url: string | null | undefined): "lab" | "other" | "none" {
  if (!url) return "none";
  return /\/__dev(?:[/?#]|$)/.test(url.replace(/^[a-z-]+:\/\/+/, "/")) ? "lab" : "other";
}

/** Whether a router path is the lab's. */
export const isLabPath = (pathname: string): boolean => pathname === "/__dev" || pathname.startsWith("/__dev/");

/** Whether every screen on the root stack is the lab's: the app can render them without a session. A stack with `/sign-in` under the lab is not. */
export const labOnly = (pathnames: readonly string[]): boolean => pathnames.length > 0 && pathnames.every(isLabPath);

/** Whether the root stack of `router` holds lab screens only. Reactive: it reads the router's entries. */
export const labShown = (router: NativeRouter): boolean => labOnly(router.entries.map((entry) => entry.url.pathname));

/**
 * Opens the lab link the app was launched with into the root `router` (ahead of its `<Router>`) and says whether the router shows lab screens
 * only: the lab needs no session, so the shell renders the navigator without waiting for one. A launch by any other link is left alone for the
 * `<Router>` to open: nothing is opened here and the answer is false. A start that restored the lab's screens is the same as a lab link.
 */
export async function openLabLaunch(router: NativeRouter): Promise<boolean> {
  const link = await openLaunchURL(router, (url) => launchKind(url) === "lab");
  if (launchKind(link) === "other") return false;
  return labShown(router);
}
