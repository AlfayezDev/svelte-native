/** What `src/hooks.mobile.ts` may export. Every export is optional. */
export type MobileHooks = {
    /** Runs once when the app starts, before the first screen mounts. SvelteKit's `ClientInit`: the first screen waits for the promise it returns. */
    init?(): unknown;
    /**
     * SvelteKit's client `handleError` (`HandleClientError`), for what a remote function's call fails with: it gets the caught error
     * (`kind` `app`, `framework` or `unknown`) and returns the properties of `App.Error` to set, or nothing.
     */
    handleError?(input: {
        kind: "app" | "framework" | "unknown";
        error: unknown;
        event: unknown;
    }): unknown;
    /** The `transport` export of SvelteKit's universal hooks (`src/hooks.ts`): the custom types the server and the app pass between them. */
    transport?: Record<string, {
        encode(value: unknown): unknown;
        decode(data: unknown): unknown;
    }>;
};
/** Called by the generated `.svelte-native/hooks.ts` with the exports of `src/hooks.mobile.ts` (or none, for an app without the file), on every evaluation of it. */
export declare function registerHooks(hooks: MobileHooks): void;
/** Runs the registered `init` again after it failed (the error screen's Reload). Returns whether it did. */
export declare function retryInit(): boolean;
/** The app's hooks as last registered (none until the generated module has run, and in an app without the file). */
export declare const appHooks: () => MobileHooks;
/** Calls `watcher` with the hooks now and on every registration; returns what stops it. */
export declare function watchHooks(watcher: (hooks: MobileHooks) => void): () => void;
/** While `init` is in flight, a promise that resolves (never rejects) when it has settled; `undefined` otherwise. */
export declare const initSettling: () => Promise<void> | undefined;
/** What the last `init` failed with, until a registration or `retryInit` runs it again. */
export declare const initFailure: () => {
    error: unknown;
} | undefined;
/** Forgets every registration and the state of `init` (tests). */
export declare function resetHooks(): void;
