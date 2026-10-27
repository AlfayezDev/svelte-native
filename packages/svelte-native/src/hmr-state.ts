import type { Component } from "svelte";
import type { Presentation } from "./fabric/navigation.ts";

/** One stack of a router as hot reload keeps it: its entries bottom first, each with the state of the navigator it is the screen of. */
export type StackSnapshot = {
  entries: {
    href: string;
    presentation: Presentation;
    /** The nested stack's entries (a stack navigator's screen). */
    stack?: StackSnapshot;
    /** The selected pane and every pane's stack (a tabs navigator's screen). */
    tabs?: { selected: string; panes: Record<string, StackSnapshot> };
  }[];
};

/**
 * Development-loop state that must outlive a hot update. Metro re-runs the modules on the path from an edited file to
 * the entry, so anything held in those modules' own variables is lost; this lives on `globalThis` instead.
 */
export type HmrState = {
  /** The root component and props the latest evaluation of the entry registered. */
  app?: { App: Component<Record<string, unknown>>; props: Record<string, unknown> };
  /** Running surfaces: root tag to the `initialProps` it was started with. */
  surfaces: Map<number, Record<string, unknown> | undefined>;
  /** The live root router's navigation state (every stack and tabs selection of its tree); replaced by each `createRouter`. */
  navigation?: () => StackSnapshot;
  /** Navigation state to adopt in the next root `createRouter` call; set only while surfaces are being remounted. */
  restore?: StackSnapshot;
  /** The named routers outside the root's tree (a tab pane's own router in the lab) by scope: the live state of each, and what the root adopting `restore` collected for them. */
  scopes?: Map<string, () => StackSnapshot>;
  scopeRestore?: Map<string, StackSnapshot>;
};

export function hmrState(): HmrState {
  const scope = globalThis as { __svelteNativeHmrState?: HmrState };
  scope.__svelteNativeHmrState ??= { surfaces: new Map() };
  return scope.__svelteNativeHmrState;
}
