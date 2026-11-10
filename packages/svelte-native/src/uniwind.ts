// An app's type check reaches this file through the package's exports and sees no other file of the library's, so the declarations of
// Uniwind's unexported modules are referenced here.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./uniwind-internal.d.ts" />
/**
 * Tailwind classes through Uniwind (https://uniwind.dev): import this module once, in the root layout, with the app's CSS file,
 * and `class` on every component becomes a React Native style.
 *
 *   import "@example/svelte-native/uniwind";
 *   import "../global.css";
 *
 * Uniwind compiles the CSS file (Tailwind's utilities, your own classes, themes and variables) at build time; `withSvelteNative`'s
 * `uniwind` option sets that up in Metro. Its React components and hooks are not used: this module asks Uniwind's style store for the
 * style of a class list, and tracks what that style depends on (the color scheme, the theme, the window, the insets, the font scale),
 * so a component whose classes have `dark:`, `md:`, `pt-safe` or a theme variable updates when that changes.
 */
import { createSubscriber } from "svelte/reactivity";
// Uniwind's config object, style store and change notifier are not in its package's exports: `withSvelteNative` resolves these paths to
// the files of the app's `uniwind` (metro.ts), the same modules its CSS file's code initialises.
import { Uniwind } from "uniwind/src/core/config";
import { UniwindListener } from "uniwind/src/core/listener";
import { UniwindStore } from "uniwind/src/core/native";
import { setClassResolver } from "./classes.ts";
import { subscribeInsets } from "./fabric/insets.ts";

/** Uniwind's `ScopedTheme` and `ScopedVariables` are React context; outside them its context is this. */
const context = { scopedTheme: null, rtl: null, variables: null };

/** `StyleDependency.Theme`: in development every recompile of the CSS file notifies all dependencies, this one included. */
const THEME = 2;
/** `StyleDependency.Insets`: the safe-area utilities (`pt-safe`, `h-screen-safe`, ...). */
const INSETS = 5;

// Uniwind reads the safe-area insets from its runtime, which its React `SafeAreaListener` keeps up to date; here the engine's insets
// events do, with the values the `insets` store has. Without the engine module (it is not linked yet) the next style that needs them
// tries again.
let insetsConnected = false;
let lastInsets = "";
function connectInsets(): void {
  if (insetsConnected) return;
  insetsConnected = subscribeInsets(({ top, right, bottom, left }) => {
    const key = `${top} ${right} ${bottom} ${left}`;
    if (key === lastInsets) return;
    lastInsets = key;
    Uniwind.updateInsets({ top, right, bottom, left });
  }) !== null;
}
connectInsets();

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
  if (dependencies.includes(INSETS)) connectInsets();
  // A style with no dependency is fixed for this CSS, which development recompiles on every save.
  if (dev() && !dependencies.includes(THEME)) track(THEME);
  return styles;
});
