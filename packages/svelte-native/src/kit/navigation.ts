import { untrack } from "svelte";
import type * as Kit from "$app/navigation";
import { BASE, type PageRoute, type RouteNode, type StackNode, type TabsNode } from "../route-tree.ts";
import { rootRouter } from "../router.svelte.ts";
import { Linking } from "../platform.ts";
import { routeIdOf } from "./route-id.ts";

/**
 * `$app/navigation` on the device (Metro resolves the import here, `withSvelteNative`). `goto` drives the app's root router, from any code. `preloadCode` loads a screen's
 * code, and `disableScrollHandling` is a no-op because the device has no scroll handling to disable. What the router has nothing behind (navigation hooks, `load` functions,
 * shallow routing, history snapshots) is a function that throws `<name> is not available on the device yet (svelte-native)` and says why: an import of one type-checks, since SvelteKit declares it.
 */

const ORIGIN = new URL(BASE).origin;

/** The screen `goto` resolves a relative URL against: the one the user sees, or the root of the app before it has a screen. */
function here(): URL {
  try {
    return rootRouter()?.current.url ?? new URL(BASE);
  } catch {
    return new URL(BASE); // the root stack has no screen yet
  }
}

/**
 * Goes to a route of the app, through the root router: it selects the tab the route belongs to, closes a modal in the way, and pushes the screen on the stack it belongs to (or goes back to it when
 * that stack has it). A relative `url` is resolved against the screen the user sees, as the browser would. `replace` (and `replaceState`, SvelteKit's deprecated name) replaces the top screen
 * instead of pushing one. A URL of another site, or any scheme of the system, is opened by the system, as `<a href>` does. `reset`, `refreshAll`, `invalidate`, `invalidateAll` and `persistState` are
 * ignored (they scroll, focus and rerun `load` functions, none of which exists here); `shallow` and `state` reject, since the device has no `page.state` to put them in.
 * The promise resolves once the navigation is made, and rejects when no screen of the app has the path, or the app has no router yet.
 */
export const goto: typeof Kit.goto = (url, options = {}) =>
  // Untracked, as SvelteKit's is: `$effect(() => { if (!signedIn) goto("/sign-in") })` must not run again for every screen the user pushes. (The body of an async function runs
  // synchronously up to its first `await`, inside the effect, so it is a function that returns a promise.)
  untrack(async () => {
    if (options.shallow) throw unavailable("`shallow` in the options of goto", "shallow routing (a URL change that navigates nowhere) needs `page.state`, which the device does not have");
    if (options.state !== undefined) throw unavailable("`state` in the options of goto", "`page.state` is always empty on the device");
    const router = rootRouter();
    if (!router) throw new Error("goto needs the app's router, which does not exist yet: it is made by createRouter in the app shell");
    const target = typeof url === "string" ? new URL(url, here()) : url;
    if (target.origin !== ORIGIN) {
      await Linking.openURL(target.href);
      return;
    }
    // `replace` is the option and `replaceState` its deprecated name; the first that is given wins, as in SvelteKit.
    router.goto(`${target.pathname}${target.search}${target.hash}`, (options.replace ?? options.replaceState ?? false) ? { replaceState: true } : {});
  });

/** The route of a tree with this SvelteKit id: a page, or the screen of a navigator (its layout), looked for through the stacks and the tabs' panes. */
function routeWithId(node: StackNode | TabsNode, id: string): PageRoute | RouteNode | undefined {
  for (const stack of node.kind === "stack" ? [node] : node.panes.map((pane) => pane.stack)) {
    for (const route of stack.routes) {
      if (routeIdOf(route) === id) return route;
      const inner = route.kind === "page" ? undefined : routeWithId(route, id);
      if (inner) return inner;
    }
  }
  return undefined;
}

/**
 * Loads the code of the route with this id (SvelteKit's id: `/(app)/blog/[slug]`) so a later `goto` has less to import: the page and the content layouts it brings, or the layout of a
 * navigator (a tabs or a stack layout has an id of its own), once, as a navigation would. Resolves when it is loaded, and rejects with what a failed load threw, or for an id no route has.
 * It loads code only: no `load` function exists to run.
 */
export const preloadCode: typeof Kit.preloadCode = (id) =>
  untrack(async () => {
    const router = rootRouter();
    if (!router) throw new Error("preloadCode needs the app's router, which does not exist yet: it is made by createRouter in the app shell");
    const route = routeWithId(router.node, id);
    if (!route) throw new Error(`No route of the app has the id ${id}`);
    return router.preload(route);
  });

/** What a part of SvelteKit's API the device does not have fails with: the name of the feature, then why. */
function unavailable(what: string, why: string): Error {
  return new Error(`${what} is not available on the device yet (svelte-native): ${why}`);
}
/** A function of `$app/navigation` the device does not have: it throws `\`name\` is not available on the device yet (svelte-native): …` when called. */
const missing = (name: string, why: string) => (): never => { throw unavailable(`\`${name}\``, why); };

/** Does nothing: SvelteKit's scroll handling is the browser's, and the device has none to disable. */
export const disableScrollHandling: typeof Kit.disableScrollHandling = () => {};

export const beforeNavigate: typeof Kit.beforeNavigate = missing("beforeNavigate", "the router has no hook to look at a navigation before it happens or to cancel it");
export const afterNavigate: typeof Kit.afterNavigate = missing("afterNavigate", "the router reports no navigation events; read `page.url` in an `$effect` to follow the screen");
export const onNavigate: typeof Kit.onNavigate = missing("onNavigate", "the router has no hook that runs before a navigation");
export const snapshot: typeof Kit.snapshot = missing("snapshot", "screens are not restored from a history; the router saves the stacks itself (Navigation state)");
export const invalidate: typeof Kit.invalidate = missing("invalidate", "a screen has no `load` function to run again; refetch what it shows");
export const invalidateAll: typeof Kit.invalidateAll = missing("invalidateAll", "a screen has no `load` function to run again; refetch what it shows");
export const refreshAll: typeof Kit.refreshAll = missing("refreshAll", "a screen has no `load` function to run again; `refreshAll` of `@alfayez/svelte-native/remote` refetches the remote functions' queries");
export const preloadData: typeof Kit.preloadData = missing("preloadData", "a screen has no `load` function to run; `preloadCode(routeId)` loads its code");
export const pushState: typeof Kit.pushState = missing("pushState", "shallow routing needs `page.state`, which the device does not have");
export const replaceState: typeof Kit.replaceState = missing("replaceState", "shallow routing needs `page.state`, which the device does not have");
