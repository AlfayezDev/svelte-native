import { abortReason } from "./abort.ts";
import { BytesSource, bodyStateOf, NativeBodySource } from "./body.ts";
import { parseDataURL } from "./data-url.ts";
import { fetchError } from "./errors.ts";
import { headerPairs } from "./headers.ts";
import { native } from "./module.ts";
import { Request, requestStateOf, type RequestInfo, type RequestInit } from "./request.ts";
import type { NativeResponseHead } from "./native.ts";
import { responseFromBytes, responseFromNative, type Response } from "./response.ts";

const NULL_BODY_STATUSES = [101, 103, 204, 205, 304];

/**
 * `fetch`, over `NativeRequest`. The request is built as a `Request` first (so the arguments are validated, merged and defaulted as the standard says), then:
 *
 * - `data:` URLs are answered here, in JavaScript. Any other scheme but http, https, `file:` and (Android) `content:` is a network error.
 * - The body goes to native code as a string, bytes or a NativeBlob; a ReadableStream body is drained to bytes first (uploads are not streamed).
 * - `credentials: "same-origin"` is "include": there is no other origin in an app. `mode`, `cache`, `referrer` and `integrity` are accepted and ignored.
 * - A signal that is aborted rejects with its reason; one that aborts later cancels the transfer and rejects, or errors the body, with the reason (the default AbortError when it has none).
 * - A failure of native code is a TypeError ("Network request failed: ...") whose `cause` is what native code threw.
 */
export async function fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const state = requestStateOf(request);
  const signal = state.signal;
  if (signal?.aborted) throw abortReason(signal);

  const url = new URL(state.url);
  if (url.protocol === "data:") return dataURLResponse(state.url, state.method);
  if (!["http:", "https:", "file:", "content:"].includes(url.protocol)) throw fetchError(new Error(`unsupported URL scheme ${url.protocol}`));
  url.hash = "";

  const bodyState = bodyStateOf(request);
  bodyState.consumed = true;
  const body = bodyState.source === null ? null : await bodyState.source.upload();
  if (signal?.aborted) throw abortReason(signal);

  const nativeRequest = new (native().NativeRequest)();
  const source = new NativeBodySource(nativeRequest, () => signal?.removeEventListener("abort", onAbort));
  // The signal outlives the response in the common case (one controller for a screen's requests), so it must not keep an unread body, and the transfer behind it, alive: it holds the
  // body weakly, and a body that was collected has been released and stopped by native code already.
  const weak = typeof WeakRef === "function" ? new WeakRef(source) : { deref: () => source };
  function onAbort(): void {
    weak.deref()?.abort(abortReason(signal));
  }
  signal?.addEventListener("abort", onAbort);
  let head: NativeResponseHead;
  try {
    head = await nativeRequest.start(url.href, {
      method: state.method,
      headers: headerPairs(state.headers),
      credentials: state.credentials === "omit" ? "omit" : "include",
      redirect: state.redirect as "follow" | "error" | "manual",
    }, body);
  } catch (error) {
    signal?.removeEventListener("abort", onAbort);
    throw fetchError(error, signal?.aborted ? abortReason(signal) : undefined);
  }
  if (state.method === "HEAD" || NULL_BODY_STATUSES.includes(head.status)) {
    source.discard();
    return responseFromNative(head, null);
  }
  return responseFromNative(head, source);
}

function dataURLResponse(href: string, method: string): Response {
  const parsed = method === "GET" ? parseDataURL(href) : null;
  if (parsed === null) throw fetchError(new Error(method === "GET" ? "invalid data: URL" : "a data: URL can only be fetched with GET"));
  return responseFromBytes(href, { "content-type": parsed.type }, new BytesSource(parsed.bytes));
}
