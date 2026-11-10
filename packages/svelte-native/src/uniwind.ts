// An app's type check reaches this file through the package's exports and sees no other file of the library's, so the declarations of
// Uniwind's two unexported modules are referenced here.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./uniwind-internal.d.ts" />
/**
 * Tailwind classes through Uniwind (https://uniwind.dev): import this module once, in the root layout, with the app's CSS file,
 * and `class` on every component becomes a React Native style.
 *
 *   import "@rasheed/svelte-native/uniwind";
 *   import "../global.css";
 *
 * Uniwind compiles the CSS file (Tailwind's utilities, your own classes, themes and variables) at build time; `withSvelteNative`'s
 * `uniwind` option sets that up in Metro. Its React components and hooks are not used: this module asks Uniwind's style store for the
 * style of a class list, and tracks what that style depends on (the color scheme, the theme, the window, the insets, the font scale),
 * so a component whose classes have `dark:`, `md:` or a theme variable updates when that changes.
 */
import { createSubscriber } from "svelte/reactivity";
// Uniwind's style store and change notifier are not in its package's exports: `withSvelteNative` resolves these two paths to the files
// of the installed `uniwind` (`uniwindInternal` in metro.ts), the same modules its CSS file's code initialises.
import { UniwindListener } from "uniwind/src/core/listener";
import { UniwindStore } from "uniwind/src/core/native";
import { setClassResolver } from "./classes.ts";

/** Uniwind's `ScopedTheme` and `ScopedVariables` are React context; outside them its context is this. */
const context = { scopedTheme: null, rtl: null, variables: null };

/** `StyleDependency.Theme`: in development every recompile of the CSS file notifies all dependencies, this one included. */
const THEME = 2;

const dev = () => typeof __DEV__ !== "undefined" && __DEV__;

const subscribers = new Map<number, () => void>();
function track(dependency: number): void {
  let subscribe = subscribers.get(dependency);
  if (subscribe === undefined) {
    subscribe = createSubscriber((update) => UniwindListener.subscribe(update, [dependency]));
    subscribers.set(dependency, subscribe);
  }
  subscribe();
}

setClassResolver((className, props, state) => {
  const { styles, dependencies } = UniwindStore.getStyles(className, props, { isDisabled: state.disabled }, context);
  for (const dependency of dependencies) track(dependency);
  // A style with no dependency is fixed for this CSS, which development recompiles on every save.
  if (dev() && !dependencies.includes(THEME)) track(THEME);
  return styles;
});
