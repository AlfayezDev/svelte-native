/**
 * The host of a SvelteKit server as an app config states it, and its validation. Pure (no React Native, no Expo): the config plugin, the
 * runtime and the tests share one reading of it.
 */

/** The part of the app config this reads. */
export type RemoteHostConfig = {
  /** The server's origin: `https://app.example.com`, or `http://localhost:3000` for a development server. No path: `base` is the path. */
  origin: string;
  /** SvelteKit's `paths.base` (`""` or `/prefix`). Default `""`. */
  base?: string;
  /** SvelteKit's `appDir` (the path segment before `remote/`). Default `_app`. */
  appDir?: string;
};

export class RemoteConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteConfigError";
  }
}

/** The key of `extra` the Expo plugin and `app.config.ts` write the host under: `extra.svelteNative.remote`. */
export const EXTRA_KEY = "svelteNative";

export const HOW = "Set `extra.svelteNative.remote.origin` in app.config.ts (the \"@example/svelte-native/expo\" plugin's `remote` option writes it), or call `configureRemote({ origin })` before the first remote function.";

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
