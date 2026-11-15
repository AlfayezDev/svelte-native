import type { Payload, ViewConfig } from "../../src/fabric/view-configs.ts";

/**
 * Stands in for `src/fabric/view-configs.ts` in bundles that test the host's own behaviour (navigation, screens) and want
 * to read the props a node was given rather than the encoded payload: every prop passes through as it is, an update
 * carries the keys whose value differs by identity, and the events are the few the fixtures emit.
 */
const events = new Map([["topChange", "onChange"], ["topLayout", "onLayout"], ["topScroll", "onScroll"], ["topDismiss", "onDismiss"]]);
const config: ViewConfig = { attributes: {}, events, foreign: false };

export const viewConfigFor = (): ViewConfig => config;
export const createPayload = (props: Record<string, unknown>): Payload => ({ ...props });
export function diffPayload(previous: Record<string, unknown>, next: Record<string, unknown>): Payload | null {
  const payload: Payload = {};
  let changed = false;
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (previous[key] !== next[key]) { payload[key] = key in next ? next[key] : null; changed = true; }
  }
  return changed ? payload : null;
}

// The main entry exports the SVG components, whose host modules define their view kinds and convert colours at import time; these bundles mount none of them.
export const defineViewKind = (): void => {};
export const processColorValue = (color: unknown): unknown => color;
