/**
 * What SvelteKit's client files expect of the JavaScript environment, and fallbacks for what Hermes may lack. Importing the module installs the
 * fallbacks (only for names the engine does not define); `missingGlobals` names what cannot be made up.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** `btoa` for a string of characters up to U+00FF (`stringify_remote_arg` encodes the payload of every call that has an argument). */
export function base64Encode(binary: string): string {
  let out = "";
  for (let index = 0; index < binary.length; index += 3) {
    const a = binary.charCodeAt(index);
    const b = binary.charCodeAt(index + 1);
    const c = binary.charCodeAt(index + 2);
    if (a > 255 || b > 255 || c > 255) throw new Error("The string to be encoded contains characters outside of the Latin1 range.");
    const triple = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    out += index + 1 < binary.length ? ALPHABET[(triple >> 6) & 63] : "=";
    out += index + 2 < binary.length ? ALPHABET[triple & 63] : "=";
  }
  return out;
}

/** `atob`. */
export function base64Decode(encoded: string): string {
  const clean = encoded.replace(/[\t\n\f\r ]/g, "").replace(/={1,2}$/, "");
  if (clean.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(clean)) throw new Error("The string to be decoded is not correctly encoded.");
  let out = "";
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    value = (value << 6) | ALPHABET.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 255);
    }
  }
  return out;
}

/** Installs a fallback for each of these the engine does not define. A `WeakRef` that holds strongly and a `FinalizationRegistry` that never calls back only keep SvelteKit's query cache from freeing an entry. */
export function installEnvironment(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
  if (typeof target.btoa !== "function") target.btoa = base64Encode;
  if (typeof target.atob !== "function") target.atob = base64Decode;
  if (typeof target.WeakRef !== "function") {
    target.WeakRef = class<T extends object> {
      #target: T;
      constructor(value: T) { this.#target = value; }
      deref(): T { return this.#target; }
    };
  }
  if (typeof target.FinalizationRegistry !== "function") {
    target.FinalizationRegistry = class {
      register(): void {}
      unregister(): boolean { return false; }
    };
  }
}

const REQUIRED = ["ReadableStream", "TextEncoder", "TextDecoder", "AbortController", "Headers", "URL", "URLSearchParams"] as const;

/** The globals remote functions need that this runtime does not define. */
export function missingGlobals(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): string[] {
  return REQUIRED.filter((name) => typeof target[name] === "undefined");
}

/** Throws, naming each missing global, when the environment cannot run SvelteKit's client files. */
export function assertEnvironment(): void {
  const missing = missingGlobals();
  if (missing.length > 0) throw new Error(`Remote functions need ${missing.join(", ")}, which this JavaScript environment does not define. Expo SDK 57 installs them (expo/src/winter, and the streams polyfill Expo's Metro adds); check that the app runs through Expo's Metro config.`);
}

installEnvironment();
