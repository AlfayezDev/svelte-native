/**
 * What the two senders (`fcm.ts`, `apns.ts`) share: the `SendResult` of a failure, built in one place so that every provider's answer reaches the caller in the same
 * shape, and the small readings of a provider's answer.
 */
import type { SendResult } from "./server.ts";

export type Failure = Extract<SendResult, { ok: false }>;

export function failure(reason: Failure["reason"], detail: string, status?: number, retryAfter?: number): Failure {
  return { ok: false, reason, ...(status !== undefined ? { status } : {}), ...(retryAfter !== undefined ? { retryAfter } : {}), detail };
}

/**
 * The `Retry-After` header as milliseconds: a number of seconds, or an HTTP date (RFC 9110, 10.2.3). A header that is neither, or absent, gives none, and a date that has
 * passed gives 0.
 */
export function retryAfterOf(value: string | string[] | null | undefined): number | undefined {
  const header = (Array.isArray(value) ? value[0] : value)?.trim();
  if (header === undefined || header === "") return undefined;
  if (/^\d+$/.test(header)) return Number(header) * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** A failed connection or request as a sentence: the error's message and, for `fetch`, the reason of its `cause` (`fetch failed` alone says nothing). Any URL in it is cut to its host (`withoutSecrets`). */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return withoutSecrets(String(error));
  const cause = error.cause instanceof Error ? error.cause.message : undefined;
  return withoutSecrets(cause === undefined || cause === error.message ? error.message : `${error.message} (${cause})`);
}

/** A URL's host, which is what a message says of an endpoint: the rest may hold a password (`user:pw@`) or a key in its query. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || "the endpoint";
  } catch {
    return "the endpoint";
  }
}

/**
 * A message with every URL in it cut to its scheme and host. Node's own errors quote the URL they were given (`fetch` refuses one with credentials by quoting it whole), and
 * a `detail` is printed by `push send` and logged by apps.
 */
export const withoutSecrets = (text: string): string => text.replace(/\b([a-z][a-z\d+.-]*:\/\/)[^\s"'<>]+/gi, (url, scheme: string) => `${scheme}${hostOf(url)}`);

/** A body that is JSON, or `undefined` when it is not: an error page of a proxy in front of a provider is text, and its status says what it is. */
export function parseJson(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** An http or https URL of an option, as a string with no trailing slash; a `TypeError` that names the option when it is not one. */
export function httpUrl(value: unknown, name: string): string {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new TypeError(`${name} must be an http or https URL, not ${JSON.stringify(value)}.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError(`${name} must be an http or https URL, not ${JSON.stringify(value)}.`);
  return url.href.replace(/\/+$/, "");
}
