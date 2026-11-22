// biome-ignore-all lint/suspicious/noExplicitAny: the shape of SvelteKit's transport hook
// The ambient declarations of the SvelteKit files this module imports (a script file of `declare module`s: it cannot be imported).
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./kit-modules.d.ts" />
/**
 * Where the SvelteKit server is and how the client talks to it. The host is set in the app config (`extra.expoSvelte.remote`, which the
 * Expo plugin's `remote` option writes), read at runtime from the manifest embedded in the build, and overridden by `configureRemote`.
 */
import Constants from "expo-constants";
import { watchHooks, type MobileHooks } from "../app-hooks.ts";
import { init_transport } from "@sveltejs/kit/src/runtime/app/internal/transport.js";
import { hostFromExtra, HOW, normalizeAppDir, normalizeBase, normalizeOrigin, RemoteConfigError, type RemoteHostConfig } from "./host.ts";
import { provideHost } from "./link.ts";
import { setPaths } from "./shims/paths.ts";
import { resetApp, setApp, type ClientHooks } from "./shims/client.ts";

export type Transport = Record<string, { encode: (value: unknown) => unknown; decode: (data: unknown) => unknown }>;

export type RemoteOptions = Partial<RemoteHostConfig> & {
  /** The `transport` export of the app's universal hooks (`src/hooks.ts`): the custom types the server and the client pass between them. Pass the same object the browser uses. Replaces the `transport` of `src/hooks.mobile.ts`. */
  transport?: Transport;
  /** The app's client `handleError` hook: what an error from a remote function becomes (`App.Error`), as in the browser. Replaces the `handleError` of `src/hooks.mobile.ts`. */
  handleError?: ClientHooks["handleError"];
  /** A `fetch` to use instead of Expo's (tests, a proxy). It must return a response whose `body` streams for `query.live`. `null` goes back to Expo's. */
  fetch?: typeof globalThis.fetch | null;
  /** What a `redirect()` from the server does, given the location it names. The default goes through the root router (the location is a route of the app) or opens an external URL. `null` goes back to the default. */
  goto?: ((location: string) => void | Promise<void>) | null;
};

let configured: Partial<RemoteHostConfig> = {};
/** What `configureRemote` set of the hooks: it wins over the app's `src/hooks.mobile.ts`. */
let explicit: { transport?: Transport; handleError?: ClientHooks["handleError"] } = {};
let fromHooks: MobileHooks = {};
let options: { fetch?: typeof globalThis.fetch; goto?: (location: string) => void | Promise<void> } = {};
let fromManifest: { value: Required<RemoteHostConfig> | undefined } | undefined;

/** The manifest's host, read once (the embedded config does not change while the app runs). */
function manifestHost(): Required<RemoteHostConfig> | undefined {
  if (fromManifest === undefined) fromManifest = { value: hostFromExtra(Constants.expoConfig?.extra) };
  return fromManifest.value;
}

/** The host in effect: `configureRemote` over the app config (which is only read for what `configureRemote` did not set). `origin` is `undefined` when neither names one. */
export function currentHost(): { origin: string | undefined; base: string; appDir: string } {
  const { origin, base, appDir } = configured;
  const needsManifest = origin === undefined || base === undefined || appDir === undefined;
  const manifest = needsManifest ? manifestHost() : undefined;
  return { origin: origin ?? manifest?.origin, base: base ?? manifest?.base ?? "", appDir: appDir ?? manifest?.appDir ?? "_app" };
}

/** The origin requests go to; throws `RemoteConfigError`, naming where to set it, when the build has none. This is what makes a missing host fail at the first call. */
export function requireOrigin(): string {
  const { origin } = currentHost();
  if (origin === undefined) throw new RemoteConfigError(`No SvelteKit host is configured for remote functions. ${HOW}`);
  return origin;
}

export const transportOptions = (): { fetch?: typeof globalThis.fetch; goto?: (location: string) => void | Promise<void> } => options;

/**
 * Overrides the host from the app config and sets the hooks the browser's `hooks.ts` would: call it once at startup (before or after the
 * `.remote` modules are imported). Every field is optional and only the ones given change.
 */
export function configureRemote(next: RemoteOptions = {}): void {
  const { transport, handleError, fetch, goto, origin, base, appDir } = next;
  // Validate before anything is stored, so a bad value leaves the previous configuration in place.
  const merged = { ...configured, ...(origin !== undefined ? { origin: normalizeOrigin(origin) } : {}), ...(base !== undefined ? { base: normalizeBase(base) } : {}), ...(appDir !== undefined ? { appDir: normalizeAppDir(appDir) } : {}) };
  configured = merged;
  options = { fetch: fetch === null ? undefined : (fetch ?? options.fetch), goto: goto === null ? undefined : (goto ?? options.goto) };
  if (transport) explicit.transport = transport;
  if (handleError) explicit.handleError = handleError;
  if (transport || handleError) applyHooks();
  try {
    const host = currentHost();
    setPaths(host.base, host.appDir);
  } catch {
    // An invalid app config is reported by the first remote call (`requireOrigin`), not here.
  }
}

/** Forgets everything `configureRemote` set, and re-reads the app config (tests). */
export function resetRemoteConfig(): void {
  configured = {};
  options = {};
  fromManifest = undefined;
  explicit = {};
  applyHooks();
  setPaths("", "_app");
  applyManifestPaths();
}

/** The transport and error hook in effect: `configureRemote`'s, or else the app's hooks file's, or else none (SvelteKit's default `handleError`). */
function applyHooks(): void {
  init_transport((explicit.transport ?? fromHooks.transport ?? {}) as never);
  resetApp();
  const handleError = explicit.handleError ?? (fromHooks.handleError as ClientHooks["handleError"] | undefined);
  if (handleError) setApp({ handleError });
}

watchHooks((hooks) => {
  fromHooks = hooks;
  applyHooks();
});

provideHost(() => ({ ...currentHost(), goto: options.goto }));

/** The paths are live bindings Kit's files read when they build a URL; the app config's are in place from the first import on. */
function applyManifestPaths(): void {
  try {
    const host = manifestHost();
    if (host) setPaths(host.base, host.appDir);
  } catch {
    // An invalid app config is reported by the first remote call (`requireOrigin` throws again), not by importing the module.
  }
}
applyManifestPaths();
