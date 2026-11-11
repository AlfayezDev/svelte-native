/**
 * Copies attributes and styles out of Svelte's reactive proxies (the host must never read a live proxy)
 * and keeps the identity of unchanged style objects between renders, so memoised branches skip work.
 */
import { classStyle } from "./classes.ts";

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype && !("_isReanimatedSharedValue" in value);
}

function retainStyle(value: unknown, previous: unknown): unknown {
  if (Array.isArray(value)) {
    const old: unknown[] = Array.isArray(previous) ? previous : [];
    let same = old.length === value.length;
    const next: unknown[] = new Array(value.length);
    for (let index = 0; index < value.length; index++) {
      const item = retainStyle(value[index], old[index]);
      next[index] = item;
      if (same && !Object.is(item, old[index])) same = false;
    }
    return same && Array.isArray(previous) ? previous : next;
  }
  if (plainRecord(value)) {
    const old = plainRecord(previous) ? previous : {};
    const next: Record<string, unknown> = {};
    let count = 0;
    let same = plainRecord(previous);
    for (const key in value) {
      const item = retainStyle(value[key], old[key]);
      next[key] = item;
      count++;
      if (same && !Object.is(item, old[key])) same = false;
    }
    return same && count === Object.keys(old).length ? previous : next;
  }
  return value;
}

/**
 * One resolver per component instance; call it with the component's attributes on every update, in the component's template (the
 * style of `class` is worked out here, so what the class resolver reads is tracked by the template: see `classes.ts`).
 */
export function createNativeProps() {
  let previous: Record<string, unknown> | undefined;
  return (attributes: object): Record<string, unknown> => {
    const old = previous ?? {};
    const next: Record<string, unknown> = { ...attributes };
    if ("class" in next) {
      const fromClass = classStyle(next.class, next);
      delete next.class;
      if (fromClass !== undefined) next.style = next.style === undefined || next.style === null ? fromClass : [fromClass, next.style];
    }
    if ("style" in next) next.style = retainStyle(next.style, old.style);
    if (previous) {
      const keys = Object.keys(next);
      if (keys.length === Object.keys(old).length && keys.every((key) => Object.is(next[key], old[key]))) return previous;
    }
    previous = next;
    return next;
  };
}

function hidden(key: string): boolean {
  return key === "nativeProps" || key === "nativeClass" || key === "children" || key === "class" || key === "id" || key.startsWith("$$") || key.startsWith("data-");
}

/**
 * The React Native props of a host element: the legacy `nativeProps` object overlaid with every other attribute
 * (Svelte internals, `class`, `id`, `data-*` and `children` are not React Native props; the style of `class` comes as `nativeClass`).
 * `ref` stays in the result for the host to peel off. Svelte stringifies a `style` attribute on every element,
 * so a string `style` is dropped and `nativeStyle` carries a style object for the lowering preprocessor.
 */
export function mergeHostProps(attributes: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const legacy = attributes.nativeProps;
  const merged: Record<string, unknown> = legacy && typeof legacy === "object" ? { ...legacy } : {};
  for (const key in attributes) {
    if (hidden(key) || key === "nativeStyle") continue;
    const value = attributes[key];
    if (key === "style" && typeof value === "string") continue;
    if (key === "ref" && typeof value !== "function" && (value === null || typeof value !== "object")) continue;
    merged[key] = value;
  }
  if (attributes.nativeStyle !== undefined) merged.style = attributes.nativeStyle;
  // The style of a lowered tag's `class` (`hostClass`), under its own style as on a component.
  const fromClass = attributes.nativeClass;
  if (fromClass !== undefined && fromClass !== null) merged.style = merged.style === undefined || merged.style === null ? fromClass : [fromClass, merged.style];
  return merged;
}
