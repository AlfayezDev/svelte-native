/**
 * The app's hooks: `src/hooks.mobile.ts` (or `.js`), the native app's counterpart of SvelteKit's `hooks.client.ts`. The generated
 * `.svelte-native/hooks.ts` imports the file and calls `registerHooks` with its exports; the entry imports that module after the boot
 * modules and before the app's layout and routes, so the file's top level runs before any of the app's own code.
 *
 * - `init` runs once, when the app's JavaScript starts. The first screen mounts when the promise it returns has resolved (the splash screen
 *   stays up meanwhile). It runs in a launch without a screen too (a background task), since that launch evaluates the same entry.
 * - `handleError` and `transport` are the remote functions' (`remote/config.ts` watches them here, so an app that uses no remote function
 *   loads nothing of SvelteKit for them).
 *
 * A hot update of the file registers its new exports; `init` does not run again, unless it failed (development shows the failure on the
 * screen, and the fix runs it again). In a release build a failed `init` is a fatal error, as a throw at the top of the entry would be.
 */
import { mark } from "./boot-marks.ts";

/** What `src/hooks.mobile.ts` may export. Every export is optional. */
export type MobileHooks = {
  /** Runs once when the app starts, before the first screen mounts. SvelteKit's `ClientInit`: the first screen waits for the promise it returns. */
  init?(): unknown;
  /**
   * SvelteKit's client `handleError` (`HandleClientError`), for what a remote function's call fails with: it gets the caught error
   * (`kind` `app`, `framework` or `unknown`) and returns the properties of `App.Error` to set, or nothing.
   */
  handleError?(input: { kind: "app" | "framework" | "unknown"; error: unknown; event: unknown }): unknown;
  /** The `transport` export of SvelteKit's universal hooks (`src/hooks.ts`): the custom types the server and the app pass between them. */
  transport?: Record<string, { encode(value: unknown): unknown; decode(data: unknown): unknown }>;
};

let current: MobileHooks = {};
let registered = false;
const watchers = new Set<(hooks: MobileHooks) => void>();
/** Whether `init` has run to its end in this runtime (or the first registration had none). */
let started = false;
/** The `init` in flight: a promise that resolves when it has settled, whichever way. */
let settling: Promise<void> | undefined;
/** What the last `init` failed with. */
let failure: { error: unknown } | undefined;

const dev = () => typeof __DEV__ !== "undefined" && __DEV__;
const thenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as { then?: unknown } | null)?.then === "function";

function fail(error: unknown): void {
  failure = { error };
  if (dev()) {
    // `launchSurface` shows it on the screen; the native fatal path would end the process, and with it the next hot update.
    console.error("src/hooks.mobile: init failed", error);
    return;
  }
  const errorUtils = (globalThis as { ErrorUtils?: { reportFatalError(error: unknown): void } }).ErrorUtils;
  if (errorUtils) errorUtils.reportFatalError(error);
  else queueMicrotask(() => { throw error; });
}

/** Called by the generated `.svelte-native/hooks.ts` with the exports of `src/hooks.mobile.ts`, on every evaluation of it. */
export function registerHooks(hooks: MobileHooks): void {
  current = hooks;
  for (const watcher of watchers) watcher(hooks);
  if (!registered) mark("hooks");
  registered = true;
  // A hot update while an earlier `init` is still in flight keeps that one.
  if (started || settling !== undefined) return;
  failure = undefined;
  if (typeof hooks.init !== "function") {
    started = true;
    return;
  }
  let result: unknown;
  try {
    result = hooks.init();
  } catch (error) {
    fail(error);
    return;
  }
  if (!thenable(result)) {
    started = true;
    return;
  }
  const run: Promise<void> = Promise.resolve(result).then(
    () => { started = true; },
    (error: unknown) => { fail(error); },
  ).finally(() => {
    if (settling === run) settling = undefined;
    mark("hooks init");
  });
  settling = run;
}

/** The app's hooks as last registered (none until the generated module has run, and in an app without the file). */
export const appHooks = (): MobileHooks => current;

/** Calls `watcher` with the hooks now and on every registration; returns what stops it. */
export function watchHooks(watcher: (hooks: MobileHooks) => void): () => void {
  watchers.add(watcher);
  watcher(current);
  return () => { watchers.delete(watcher); };
}

/** While `init` is in flight, a promise that resolves (never rejects) when it has settled; `undefined` otherwise. */
export const initSettling = (): Promise<void> | undefined => settling;

/** What the last `init` failed with, until a registration runs it again. */
export const initFailure = (): { error: unknown } | undefined => failure;

/** Forgets every registration and the state of `init` (tests). */
export function resetHooks(): void {
  current = {};
  registered = false;
  started = false;
  settling = undefined;
  failure = undefined;
  for (const watcher of watchers) watcher(current);
}
