import { abortReason, listenWhileAlive, untilAborted } from "./abort.ts";
import { BytesSource, bodyStateOf, NativeBodySource } from "./body.ts";
import { parseDataURL } from "./data-url.ts";
import { fetchError } from "./errors.ts";
import { combinedHeaderPairs } from "./headers.ts";
import { native } from "./module.ts";
import { Request, requestStateOf, type RequestInfo, type RequestInit } from "./request.ts";
import type { NativeResponseHead } from "./native.ts";
import { readReactNativeBlob } from "./rn.ts";
import { responseFromBytes, responseFromNative, type Response } from "./response.ts";

const NULL_BODY_STATUSES = [101, 103, 204, 205, 304];

/**
 * `fetch`, over `NativeRequest`. The request is built as a `Request` first (so the arguments are validated, merged and defaulted as the standard says), then:
 *
 * - `data:` URLs are answered here, in JavaScript, for any method (the standard has no method rule for them). A `blob:` URL (iOS: what React Native's own `URL.createObjectURL` of one of
 *   its Blobs gives, an XHR `responseType = "blob"` response for one) is read through React Native's FileReader, the interop's slow path. Any other scheme but http, https,
 *   `file:` and (Android) `content:` is a network error. A repeated request header is sent as one, its values joined with ", ".
 * - The body goes to native code as a string, bytes or a NativeBlob; a ReadableStream body is drained to bytes first (uploads are not streamed).
 * - `credentials: "same-origin"` is "include": there is no other origin in an app. `mode`, `cache`, `referrer` and `integrity` are accepted and ignored.
 * - A signal that is aborted rejects with its reason; one that aborts later cancels the transfer and rejects, or errors the body, with the reason (the default AbortError when it has none).
 *   One that aborts while a ReadableStream body is drained cancels that stream with the reason and rejects, and no native request starts.
 * - A failure of native code is a TypeError ("Network request failed: ...") whose `cause` is what native code threw.
 */
export async function fetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const state = requestStateOf(request);
  const signal = state.signal;
  if (signal?.aborted) {
    // The standard's "abort the fetch() call": a caller's stream body is cancelled with the reason, so its producer stops.
    const reason = abortReason(signal);
    bodyStateOf(request).source?.cancel?.(reason);
    throw reason;
  }

  const url = new URL(state.url);
  if (url.protocol === "data:") return dataURLResponse(state.url);
  if (url.protocol === "blob:") return reactNativeBlobResponse(state.url, url, state.method);
  if (!["http:", "https:", "file:", "content:"].includes(url.protocol)) throw fetchError(new Error(`unsupported URL scheme ${url.protocol}`));
  url.hash = "";

  const bodyState = bodyStateOf(request);
  bodyState.consumed = true;
  // The body is ready before anything native starts; an abort meanwhile (a caller's stream whose producer may never write) rejects at once, and cancels that stream with the reason.
  const body = bodyState.source === null ? null : await untilAborted(bodyState.source.upload(signal), signal);
  if (signal?.aborted) throw abortReason(signal);

  const nativeRequest = new (native().NativeRequest)();
  // The signal outlives the response in the common case (one controller for a screen's requests), so it must not keep an unread body, and the transfer behind it, alive:
  // it listens for the body weakly (`listenWhileAlive`), and takes the listener off when the body ends or is collected.
  let stopListening = (): void => undefined;
  const source = new NativeBodySource(nativeRequest, () => stopListening());
  if (signal) stopListening = listenWhileAlive(signal, source, (owner) => owner.abort(abortReason(signal)));
  let head: NativeResponseHead;
  try {
    head = await nativeRequest.start(url.href, {
      method: state.method,
      headers: combinedHeaderPairs(state.headers),
      credentials: state.credentials === "omit" ? "omit" : "include",
      redirect: state.redirect as "follow" | "error" | "manual",
    }, body);
  } catch (error) {
    stopListening();
    // Whatever native code made of the cancel (a network error where a socket was closed under it, as often as ERR_FETCH_ABORTED), an aborted signal is why it failed.
    if (signal?.aborted) throw abortReason(signal);
    throw fetchError(error);
  }
  if (state.method === "HEAD" || NULL_BODY_STATUSES.includes(head.status)) {
    source.discard();
    return responseFromNative(head, null);
  }
  return responseFromNative(head, source);
}

function dataURLResponse(href: string): Response {
  const parsed = parseDataURL(href);
  if (parsed === null) throw fetchError(new Error("invalid data: URL"));
  return responseFromBytes(href, { "content-type": parsed.type }, new BytesSource(parsed.bytes));
}

/** `blob:<id>?offset=<n>&size=<n>`, the form of React Native's own object URLs on iOS: its Blob store is read through its FileReader, the one way out of it. */
async function reactNativeBlobResponse(href: string, url: URL, method: string): Promise<Response> {
  const given = [url.searchParams.get("offset"), url.searchParams.get("size")];
  const [offset, size] = given.map((value) => (value === null || value === "" ? Number.NaN : Number(value))) as [number, number];
  if (method !== "GET" || url.pathname === "" || !Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 0) {
    throw fetchError(new Error(method === "GET" ? `${href} is not a blob: URL of React Native's` : "a blob: URL can only be fetched with GET"));
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await readReactNativeBlob({ data: { blobId: decodeURIComponent(url.pathname), offset, size } });
  } catch (error) {
    throw fetchError(error);
  }
  return responseFromBytes(href, { "content-length": String(size) }, new BytesSource(new Uint8Array(bytes)));
}
