// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- a script of `declare module`s: it cannot be imported, only referenced
/// <reference path="./fabric/react-native-internals.d.ts" />
import { mark } from "./boot-marks.ts";
// Expo's WinterCG runtime: a standard `URL` and `URLSearchParams` (and `fetch`, `TextDecoder`, ...) as globals. React Native's own `URL` takes
// only a string and lacks most of the standard, and the router builds every location as a `SvelteURL` (`new URL(url)` of a `URL`), so an app
// that never loaded Expo's runtime itself started with `TypeError: undefined is not a function` and a blank screen (the showcase, 9 Nov 2026).
// `expo` is a required peer and has no `exports` map; Metro picks `runtime.native.ts` on a device.
import "expo/src/winter";
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
mark("polyfills");
