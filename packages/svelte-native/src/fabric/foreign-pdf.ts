/**
 * `react-native-pdf` 7 without React (`index.js`): the native view (`RNPDFPdfView`, a codegen component) takes a local file `path`,
 * so the wrapper's work is getting one. `openPdf` does what `Pdf._loadFromSource` does (a download, a bundled asset, a data URI or
 * a file path, with the optional cache) through `react-native-blob-util`'s native module, and `parsePdfMessage` reads the one
 * string event (`onChange`) the native view sends. Nothing here imports the library or `react-native-blob-util`.
 */
import { turboModule, type Commandable } from "./foreign.ts";

/** A PDF source as the library takes it: a `require`d asset, or `{ uri }` with the optional cache and the request. */
export type PdfSource = number | {
  uri?: string;
  cache?: boolean;
  cacheFileName?: string;
  /** Seconds a cached file stays valid; 0 or none: for ever. */
  expiration?: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type Done<Value = void> = (error?: string | null, value?: Value) => void;
type ResponseInfo = { headers?: Record<string, string> };
/** The functions of `react-native-blob-util`'s TurboModule (`codegenSpecs/NativeBlobUtils.js`) the loading uses. */
export type BlobUtilModule = {
  getConstants(): { CacheDir: string };
  stat(path: string, callback: Done<{ size: string | number; lastModified: string | number }>): void;
  unlink(path: string, callback: Done): void;
  cp(source: string, destination: string, callback: Done<boolean>): void;
  writeFile(path: string, encoding: string, data: string, transformFile: boolean, append: boolean): Promise<number>;
  fetchBlob(options: object, taskId: string, method: string, url: string, headers: object, body: string, callback: (error: string | null, rawType?: string, data?: string, info?: ResponseInfo) => void): void;
  cancelRequest(taskId: string, callback: (...values: unknown[]) => void): void;
};

const blobUtil = (): BlobUtilModule => turboModule<BlobUtilModule>("ReactNativeBlobUtil");

/** `crypto-js`' `SHA1(text).toString()`: the file name of a cached download is the hash of its URI. */
export function sha1(text: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code < 0xdc00 && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low < 0xe000) { code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00); index++; }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  const length = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bits = length * 8;
  for (let shift = 56; shift >= 0; shift -= 8) bytes.push(shift >= 32 ? 0 : (bits >>> shift) & 0xff);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array<number>(80);
  for (let block = 0; block < bytes.length; block += 64) {
    for (let index = 0; index < 16; index++) {
      const at = block + index * 4;
      w[index] = ((bytes[at] as number) << 24) | ((bytes[at + 1] as number) << 16) | ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
    }
    for (let index = 16; index < 80; index++) {
      const value = (w[index - 3] as number) ^ (w[index - 8] as number) ^ (w[index - 14] as number) ^ (w[index - 16] as number);
      w[index] = (value << 1) | (value >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let index = 0; index < 80; index++) {
      let f: number;
      let k: number;
      if (index < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (index < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (index < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const next = ((((a << 5) | (a >>> 27)) + f + e + k + (w[index] as number)) | 0);
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = next;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

const call = <Value>(start: (done: Done<Value>) => void): Promise<Value | undefined> =>
  new Promise((resolve, reject) => start((error, value) => (error ? reject(new Error(error)) : resolve(value))));
const unlinkQuietly = (module: BlobUtilModule, path: string): Promise<void> => call<void>((done) => module.unlink(path, done)).then(() => undefined, () => undefined);

const header = (info: ResponseInfo | undefined, name: string): string | undefined => {
  const headers = info?.headers;
  if (!headers) return undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
};

export type PdfFile = {
  /** The local path of the document; rejects with the library's errors (`no pdf source!`, `DownloadFailed:<uri>`, the module's own). */
  path: Promise<string>;
  /** Stops a download in progress; the promise then rejects or never settles, as the caller left it. */
  cancel(): void;
};
export type OpenPdfOptions = {
  /** `Image.resolveAssetSource` for a `require`d asset. */
  resolveAsset: (asset: number) => { uri?: string } | null | undefined;
  trustAllCerts?: boolean;
  module?: BlobUtilModule;
};

/**
 * `Pdf._loadFromSource` and `_prepareFile`: the file for a source. A cached file that has not expired is used as it is; else a
 * `http(s)` URI is downloaded to `<cache>/<sha1(uri)>.pdf` (through a `.tmp` file, which is checked against the response's
 * `Content-Length` when the response is not encoded and then moved), a `bundle-assets://` file is copied there, a
 * `data:application/pdf;base64,` URI is written there, and any other URI is a file path (`file://` removed, percent escapes decoded).
 */
export function openPdf(source: PdfSource, { resolveAsset, trustAllCerts = true, module = blobUtil() }: OpenPdfOptions): PdfFile {
  const resolved = (typeof source === "number" ? resolveAsset(source) : source) ?? {};
  const spec = resolved as Exclude<PdfSource, number>;
  const uri = spec.uri ?? "";
  const cacheFile = `${module.getConstants().CacheDir}/${spec.cacheFileName || `${sha1(uri)}.pdf`}`;
  let taskId: string | null = null;
  let canceled = false;

  async function download(): Promise<string> {
    const temporary = `${cacheFile}.tmp`;
    await unlinkQuietly(module, temporary);
    taskId = `${Date.now().toString(16)}-${Math.floor(Math.random() * 0xffffffff).toString(16)}`;
    const headers: Record<string, string> = {};
    for (const key of Object.keys(spec.headers ?? {})) headers[key] = spec.headers?.[key] || "";
    try {
      const info = await new Promise<ResponseInfo | undefined>((resolve, reject) => {
        module.fetchBlob({ path: temporary, trusty: trustAllCerts }, taskId as string, spec.method ? spec.method : "GET", uri, headers, spec.body ? spec.body : "", (error, _type, _data, responseInfo) => (error ? reject(new Error(error)) : resolve(responseInfo)));
      });
      taskId = null;
      if (canceled) throw new Error("canceled");
      if (info?.headers && !header(info, "content-encoding") && !header(info, "transfer-encoding") && header(info, "content-length")) {
        const expected = header(info, "content-length");
        let actual: number | undefined;
        try {
          const stat = await call<{ size: string | number }>((done) => module.stat(temporary, done));
          if (!stat || !parseInt(String(stat.size))) throw new Error(`FileNotFound:${uri}`);
          actual = parseInt(String(stat.size));
        } catch {
          throw new Error(`DownloadFailed:${uri}`);
        }
        if (Number(expected) !== actual) throw new Error(`DownloadFailed:${uri}`);
      }
      await unlinkQuietly(module, cacheFile);
      await call<boolean>((done) => module.cp(temporary, cacheFile, done));
      await unlinkQuietly(module, temporary);
      return cacheFile;
    } catch (error) {
      await unlinkQuietly(module, temporary);
      await unlinkQuietly(module, cacheFile);
      throw error;
    }
  }

  async function prepare(): Promise<string> {
    if (!spec.uri) throw new Error("no pdf source!");
    await unlinkQuietly(module, cacheFile);
    if (/^https?:\/\//.test(uri)) return download();
    if (/^bundle-assets:\/\//.test(uri)) {
      try {
        await call<boolean>((done) => module.cp(uri, cacheFile, done));
      } catch (error) {
        await unlinkQuietly(module, cacheFile);
        throw error;
      }
      return cacheFile;
    }
    if (/^data:application\/pdf;base64/.test(uri)) {
      try {
        await module.writeFile(cacheFile, "base64", uri.replace(/data:application\/pdf;base64,/i, ""), false, false);
      } catch (error) {
        await unlinkQuietly(module, cacheFile);
        throw error;
      }
      return cacheFile;
    }
    return decodeURIComponent(uri.replace(/file:\/\//i, ""));
  }

  async function load(): Promise<string> {
    if (spec.cache) {
      try {
        const stat = await call<{ lastModified: string | number }>((done) => module.stat(cacheFile, done));
        if (!stat) throw new Error("no stat");
        if (!spec.expiration || spec.expiration * 1000 + parseInt(String(stat.lastModified)) > Date.now()) return cacheFile;
      } catch {
        // Not cached, or the cache expired: fetch it again.
      }
    }
    return prepare();
  }

  return {
    path: load(),
    cancel() {
      canceled = true;
      if (taskId !== null) module.cancelRequest(taskId, () => undefined);
      taskId = null;
    },
  };
}

/** What the native view's one `onChange` event says: the document loaded, the page changed, an error, a tap, a zoom or a link. */
export type PdfEvent =
  | { type: "loadComplete"; pages: number; size: { width: number; height: number }; tableContents: unknown }
  | { type: "pageChanged"; page: number; pages: number }
  | { type: "error"; error: Error }
  | { type: "pageSingleTap"; page: number; x: number; y: number }
  | { type: "scaleChanged"; scale: number }
  | { type: "linkPressed"; url: string };

/** `Pdf._onChange`: the message is `name|argument|...`; the table of contents of a loaded document is JSON and may contain `|`. */
export function parsePdfMessage(text: string | null | undefined): PdfEvent | null {
  const message = (text ?? "").split("|");
  if (message.length > 5) message[4] = message.splice(4).join("|");
  switch (message[0]) {
    case "loadComplete": {
      let tableContents: unknown;
      try {
        tableContents = message[4] && JSON.parse(message[4]);
      } catch {
        tableContents = message[4];
      }
      return { type: "loadComplete", pages: Number(message[1]), size: { width: Number(message[2]), height: Number(message[3]) }, tableContents };
    }
    case "pageChanged": return { type: "pageChanged", page: Number(message[1]), pages: Number(message[2]) };
    case "error": return { type: "error", error: new Error(message[1]) };
    case "pageSingleTap": return { type: "pageSingleTap", page: Number(message[1]), x: Number(message[2]), y: Number(message[3]) };
    case "scaleChanged": return { type: "scaleChanged", scale: Number(message[1]) };
    case "linkPressed": return { type: "linkPressed", url: message[1] as string };
    default: return null;
  }
}

/** The ref of `Pdf`: the library's `setPage`, a Fabric command of the native view (`setNativePage`). */
export type PdfHandle = { setPage(page: number): void };
export function pdfHandle(host: Commandable): PdfHandle {
  return {
    setPage(page) {
      if (page === null || isNaN(page)) throw new Error("Specified pageNumber is not a number");
      host.dispatchCommand("setNativePage", [page]);
    },
  };
}
