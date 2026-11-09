/**
 * The remote runtime's view of the app's navigation: the URL of the screen on top (what SvelteKit's client calls `page.url`) and where a
 * `redirect()` from the server goes. The root router registers itself while its `<Router>` is mounted (`connectHost`, through `router-link.ts`).
 */
import Linking from "react-native/Libraries/Linking/Linking";
import { linkedRouter } from "./router-link.ts";

type Host = { origin: string | undefined; base: string; goto?: (location: string) => void | Promise<void> };

/** The URL a router builds its locations on; the screen URL when no router is mounted (or nothing is shown yet). */
export const NATIVE_ORIGIN = "https://native.invalid";

let host: () => Host = () => ({ origin: undefined, base: "" });

/** Set by `config.ts`: the configured origin and base, and the app's own `goto`. */
export function provideHost(next: () => Host): void {
  host = next;
}

/** The screen on top, as a URL (`https://native.invalid/path?query`). */
export function currentUrl(): URL {
  try {
    const url = linkedRouter()?.current.url;
    if (url) return url;
  } catch {
    // The router has no screen yet.
  }
  return new URL("/", NATIVE_ORIGIN);
}

/**
 * Follows a location a remote function redirected to. The app's own `goto` (`configureRemote({ goto })`) takes it first; otherwise a location of
 * the app (a path, or a URL on the configured origin, with SvelteKit's `base` removed) goes through the root router; an `http:` or `https:` URL of another
 * site is opened by the system; any other kind of URL (`javascript:`, `intent:`, `file:`, another app's scheme) is refused.
 */
export async function navigate(location: string): Promise<void> {
  const { origin, base, goto } = host();
  if (goto) return void (await goto(location));
  const target = new URL(location, origin ?? NATIVE_ORIGIN);
  if (origin !== undefined && target.origin !== origin) {
    // A redirect is the server's word, and the server is not the app: it may send the user to a web page, not to another app or into a file.
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error(`A remote function redirected to ${location}, which is not an http: or https: address and not a route of the app: it is not opened.`);
    // (The app project declares `Linking` for itself, with the members the app uses: this is the one that opens a URL.)
    await (Linking as unknown as { openURL(url: string): Promise<unknown> }).openURL(target.href);
    return;
  }
  const linked = linkedRouter();
  if (!linked) throw new Error(`A remote function redirected to ${location}, and no router is connected to follow it: render <Router> or pass configureRemote({ goto }).`);
  const path = base !== "" && (target.pathname === base || target.pathname.startsWith(`${base}/`)) ? target.pathname.slice(base.length) || "/" : target.pathname;
  linked.goto(`${path}${target.search}${target.hash}`);
}
