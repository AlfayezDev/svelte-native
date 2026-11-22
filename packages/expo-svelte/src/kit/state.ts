import { createSubscriber } from "svelte/reactivity";
import type * as Kit from "$app/state";
import { BASE } from "../route-tree.ts";
import { rootRouter, type NativeLocation } from "../router.svelte.ts";
import { routeIdOf } from "./route-id.ts";

/**
 * `$app/state` on the device (Metro resolves the import here, `withExpoSvelte`): `page`, `navigating` and `updated`, with SvelteKit's shapes.
 * `page` follows the screen the user sees, through the app's root router, so it works in any component and in any module, not only below a `<Router>`.
 */

const home = new URL("/", BASE);
const empty = Object.freeze({}) as Record<string, never>;

/** The screen on top: the deepest one through the root router's tabs and stacks (a modal over the tabs counts), or none before the app has a router or its first screen. Read in an effect, it follows both. */
function visible(): NativeLocation | undefined {
  const router = rootRouter();
  if (!router) return undefined;
  try {
    return router.current;
  } catch {
    return undefined; // the stack has no screen yet
  }
}

/** One `{ id }` per screen, so `page.route` is the same object for as long as the screen is on top (a `$derived` of it does not run again). */
const routes = new WeakMap<NativeLocation, { id: string }>();
const unmatched = { id: null };
function routeOf(entry: NativeLocation | undefined): { id: string | null } {
  if (!entry) return unmatched;
  const known = routes.get(entry);
  if (known) return known;
  const route = { id: routeIdOf(entry.route) };
  routes.set(entry, route);
  return route;
}

/**
 * The page the user sees. `url`, `params` and `route.id` are the deepest screen's: its URL (on the origin `https://native.invalid`, as `useRouter().current.url`), the parameters
 * of its route and its route's id, as SvelteKit writes it (`/(app)/blog/[slug]`). There is no `load` function and no form action on the device, so the rest is SvelteKit's
 * values for a page that has none: `data` and `state` are `{}`, `form` and `error` and `shallow` are `null`, `status` is `200`.
 */
export const page: Kit.Page = {
  get url() { return (visible()?.url ?? home) as Kit.Page["url"]; },
  get params() { return visible()?.params ?? empty; },
  get route() { return routeOf(visible()) as Kit.Page["route"]; },
  status: 200,
  error: null,
  data: Object.freeze({}) as Kit.Page["data"],
  state: Object.freeze({}) as Kit.Page["state"],
  form: null,
  shallow: null,
};

/** Always the shape of "no navigation": the router applies a navigation in one step and has none in flight to report. */
export const navigating: typeof Kit.navigating = { from: null, to: null, type: null, willUnload: null, delta: null, complete: null };

/** The updates client, loaded when `updated` is first used: a screen that only reads `page` does not pay for it. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
const client = () => (require("../updates/instance.ts") as typeof import("../updates/instance.ts")).updates;

// One listener on the updates for every reader: the first read inside an effect adds it, the last of those effects to go removes it.
const subscribe = createSubscriber((update) => client().onPending(update));

/**
 * Whether an update is waiting: `current` is `true` once a check found one (`updated.check()`, `checkForUpdateAsync`) or one was downloaded (`fetchUpdateAsync`, the check at
 * launch), and stays `true` until the app restarts on it (`reloadAsync`). In a build whose updates are off (`isEnabled` is `false`: development builds) it is `false`, and `check()` resolves `false`.
 */
export const updated: typeof Kit.updated = {
  get current() {
    subscribe();
    return client().pending;
  },
  async check() {
    const updates = client();
    if (updates.pending) return true;
    try {
      await updates.checkForUpdateAsync();
    } catch (error) {
      console.warn("[Svelte updates] the check for an update failed", error);
    }
    return updates.pending;
  },
};
