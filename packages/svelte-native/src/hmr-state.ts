import type { Component } from "svelte";
import type { Presentation } from "./fabric/navigation.ts";

/** One stack of a router as it is kept across a hot update, a recreated Activity or a restarted process: its entries bottom first, each with the state of the navigator it is the screen of. */
export type StackSnapshot = {
  entries: {
    /** The id of the route the entry shows (a page, or a navigator); restore finds it by this and falls back to the href, so a snapshot without it still restores. */
    route?: string;
    href: string;
    presentation: Presentation;
    /** The nested stack's entries (a stack navigator's screen). */
    stack?: StackSnapshot;
    /** The selected pane and every pane's stack (a tabs navigator's screen). */
    tabs?: { selected: string; panes: Record<string, StackSnapshot> };
  }[];
};

/**
 * What the root router leaves for the one that replaces it: every stack and tabs selection, and the launch link the app has
 * already acted on (a router that adopts the state does not open the same link again: see `openLaunchURL` in the router).
 */
export type NavigationState = { stack: StackSnapshot; launch?: string };

/**
 * State that outlives a surface. Metro re-runs the modules on the path from an edited file to the entry, so anything held in
 * those modules' own variables is lost; a recreated Android Activity stops its surface and starts another in the same JavaScript
 * runtime. This lives on `globalThis` instead, and the next root router adopts the navigation state left in it.
 */
export type HmrState = {
  /** The root component and props the latest evaluation of the entry registered. */
  app?: { App: Component<Record<string, unknown>>; props: Record<string, unknown> };
  /** Running surfaces: root tag to the `initialProps` it was started with. */
  surfaces: Map<number, Record<string, unknown> | undefined>;
  /** The live root router's navigation state (every stack and tabs selection of its tree); replaced by each `createRouter`. */
  navigation?: () => NavigationState;
  /** Navigation state to adopt in the next root `createRouter` call: set when surfaces are remounted and whenever the last surface stops, taken by the router that adopts it. */
  restore?: NavigationState;
  /** Where the root router writes its state as JSON after every change (the host sets it; Android keeps it for the Activity's saved instance state, iOS writes it to a file when the app goes to the background, see SPEC.md "Navigation state across recreation and process death"). */
  save?: (json: string) => void;
  /** The named routers outside the root's tree (a tab pane's own router in the lab) by scope: the live state of each, and what the root adopting `restore` collected for them. */
  scopes?: Map<string, () => StackSnapshot>;
  scopeRestore?: Map<string, StackSnapshot>;
};

export function hmrState(): HmrState {
  const scope = globalThis as { __svelteNativeHmrState?: HmrState };
  scope.__svelteNativeHmrState ??= { surfaces: new Map() };
  return scope.__svelteNativeHmrState;
}

/**
 * The navigation state a previous process left (`initialProps.navigation`, the JSON the router wrote through `save`; on iOS `launchSurface` puts the
 * host's record there after judging its age, `freshNavigation`). Anything
 * that is not such a state is ignored; a state of routes that no longer exist is dropped when the router restores it.
 */
export function parseNavigation(value: unknown): NavigationState | undefined {
  if (typeof value !== "string") return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return undefined; }
  const { stack, launch } = (parsed && typeof parsed === "object" ? parsed : {}) as { stack?: { entries?: unknown }; launch?: unknown };
  if (!Array.isArray(stack?.entries)) return undefined;
  return { stack: stack as StackSnapshot, ...(typeof launch === "string" ? { launch } : {}) };
}
