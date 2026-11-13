import { File, isBlob, nativeBlobOf, normalizeType } from "./blob.ts";
import { decodeUtf8, encodeUtf8, indexOfBytes, toUSVString, viewOf } from "./encoding.ts";
import { FormData, isRnFileValue } from "./form-data.ts";
import { native } from "./module.ts";
import type { NativeBlob } from "./native.ts";
import { isReactNativeBlob, readReactNativeBlob } from "./rn.ts";

/** What a FormData body is made of, and what it is made from: `multipart/form-data` and `application/x-www-form-urlencoded`. */
export type FormEntries = readonly (readonly [string, unknown])[];

export function newBoundary(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let boundary = "----SvelteNativeFormBoundary";
  for (let i = 0; i < 16; i++) boundary += characters[Math.floor(Math.random() * characters.length)];
  return boundary;
}

/** The standard's newline normalisation of a name or a value: a lone CR or LF becomes CRLF. */
const crlf = (text: string): string => text.replace(/\r\n|\r|\n/g, "\r\n");
const quoted = (text: string): string => text.replace(/\n/g, "%0A").replace(/\r/g, "%0D").replace(/"/g, "%22");

function head(boundary: string, name: string, filename: string | null, type: string | null): string {
  let text = `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(crlf(toUSVString(name)))}"`;
  if (filename !== null) text += `; filename="${quoted(toUSVString(filename))}"`;
  if (type !== null) text += `\r\nContent-Type: ${type}`;
  return `${text}\r\n\r\n`;
}

/**
 * The multipart body of `entries` as one NativeBlob made of string parts and the entries' own Blobs: the bytes of a file are never read into JavaScript. A file of React Native's
 * `{ uri, name, type }` kind is opened natively (`blobFromURI`); one of its Blobs is read through its FileReader (the interop's slow path).
 */
export async function encodeEntries(entries: FormEntries, boundary: string): Promise<NativeBlob> {
  const parts: (NativeBlob | Uint8Array | string)[] = [];
  const text = (value: string): void => {
    const last = parts[parts.length - 1];
    if (typeof last === "string") parts[parts.length - 1] = last + value;
    else parts.push(value);
  };
  for (const [name, value] of entries) {
    if (typeof value === "string") {
      text(head(boundary, name, null, null) + crlf(value) + "\r\n");
    } else if (isBlob(value)) {
      text(head(boundary, name, (value as File).name ?? "blob", value.type === "" ? "application/octet-stream" : value.type));
      parts.push(nativeBlobOf(value)!);
      text("\r\n");
    } else if (isRnFileValue(value)) {
      const type = value.type === undefined ? "application/octet-stream" : value.type;
      text(head(boundary, name, typeof value.name === "string" ? value.name : null, type));
      parts.push(await native().blobFromURI(value.uri, normalizeType(type)));
      text("\r\n");
    } else if (isReactNativeBlob(value)) {
      const blob = value as { type: string };
      text(head(boundary, name, "blob", blob.type === "" ? "application/octet-stream" : blob.type));
      parts.push(new Uint8Array(await readReactNativeBlob(value)));
      text("\r\n");
    } else {
      text(head(boundary, name, null, null) + crlf(toUSVString(String(value))) + "\r\n");
    }
  }
  text(`--${boundary}--\r\n`);
  return new (native().NativeBlob)(parts, "");
}

/** The `boundary` parameter of a multipart Content-Type, or null. */
export function boundaryOf(contentType: string): string | null {
  const match = /;\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match === null ? null : (match[1] ?? match[2] ?? null);
}

const unquote = (text: string): string => text.replace(/%0A/gi, "\n").replace(/%0D/gi, "\r").replace(/%22/g, '"');

function parameters(header: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of header.matchAll(/;\s*([^\s=;]+)\s*=\s*(?:"([^"]*)"|([^;\s]*))/g)) result.set(match[1]!.toLowerCase(), unquote(match[2] ?? match[3] ?? ""));
  return result;
}

/** The standard's multipart/form-data parser: a part with a `filename` is a File (type text/plain unless the part says), any other a string. Anything it cannot parse is a TypeError. */
export function parseMultipart(bytes: Uint8Array, boundary: string): FormData {
  function bad(why: string): never {
    throw new TypeError(`Invalid multipart/form-data body: ${why}`);
  }
  const delimiter = encodeUtf8(`--${boundary}`);
  const lineAndDelimiter = encodeUtf8(`\r\n--${boundary}`);
  const blankLine = encodeUtf8("\r\n\r\n");
  const form = new FormData();
  let at = indexOfBytes(bytes, delimiter);
  if (at === -1) bad("the boundary is not in the body");
  at += delimiter.length;
  for (;;) {
    if (bytes[at] === 0x2d && bytes[at + 1] === 0x2d) return form;
    while (bytes[at] === 0x20 || bytes[at] === 0x09) at++;
    if (bytes[at] !== 0x0d || bytes[at + 1] !== 0x0a) bad("a boundary is not followed by a line break");
    at += 2;
    let headers = "";
    if (bytes[at] === 0x0d && bytes[at + 1] === 0x0a) at += 2;
    else {
      const end = indexOfBytes(bytes, blankLine, at);
      if (end === -1) bad("a part has no end of headers");
      headers = decodeUtf8(bytes.subarray(at, end));
      at = end + 4;
    }
    const next = indexOfBytes(bytes, lineAndDelimiter, at);
    if (next === -1) bad("a part is not closed by the boundary");
    const content = bytes.subarray(at, next);
    at = next + lineAndDelimiter.length;
    let disposition: Map<string, string> | undefined;
    let type: string | undefined;
    for (const line of headers.split("\r\n")) {
      const colon = line.indexOf(":");
      const name = line.slice(0, colon).trim().toLowerCase();
      if (name === "content-disposition") disposition = parameters(`;${line.slice(colon + 1).replace(/^\s*[^;]*/, "")}`);
      else if (name === "content-type") type = line.slice(colon + 1).trim();
    }
    const name = disposition?.get("name");
    if (name === undefined) bad("a part has no name");
    const filename = disposition?.get("filename");
    if (filename === undefined) form.append(name, decodeUtf8(content, true));
    else form.append(name, new File([viewOf(content)], filename, { type: type ?? "text/plain" }));
  }
}

/** The `application/x-www-form-urlencoded` parser: every pair a string entry. */
export function parseUrlEncoded(text: string): FormData {
  const form = new FormData();
  for (const [name, value] of new URLSearchParams(text)) form.append(name, value);
  return form;
}
