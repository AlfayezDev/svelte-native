import { installAbortStatics } from "./abort.ts";
import { optionalNative } from "./module.ts";

/**
 * What `polyfills.ts` calls, on the first read of one of the globals it made lazy: the global's value. That is Svelte Native's own object when the app's binary has the native module
 * `SvelteFetch` (found by one registry lookup, the first time), and what the runtime had (Expo's `fetch`, React Native's `Blob`, ...) when it has not: an app that updated its JavaScript
 * without rebuilding keeps working. All eight come from the same side, whichever is read first. Loading the implementation, patching `URL.createObjectURL` and adding
 * `AbortSignal.timeout` and `AbortSignal.any` where they are missing, and teaching React Native's XMLHttpRequest to send our Blobs (`xhr.ts`) happen then too, never at boot.
 */
export const FETCH_GLOBALS = ["fetch", "Headers", "Request", "Response", "Blob", "File", "FileReader", "FormData"] as const;
export type FetchGlobal = (typeof FETCH_GLOBALS)[number];

let ours: Record<FetchGlobal, unknown> | null | undefined;

function activate(): Record<FetchGlobal, unknown> | null {
  if (optionalNative() === null) return null;
  /* eslint-disable @typescript-eslint/no-require-imports -- required on first use */
  const layer = require("./index.ts") as typeof import("./index.ts");
  (require("./url.ts") as typeof import("./url.ts")).patchObjectURLs();
  (require("./xhr.ts") as typeof import("./xhr.ts")).patchXHRSend();
  /* eslint-enable @typescript-eslint/no-require-imports */
  installAbortStatics();
  return { fetch: layer.fetch, Headers: layer.Headers, Request: layer.Request, Response: layer.Response, Blob: layer.Blob, File: layer.File, FileReader: layer.FileReader, FormData: layer.FormData };
}

export function resolveGlobal(name: FetchGlobal, previous: PropertyDescriptor | undefined): unknown {
  ours ??= activate();
  if (ours !== null) return ours[name];
  return previous?.get ? previous.get.call(globalThis) : previous?.value;
}
