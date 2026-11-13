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
export type ClassProps = {
    class?: ClassValue;
};
/**
 * Turns a class list (never empty) into a React Native style, or `undefined` for none. `style` is the element's own style, whose font size its font-relative values are made from.
 * `defer` leaves them in the result as a `fontRelative` key instead (the lowered HTML elements, whose font size is the one they inherit: the host works them out, `fabric/text-inherit.ts`).
 */
export type ClassResolver = (className: string, style?: unknown, defer?: boolean) => unknown;
/** Registers the resolver every component's `class` goes through; `undefined` removes it. One at a time: the last one registered is used. */
export declare function setClassResolver(next: ClassResolver | undefined): void;
/** A class value as one space-separated string, the way Svelte joins `class` on a DOM element (clsx: a falsy value, `0` included, adds nothing). */
export declare function classList(value: unknown): string;
/**
 * `props` with the style of its `class` under its `style`, and no `class`: for a component that reads its `style` before the host does
 * (a safe area's padding, expo-image's resize mode). Call it where the component's template or a `$derived` tracks it.
 */
export declare function mergeClass<T extends Record<string, unknown>>(props: T): Omit<T, "class">;
/**
 * The style of a component's `class`, or `undefined` when it has none or no resolver is registered (with a warning, once, in development). `style` is the
 * element's own style: a `leading-none` is made from the font size it sets (not one the element inherits from a parent `Text`).
 */
export declare function classStyle(value: unknown, style?: unknown, defer?: boolean): unknown;
export {};
