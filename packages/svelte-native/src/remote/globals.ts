/**
 * The globals SvelteKit's client files use, as this package gives them to those files only (the Metro transformer adds an import of
 * these names to each of them; nothing is installed on the global object). See `transform.ts`, `kitGlobalsImport`.
 */
import AppState from "react-native/Libraries/AppState/AppState";
import { fetch as expoFetch } from "expo/fetch";
import { requireOrigin, transportOptions } from "./config.ts";
import { currentUrl } from "./link.ts";
import "./environment.ts";

/** Vite defines this for SvelteKit's client files; only `prerender` reads it, to name its Cache API cache. */
export const __SVELTEKIT_DEV__ = false;

const BODYLESS = new Set(["GET", "HEAD"]);

/**
 * `fetch` for the SvelteKit server: a path is made absolute on the configured origin; cookies are the platform's (`credentials: "include"`:
 * on Android the cookie jar React Native's networking and the WebView share, on iOS `HTTPCookieStorage`); and a request that is not a GET
 * carries `Origin: <the configured origin>`, which is what SvelteKit's remote function CSRF check compares with the origin it serves
 * (`is_remote_forbidden`, `src/runtime/server/csrf.js`). Expo's `fetch` is the one that streams a response body on both platforms (`query.live`).
 * Throws `RemoteConfigError` when no origin is configured.
 */
export function fetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const origin = requireOrigin();
  const href = typeof input === "string" ? input : input.href;
  const url = href.startsWith("/") ? origin + href : href;
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!BODYLESS.has(method) && !headers.has("origin") && (url === origin || url.startsWith(`${origin}/`))) headers.set("origin", origin);
  const send = (transportOptions().fetch ?? expoFetch) as typeof globalThis.fetch;
  return send(url, { credentials: "include", ...init, headers });
}

/** `location` of the screen on top: SvelteKit's remote functions send its path and query so `getRequestEvent().url` on the server is the screen. */
export const location = {
  get href() { return currentUrl().href; },
  get origin() { return currentUrl().origin; },
  get pathname() { return currentUrl().pathname; },
  get search() { return currentUrl().search; },
  get hash() { return currentUrl().hash; },
  toString() { return currentUrl().href; },
};

/** A phone has a network or an error to say it does not; a live query keeps retrying (the browser's `navigator.onLine` is the only thing it reads). */
export const navigator = { onLine: true };

type Listener = (event: { type: string; persisted?: boolean }) => void;
const listeners = new Map<string, Set<Listener>>();
let subscription: { remove(): void } | undefined;

function emit(type: string, event: { persisted?: boolean } = {}): void {
  for (const listener of [...(listeners.get(type) ?? [])]) listener({ type, ...event });
}

/**
 * The page lifecycle live queries listen for, from the app's: `pagehide` when the app goes to the background (the stream is closed and
 * not retried), `pageshow` with `persisted` when it comes back (the stream is reconnected, as for a page restored from the back/forward cache).
 */
export const window = {
  addEventListener(type: string, listener: Listener): void {
    let set = listeners.get(type);
    if (!set) {
      set = new Set();
      listeners.set(type, set);
    }
    set.add(listener);
    subscription ??= AppState.addEventListener("change", (state) => {
      if (state === "background") emit("pagehide");
      else if (state === "active") emit("pageshow", { persisted: true });
    });
  },
  removeEventListener(type: string, listener: Listener): void {
    listeners.get(type)?.delete(listener);
    if ([...listeners.values()].every((set) => set.size === 0)) {
      subscription?.remove();
      subscription = undefined;
    }
  },
};

/**
 * `Blob` for `serialize_binary_form` (SvelteKit's form-utils.js), which builds the body of a form submission from `Uint8Array` and string parts;
 * React Native's `Blob` refuses `ArrayBuffer` parts. This one only collects bytes, and `bytes()` is what the request sends.
 */
export class Blob {
  readonly #bytes: Uint8Array;
  constructor(parts: ReadonlyArray<Uint8Array | string> = []) {
    const encoder = new TextEncoder();
    const chunks = parts.map((part) => {
      if (typeof part === "string") return encoder.encode(part);
      if (part instanceof Uint8Array) return part;
      throw new Error("A native form can carry text, numbers and booleans; files are not supported.");
    });
    this.#bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      this.#bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  get size(): number { return this.#bytes.byteLength; }
  bytes(): Uint8Array { return this.#bytes; }
}
