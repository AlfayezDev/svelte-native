import { File, isBlob, isFile, nativeBlobOf, type Blob } from "./blob.ts";
import { toUSVString } from "./encoding.ts";
import { isReactNativeBlob, reactNativeFormData, type RnFormDataPart } from "./rn.ts";

/**
 * `FormData` with the standard's API, built on React Native's own class so that `xhr.send(formData)` (and axios, which sends through XHR) keeps working: React Native's networking tests
 * `body instanceof FormData` against its class and then calls `getParts()`, so ours extends it, keeps the entries in its `_parts` and answers `getParts()` for our Blobs with the `uri` of a
 * file native code writes for them (`NativeBlob.objectURL`). `fetch` does not go through `getParts`: it builds the multipart body as one NativeBlob (`multipart.ts`).
 *
 * An entry is a string, one of our Files (a Blob appended without a name is wrapped as a File named "blob", as the standard says), or what React Native's own FormData takes: an object
 * `{ uri, name, type }` naming a local file, kept as given (the file is opened when the body is sent), or one of its Blobs, converted when sent.
 */
export type RnFileValue = { uri: string; name?: string; type?: string };
export type FormDataEntryValue = string | File | RnFileValue;

export const isRnFileValue = (value: unknown): value is RnFileValue => typeof value === "object" && value !== null && !isBlob(value) && typeof (value as { uri?: unknown }).uri === "string";

function entryValue(value: unknown, filename: string | undefined): unknown {
  if (isBlob(value)) {
    if (isFile(value) && filename === undefined) return value;
    return new File([value], filename === undefined ? "blob" : filename, { type: value.type, lastModified: isFile(value) ? value.lastModified : undefined });
  }
  if (filename !== undefined) {
    if (isRnFileValue(value)) return { ...value, name: filename };
    if (isReactNativeBlob(value)) return value;
    throw new TypeError("FormData: a filename can only be given with a Blob");
  }
  return isRnFileValue(value) || isReactNativeBlob(value) ? value : toUSVString(String(value));
}

const Base = reactNativeFormData();

function requireArguments(method: string, given: number, wanted: number): void {
  if (given < wanted) throw new TypeError(`FormData.${method} requires ${wanted} argument${wanted === 1 ? "" : "s"}, but only ${given} present`);
}

export class FormData extends Base {
  constructor(form?: unknown) {
    super();
    if (form !== undefined) throw new TypeError("FormData cannot be built from a form: there are no forms in a native app");
  }

  append(...args: [name: string, value: string | Blob | RnFileValue, filename?: string]): void {
    requireArguments("append", args.length, 2);
    this._parts.push([toUSVString(String(args[0])), entryValue(args[1], args[2] === undefined ? undefined : toUSVString(String(args[2])))]);
  }

  delete(...args: [name: string]): void {
    requireArguments("delete", args.length, 1);
    const name = String(args[0]);
    this._parts = this._parts.filter(([entry]) => entry !== name);
  }

  get(...args: [name: string]): FormDataEntryValue | null {
    requireArguments("get", args.length, 1);
    const name = String(args[0]);
    return (this._parts.find(([entry]) => entry === name)?.[1] ?? null) as FormDataEntryValue | null;
  }

  getAll(...args: [name: string]): FormDataEntryValue[] {
    requireArguments("getAll", args.length, 1);
    const name = String(args[0]);
    return this._parts.filter(([entry]) => entry === name).map(([, value]) => value as FormDataEntryValue);
  }

  has(...args: [name: string]): boolean {
    requireArguments("has", args.length, 1);
    const name = String(args[0]);
    return this._parts.some(([entry]) => entry === name);
  }

  /** Replaces the first entry of that name (in place) and drops the others, or appends when there is none. */
  set(...args: [name: string, value: string | Blob | RnFileValue, filename?: string]): void {
    requireArguments("set", args.length, 2);
    const name = toUSVString(String(args[0]));
    const value = entryValue(args[1], args[2] === undefined ? undefined : toUSVString(String(args[2])));
    const first = this._parts.findIndex(([entry]) => entry === name);
    if (first === -1) this._parts.push([name, value]);
    else this._parts = this._parts.filter(([entry], index) => entry !== name || index === first).map((pair, index) => (index === first ? [name, value] : pair));
  }

  forEach(callback: (value: FormDataEntryValue, name: string, formData: FormData) => void, thisArg?: unknown): void {
    if (typeof callback !== "function") throw new TypeError("FormData.forEach requires a function");
    for (const [name, value] of this.entries()) callback.call(thisArg, value, name, this);
  }

  *entries(): IterableIterator<[string, FormDataEntryValue]> {
    for (let index = 0; index < this._parts.length; index++) yield [this._parts[index]![0], this._parts[index]![1] as FormDataEntryValue];
  }

  *keys(): IterableIterator<string> {
    for (const [name] of this.entries()) yield name;
  }

  *values(): IterableIterator<FormDataEntryValue> {
    for (const [, value] of this.entries()) yield value;
  }

  [Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]> {
    return this.entries();
  }

  /**
   * What React Native's networking reads: React Native's own parts, and for each of our Blobs the `uri` of the file native code keeps its bytes in. Writing that file is
   * synchronous (`objectURL` is), so the first call costs a write of every Blob's bytes on the JavaScript thread. `XMLHttpRequest.send` is wrapped (`xhr.ts`) to delete the files when
   * the request ends; a caller of `getParts()` on its own owns them (`URL.revokeObjectURL`).
   */
  getParts(): RnFormDataPart[] {
    const parts = super.getParts();
    this._parts.forEach(([, value], index) => {
      const handle = nativeBlobOf(value);
      if (handle === undefined) return;
      const part = parts[index]!;
      part.uri = handle.objectURL();
      if (part.headers["content-type"] === "") part.headers["content-type"] = "application/octet-stream";
    });
    return parts;
  }

  get [Symbol.toStringTag](): string {
    return "FormData";
  }
}

/** Whether a value is a FormData of ours or React Native's (a library may import its class directly). */
export const isFormData = (value: unknown): value is FormData => typeof value === "object" && value !== null && value instanceof Base;
