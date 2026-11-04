/**
 * Where the SvelteKit server is and how the client talks to it. The host is set in the app config (`extra.svelteNative.remote`, which the
 * Expo plugin's `remote` option writes), read at runtime from the manifest embedded in the build, and overridden by `configureRemote`.
 */
import Constants from "expo-constants";
import { init_transport } from "@sveltejs/kit/src/runtime/app/internal/transport.js";
import { provideHost } from "./link.ts";
import { setPaths } from "./shims/paths.ts";
import { resetApp, setApp, type ClientHooks } from "./shims/client.ts";

/** The part of the app config this reads. */
export type RemoteHostConfig = {
  /** The server's origin: `https://app.example.com`, or `http://localhost:3000` for a development server. No path: `base` is the path. */
  origin: string;
  /** SvelteKit's `paths.base` (`""` or `/prefix`). Default `""`. */
  base?: string;
  /** SvelteKit's `appDir` (the path segment before `remote/`). Default `_app`. */
  appDir?: string;
};

export type Transport = Record<string, { encode: (value: unknown) => unknown; decode: (data: unknown) => unknown }>;

export type RemoteOptions = Partial<RemoteHostConfig> & {
  /** The `transport` export of the app's universal hooks (`src/hooks.ts`): the custom types the server and the client pass between them. Pass the same object the browser uses. */
  transport?: Transport;
  /** The app's client `handleError` hook: what an error from a remote function becomes (`App.Error`), as in the browser. */
  handleError?: ClientHooks["handleError"];
  /** A `fetch` to use instead of Expo's (tests, a proxy). It must return a response whose `body` streams for `query.live`. */
  fetch?: typeof globalThis.fetch;
  /** What a `redirect()` from the server does, given the location it names. The default goes through the root router (the location is a route of the app) or opens an external URL. */
  goto?: (location: string) => void | Promise<void>;
};

export class RemoteConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteConfigError";
  }
}

/** The key of `extra` the Expo plugin and `app.config.ts` write the host under: `extra.svelteNative.remote`. */
export const EXTRA_KEY = "svelteNative";

const HOW = "Set `extra.svelteNative.remote.origin` in app.config.ts (the \"@rasheed/svelte-native/expo\" plugin's `remote` option writes it), or call `configureRemote({ origin })` before the first remote function.";

/** `https://host[:port]` of a URL string. Throws `RemoteConfigError` for anything that is not an http(s) origin: a path, a query, credentials or another protocol. */
export function normalizeOrigin(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new RemoteConfigError(`The remote origin must be a URL string such as "https://app.example.com", not ${JSON.stringify(value)}. ${HOW}`);
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new RemoteConfigError(`The remote origin ${JSON.stringify(value)} is not a URL. ${HOW}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new RemoteConfigError(`The remote origin ${JSON.stringify(value)} must use http: or https:.`);
  if (url.username || url.password) throw new RemoteConfigError(`The remote origin ${JSON.stringify(value)} must not carry credentials.`);
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) throw new RemoteConfigError(`The remote origin ${JSON.stringify(value)} must be an origin without a path, query or fragment: put a path prefix in \`base\` (SvelteKit's \`paths.base\`).`);
  return url.origin;
}

/** SvelteKit's `paths.base`: empty, or a path that starts with `/` and does not end with one. */
export function normalizeBase(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !value.startsWith("/") || value.endsWith("/")) throw new RemoteConfigError(`The remote base ${JSON.stringify(value)} must be "" or a path that starts with "/" and does not end with one (SvelteKit's \`paths.base\`).`);
  return value;
}

/** SvelteKit's `appDir`: a path segment without slashes at either end. */
export function normalizeAppDir(value: unknown): string {
  if (value === undefined || value === null || value === "") return "_app";
  if (typeof value !== "string" || value.startsWith("/") || value.endsWith("/")) throw new RemoteConfigError(`The remote appDir ${JSON.stringify(value)} must be a path segment without a leading or trailing "/" (SvelteKit's \`appDir\`, "_app" by default).`);
  return value;
}

/** The `extra` the app was built with (`app.config.ts`) to a validated host, or `undefined` when `extra` names none. */
export function hostFromExtra(extra: unknown): Required<RemoteHostConfig> | undefined {
  const section = (extra as Record<string, { remote?: unknown } | undefined> | null | undefined)?.[EXTRA_KEY]?.remote;
  if (section === undefined || section === null) return undefined;
  if (typeof section !== "object") throw new RemoteConfigError(`extra.${EXTRA_KEY}.remote must be an object { origin, base?, appDir? }, not ${JSON.stringify(section)}.`);
  const { origin, base, appDir } = section as Partial<RemoteHostConfig>;
  return { origin: normalizeOrigin(origin), base: normalizeBase(base), appDir: normalizeAppDir(appDir) };
}

let configured: Partial<RemoteHostConfig> = {};
let options: Pick<RemoteOptions, "fetch" | "goto"> = {};
let fromManifest: { value: Required<RemoteHostConfig> | undefined } | undefined;

/** The manifest's host, read once (the embedded config does not change while the app runs). */
function manifestHost(): Required<RemoteHostConfig> | undefined {
  return (fromManifest ??= { value: hostFromExtra(Constants.expoConfig?.extra) }).value;
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

export const transportOptions = (): Pick<RemoteOptions, "fetch" | "goto"> => options;

/**
 * Overrides the host from the app config and sets the hooks the browser's `hooks.ts` would: call it once at startup (before or after the
 * `.remote` modules are imported). Every field is optional and only the ones given change.
 */
export function configureRemote(next: RemoteOptions = {}): void {
  const { transport, handleError, fetch, goto, origin, base, appDir } = next;
  // Validate before anything is stored, so a bad value leaves the previous configuration in place.
  const merged = { ...configured, ...(origin !== undefined ? { origin: normalizeOrigin(origin) } : {}), ...(base !== undefined ? { base: normalizeBase(base) } : {}), ...(appDir !== undefined ? { appDir: normalizeAppDir(appDir) } : {}) };
  configured = merged;
  options = { fetch: fetch ?? options.fetch, goto: goto ?? options.goto };
  if (transport) init_transport(transport as never);
  if (handleError) setApp({ handleError });
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
  init_transport({});
  resetApp();
  setPaths("", "_app");
  applyManifestPaths();
}

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
