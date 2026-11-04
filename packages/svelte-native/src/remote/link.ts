/**
 * The remote runtime's view of the app's navigation: the URL of the screen on top (what SvelteKit's client calls `page.url`) and where a
 * `redirect()` from the server goes. The root router registers itself while its `<Router>` is mounted (`connectHost`); this module imports
 * only what the router imports itself, so the router can import it without pulling the runtime in.
 */
import Linking from "react-native/Libraries/Linking/Linking";

type Linked = { goto(href: string): void; readonly current: { readonly url: URL } };
type Host = { origin: string | undefined; base: string; goto?: (location: string) => void | Promise<void> };

/** The URL a router builds its locations on; the screen URL when no router is mounted (or nothing is shown yet). */
export const NATIVE_ORIGIN = "https://native.invalid";

let linked: Linked | undefined;
let host: () => Host = () => ({ origin: undefined, base: "" });

/** Registers the root router; the returned function unregisters it (when it is still the registered one). */
export function linkRouter(router: Linked): () => void {
  linked = router;
  return () => { if (linked === router) linked = undefined; };
}

/** Set by `config.ts`: the configured origin and base, and the app's own `goto`. */
export function provideHost(next: () => Host): void {
  host = next;
}

/** The screen on top, as a URL (`https://native.invalid/path?query`). */
export function currentUrl(): URL {
  try {
    const url = linked?.current.url;
    if (url) return url;
  } catch {
    // The router has no screen yet.
  }
  return new URL("/", NATIVE_ORIGIN);
}

/**
 * Follows a location a remote function redirected to. The app's own `goto` (`configureRemote({ goto })`) takes it first; otherwise a location of
 * the app (a path, or a URL on the configured origin, with SvelteKit's `base` removed) goes through the root router and any other URL is
 * opened by the system.
 */
export async function navigate(location: string): Promise<void> {
  const { origin, base, goto } = host();
  if (goto) return void (await goto(location));
  const target = new URL(location, origin ?? NATIVE_ORIGIN);
  if (origin !== undefined && target.origin !== origin) {
    await Linking.openURL(target.href);
    return;
  }
  if (!linked) throw new Error(`A remote function redirected to ${location}, and no router is connected to follow it: render <Router> or pass configureRemote({ goto }).`);
  const path = base !== "" && (target.pathname === base || target.pathname.startsWith(`${base}/`)) ? target.pathname.slice(base.length) || "/" : target.pathname;
  linked.goto(`${path}${target.search}${target.hash}`);
}
