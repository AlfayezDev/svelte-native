// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- a script of `declare module`s: it cannot be imported, only referenced
/// <reference path="./fabric/react-native-internals.d.ts" />
import { mark } from "./boot-marks.ts";
import "./expo-runtime.ts"; // Expo's WinterCG runtime: the standard `URL` the router needs
import "./intl.ts"; // lazy: `mark("intl")` fires on the first Intl.PluralRules/RelativeTimeFormat/ListFormat/Locale access
import { defineLazyGlobal } from "./lazy-global.ts";
import { loadLocalStorage } from "./local-storage.ts";
import { loadCrypto } from "./web-crypto.ts";
import { createStorage, memoryBackend } from "./web-storage.ts";
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
// `fetch`, `Headers`, `Request`, `Response`, `Blob`, `File`, `FileReader` and `FormData` are Svelte Native's own (`fetch/`), not Expo's `expo/fetch` and React Native's, when the app's binary has
// the native module `SvelteFetch`. Why ours replaces `expo/fetch`: one native module owns both the request and the bytes of every Blob. A response read as a Blob stays in native code (Expo's
// `fetch` reads the body into JavaScript and copies it back into React Native's Blob store, and React Native's Blob reads out only as base64 through its FileReader); a Blob is sliced, joined
// and uploaded as segments of native memory (Expo's `fetch` reads a Blob body into JavaScript before it sends it); a binary body goes to native code as bytes, never as base64; and a multipart
// body is one native Blob of strings and the files' own segments, built without copying a file through JavaScript.
// Each global is a getter that settles on the first read, so none of it is loaded, or even looked up in the module registry, while the app boots (`fetch/install.ts` decides on that first
// read; a binary without the module gets what the runtime installed above). A library that tests for `Blob`, `File` or `FormData` when it loads reads one of them then, and loads the layer
// then. This file runs on a device only: the web build never imports it.
for (const name of ["fetch", "Headers", "Request", "Response", "Blob", "File", "FileReader", "FormData"] as const) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  if (previous && !previous.configurable) continue;
  const enumerable = previous?.enumerable ?? false;
  const settle = (value: unknown): unknown => {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable });
    return value;
  };
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable,
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on the first read
    get: () => settle((require("./fetch/install.ts") as typeof import("./fetch/install.ts")).resolveGlobal(name, previous)),
    set: settle,
  });
}

// `crypto` (react-native-quick-crypto), `localStorage` (MMKV) and `sessionStorage` (memory), each made when it is first read: the boot loads neither library, starts neither Nitro module
// and creates no file. A platform or a library that has defined one of the names already keeps it.
defineLazyGlobal(globalThis, "crypto", loadCrypto);
defineLazyGlobal(globalThis, "localStorage", loadLocalStorage);
defineLazyGlobal(globalThis, "sessionStorage", () => createStorage(memoryBackend()));
mark("polyfills");
