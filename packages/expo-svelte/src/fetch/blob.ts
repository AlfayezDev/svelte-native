import { toUSVString, viewOf } from "./encoding.ts";
import { native } from "./module.ts";
import type { NativeBlob } from "./native.ts";
import { isReactNativeBlob } from "./rn.ts";

/**
 * `Blob` and `File` over `NativeBlob`: the bytes stay in native code (an ordered list of segments, buffers and ranges of files); a Blob is a handle on them. Building a Blob from Blobs, slicing it,
 * uploading it and reading a response as one copy no bytes through JavaScript; `arrayBuffer`, `bytes`, `text` and `stream` are where they cross, as one ArrayBuffer or 64 KiB chunks.
 */
export type BlobPart = ArrayBuffer | ArrayBufferView | Blob | string;
export type BlobPropertyBag = { type?: string; endings?: "transparent" | "native" };
export type FilePropertyBag = BlobPropertyBag & { lastModified?: number };

const handles = new WeakMap<object, NativeBlob>();
const fileInfo = new WeakMap<object, { name: string; lastModified: number }>();

const CHUNK = 65536;

/** A blob's type as the File API has it: "" when it has a character outside U+0020 to U+007E, else lower case. */
export function normalizeType(type: unknown): string {
  const text = type === undefined ? "" : String(type);
  return /[^\x20-\x7e]/.test(text) ? "" : text.toLowerCase();
}

function handleOf(blob: Blob): NativeBlob {
  const handle = handles.get(blob);
  if (handle === undefined) throw new TypeError("Illegal invocation");
  return handle;
}

/** The native handle of one of these Blobs (or Files), or undefined for any other value. */
export function nativeBlobOf(value: unknown): NativeBlob | undefined {
  return typeof value === "object" && value !== null ? handles.get(value) : undefined;
}

export function isBlob(value: unknown): value is Blob {
  return nativeBlobOf(value) !== undefined;
}

/** A Blob over bytes native code already holds (a response body, a file). */
export function blobFromNative(handle: NativeBlob): Blob {
  const blob = Object.create(Blob.prototype) as Blob;
  handles.set(blob, handle);
  return blob;
}

function options(value: unknown, what: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" && typeof value !== "function") throw new TypeError(`${what}: the options must be an object`);
  return value as Record<string, unknown>;
}

/** The standard's "convert line endings to native": every CRLF, CR and LF becomes the platform's line ending, and on a phone that is LF. */
const nativeEndings = (text: string): string => text.replace(/\r\n|\r/g, "\n");

function partsOf(parts: unknown, endings: unknown): (NativeBlob | Uint8Array | string)[] {
  if (parts === undefined) return [];
  if (typeof parts !== "object" || parts === null || typeof (parts as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== "function") {
    throw new TypeError("The Blob parts must be an iterable of strings, buffers and Blobs");
  }
  if (endings !== undefined && endings !== "transparent" && endings !== "native") throw new TypeError(`The provided value '${String(endings)}' is not a valid enum value of type EndingType`);
  const result: (NativeBlob | Uint8Array | string)[] = [];
  for (const part of parts as Iterable<unknown>) {
    const handle = nativeBlobOf(part);
    if (handle !== undefined) result.push(handle);
    else if (part instanceof ArrayBuffer || ArrayBuffer.isView(part)) result.push(viewOf(part));
    else if (isReactNativeBlob(part)) throw new TypeError("A React Native Blob cannot be a part of a Blob: its bytes can only be read asynchronously. Read it with `await new Response(blob).blob()` first");
    else result.push(endings === "native" ? nativeEndings(String(part)) : String(part));
  }
  return result;
}

function clampedInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Math.trunc(Number(value));
  return Number.isNaN(number) ? 0 : number;
}

export class Blob {
  constructor(blobParts?: Iterable<BlobPart>, init?: BlobPropertyBag) {
    const bag = options(init, "Blob");
    const parts = partsOf(blobParts, bag.endings);
    handles.set(this, new (native().NativeBlob)(parts, normalizeType(bag.type)));
  }

  get size(): number {
    return handleOf(this).size;
  }

  get type(): string {
    return handleOf(this).type;
  }

  /** Bytes [start, end) as a new Blob over the same segments. Negative indices count from the end; both are clamped to the size. */
  slice(start?: number, end?: number, contentType?: string): Blob {
    const handle = handleOf(this);
    const size = handle.size;
    const from = clampedInteger(start, 0);
    const to = clampedInteger(end, size);
    const first = from < 0 ? Math.max(size + from, 0) : Math.min(from, size);
    const last = to < 0 ? Math.max(size + to, 0) : Math.min(to, size);
    return blobFromNative(handle.slice(first, Math.max(first, last), normalizeType(contentType)));
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return handleOf(this).bytes();
  }

  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await handleOf(this).bytes());
  }

  text(): Promise<string> {
    return handleOf(this).text();
  }

  /** The bytes in 64 KiB chunks, read from native code as the stream is pulled. */
  stream(): ReadableStream<Uint8Array> {
    const handle = handleOf(this);
    let offset = 0;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = offset < handle.size ? await handle.read(offset, CHUNK) : null;
        if (chunk === null || chunk.byteLength === 0) {
          controller.close();
          return;
        }
        offset += chunk.byteLength;
        controller.enqueue(new Uint8Array(chunk));
      },
    }, { highWaterMark: 0 });
  }

  get [Symbol.toStringTag](): string {
    return "Blob";
  }
}

export class File extends Blob {
  constructor(...args: [fileBits: Iterable<BlobPart>, fileName: string, options?: FilePropertyBag]) {
    if (args.length < 2) throw new TypeError("File requires 2 arguments: the parts and a name");
    super(args[0], args[2]);
    const lastModified = options(args[2], "File").lastModified;
    fileInfo.set(this, { name: toUSVString(String(args[1])), lastModified: lastModified === undefined ? Date.now() : clampedInteger(lastModified as number, 0) });
  }

  get name(): string {
    const info = fileInfo.get(this);
    if (info === undefined) throw new TypeError("Illegal invocation");
    return info.name;
  }

  get lastModified(): number {
    const info = fileInfo.get(this);
    if (info === undefined) throw new TypeError("Illegal invocation");
    return info.lastModified;
  }

  get [Symbol.toStringTag](): string {
    return "File";
  }
}

export function isFile(value: unknown): value is File {
  return typeof value === "object" && value !== null && fileInfo.has(value);
}
