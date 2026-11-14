// Imported first by every file of tests/fetch: the device's parts that the JavaScript layer borrows (React Native's FormData, Blob and FileReader, whose sources are Flow and cannot be
// loaded by Bun) and the fake native module. `mock.module` is global to the test process: only these three specifiers are mocked, and no other test loads them.
import { mock } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setNativeModule } from "../../src/fetch/module.ts";
import { startFake } from "./fake-native.ts";

/** React Native's FormData as it is in `Libraries/Network/FormData.js` (the class XHR recognises), without the Flow annotations. */
class RnFormData {
  _parts: [string, unknown][] = [];

  append(key: string, value: unknown): void {
    this._parts.push([key, value]);
  }

  getAll(key: string): unknown[] {
    return this._parts.filter(([name]) => name === key).map(([, value]) => value);
  }

  getParts(): Record<string, unknown>[] {
    return this._parts.map(([name, value]) => {
      const headers: Record<string, string> = { "content-disposition": `form-data; name="${name}"` };
      if (typeof value === "object" && !Array.isArray(value) && value) {
        const file = value as { name?: unknown; type?: unknown };
        if (typeof file.name === "string") headers["content-disposition"] += `; filename="${encodeURIComponent(file.name.replace(/\//g, "_"))}"`;
        if (typeof file.type === "string") headers["content-type"] = file.type;
        return { ...value, headers, fieldName: name };
      }
      return { string: String(value), headers, fieldName: name };
    });
  }
}

/** React Native's Blob: `data.blobId` into a native store that only its FileReader reads. */
const rnStore = new Map<string, Uint8Array>();
let rnCount = 0;
class RnBlob {
  data: { blobId: string; offset: number; size: number; type: string };
  constructor(blobId: string, size: number, type: string) {
    this.data = { blobId, offset: 0, size, type };
  }

  get size(): number {
    return this.data.size;
  }

  get type(): string {
    return this.data.type;
  }
}

export function makeRnBlob(bytes: Uint8Array, type = ""): RnBlob {
  const id = `rn-${++rnCount}`;
  rnStore.set(id, bytes);
  return new RnBlob(id, bytes.length, type);
}

/** The reads of React Native's FileReader that the interop made (what a check counts to say that the slow path was taken). */
export const rnReads: string[] = [];

class RnFileReader extends EventTarget {
  result: ArrayBuffer | string | null = null;
  error: Error | null = null;

  readAsArrayBuffer(blob: RnBlob): void {
    rnReads.push(blob.data.blobId);
    queueMicrotask(() => {
      const bytes = rnStore.get(blob.data.blobId);
      if (bytes === undefined) {
        this.error = new Error("no such blob");
        this.dispatchEvent(new Event("error"));
        return;
      }
      this.result = bytes.slice(blob.data.offset, blob.data.offset + blob.data.size).buffer;
      this.dispatchEvent(new Event("load"));
    });
  }
}

/**
 * React Native's XMLHttpRequest as far as the library meets it: `send` converts the body as `convertRequestBody` does (its own Blob and FormData are recognised, anything else is
 * passed on as it is) and hands it to "networking", which here keeps it in `sent` and, for a `{ uri }` body, reads the file at that moment the way native code would. `finish()` ends
 * the request: `loadend`.
 */
class RnXhr extends EventTarget {
  _headers: Record<string, string> = {};
  sent: { body: unknown; headers: Record<string, string>; file?: Uint8Array; parts?: unknown[] } | undefined;

  setRequestHeader(name: string, value: string): void {
    this._headers[name.toLowerCase()] = String(value);
  }

  /** Makes the next `send` throw, as React Native's does for a request that was not opened. */
  failNext = false;

  send(body: unknown): void {
    if (this.failNext) throw new Error("Request has not been opened");
    const data = typeof body === "string" ? { string: body } : body instanceof RnBlob ? { blob: body.data } : body instanceof RnFormData ? { formData: body.getParts() } : body;
    this.sent = { body: data, headers: { ...this._headers } };
    const uri = (data as { uri?: unknown } | null)?.uri;
    if (typeof uri === "string") this.sent.file = new Uint8Array(readFileSync(fileURLToPath(uri)));
    const parts = (data as { formData?: { uri?: string }[] } | null)?.formData;
    if (parts !== undefined) this.sent.parts = parts.map((part) => ({ ...part, file: part.uri === undefined ? undefined : new Uint8Array(readFileSync(fileURLToPath(part.uri))) }));
  }

  finish(): void {
    this.dispatchEvent(new Event("loadend"));
  }
}

mock.module("react-native/Libraries/Network/XMLHttpRequest", () => ({ default: RnXhr }));
mock.module("react-native/Libraries/Network/FormData", () => ({ default: RnFormData }));
mock.module("react-native/Libraries/Blob/Blob", () => ({ default: RnBlob }));
mock.module("react-native/Libraries/Blob/FileReader", () => ({ default: RnFileReader }));

export const fake = await startFake();
setNativeModule(fake.module);
export { RnFormData, RnBlob, RnXhr };
