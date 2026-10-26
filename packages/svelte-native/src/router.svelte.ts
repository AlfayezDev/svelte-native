import { getContext, setContext } from "svelte";
import type { Component } from "svelte";
import { SvelteMap, SvelteURL } from "svelte/reactivity";
import { hmrState, type HmrState } from "./hmr-state.ts";
import type { Presentation, RouterScopeOptions } from "./fabric/navigation.ts";

/** What loading a route yields: its page and the layouts around it, outermost first. */
export type RouteModules = { component: Component; layouts: Component[] };
export type NativeRoute = {
  id: string;
  path: string;
  /** Imports the page and its layouts. The router calls it once per route, when the route is first needed. */
  load: () => Promise<RouteModules>;
  /** How the route's screen enters the stack unless a navigation says otherwise; `push` by default. */
  presentation?: Presentation;
};
export type NativeLocation = {
  key: number;
  route: NativeRoute;
  url: URL;
  params: Record<string, string>;
  /** The screen's presentation: the one `goto` was given, else the route's, else `push`. Fixed for the life of the entry. */
  presentation: Presentation;
};
export type NavigateOptions = { replaceState?: boolean; reset?: boolean; presentation?: Presentation };
const contextKey = Symbol("svelte-native-router");
/** The router context: each `createRouter` links to the one above it, so `useRouter(scope)` can walk up to a named ancestor. */
type RouterContext = { router: Router; scope: string | undefined; parent: RouterContext | undefined };
type Router = ReturnType<typeof createRouter>;
/** The stacks of the named non-root routers, so a hot update can hand each its screens back (the root keeps `stack`/`restore`). */
type ScopedHmrState = HmrState & { scopes?: Map<string, () => string[]>; scopeRestore?: Map<string, string[]> };

export function matchRoute(route: NativeRoute, pathname: string): Record<string, string> | null {
  const names: string[] = [];
  const pattern = route.path.split("/").filter(Boolean).map((part) => {
    const optional = /^\[\[([^\]]+)\]\]$/.exec(part);
    const parameter = /^\[([^\]]+)\]$/.exec(part);
    if (optional || parameter) {
      const name = (optional ?? parameter)?.[1] ?? "";
      names.push(name.replace(/^\.\.\./, "").split("=")[0]);
      return optional ? "(?:/([^/]+))?" : name.startsWith("...") ? "/(.*)" : "/([^/]+)";
    }
    return `/${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
  }).join("");
  const match = new RegExp(`^${pattern || "/"}/?$`).exec(pathname);
  if (!match) return null;
  try {
    return Object.fromEntries(names.flatMap((name, index) => match[index + 1] === undefined ? [] : [[name, decodeURIComponent(match[index + 1])]]));
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/**
 * A navigation stack over `routes`. It registers in the component context under `options.scope` (`"root"` for the
 * outermost router, unnamed for a nested one) so `useRouter(scope)` finds it from any screen below. `options.active`
 * says whether the router currently owns the back key and links; the engine's tab panes pass their selection, so only
 * the selected tab's stack answers (default: always).
 */
export function createRouter(routes: readonly NativeRoute[], initial = "/auth/login", options: RouterScopeOptions = {}) {
  const parent = getContext<object | undefined>(contextKey);
  const scope = options.scope ?? (parent ? undefined : "root");
  let nextKey = 0;
  function location(href: string, presentation?: Presentation): NativeLocation {
    const url = new SvelteURL(href, "https://native.invalid");
    for (const route of routes) {
      const params = matchRoute(route, url.pathname);
      if (params) return { key: ++nextKey, route, url, params, presentation: presentation ?? route.presentation ?? "push" };
    }
    throw new Error(`No native screen for ${url.pathname}`);
  }
  let entries = $state.raw<readonly NativeLocation[]>([location(initial)]);
  // A development remount hands the previous router's stack over, so an edit does not send the app back to its first
  // screen. The root router takes the stack the remount recorded; the root adopting it also collects what the named
  // routers had, and each of them takes its own the first time it is created (a tab pane mounts on first selection).
  const hot: ScopedHmrState = hmrState();
  hot.scopes ??= new SvelteMap();
  hot.scopeRestore ??= new SvelteMap();
  const { scopes, scopeRestore } = hot as Required<ScopedHmrState>;
  let restored: string[] | undefined;
  if (scope === "root") {
    restored = hot.restore;
    hot.restore = undefined;
    if (restored) for (const [name, stack] of scopes) scopeRestore.set(name, stack());
  } else if (scope !== undefined) {
    restored = scopeRestore.get(scope);
    scopeRestore.delete(scope);
  }
  if (restored?.length) {
    try { entries = restored.map((href) => location(href)); } catch { /* a route that no longer exists: keep the initial screen */ }
  }
  const snapshot = () => entries.map((entry) => `${entry.url.pathname}${entry.url.search}${entry.url.hash}`);
  if (scope === "root") hot.stack = snapshot;
  else if (scope !== undefined) scopes.set(scope, snapshot);
  // A route's modules load when the route is first needed: the stack's routes right away, any other on its first
  // navigation. A screen shows its `loading` snippet until they arrive, and rethrows a failed load where it renders.
  const slots = new SvelteMap<string, { pending: true } | { modules: RouteModules } | { error: unknown }>();
  function load(route: NativeRoute): void {
    const slot = slots.get(route.id);
    if (slot && !("error" in slot)) return;
    const pending = route.load(); // a route whose load failed tries again on its next navigation
    slots.set(route.id, { pending: true });
    pending.then((modules) => slots.set(route.id, { modules }), (error: unknown) => slots.set(route.id, { error }));
  }
  for (const entry of entries) load(entry.route);
  const active = options.active ?? (() => true);
  const router = {
    scope,
    /** Whether another router is above this one (a tab's or a sheet's own stack): only the outermost router takes links. */
    nested: parent !== undefined,
    /** Whether this router currently answers the back key and links (a tab's router while its tab is selected). */
    active,
    get entries() { return entries; },
    get current() { return entries[entries.length - 1]; },
    /** The route's page and layouts once loaded, `undefined` while loading; throws what a failed load threw. */
    modules(route: NativeRoute): RouteModules | undefined {
      const slot = slots.get(route.id);
      if (slot && "error" in slot) throw slot.error;
      return slot && "modules" in slot ? slot.modules : undefined;
    },
    goto(href: string, navigation: NavigateOptions = {}) {
      const next = location(href, navigation.presentation);
      if (next.url.href === router.current.url.href && !navigation.reset) return;
      load(next.route);
      entries = navigation.reset ? [next] : navigation.replaceState ? [...entries.slice(0, -1), next] : [...entries, next];
    },
    back(): boolean {
      if (entries.length < 2) return false;
      entries = entries.slice(0, -1);
      return true;
    },
    replaceBase(href: string): void {
      const base = location(href);
      load(base.route);
      entries = [base, ...entries.slice(1)];
    },
    openURL(href: string): boolean {
      const url = URL.parse(href);
      if (!url || url.hostname === "expo-development-client") return false;
      const path = url.protocol === "https:" || url.protocol === "http:"
        ? url.pathname : `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}`;
      if (!routes.some((route) => matchRoute(route, path))) return false;
      router.goto(`${path}${url.search}${url.hash}`);
      return true;
    },
    dismissed(key: number): void {
      const index = entries.findIndex((entry) => entry.key === key);
      if (index > 0) entries = entries.slice(0, index);
    },
  };
  setContext(contextKey, { router, scope, parent });
  return router;
}

/** The nearest router, or with `scope` the nearest one above that was created with that name (`"root"` is the outermost). */
export function useRouter(scope?: string) {
  let entry = getContext<RouterContext | undefined>(contextKey);
  if (!entry) throw new Error("Native router is missing above this screen");
  if (scope === undefined) return entry.router;
  while (entry && entry.scope !== scope) entry = entry.parent;
  if (!entry) throw new Error(`No native router named "${scope}" above this screen`);
  return entry.router;
}
