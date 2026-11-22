import { nativeBlobOf, type Blob } from "./blob.ts";
import { isFormData } from "./form-data.ts";
import { native } from "./module.ts";
import { reactNativeXHRPrototype } from "./rn.ts";
import { handedOut } from "./url.ts";

/**
 * XMLHttpRequest, which axios and every other library on XHR still runs on, sends what React Native's networking understands, and that has no idea of our Blobs: its
 * `convertRequestBody` recognises its own Blob class, so `xhr.send(blob)` would hand native code an object it reads nothing from, and an empty body goes out. This wraps
 * `send`: one of our Blobs (or Files) is sent as the `{ uri }` body both platforms' networking accepts (iOS loads the URL through its request handlers, Android opens it as a file), the
 * `file://` URL of the file native code keeps the Blob's bytes in (`NativeBlob.objectURL`). Android refuses a `{ uri }` body without a Content-Type, so one is set from the Blob's type
 * (application/octet-stream when it has none) when the caller set none.
 *
 * The files are written, synchronously, by this `send` (the contract's `objectURL` is synchronous), one per Blob, and a large Blob costs a write of its bytes on the JavaScript
 * thread: an upload of a big file is better made with `fetch`, which sends the Blob's own segments and writes nothing. They are deleted when the request ends (`loadend`: done, failed, aborted
 * or timed out): both the Blob of a `{ uri }` body and every Blob of a FormData that `getParts()` turns into a file part (`form-data.ts`). A file stays while another XHR that
 * sends the same Blob still runs, and is never deleted when the app made the URL itself with `URL.createObjectURL`.
 */
const wrapped = Symbol.for("expo-svelte.xhr-send");
const inUse = new Map<string, number>();

export function patchXHRSend(): void {
  const prototype = reactNativeXHRPrototype();
  const send = prototype.send as typeof prototype.send & { [wrapped]?: true };
  if (send[wrapped]) return;
  const patched = function (this: typeof prototype, body?: unknown): void {
    const handle = nativeBlobOf(body);
    const sources = handle !== undefined ? [handle] : isFormData(body) ? (body as unknown as { _parts: [string, unknown][] })._parts.flatMap(([, value]) => nativeBlobOf(value) ?? []) : [];
    if (sources.length === 0) {
      send.call(this, body);
      return;
    }
    const urls = [...new Set(sources.map((source) => source.objectURL()))].filter((url) => !handedOut.has(url));
    for (const url of urls) inUse.set(url, (inUse.get(url) ?? 0) + 1);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      for (const url of urls) {
        const count = (inUse.get(url) ?? 1) - 1;
        if (count > 0) inUse.set(url, count);
        else {
          inUse.delete(url);
          native().revokeObjectURL(url);
        }
      }
    };
    this.addEventListener("loadend", release);
    let payload = body;
    if (handle !== undefined) {
      payload = { uri: handle.objectURL() };
      if (this._headers["content-type"] === undefined) this.setRequestHeader("Content-Type", (body as Blob).type || "application/octet-stream");
    }
    try {
      send.call(this, payload);
    } catch (error) {
      release();
      throw error;
    }
  };
  Object.defineProperty(patched, wrapped, { value: true });
  prototype.send = patched;
}
