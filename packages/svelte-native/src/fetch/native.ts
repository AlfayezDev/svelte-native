// The contract between Svelte Native's `fetch` and `Blob` (JavaScript, `src/fetch/`) and the native module behind them (`native/svelte-core`, the Expo module
// `SvelteFetch`: Swift on URLSession, Kotlin on React Native's OkHttp client). Both sides are written against this file; a change here is a change to both.
//
// What the native side owns: the request on the wire, the response bytes, and the bytes of every Blob. Bytes cross into JavaScript only when JavaScript asks for
// them (`arrayBuffer`, `bytes`, `read`), and then as one ArrayBuffer that native code allocated (Expo's NativeArrayBuffer, no copy and no base64). A response read
// as a Blob, a Blob sliced or joined, a Blob uploaded, a multipart body built from Blobs: none of these copies bytes through JavaScript.
//
// What the JavaScript side owns: the Fetch standard's objects (Headers, Request, Response, the body mixin, AbortSignal handling, `data:` URLs, FormData and
// URLSearchParams bodies, the default `Content-Type`), argument validation, and turning the native error codes below into the errors the standard names.
import type { SharedObject } from "expo-modules-core";

/** Header pairs in order, names as given (JavaScript lower-cases its own); a repeated header is repeated pairs. */
export type HeaderList = [name: string, value: string][];

/**
 * A Blob's bytes, held natively as an ordered list of immutable segments (a byte buffer, or a range of a file). Constructing one from Blobs, and `slice`, share
 * the segments: no bytes are copied until something reads them.
 */
export declare class NativeBlob extends SharedObject {
  /**
   * `parts` in order: a NativeBlob (its segments are shared), a Uint8Array (its bytes are copied once, here), a string (encoded as UTF-8; a lone surrogate
   * becomes U+FFFD). `type` arrives normalized (ASCII lower case, or "" when it had a character outside U+0020 to U+007E).
   */
  constructor(parts: (NativeBlob | Uint8Array | string)[], type: string);
  /** Total byte length. */
  readonly size: number;
  readonly type: string;
  /** Bytes [start, end), sharing segments. JavaScript passes integers with 0 <= start <= end <= size; `type` normalized as for the constructor. */
  slice(start: number, end: number, type: string): NativeBlob;
  /** Every byte, as one new ArrayBuffer. */
  bytes(): Promise<ArrayBuffer>;
  /** The bytes decoded as UTF-8: a leading byte order mark dropped, each invalid sequence U+FFFD (the Encoding standard's "UTF-8 decode"). */
  text(): Promise<string>;
  /** Up to `length` bytes from `offset` (fewer only at the end; empty when `offset >= size`). Backs `Blob.stream()`. */
  read(offset: number, length: number): Promise<ArrayBuffer>;
  /**
   * A `file://` URL of a file holding the bytes, written on the first call (synchronously: `URL.createObjectURL` is synchronous) under the app's cache
   * directory in `svelte-native-blobs/`; later calls return the same URL. An image, a video or a WebView loads it like any local file.
   */
  objectURL(): string;
}

export type NativeRequestInit = {
  /** Upper-cased already when it is one of the standard's methods (DELETE, GET, HEAD, OPTIONS, POST, PUT); otherwise as given. */
  method: string;
  /** Sent as given. Native code adds no Content-Type of its own (JavaScript sets the standard's default); the platform may add Accept-Encoding, Host, Content-Length. */
  headers: HeaderList;
  /** "include": the system cookie store, the one React Native's own networking uses, both ways. "omit": no Cookie sent, Set-Cookie ignored. */
  credentials: "include" | "omit";
  /** "follow": up to 20 redirects. "error": a redirect status (301, 302, 303, 307, 308) rejects with ERR_FETCH_REDIRECT. "manual": the redirect response itself resolves (Node's semantics, not the browser's opaque response). */
  redirect: "follow" | "error" | "manual";
};

export type NativeResponseHead = {
  status: number;
  /** The reason phrase when the protocol carries one (HTTP/1.1), else "". */
  statusText: string;
  /** In order as received. iOS merges a repeated header into one value joined by ", " (the system gives no other view), Set-Cookie included. */
  headers: HeaderList;
  /** The final URL, after redirects. */
  url: string;
  redirected: boolean;
};

/**
 * One fetch: `start` sends it and resolves with the response head, then exactly one of `read` (repeatedly), `arrayBuffer`, `text` or `blob` takes the body.
 * JavaScript enforces "exactly one"; native code may reject a second consumer with ERR_FETCH_BODY_USED. Released (by JavaScript's garbage collector, or
 * `cancel`) it stops the transfer and frees what it buffered.
 *
 * Errors reject with an Error whose `code` is one of:
 * - `ERR_FETCH_ABORTED`: `cancel` was called (before the head, or while the body was read).
 * - `ERR_FETCH_REDIRECT`: a redirect under `redirect: "error"`, or more than 20 under "follow".
 * - `ERR_FETCH_URL`: a URL native code does not serve (see `start`).
 * - `ERR_FETCH_NETWORK`: anything else between the app and the server (DNS, TLS, refused, reset, a body cut short); the message says which.
 * - `ERR_FETCH_BODY_USED`: a second body consumer.
 */
export declare class NativeRequest extends SharedObject {
  constructor();
  /**
   * Sends the request. `url` is http(s), `file://`, or (Android) `content://`: a file answers 200 with its bytes and no headers but Content-Length (a missing
   * file is ERR_FETCH_NETWORK). JavaScript answers `data:` URLs itself and passes no other scheme. `body` is null for GET and HEAD (JavaScript rejects a body
   * there); a NativeBlob is streamed from its segments (file segments read as they are sent), a Uint8Array is sent as is, a string as UTF-8.
   * Resolves when the status and headers have arrived. Network work never runs on the JavaScript thread.
   */
  start(url: string, init: NativeRequestInit, body: NativeBlob | Uint8Array | string | null): Promise<NativeResponseHead>;
  /** Stops the request or the body transfer; every pending promise of this object rejects with ERR_FETCH_ABORTED. No effect once the body has been read to its end. */
  cancel(): void;
  /**
   * The next body bytes: at least 1 and at most `maxBytes`, or null at the end of the body. Resolves as soon as any bytes are there (it does not wait to fill
   * `maxBytes`). Native code buffers what arrives before it is read, and pauses the transfer while more than 1 MiB is unread.
   */
  read(maxBytes: number): Promise<ArrayBuffer | null>;
  /** The rest of the body as one ArrayBuffer. */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** The rest of the body decoded as UTF-8, as `NativeBlob.text` does. (The Fetch standard's `text()` ignores the charset parameter.) */
  text(): Promise<string>;
  /** The rest of the body as a Blob of `type` (JavaScript passes the Content-Type header, normalized); its bytes stay native. */
  blob(type: string): Promise<NativeBlob>;
}

/** The module, `requireOptionalNativeModule<SvelteFetchModule>("SvelteFetch")`. */
export type SvelteFetchModule = {
  NativeBlob: typeof NativeBlob;
  NativeRequest: typeof NativeRequest;
  /**
   * A Blob over a local file, read when its bytes are needed: `file://`, or (Android) `content://` through the content resolver. Its size is the file's at this
   * call. Backs React Native's FormData file parts (`{ uri, name, type }`). Rejects with ERR_FETCH_NETWORK when the file cannot be opened.
   */
  blobFromURI(uri: string, type: string): Promise<NativeBlob>;
  /** Deletes the file behind a URL `NativeBlob.objectURL` returned. Any other URL is ignored. */
  revokeObjectURL(url: string): void;
};
