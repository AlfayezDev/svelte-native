import { abortReason } from "./abort.ts";
import { blobFromNative, Blob, isBlob, nativeBlobOf, normalizeType } from "./blob.ts";
import { concatBytes, decodeUtf8, encodeUtf8, isArrayBuffer, toArrayBuffer, toUSVString, viewOf } from "./encoding.ts";
import { fetchError } from "./errors.ts";
import { FormData, isFormData } from "./form-data.ts";
import { native } from "./module.ts";
import { boundaryOf, encodeEntries, newBoundary, parseMultipart, parseUrlEncoded } from "./multipart.ts";
import type { NativeBlob, NativeRequest } from "./native.ts";
import { isReactNativeBlob, readReactNativeBlob } from "./rn.ts";

/**
 * The body mixin of `Request` and `Response`. A body is a source (where its bytes are) plus, once something asks for it, a ReadableStream.
 *
 * - The sources are a string, a copy of a buffer, a NativeBlob (a Blob, a multipart body, a React Native Blob copied into one), a caller's ReadableStream, or the body of a NativeRequest.
 *   Until the stream is touched (`body` read, or the body cloned), `arrayBuffer`, `text` and `blob` ask the source directly: for a response that is one native call and the bytes of a `blob()`
 *   never reach JavaScript. Once the stream exists every consumer reads it instead, as the standard has it.
 * - `bodyUsed` is the standard's "disturbed": a consumer ran, or something pulled from or cancelled the stream. A body is unusable when it is disturbed or its stream is locked.
 * - A source is replayable when its bytes can be read again (everything but a body off the wire and a caller's stream). Cloning one shares it; cloning the others tees the stream.
 */
export type BodyInit = string | ArrayBuffer | ArrayBufferView | Blob | FormData | URLSearchParams | ReadableStream<Uint8Array>;

/** Whether something pulled from, or cancelled, a body's stream. Shared by the stream and its body, so a body that takes over another's stream sees the other's reads. */
export type Usage = { disturbed: boolean };

export interface BodySource {
  readonly replayable: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  blob(type: string): Promise<Blob>;
  stream(usage: Usage): ReadableStream<Uint8Array>;
  /** What a request sends: a string, bytes or a NativeBlob, whichever the source holds. A caller's stream that `signal` aborts the reading of is cancelled with the signal's reason. */
  upload(signal?: AbortSignal | null): Promise<NativeBlob | Uint8Array | string>;
}

const CHUNK = 65536;

/** A stream whose chunks come from `next` (null ends it), pulled only when a reader asks. */
export function pullStream(usage: Usage, next: () => Promise<Uint8Array | null>, cancel?: (reason: unknown) => void | Promise<void>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      usage.disturbed = true;
      const chunk = await next();
      if (chunk === null) controller.close();
      else controller.enqueue(chunk);
    },
    cancel(reason) {
      usage.disturbed = true;
      return cancel?.(reason);
    },
  }, { highWaterMark: 0 });
}

/**
 * Every chunk of a stream as one byte array; a chunk that is not a Uint8Array is a TypeError. When `signal` aborts, the stream is cancelled with the signal's reason (which also ends a
 * read that waits on a producer that never writes) and the promise rejects with it.
 */
async function readAll(stream: ReadableStream<Uint8Array>, signal?: AbortSignal | null): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  const cancel = (): void => {
    reader.cancel(abortReason(signal)).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancel);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortReason(signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError("Received a chunk that is not a Uint8Array");
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  return concatBytes(chunks);
}

const once = <T>(make: () => Promise<T>): (() => Promise<T>) => {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
};

class StringSource implements BodySource {
  readonly replayable = true;
  constructor(readonly value: string) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return toArrayBuffer(encodeUtf8(this.value));
  }

  /** Decoding what was encoded: a byte order mark that begins the string is dropped. */
  async text(): Promise<string> {
    return this.value.charCodeAt(0) === 0xfeff ? this.value.slice(1) : this.value;
  }

  async blob(type: string): Promise<Blob> {
    return new Blob([this.value], { type });
  }

  stream(usage: Usage): ReadableStream<Uint8Array> {
    let sent = false;
    return pullStream(usage, async () => {
      if (sent) return null;
      sent = true;
      return encodeUtf8(this.value);
    });
  }

  async upload(): Promise<string> {
    return this.value;
  }
}

export class BytesSource implements BodySource {
  readonly replayable = true;
  /** `bytes` is the source's own copy: the caller's buffer may change after the body is made. */
  constructor(readonly bytes: Uint8Array) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.slice().buffer;
  }

  async text(): Promise<string> {
    return decodeUtf8(this.bytes);
  }

  async blob(type: string): Promise<Blob> {
    return new Blob([this.bytes], { type });
  }

  stream(usage: Usage): ReadableStream<Uint8Array> {
    let sent = this.bytes.byteLength === 0;
    return pullStream(usage, async () => {
      if (sent) return null;
      sent = true;
      return this.bytes.slice();
    });
  }

  async upload(): Promise<Uint8Array> {
    return this.bytes;
  }
}

/** Bytes that live in a NativeBlob, made when they are first needed (a multipart body names files that are opened then; a React Native Blob is read then). */
class BlobSource implements BodySource {
  readonly replayable = true;
  constructor(readonly load: () => Promise<NativeBlob>) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await this.load()).bytes();
  }

  async text(): Promise<string> {
    return (await this.load()).text();
  }

  async blob(type: string): Promise<Blob> {
    const handle = await this.load();
    return blobFromNative(handle.type === type ? handle : handle.slice(0, handle.size, type));
  }

  stream(usage: Usage): ReadableStream<Uint8Array> {
    let offset = 0;
    return pullStream(usage, async () => {
      const handle = await this.load();
      const chunk = offset < handle.size ? await handle.read(offset, CHUNK) : null;
      if (chunk === null || chunk.byteLength === 0) return null;
      offset += chunk.byteLength;
      return new Uint8Array(chunk);
    });
  }

  upload(): Promise<NativeBlob> {
    return this.load();
  }
}

/**
 * A ReadableStream a caller made. The body's stream is a stream of ours over it, so that a read, or a cancel, of the body is what makes the body used (the standard's "disturbed",
 * which a caller's stream gives no way to ask): `new Response(stream)`, a read of `response.body` and `response.bodyUsed` is true. The caller's stream is locked only once the first
 * read comes, as a body's own is. A request drains the stream to bytes before sending: uploads are not streamed.
 */
class StreamSource implements BodySource {
  readonly replayable = false;
  constructor(readonly source: ReadableStream<Uint8Array>) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return toArrayBuffer(await readAll(this.source));
  }

  async text(): Promise<string> {
    return decodeUtf8(await readAll(this.source));
  }

  async blob(type: string): Promise<Blob> {
    return new Blob([await readAll(this.source)], { type });
  }

  stream(usage: Usage): ReadableStream<Uint8Array> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    return pullStream(usage, async () => {
      reader ??= this.source.getReader();
      const { done, value } = await reader.read();
      return done ? null : value;
    }, (reason) => (reader ?? this.source).cancel(reason));
  }

  upload(signal?: AbortSignal | null): Promise<Uint8Array> {
    return readAll(this.source, signal);
  }
}

/**
 * The body of a response, still in native code. It is read once, whole (`arrayBuffer`, `text`, `blob`: one native call each) or in chunks (the stream pulls `read(65536)`). When the
 * request's signal aborts, the body ends with the signal's reason: a read in flight rejects with it, and so does the stream, which is errored at once if nobody is reading.
 */
export class NativeBodySource implements BodySource {
  readonly replayable = false;
  #request: NativeRequest;
  #detach: () => void;
  #aborted: { reason: unknown } | null = null;
  #controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  #finished = false;

  /** `detach` stops listening for the abort, and is called once the body has been read to its end (or failed). */
  constructor(request: NativeRequest, detach: () => void) {
    this.#request = request;
    this.#detach = detach;
  }

  abort(reason: unknown): void {
    if (this.#finished) return;
    this.#aborted = { reason };
    this.#request.cancel();
    this.#controller?.error(reason);
    this.#finish();
  }

  /** Lets go of the body without reading it (a null-body response): the transfer stops and the abort is no longer listened for. */
  discard(): void {
    this.#request.cancel();
    this.#finish();
  }

  #finish(): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#detach();
  }

  #failure(error: unknown): unknown {
    return this.#aborted === null ? fetchError(error) : this.#aborted.reason;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    try {
      return await this.#request.arrayBuffer();
    } catch (error) {
      throw this.#failure(error);
    } finally {
      this.#finish();
    }
  }

  async text(): Promise<string> {
    try {
      return await this.#request.text();
    } catch (error) {
      throw this.#failure(error);
    } finally {
      this.#finish();
    }
  }

  async blob(type: string): Promise<Blob> {
    try {
      return blobFromNative(await this.#request.blob(type));
    } catch (error) {
      throw this.#failure(error);
    } finally {
      this.#finish();
    }
  }

  stream(usage: Usage): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#controller = controller;
        if (this.#aborted !== null) controller.error(this.#aborted.reason);
      },
      pull: async (controller) => {
        usage.disturbed = true;
        try {
          const chunk = await this.#request.read(CHUNK);
          if (chunk === null) {
            controller.close();
            this.#finish();
          } else {
            controller.enqueue(new Uint8Array(chunk));
          }
        } catch (error) {
          this.#finish();
          throw this.#failure(error);
        }
      },
      cancel: () => {
        usage.disturbed = true;
        this.#request.cancel();
        this.#finish();
      },
    }, { highWaterMark: 0 });
  }

  async upload(): Promise<Uint8Array> {
    return new Uint8Array(await this.arrayBuffer());
  }
}

export class BodyState {
  stream: ReadableStream<Uint8Array> | null = null;
  usage: Usage = { disturbed: false };
  consumed = false;
  constructor(public source: BodySource | null) {}

  get used(): boolean {
    return this.consumed || this.usage.disturbed;
  }
}

const bodies = new WeakMap<object, BodyState>();

export function setBodyState(owner: object, state: BodyState): void {
  bodies.set(owner, state);
}

export function bodyStateOf(owner: object): BodyState {
  const state = bodies.get(owner);
  if (state === undefined) throw new TypeError("Illegal invocation");
  return state;
}

const unusable = (): TypeError => new TypeError("Body is unusable: the body has already been read, or its stream is locked");

/** A body for `clone()`: shared when its source can be read again, else the stream is teed and each side gets one branch (each tracks its own reads). */
export function cloneBodyState(state: BodyState): BodyState {
  if (state.source === null) return new BodyState(null);
  if (state.used || state.stream?.locked) throw unusable();
  if (state.source.replayable) return new BodyState(state.source);
  const [first, second] = (state.stream ?? state.source.stream({ disturbed: false })).tee();
  const copy = new BodyState(state.source);
  state.usage = { disturbed: false };
  copy.usage = { disturbed: false };
  state.stream = tracked(first, state.usage);
  copy.stream = tracked(second, copy.usage);
  return copy;
}

function tracked(branch: ReadableStream<Uint8Array>, usage: Usage): ReadableStream<Uint8Array> {
  const reader = branch.getReader();
  return pullStream(usage, async () => {
    const { done, value } = await reader.read();
    return done ? null : value;
  }, (reason) => reader.cancel(reason));
}

/** `new Request(request)` takes the body of `request`: this one reads from it from now on, and the other is used up. */
export function takeBodyState(from: BodyState): BodyState {
  if (from.source !== null && (from.used || from.stream?.locked)) throw unusable();
  const taken = new BodyState(from.source);
  taken.stream = from.stream;
  taken.usage = from.usage;
  from.consumed = true;
  return taken;
}

export type ExtractedBody = { source: BodySource; type: string | null };

export const isReadableStream = (value: unknown): value is ReadableStream<Uint8Array> => typeof ReadableStream === "function" && value instanceof ReadableStream;
const isSearchParams = (value: unknown): value is URLSearchParams => (typeof URLSearchParams === "function" && value instanceof URLSearchParams) || Object.prototype.toString.call(value) === "[object URLSearchParams]";

/** The standard's "extract a body": the source for a `BodyInit` and its default Content-Type. An object of no other kind is its string form, as in a browser. */
export function extractBody(value: unknown): ExtractedBody {
  if (typeof value === "string") return { source: new StringSource(toUSVString(value)), type: "text/plain;charset=UTF-8" };
  if (isSearchParams(value)) return { source: new StringSource(value.toString()), type: "application/x-www-form-urlencoded;charset=UTF-8" };
  if (isArrayBuffer(value) || ArrayBuffer.isView(value)) return { source: new BytesSource(viewOf(value).slice()), type: null };
  if (isBlob(value)) {
    const handle = nativeBlobOf(value)!;
    return { source: new BlobSource(async () => handle), type: value.type === "" ? null : value.type };
  }
  if (isFormData(value)) {
    const entries = [...(value as unknown as { _parts: [string, unknown][] })._parts];
    const boundary = newBoundary();
    return { source: new BlobSource(once(() => encodeEntries(entries, boundary))), type: `multipart/form-data; boundary=${boundary}` };
  }
  if (isReadableStream(value)) {
    if (value.locked) throw new TypeError("A body stream cannot be locked");
    return { source: new StreamSource(value), type: null };
  }
  if (isReactNativeBlob(value)) {
    const blob = value as { type: string };
    const type = normalizeType(blob.type);
    return { source: new BlobSource(once(async () => new (native().NativeBlob)([new Uint8Array(await readReactNativeBlob(value))], type))), type: type === "" ? null : type };
  }
  return { source: new StringSource(toUSVString(String(value))), type: "text/plain;charset=UTF-8" };
}

const isMultipart = (type: string): boolean => type.split(";")[0]!.trim().toLowerCase() === "multipart/form-data";

/**
 * Gives `headers` the Content-Type its body brings, as the standard says: when the caller set none. The one exception is a caller who set `multipart/form-data` without the
 * boundary of the body (a header written by habit, which no server can parse a body with): that one is replaced by the body's own, as React Native's XMLHttpRequest and expo/fetch
 * replace it. Any other Content-Type the caller set stays, and so does one that names the body's boundary.
 */
export function applyBodyType(headers: { get(name: string): string | null; set(name: string, value: string): void }, type: string | null): void {
  if (type === null) return;
  const given = headers.get("content-type");
  if (given === null || (isMultipart(type) && isMultipart(given) && boundaryOf(given) !== boundaryOf(type))) headers.set("content-type", type);
}

async function consume<T>(owner: Body, direct: (source: BodySource) => Promise<T>, fromBytes: (bytes: Uint8Array) => T | Promise<T>, empty: () => T): Promise<T> {
  const state = bodyStateOf(owner);
  if (state.source === null) return empty();
  if (state.used || state.stream?.locked) throw unusable();
  state.consumed = true;
  if (state.stream === null) return direct(state.source);
  return fromBytes(await readAll(state.stream));
}

const contentTypeOf = (owner: Body): string => (owner as unknown as { headers: { get(name: string): string | null } }).headers.get("content-type") ?? "";

export class Body {
  get body(): ReadableStream<Uint8Array> | null {
    const state = bodyStateOf(this);
    if (state.source === null) return null;
    state.stream ??= state.consumed
      ? new ReadableStream<Uint8Array>({ start: (controller) => controller.close() })
      : state.source.stream(state.usage);
    return state.stream;
  }

  get bodyUsed(): boolean {
    const state = bodyStateOf(this);
    return state.source !== null && state.used;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return consume(this, (source) => source.arrayBuffer(), toArrayBuffer, () => new ArrayBuffer(0));
  }

  bytes(): Promise<Uint8Array> {
    return consume(this, async (source) => new Uint8Array(await source.arrayBuffer()), (bytes) => bytes, () => new Uint8Array(0));
  }

  text(): Promise<string> {
    return consume(this, (source) => source.text(), (bytes) => decodeUtf8(bytes), () => "");
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.text());
  }

  blob(): Promise<Blob> {
    const type = normalizeType(contentTypeOf(this));
    return consume(this, (source) => source.blob(type), (bytes) => new Blob([bytes], { type }), () => new Blob([], { type }));
  }

  /** Parses `multipart/form-data` (files become Files) and `application/x-www-form-urlencoded`; any other Content-Type is a TypeError. */
  async formData(): Promise<FormData> {
    const type = contentTypeOf(this);
    const bytes = await consume(this, async (source) => new Uint8Array(await source.arrayBuffer()), (chunk) => chunk, () => new Uint8Array(0));
    const essence = type.split(";")[0]!.trim().toLowerCase();
    if (essence === "multipart/form-data") {
      const boundary = boundaryOf(type);
      if (boundary === null) throw new TypeError("The multipart/form-data Content-Type has no boundary");
      return parseMultipart(bytes, boundary);
    }
    if (essence === "application/x-www-form-urlencoded") return parseUrlEncoded(decodeUtf8(bytes));
    throw new TypeError('The Content-Type is not "multipart/form-data" or "application/x-www-form-urlencoded"');
  }
}
