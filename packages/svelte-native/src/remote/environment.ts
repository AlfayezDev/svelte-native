/**
 * What SvelteKit's client files expect of the JavaScript environment, and stand-ins for what Hermes lacks or cannot do. Nothing here is installed on
 * the global object: `globals.ts` hands these to SvelteKit's files as module-scoped names (the transformer imports them there). `missingGlobals`
 * names what cannot be made up.
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

type Registration = { ref: WeakRef<object> | undefined; held: unknown; cleanup: (held: unknown) => void; done: boolean };
type Engine = (new (cleanup: (held: unknown) => void) => { register(target: object, held: unknown, token?: object): void; unregister(token: object): boolean }) | undefined;
type Lifecycle = (listener: (state: string) => void) => { remove(): void };

// The registrations of the targets the engine has not collected, for the sweep; and every registration by its target, for `releaseNow`.
const registrations = new Set<Registration>();
const registrationOf = new WeakMap<object, Registration>();
const tokenHolds = new WeakMap<object, Set<Registration>>();
/** How often the stand-in registry looks for targets the engine has collected. */
export const SWEEP_MS = 3000;
let sweeper: ReturnType<typeof setTimeout> | undefined;
let lifecycle: Lifecycle | undefined;
let lifecycleSubscription: { remove(): void } | undefined;
let inBackground = false;

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
  for (const registration of [...registrations]) if (registration.ref?.deref() === undefined) finalize(registration);
}

/** Whether the stand-in registry has a timer waiting. */
export const sweepTimerRunning = (): boolean => sweeper !== undefined;

function stopSweeping(): void {
  if (sweeper !== undefined) clearTimeout(sweeper);
  sweeper = undefined;
}

function keepSweeping(): void {
  if (sweeper !== undefined || inBackground) return;
  sweeper = setTimeout(function sweep() {
    sweeper = undefined;
    sweepRegistry();
    if (registrations.size > 0) keepSweeping();
  }, SWEEP_MS);
}

/**
 * The app's foreground and background, for the sweep timer: it is not left running in the background (iOS keeps a timer until the app is suspended), and a
 * sweep runs when the app comes back, for what was lost meanwhile. `globals.ts` passes React Native's `AppState`; `undefined` unhooks it (tests).
 */
export function setSweepLifecycle(next: Lifecycle | undefined): void {
  lifecycleSubscription?.remove();
  lifecycleSubscription = undefined;
  lifecycle = next;
  inBackground = false;
  if (registrations.size > 0) watchLifecycle();
}

function watchLifecycle(): void {
  if (lifecycle === undefined || lifecycleSubscription !== undefined) return;
  lifecycleSubscription = lifecycle((state) => {
    if (state === "background") {
      inBackground = true;
      stopSweeping();
    } else if (state === "active" && inBackground) {
      inBackground = false;
      sweepRegistry();
      if (registrations.size > 0) keepSweeping();
    }
  });
}

/**
 * The `FinalizationRegistry` SvelteKit's query cache runs on (an entry is evicted, and a live query's stream closed, when the last query object that uses
 * it is collected), over the engine's own (`engine`) when it has one. Either way a registration can be released by hand, `releaseNow`, which SvelteKit's
 * own cannot offer: the engine's callback for a target released by hand does nothing, so an entry is not released twice.
 *
 * With no `engine` (React Native 0.86's Hermes, 0.17) it is a stand-in that keeps a `WeakRef` per target and looks, every few seconds, for the ones
 * the engine has cleared.
 */
export function makeFinalizationRegistry(engine: Engine) {
  return class TrackedFinalizationRegistry {
    readonly #cleanup: (held: unknown) => void;
    readonly #engine: InstanceType<NonNullable<Engine>> | undefined;
    constructor(cleanup: (held: unknown) => void) {
      if (typeof cleanup !== "function") throw new TypeError("FinalizationRegistry cleanup callback must be callable");
      this.#cleanup = cleanup;
      this.#engine = engine && new engine((registration) => { finalize(registration as Registration); });
    }
    register(target: object, held: unknown, token?: object): void {
      const registration: Registration = { ref: undefined, held, cleanup: this.#cleanup, done: false };
      registrationOf.set(target, registration);
      if (token) {
        const holds = tokenHolds.get(token) ?? new Set<Registration>();
        holds.add(registration);
        tokenHolds.set(token, holds);
      }
      if (this.#engine) {
        this.#engine.register(target, registration, token);
        return;
      }
      registration.ref = new WeakRef(target);
      registrations.add(registration);
      watchLifecycle();
      keepSweeping();
    }
    unregister(token: object): boolean {
      const holds = tokenHolds.get(token);
      if (!holds) return false;
      for (const registration of holds) {
        registration.done = true;
        registrations.delete(registration);
      }
      tokenHolds.delete(token);
      this.#engine?.unregister(token);
      return true;
    }
  };
}

/**
 * Runs the cleanup registered for `target` now, as if the engine had collected it, once. `false` when `target` was never registered here or was
 * released before.
 */
export function releaseNow(target: object): boolean {
  const registration = registrationOf.get(target);
  if (!registration || registration.done) return false;
  finalize(registration);
  return true;
}

/** `WeakRef` for an engine without one: it holds its target, so the target is never collected through it. */
export class WeakRefFallback<T extends object> {
  readonly #target: T;
  constructor(target: T) { this.#target = target; }
  deref(): T { return this.#target; }
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
