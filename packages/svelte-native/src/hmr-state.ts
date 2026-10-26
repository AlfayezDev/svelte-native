import type { Component } from "svelte";

/**
 * Development-loop state that must outlive a hot update. Metro re-runs the modules on the path from an edited file to
 * the entry, so anything held in those modules' own variables is lost; this lives on `globalThis` instead.
 */
export type HmrState = {
  /** The root component and props the latest evaluation of the entry registered. */
  app?: { App: Component<Record<string, unknown>>; props: Record<string, unknown> };
  /** Running surfaces: root tag to the `initialProps` it was started with. */
  surfaces: Map<number, Record<string, unknown> | undefined>;
  /** The live router's navigation stack as hrefs (the base entry first); replaced by each `createRouter`. */
  stack?: () => string[];
  /** A navigation stack to adopt in the next `createRouter` call; set only while surfaces are being remounted. */
  restore?: string[];
};

export function hmrState(): HmrState {
  const scope = globalThis as { __svelteNativeHmrState?: HmrState };
  scope.__svelteNativeHmrState ??= { surfaces: new Map() };
  return scope.__svelteNativeHmrState;
}
