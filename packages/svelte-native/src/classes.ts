/**
 * `class` on a component. Svelte Native has no CSS engine at run time: the app's CSS file is compiled when Metro starts (the `css` option of
 * `withSvelteNative`; Tailwind 4 and the converter in `css/`) into a table of its classes as React Native styles, and a class list is looked up in
 * it (`css/runtime.ts`). The style of the classes goes under the component's own `style`, so an inline style wins, as it does over a stylesheet on the web.
 *
 * The lookup runs while a component works out its props, inside its template, so a class that depends on the color scheme or the window size
 * makes the component update when that changes.
 *
 * This module only holds the resolver: the Fabric entry (`fabric/index.ts`) registers the default one (`css/load-table.ts`), so the components, the renderer and what they import
 * do not depend on React Native's platform modules, which a test or a tool that loads them outside an app has no stand-in for.
 */

/** What `class` takes, as on a DOM element in Svelte: a string, or arrays and objects of class names (clsx). */
export type ClassValue = string | number | bigint | boolean | null | undefined | ClassDictionary | ClassValue[];
type ClassDictionary = Record<string, unknown>;

/** The `class` prop of every component (`ClassValue`); see this module. */
export type ClassProps = { class?: ClassValue };

/** Turns a class list (never empty) into a React Native style, or `undefined` for none. `style` is the element's own style, whose font size its font-relative values are made from. */
export type ClassResolver = (className: string, style?: unknown) => unknown;

let resolver: ClassResolver | undefined;
let warned = false;

const dev = () => typeof __DEV__ !== "undefined" && __DEV__;

/** Registers the resolver every component's `class` goes through; `undefined` removes it. One at a time: the last one registered is used. */
export function setClassResolver(next: ClassResolver | undefined): void {
  resolver = next;
  warned = false;
}

/** A class value as one space-separated string, the way Svelte joins `class` on a DOM element (clsx: a falsy value, `0` included, adds nothing). */
export function classList(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    let joined = "";
    for (const item of value) {
      const part = classList(item);
      if (part !== "") joined = joined === "" ? part : `${joined} ${part}`;
    }
    return joined;
  }
  if (value !== null && typeof value === "object") {
    let joined = "";
    for (const key in value as ClassDictionary) if ((value as ClassDictionary)[key]) joined = joined === "" ? key : `${joined} ${key}`;
    return joined;
  }
  return "";
}

/**
 * `props` with the style of its `class` under its `style`, and no `class`: for a component that reads its `style` before the host does
 * (a safe area's padding, expo-image's resize mode). Call it where the component's template or a `$derived` tracks it.
 */
export function mergeClass<T extends Record<string, unknown>>(props: T): Omit<T, "class"> {
  if (!("class" in props)) return props;
  const { class: value, ...rest } = props;
  const fromClass = classStyle(value, rest.style);
  if (fromClass === undefined) return rest;
  return { ...rest, style: rest.style === undefined || rest.style === null ? fromClass : [fromClass, rest.style] };
}

/**
 * The style of a component's `class`, or `undefined` when it has none or no resolver is registered (with a warning, once, in development). `style` is the
 * element's own style: a `leading-none` is made from the font size it sets (not one the element inherits from a parent `Text`).
 */
export function classStyle(value: unknown, style?: unknown): unknown {
  const className = classList(value);
  if (className === "") return undefined;
  if (resolver === undefined) {
    if (dev() && !warned) {
      warned = true;
      console.warn(`svelte-native: class="${className}" has no effect: no class table is loaded. The app's entry loads it through "@example/svelte-native/fabric" (docs: styling#classes).`);
    }
    return undefined;
  }
  return resolver(className, style);
}
