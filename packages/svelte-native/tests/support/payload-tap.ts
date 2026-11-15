import * as real from "../../src/fabric/view-configs.ts";
import type { Payload, Platform, ViewConfig } from "../../src/fabric/view-configs.ts";
import type { Reference } from "../rn-reference.ts";

/**
 * Stands in for `src/fabric/view-configs.ts` in a fixture bundle. It runs the real static view configs and, for every
 * payload the host builds, also asks React Native's own registry and attribute payload code (set on
 * `globalThis.__payloadTap` by the test) for the same payload and records both as JSON, so a test can require that the
 * two are identical, key order included.
 */
export type PayloadCheck = { kind: "create" | "diff"; view: string; mine: string; reactNative: string };
export type PayloadTap = { reference: Pick<Reference, "get" | "create" | "diff">; checks: PayloadCheck[] };
const tap = () => (globalThis as { __payloadTap?: PayloadTap }).__payloadTap;
const names = new WeakMap<ViewConfig, string>();
const json = (value: unknown) => JSON.stringify(value) ?? "undefined";

export function viewConfigFor(name: string, platform: Platform): ViewConfig {
  const config = real.viewConfigFor(name, platform);
  names.set(config, name);
  return config;
}

export function createPayload(props: Record<string, unknown>, config: ViewConfig): Payload | null {
  const mine = real.createPayload(props, config);
  const compare = tap();
  const view = names.get(config) ?? "";
  if (compare) compare.checks.push({ kind: "create", view, mine: json(mine), reactNative: json(compare.reference.create(props, compare.reference.get(view).validAttributes)) });
  return mine;
}

export function diffPayload(previous: Record<string, unknown>, next: Record<string, unknown>, config: ViewConfig): Payload | null {
  const mine = real.diffPayload(previous, next, config);
  const compare = tap();
  const view = names.get(config) ?? "";
  if (compare) compare.checks.push({ kind: "diff", view, mine: json(mine), reactNative: json(compare.reference.diff(previous, next, compare.reference.get(view).validAttributes)) });
  return mine;
}
