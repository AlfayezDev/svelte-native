// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- a script of `declare module`s: it cannot be imported, only referenced
/// <reference path="./fabric/react-native-internals.d.ts" />
import { mark } from "./boot-marks.ts";
import "./expo-runtime.ts"; // Expo's WinterCG runtime: the standard `URL` the router needs
import "./intl.ts"; // lazy: `mark("intl")` fires on the first Intl.PluralRules/RelativeTimeFormat/ListFormat/Locale access
import AppState from "react-native/Libraries/AppState/AppState";
import type { EventSubscription as NativeEventSubscription } from "react-native/Libraries/vendor/emitter/EventEmitter";

if (!("toSorted" in Array.prototype)) Object.defineProperty(Array.prototype, "toSorted", {
  value(this: unknown[], compare?: (a: unknown, b: unknown) => number) { return [...this].sort(compare); },
  writable: true,
  configurable: true,
});

// A data or query client's focus check (`window.addEventListener("focus", …)`) follows the native application's foreground lifecycle.
if (typeof window.addEventListener !== "function") {
  const subscriptions = new Map<unknown, NativeEventSubscription>();
  Object.assign(window, {
    addEventListener(type: string, listener: () => void) {
      if (type !== "focus") return;
      subscriptions.set(listener, AppState.addEventListener("change", (state) => { if (state === "active") listener(); }));
    },
    removeEventListener(_type: string, listener: () => void) {
      subscriptions.get(listener)?.remove();
      subscriptions.delete(listener);
    },
  });
}
// `window.matchMedia`, which Svelte's `MediaQuery` and `svelte/motion`'s `prefersReducedMotion` call and so does code shared with the web (React Native has none). What is installed is a function
// that loads the implementation (`match-media.ts`: the query parser and the system sources) on its first call, so the boot reads nothing from the system and loads none of it.
if (typeof window.matchMedia !== "function") {
  let implementation: typeof import("./match-media.ts") | undefined;
  Object.assign(window, {
    matchMedia(...args: [query: string]) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first call
      implementation ??= require("./match-media.ts") as typeof import("./match-media.ts");
      return implementation.matchMedia(...args);
    },
  });
}
mark("polyfills");
