import { openLaunchURL, readLaunchURL, type NativeRouter } from "@rasheed/svelte-native";
import { labOnly, launchKind } from "./launch-link.ts";

/** Whether the root stack of `router` holds lab screens only, which the app can render without an account. Reactive: it reads the router's entries. */
export const labShown = (router: NativeRouter): boolean => labOnly(router.entries.map((entry) => entry.url.pathname));

/**
 * Opens the lab link the app was launched with (`rasheed-svelte://__dev/…`) into the root `router` and says whether the router shows lab
 * screens only. The lab needs neither the platform configuration nor an account, so the shell renders the navigator without waiting for
 * them for such a start; the router has opened the link before anything is rendered, so the login (its first screen, which needs the
 * account) is never rendered without one. A start that restored the lab's screens (a restart with no link, or the Activity's own link again)
 * is the same. A launch by any other link is left alone: nothing is opened and the answer is false. The platform gets a few seconds to
 * answer for the link (`readLaunchURL`); after that the app starts as if it had none.
 * Asked by the root layout behind `nativeLabEnabled` only.
 */
export async function openLabLaunch(router: NativeRouter): Promise<boolean> {
  const kind = launchKind(await readLaunchURL());
  if (kind === "other") return false;
  if (kind === "lab") await openLaunchURL(router);
  return labShown(router);
}
