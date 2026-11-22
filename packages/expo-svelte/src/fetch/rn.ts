// What the Fetch objects borrow from React Native, each loaded on first use: its `FormData` (which XMLHttpRequest, and so axios, still recognises and sends), and its `Blob` and
// `FileReader` (an XHR response of type "blob" is one of its Blobs, whose bytes live in its own native store, readable through its own FileReader and nothing else).
/* eslint-disable @typescript-eslint/no-require-imports -- each is required on first use */

type RnFormDataPart = { uri?: string; name?: string; type?: string; string?: string; headers: Record<string, string>; fieldName: string };
export type RnFormDataConstructor = new () => { _parts: [string, unknown][]; getParts(): RnFormDataPart[] };
export type { RnFormDataPart };

let formData: RnFormDataConstructor | undefined;
export function reactNativeFormData(): RnFormDataConstructor {
  formData ??= (require("react-native/Libraries/Network/FormData") as { default: RnFormDataConstructor }).default;
  return formData;
}

type RnBlobConstructor = abstract new (...args: never[]) => { readonly size: number; readonly type: string };
let blobClass: RnBlobConstructor | undefined;

/** Whether a value is one of React Native's Blobs (or Files): what an XHR with `responseType = "blob"`, `expo-image-picker` and the like hand out. */
export function isReactNativeBlob(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  blobClass ??= (require("react-native/Libraries/Blob/Blob") as { default: RnBlobConstructor }).default;
  return value instanceof blobClass;
}

type RnFileReader = {
  result: ArrayBuffer | string | null;
  error: Error | null;
  addEventListener(type: "load" | "error", listener: () => void): void;
  readAsArrayBuffer(blob: unknown): void;
};

/** The bytes of one of React Native's Blobs: through its FileReader (a base64 round trip, the only way out of its store), so this is the slow path of the interop. */
export function readReactNativeBlob(blob: unknown): Promise<ArrayBuffer> {
  const Reader = (require("react-native/Libraries/Blob/FileReader") as { default: new () => RnFileReader }).default;
  return new Promise((resolve, reject) => {
    const reader = new Reader();
    reader.addEventListener("load", () => resolve(reader.result as ArrayBuffer));
    reader.addEventListener("error", () => reject(reader.error ?? new TypeError("A React Native Blob could not be read")));
    reader.readAsArrayBuffer(blob);
  });
}

type RnXhrPrototype = {
  _headers: Record<string, string>;
  setRequestHeader(name: string, value: string): void;
  addEventListener(type: "loadend", listener: () => void): void;
  send(body?: unknown): void;
};

/** The prototype of React Native's XMLHttpRequest (axios, and every library on XHR, runs on it). */
export function reactNativeXHRPrototype(): RnXhrPrototype {
  return (require("react-native/Libraries/Network/XMLHttpRequest") as { default: { prototype: RnXhrPrototype } }).default.prototype;
}
