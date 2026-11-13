// Imported first by every file of tests/fetch: the device's parts that the JavaScript layer borrows (React Native's FormData, Blob and FileReader, whose sources are Flow and cannot be
// loaded by Bun) and the fake native module. `mock.module` is global to the test process: only these three specifiers are mocked, and no other test loads them.
import { mock } from "bun:test";
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

mock.module("react-native/Libraries/Network/FormData", () => ({ default: RnFormData }));
mock.module("react-native/Libraries/Blob/Blob", () => ({ default: RnBlob }));
mock.module("react-native/Libraries/Blob/FileReader", () => ({ default: RnFileReader }));

export const fake = await startFake();
setNativeModule(fake.module);
export { RnFormData, RnBlob };
