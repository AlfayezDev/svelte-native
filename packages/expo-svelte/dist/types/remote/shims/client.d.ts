export type ClientError = {
    status: number;
    message: string;
    [key: string]: unknown;
};
export type ClientHooks = {
    /** As SvelteKit's client `handleError`: gets what was caught and returns the properties of `App.Error` to set, or nothing. */
    handleError: (input: {
        kind: "app" | "framework" | "unknown";
        error: unknown;
        event: unknown;
        status?: number;
        message?: string;
    }) => Partial<ClientError> | undefined | Promise<Partial<ClientError> | undefined>;
};
/** `app.encoders` and `app.decoders` are the transport's, read when a payload is built or parsed (they are replaced by `configureRemote({ transport })`). */
export declare const app: {
    readonly encoders: Record<string, (value: unknown) => unknown>;
    readonly decoders: Record<string, (data: unknown) => unknown>;
    readonly hooks: ClientHooks;
};
export declare function setApp(next: Partial<ClientHooks>): void;
export declare function resetApp(): void;
/** Responses the server rendered into a page (`q`, `l`, `f`, `p`): a native screen is not server-rendered, so they stay empty. */
export declare const query_responses: Record<string, {
    v?: unknown;
    e?: unknown;
}>;
export declare const prerender_responses: Record<string, {
    v?: unknown;
    e?: unknown;
}>;
type Resource = {
    refresh(): Promise<void>;
    reconnect(): Promise<void>;
};
/** id → payload → the cache entry of every query (and live query) a screen holds. */
export declare const query_map: Map<string, Map<string, {
    resource: Resource;
}>>;
export declare const live_query_map: Map<string, Map<string, {
    resource: Resource;
}>>;
/** SvelteKit's `handle_error` for a caught value: the `App.Error` a failed query or form shows. */
export declare function handle_error(error: unknown, event: unknown): Promise<ClientError>;
/** A `redirect()` from the server: through the app's router, or out to the system for another site. */
export declare function _goto(location: string): Promise<void>;
/** Refetches every query and reconnects every live query a screen holds (SvelteKit's `refreshAll` also reruns `load`). */
export declare function refreshAll(): Promise<void>;
/** SvelteKit shows its nearest error page; a native form has no page to replace, so the error is reported to the console. */
export declare function set_nearest_error_page(error: unknown): Promise<void>;
export {};
