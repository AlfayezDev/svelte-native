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

type Registration = { ref: WeakRef<object>; held: unknown; cleanup: (held: unknown) => void; done: boolean; tokens: object[] };
const registrations = new Set<Registration>();
const registrationOf = new WeakMap<object, Registration>();
const tokenHolds = new WeakMap<object, Set<Registration>>();
/** How often the registry looks for targets the engine has collected. */
export const SWEEP_MS = 3000;
let sweeper: ReturnType<typeof setTimeout> | undefined;

function finalize(registration: Registration): void {
  if (registration.done) return;
  registration.done = true;
  registrations.delete(registration);
  try {
    registration.cleanup(registration.held);
  } catch (error) {
    console.error(error);
  }
}

/** Calls the cleanup of every registered target the engine has collected. */
export function sweepRegistry(): void {
  for (const registration of [...registrations]) if (registration.ref.deref() === undefined) finalize(registration);
}

function keepSweeping(): void {
  if (sweeper !== undefined) return;
  sweeper = setTimeout(function sweep() {
    sweeper = undefined;
    sweepRegistry();
    if (registrations.size > 0) sweeper = setTimeout(sweep, SWEEP_MS);
  }, SWEEP_MS);
}

/**
 * `FinalizationRegistry` for an engine without one (React Native 0.86's Hermes, 0.17): a registry that looks, every few seconds, for targets its
 * `WeakRef`s lost, and `releaseNow`, which SvelteKit's own cannot offer. SvelteKit's query cache lives on `FinalizationRegistry`: an entry is evicted,
 * and a live query's stream closed, when the last query object that uses it is collected.
 */
class SweptFinalizationRegistry {
  readonly #cleanup: (held: unknown) => void;
  constructor(cleanup: (held: unknown) => void) {
    if (typeof cleanup !== "function") throw new TypeError("FinalizationRegistry cleanup callback must be callable");
    this.#cleanup = cleanup;
  }
  register(target: object, held: unknown, token?: object): void {
    const registration: Registration = { ref: new WeakRef(target), held, cleanup: this.#cleanup, done: false, tokens: token ? [token] : [] };
    registrations.add(registration);
    registrationOf.set(target, registration);
    if (token) {
      const held = tokenHolds.get(token) ?? new Set<Registration>();
      held.add(registration);
      tokenHolds.set(token, held);
    }
    keepSweeping();
  }
  unregister(token: object): boolean {
    const held = tokenHolds.get(token);
    if (!held) return false;
    for (const registration of held) {
      registration.done = true;
      registrations.delete(registration);
    }
    tokenHolds.delete(token);
    return true;
  }
}

/**
 * Runs the cleanup registered for `target` now, as if the engine had collected it, once. `false` when `target` is not in this package's registry: the
 * engine has a `FinalizationRegistry` of its own (it cannot be told to), or the target was never registered or was released before.
 */
export function releaseNow(target: object): boolean {
  const registration = registrationOf.get(target);
  if (!registration || registration.done) return false;
  finalize(registration);
  return true;
}

/** Installs a fallback for each of these the engine does not define. A `WeakRef` that holds strongly only keeps what it points to from being collected. */
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
  if (typeof target.FinalizationRegistry !== "function") target.FinalizationRegistry = SweptFinalizationRegistry;
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
