// Stands in for SvelteKit's router client (`client/client.js`) in the client files this package reuses (`client/remote-functions/*`). It
// holds what they share (the maps of the live queries, the `app` with the transport's encoders and the error hook) and the two things
// they ask the router for: `_goto` (a `redirect()` from the server) and `refreshAll`. There are no `load` functions to rerun, no
// server-rendered payload to hydrate and no error page, so those parts of the original have no counterpart.
import { HandledHttpError, HttpError, SvelteKitError } from "@sveltejs/kit/internal";
import { decoders, encoders } from "@sveltejs/kit/src/runtime/app/internal/transport.js";
import { navigate } from "../link.ts";

export type ClientError = { status: number; message: string; [key: string]: unknown };
export type ClientHooks = {
  /** As SvelteKit's client `handleError`: gets what was caught and returns the properties of `App.Error` to set, or nothing. */
  handleError: (input: { kind: "app" | "framework" | "unknown"; error: unknown; event: unknown; status?: number; message?: string }) => Partial<ClientError> | void | Promise<Partial<ClientError> | void>;
};

const defaultHooks: ClientHooks = {
  handleError: ({ kind, error }) => { if (kind !== "app") console.error(error); },
};
const hooks: ClientHooks = { ...defaultHooks };

/** `app.encoders` and `app.decoders` are the transport's, read when a payload is built or parsed (they are replaced by `configureRemote({ transport })`). */
export const app = {
  get encoders() { return encoders; },
  get decoders() { return decoders; },
  get hooks() { return hooks; },
};

export function setApp(next: Partial<ClientHooks>): void {
  Object.assign(hooks, next);
}

export function resetApp(): void {
  Object.assign(hooks, defaultHooks);
}

/** Responses the server rendered into a page (`q`, `l`, `f`, `p`): a native screen is not server-rendered, so they stay empty. */
export const query_responses: Record<string, { v?: unknown; e?: unknown }> = {};
export const prerender_responses: Record<string, { v?: unknown; e?: unknown }> = {};

type Resource = { refresh(): Promise<void>; reconnect(): Promise<void> };
/** id → payload → the cache entry of every query (and live query) a screen holds. */
export const query_map = new Map<string, Map<string, { resource: Resource }>>();
export const live_query_map = new Map<string, Map<string, { resource: Resource }>>();

/** SvelteKit's `handle_error` for a caught value: the `App.Error` a failed query or form shows. */
export async function handle_error(error: unknown, event: unknown): Promise<ClientError> {
  if (error instanceof HandledHttpError) return error.body as ClientError;
  let caught: Parameters<ClientHooks["handleError"]>[0];
  if (error instanceof HttpError) caught = { kind: "app", error: error.body, event };
  else if (error instanceof SvelteKitError) caught = { kind: "framework", error: { status: error.status, message: error.text }, event };
  else caught = { kind: "unknown", error, event };
  const fallback = (caught.kind === "unknown" ? { status: 500, message: "Internal Error" } : caught.error) as ClientError;
  const overrides = await hooks.handleError(caught);
  return { ...fallback, ...overrides };
}

/** A `redirect()` from the server: through the app's router, or out to the system for another site. */
export async function _goto(location: string): Promise<void> {
  await navigate(location);
}

/** Refetches every query and reconnects every live query a screen holds (SvelteKit's `refreshAll` also reruns `load`). */
export async function refreshAll(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  for (const entries of query_map.values()) for (const { resource } of entries.values()) pending.push(resource.refresh());
  for (const entries of live_query_map.values()) for (const { resource } of entries.values()) pending.push(resource.reconnect());
  await Promise.all(pending.map((promise) => promise.catch(() => {})));
}

/** SvelteKit shows its nearest error page; a native form has no page to replace, so the error is reported to the console. */
export async function set_nearest_error_page(error: unknown): Promise<void> {
  console.error(error);
}
