/**
 * `class` on a component. Svelte Native has no CSS engine of its own: a class resolver turns a class list into a React Native
 * style, and an integration registers one (`@example/svelte-native/uniwind`, Tailwind through Uniwind). The style of the classes
 * goes under the component's own `style`, so an inline style wins, as it does over a stylesheet on the web.
 *
 * The resolver runs while a component works out its props, inside its template, so a resolver that reads Svelte state (the theme,
 * the window size, the color scheme) makes the component update when that changes.
 */

/** What `class` takes, as on a DOM element in Svelte: a string, or arrays and objects of class names (clsx). */
export type ClassValue = string | number | bigint | boolean | null | undefined | ClassDictionary | ClassValue[];
type ClassDictionary = Record<string, unknown>;

/** The `class` prop of every component (`ClassValue`); see this module. */
export type ClassProps = { class?: ClassValue };

/** The state of the component the classes are for, for variants such as `disabled:`. */
export type ClassState = { disabled: boolean };

/** Turns a class list (never empty) into a React Native style, or `undefined` for none. */
export type ClassResolver = (className: string, props: Readonly<Record<string, unknown>>, state: ClassState) => unknown;

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

/** The style of a component's `class`, or `undefined` when it has none or no resolver is registered (with a warning, once, in development). */
export function classStyle(value: unknown, props: Readonly<Record<string, unknown>>): unknown {
  const className = classList(value);
  if (className === "") return undefined;
  if (resolver === undefined) {
    if (dev() && !warned) {
      warned = true;
      console.warn(`svelte-native: class="${className}" has no effect: no class resolver is registered. Import "@example/svelte-native/uniwind" and your CSS file in the root layout (docs: styling#classes).`);
    }
    return undefined;
  }
  return resolver(className, props, { disabled: props.disabled === true });
}
