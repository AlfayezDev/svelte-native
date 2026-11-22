// biome-ignore-all lint/suspicious/noExplicitAny: declarations of untyped SvelteKit JavaScript
// SvelteKit's `exports` map keeps `src/` closed; the Metro integration and the tests resolve these paths to the files (`transform.ts`, `remoteResolution`).
// Only what this package uses is typed.
declare module "@sveltejs/kit/src/runtime/client/remote-functions/command.svelte.js" {
  export function command(id: string): (arg?: unknown) => Promise<unknown> & { updates(...updates: unknown[]): Promise<unknown> };
}
declare module "@sveltejs/kit/src/runtime/client/remote-functions/prerender.svelte.js" {
  export function prerender(id: string): (arg?: unknown) => unknown;
}
declare module "@sveltejs/kit/src/runtime/client/remote-functions/query/index.js" {
  export function query(id: string): (arg?: unknown) => unknown;
}
declare module "@sveltejs/kit/src/runtime/client/remote-functions/query-batch.svelte.js" {
  export function query_batch(id: string): (arg?: unknown) => unknown;
}
declare module "@sveltejs/kit/src/runtime/client/remote-functions/query-live/index.js" {
  export function query_live(id: string): (arg?: unknown) => unknown;
}
declare module "@sveltejs/kit/src/runtime/client/remote-functions/shared.svelte.js" {
  export function remote_request(url: string, init?: RequestInit, refreshes?: Set<string> | null): Promise<{ _?: any; r?: boolean; redirect?: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  export function categorize_updates(updates: unknown[]): { overrides: Array<() => void>; refreshes: Set<string> };
  export function fail_unhandled_refreshes(refreshes: Set<string> | null): void;
}
declare module "@sveltejs/kit/src/runtime/form-utils.js" {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  export const BINARY_FORM_CONTENT_TYPE: string;
  export const DELETE_KEY: object;
  export function build_path_string(path: (string | number)[]): string;
  export function coerce_form_value(type: "number" | "boolean" | null, value: any): any;
  export function create_field_proxy(context: any, target?: any, path?: (string | number)[]): any;
  export function deep_get(object: Record<string, any>, path: (string | number)[]): any;
  export function deep_set(object: Record<string, any>, keys: string[], value: any): void;
  export function flatten_issues(issues: any[]): Record<string, any[]>;
  export function normalize_issue(issue: any, server?: boolean): any;
  export function serialize_binary_form(data: Record<string, any>, meta: Record<string, any>): { blob: { bytes(): Uint8Array } };
}
declare module "@sveltejs/kit/src/runtime/app/internal/transport.js" {
  export const encoders: Record<string, (value: unknown) => unknown>;
  export const decoders: Record<string, (data: unknown) => unknown>;
  export function init_transport(transport: Record<string, { encode: (value: unknown) => unknown; decode: (data: unknown) => unknown }>): void;
}
declare module "@sveltejs/kit/internal" {
  export class HttpError { constructor(error: { status: number; message: string }); status: number; body: { status: number; message: string }; }
  export class HandledHttpError extends HttpError {}
  export class SvelteKitError extends Error { constructor(status: number, text: string, message: string); status: number; text: string; }
}
