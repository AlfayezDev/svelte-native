import { type RemoteHostConfig } from "./host.js";
import { type ClientHooks } from "./shims/client.js";
export type Transport = Record<string, {
    encode: (value: unknown) => unknown;
    decode: (data: unknown) => unknown;
}>;
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
/** The host in effect: `configureRemote` over the app config (which is only read for what `configureRemote` did not set). `origin` is `undefined` when neither names one. */
export declare function currentHost(): {
    origin: string | undefined;
    base: string;
    appDir: string;
};
/** The origin requests go to; throws `RemoteConfigError`, naming where to set it, when the build has none. This is what makes a missing host fail at the first call. */
export declare function requireOrigin(): string;
export declare const transportOptions: () => {
    fetch?: typeof globalThis.fetch;
    goto?: (location: string) => void | Promise<void>;
};
/**
 * Overrides the host from the app config and sets the hooks the browser's `hooks.ts` would: call it once at startup (before or after the
 * `.remote` modules are imported). Every field is optional and only the ones given change.
 */
export declare function configureRemote(next?: RemoteOptions): void;
/** Forgets everything `configureRemote` set, and re-reads the app config (tests). */
export declare function resetRemoteConfig(): void;
