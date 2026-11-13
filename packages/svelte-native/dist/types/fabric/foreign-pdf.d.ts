/**
 * `react-native-pdf` 7 without React (`index.js`): the native view (`RNPDFPdfView`, a codegen component) takes a local file `path`,
 * so the wrapper's work is getting one. `openPdf` does what `Pdf._loadFromSource` does (a download, a bundled asset, a data URI or
 * a file path, with the optional cache) through `react-native-blob-util`'s native module, and `parsePdfMessage` reads the one
 * string event (`onChange`) the native view sends. Nothing here imports the library or `react-native-blob-util`.
 */
import { type Commandable } from "./foreign.js";
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
type ResponseInfo = {
    headers?: Record<string, string>;
};
/** The functions of `react-native-blob-util`'s TurboModule (`codegenSpecs/NativeBlobUtils.js`) the loading uses. */
export type BlobUtilModule = {
    getConstants(): {
        CacheDir: string;
    };
    stat(path: string, callback: Done<{
        size: string | number;
        lastModified: string | number;
    }>): void;
    unlink(path: string, callback: Done): void;
    cp(source: string, destination: string, callback: Done<boolean>): void;
    writeFile(path: string, encoding: string, data: string, transformFile: boolean, append: boolean): Promise<number>;
    fetchBlob(options: object, taskId: string, method: string, url: string, headers: object, body: string, callback: (error: string | null, rawType?: string, data?: string, info?: ResponseInfo) => void): void;
    cancelRequest(taskId: string, callback: (...values: unknown[]) => void): void;
};
/** `crypto-js`' `SHA1(text).toString()`: the file name of a cached download is the hash of its URI. */
export declare function sha1(text: string): string;
export type PdfFile = {
    /** The local path of the document; rejects with the library's errors (`no pdf source!`, `DownloadFailed:<uri>`, the module's own). */
    path: Promise<string>;
    /** Stops a download in progress; the promise then rejects or never settles, as the caller left it. */
    cancel(): void;
};
export type OpenPdfOptions = {
    /** `Image.resolveAssetSource` for a `require`d asset. */
    resolveAsset: (asset: number) => {
        uri?: string;
    } | null | undefined;
    trustAllCerts?: boolean;
    module?: BlobUtilModule;
};
/**
 * `Pdf._loadFromSource` and `_prepareFile`: the file for a source. A cached file that has not expired is used as it is; else a
 * `http(s)` URI is downloaded to `<cache>/<sha1(uri)>.pdf` (through a `.tmp` file, which is checked against the response's
 * `Content-Length` when the response is not encoded and then moved), a `bundle-assets://` file is copied there, a
 * `data:application/pdf;base64,` URI is written there, and any other URI is a file path (`file://` removed, percent escapes decoded).
 */
export declare function openPdf(source: PdfSource, { resolveAsset, trustAllCerts, module }: OpenPdfOptions): PdfFile;
/** What the native view's one `onChange` event says: the document loaded, the page changed, an error, a tap, a zoom or a link. */
export type PdfEvent = {
    type: "loadComplete";
    pages: number;
    size: {
        width: number;
        height: number;
    };
    tableContents: unknown;
} | {
    type: "pageChanged";
    page: number;
    pages: number;
} | {
    type: "error";
    error: Error;
} | {
    type: "pageSingleTap";
    page: number;
    x: number;
    y: number;
} | {
    type: "scaleChanged";
    scale: number;
} | {
    type: "linkPressed";
    url: string;
};
/** `Pdf._onChange`: the message is `name|argument|...`; the table of contents of a loaded document is JSON and may contain `|`. */
export declare function parsePdfMessage(text: string | null | undefined): PdfEvent | null;
/** The ref of `Pdf`: the library's `setPage`, a Fabric command of the native view (`setNativePage`). */
export type PdfHandle = {
    setPage(page: number): void;
};
export declare function pdfHandle(host: Commandable): PdfHandle;
export {};
