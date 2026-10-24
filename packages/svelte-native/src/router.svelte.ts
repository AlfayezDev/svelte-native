import { getContext, setContext } from "svelte";
import type { Component } from "svelte";
import { SvelteURL } from "svelte/reactivity";

export type NativeRoute = {
  id: string;
  path: string;
  component: Component;
  layouts: Component[];
  presentation?: "push" | "modal";
};
export type NativeLocation = {
  key: number;
  route: NativeRoute;
  url: URL;
  params: Record<string, string>;
};
const contextKey = Symbol("svelte-native-router");

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

export function createRouter(routes: readonly NativeRoute[], initial = "/auth/login") {
  let nextKey = 0;
  function location(href: string): NativeLocation {
    const url = new SvelteURL(href, "https://native.invalid");
    for (const route of routes) {
      const params = matchRoute(route, url.pathname);
      if (params) return { key: ++nextKey, route, url, params };
    }
    throw new Error(`No native screen for ${url.pathname}`);
  }
  let entries = $state.raw<readonly NativeLocation[]>([location(initial)]);
  const router = {
    get entries() { return entries; },
    get current() { return entries[entries.length - 1]; },
    goto(href: string, options: { replaceState?: boolean; reset?: boolean } = {}) {
      const next = location(href);
      if (next.url.href === router.current.url.href && !options.reset) return;
      entries = options.reset ? [next] : options.replaceState ? [...entries.slice(0, -1), next] : [...entries, next];
    },
    back(): boolean {
      if (entries.length < 2) return false;
      entries = entries.slice(0, -1);
      return true;
    },
    replaceBase(href: string): void {
      entries = [location(href), ...entries.slice(1)];
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
  setContext(contextKey, router);
  return router;
}

export function useRouter() {
  const router = getContext<ReturnType<typeof createRouter>>(contextKey);
  if (!router) throw new Error("Native router is missing above this screen");
  return router;
}
