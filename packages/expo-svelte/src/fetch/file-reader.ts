import { isBlob, nativeBlobOf, type Blob } from "./blob.ts";
import { base64Encode, decodeUtf8, latin1 } from "./encoding.ts";
import { isReactNativeBlob, readReactNativeBlob } from "./rn.ts";

/**
 * `FileReader` over Blobs of ours (read natively, as one ArrayBuffer) and over React Native's own Blobs (delegated to React Native's FileReader). Events are the standard's: `loadstart`,
 * then `load` (or `error`, or `abort`), then `loadend`; a handler property (`onload`, ...) is a listener. A reader that is loading throws InvalidStateError when asked to read again.
 */
const EMPTY = 0, LOADING = 1, DONE = 2;
const EVENTS = ["loadstart", "progress", "load", "abort", "error", "loadend"] as const;
type EventName = (typeof EVENTS)[number];

type Handler = (event: Event) => void;
type State = { readyState: 0 | 1 | 2; result: string | ArrayBuffer | null; error: Error | null; generation: number; handlers: Partial<Record<EventName, Handler | null>> };
const states = new WeakMap<FileReader, State>();

function stateOf(reader: FileReader): State {
  const state = states.get(reader);
  if (state === undefined) throw new TypeError("Illegal invocation");
  return state;
}

function progressEvent(type: EventName, loaded: number, total: number): Event {
  const event = new Event(type);
  Object.defineProperties(event, { lengthComputable: { value: true }, loaded: { value: loaded }, total: { value: total } });
  return event;
}

/** The `charset` a Blob's type or an `encoding` argument names, when it is not UTF-8, as a label `TextDecoder` may know. */
const decoderFor = (label: string): ((bytes: Uint8Array) => string) | null => {
  const name = label.trim().toLowerCase();
  if (name === "" || name === "utf-8" || name === "utf8") return null;
  try {
    const decoder = new TextDecoder(name);
    return (bytes) => decoder.decode(bytes);
  } catch {
    return null;
  }
};

export class FileReader extends EventTarget {
  static readonly EMPTY = EMPTY;
  static readonly LOADING = LOADING;
  static readonly DONE = DONE;
  readonly EMPTY = EMPTY;
  readonly LOADING = LOADING;
  readonly DONE = DONE;

  constructor() {
    super();
    states.set(this, { readyState: EMPTY, result: null, error: null, generation: 0, handlers: {} });
    for (const type of EVENTS) {
      this.addEventListener(type, (event) => stateOf(this).handlers[type]?.call(this, event));
    }
  }

  get readyState(): 0 | 1 | 2 {
    return stateOf(this).readyState;
  }

  get result(): string | ArrayBuffer | null {
    return stateOf(this).result;
  }

  get error(): Error | null {
    return stateOf(this).error;
  }

  get onloadstart(): Handler | null {
    return stateOf(this).handlers.loadstart ?? null;
  }

  set onloadstart(handler: Handler | null) {
    stateOf(this).handlers.loadstart = typeof handler === "function" ? handler : null;
  }

  get onprogress(): Handler | null {
    return stateOf(this).handlers.progress ?? null;
  }

  set onprogress(handler: Handler | null) {
    stateOf(this).handlers.progress = typeof handler === "function" ? handler : null;
  }

  get onload(): Handler | null {
    return stateOf(this).handlers.load ?? null;
  }

  set onload(handler: Handler | null) {
    stateOf(this).handlers.load = typeof handler === "function" ? handler : null;
  }

  get onabort(): Handler | null {
    return stateOf(this).handlers.abort ?? null;
  }

  set onabort(handler: Handler | null) {
    stateOf(this).handlers.abort = typeof handler === "function" ? handler : null;
  }

  get onerror(): Handler | null {
    return stateOf(this).handlers.error ?? null;
  }

  set onerror(handler: Handler | null) {
    stateOf(this).handlers.error = typeof handler === "function" ? handler : null;
  }

  get onloadend(): Handler | null {
    return stateOf(this).handlers.loadend ?? null;
  }

  set onloadend(handler: Handler | null) {
    stateOf(this).handlers.loadend = typeof handler === "function" ? handler : null;
  }

  readAsArrayBuffer(blob: Blob): void {
    this.#read(blob, "readAsArrayBuffer", async (bytes) => bytes());
  }

  readAsBinaryString(blob: Blob): void {
    this.#read(blob, "readAsBinaryString", async (bytes) => latin1(new Uint8Array(await bytes())));
  }

  readAsText(blob: Blob, encoding = "UTF-8"): void {
    const decode = decoderFor(encoding);
    // UTF-8 is decoded natively when the blob is ours: the bytes do not come to JavaScript to be decoded.
    this.#read(blob, "readAsText", async (bytes, text) => (decode === null ? text() : decode(new Uint8Array(await bytes()))));
  }

  readAsDataURL(blob: Blob): void {
    this.#read(blob, "readAsDataURL", async (bytes) => `data:${blob.type === "" ? "application/octet-stream" : blob.type};base64,${base64Encode(new Uint8Array(await bytes()))}`);
  }

  abort(): void {
    const state = stateOf(this);
    state.result = null;
    if (state.readyState !== LOADING) return;
    state.generation++;
    state.readyState = DONE;
    this.dispatchEvent(progressEvent("abort", 0, 0));
    this.dispatchEvent(progressEvent("loadend", 0, 0));
  }

  #read(blob: unknown, method: string, convert: (bytes: () => Promise<ArrayBuffer>, text: () => Promise<string>) => Promise<string | ArrayBuffer>): void {
    const state = stateOf(this);
    if (!isBlob(blob) && !isReactNativeBlob(blob)) throw new TypeError(`Failed to execute '${method}' on 'FileReader': parameter 1 is not of type 'Blob'.`);
    if (state.readyState === LOADING) throw new DOMException("The object is in an invalid state.", "InvalidStateError");
    state.readyState = LOADING;
    state.result = null;
    state.error = null;
    const generation = ++state.generation;
    const handle = nativeBlobOf(blob);
    const bytes = handle === undefined ? () => readReactNativeBlob(blob) : () => handle.bytes();
    const text = async () => (handle === undefined ? decodeUtf8(new Uint8Array(await readReactNativeBlob(blob))) : handle.text());
    const size = (blob as { size: number }).size;
    void (async () => {
      await Promise.resolve();
      if (state.generation !== generation) return;
      this.dispatchEvent(progressEvent("loadstart", 0, size));
      try {
        const result = await convert(bytes, text);
        if (state.generation !== generation) return;
        state.result = result;
        state.readyState = DONE;
        this.dispatchEvent(progressEvent("load", size, size));
      } catch (error) {
        if (state.generation !== generation) return;
        state.error = error instanceof Error ? error : new Error(String(error));
        state.readyState = DONE;
        this.dispatchEvent(progressEvent("error", 0, size));
      }
      this.dispatchEvent(progressEvent("loadend", state.error === null ? size : 0, size));
    })();
  }

  get [Symbol.toStringTag](): string {
    return "FileReader";
  }
}
