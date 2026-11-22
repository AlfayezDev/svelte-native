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
export declare class RemoteConfigError extends Error {
    constructor(message: string);
}
/** The key of `extra` the Expo plugin and `app.config.ts` write the host under: `extra.expoSvelte.remote`. */
export declare const EXTRA_KEY = "expoSvelte";
export declare const HOW = "Set `extra.expoSvelte.remote.origin` in app.config.ts (the \"expo-svelte\" plugin's `remote` option writes it), or call `configureRemote({ origin })` before the first remote function.";
/** `https://host[:port]` of a URL string. Throws `RemoteConfigError` for anything that is not an http(s) origin: a path, a query, credentials or another protocol. */
export declare function normalizeOrigin(value: unknown): string;
/** SvelteKit's `paths.base`: empty, or a path that starts with `/` and does not end with one. */
export declare function normalizeBase(value: unknown): string;
/** SvelteKit's `appDir`: a path segment without slashes at either end. */
export declare function normalizeAppDir(value: unknown): string;
/** The `extra` the app was built with (`app.config.ts`) to a validated host, or `undefined` when `extra` names none. */
export declare function hostFromExtra(extra: unknown): Required<RemoteHostConfig> | undefined;
