// Text and byte helpers the Fetch objects share. Everything here is standard JavaScript on bytes; the platform's own text codecs (`TextEncoder`, `TextDecoder`) are read from the
// global scope at the call, where Expo's runtime installs them on a device.

/** A string with each lone surrogate replaced by U+FFFD (what the standards call a USVString). */
export function toUSVString(value: string): string {
  let result: string | undefined;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    const lone = unit >= 0xd800 && unit <= 0xdbff
      ? !(i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff)
      : unit >= 0xdc00 && unit <= 0xdfff && !(i > 0 && value.charCodeAt(i - 1) >= 0xd800 && value.charCodeAt(i - 1) <= 0xdbff);
    if (lone) result ??= value.slice(0, i);
    if (result !== undefined) result += lone ? "�" : value[i];
  }
  return result ?? value;
}

export const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The Encoding standard's "UTF-8 decode": a leading byte order mark is dropped (unless `keepBom`) and each invalid sequence is U+FFFD. */
export const decodeUtf8 = (bytes: Uint8Array, keepBom = false): string => new TextDecoder("utf-8", { ignoreBOM: keepBom }).decode(bytes);

/** The bytes of `view` as an ArrayBuffer of exactly its length: its own buffer when it covers all of it, else a copy. */
export function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) return view.buffer as ArrayBuffer;
  return view.slice().buffer;
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  let length = 0;
  for (const chunk of chunks) length += chunk.byteLength;
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

/** The bytes a BufferSource names, as a view over the same memory. */
export function viewOf(source: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64Encode(bytes: Uint8Array): string {
  const pieces: string[] = [];
  let piece = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    piece += ALPHABET[a >> 2]! + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    piece += b === undefined ? "==" : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]! + (c === undefined ? "=" : ALPHABET[c & 63]!);
    if (piece.length >= 8192) { pieces.push(piece); piece = ""; }
  }
  pieces.push(piece);
  return pieces.join("");
}

const DECODE = new Map([...ALPHABET].map((character, index) => [character, index]));

/** The Infra standard's "forgiving-base64 decode": ASCII whitespace is dropped, one or two `=` may end the data, and a length of 1 mod 4 or a stray character is a failure (null). */
export function base64Decode(text: string): Uint8Array | null {
  let data = text.replace(/[\t\n\f\r ]+/g, "");
  if (data.length % 4 === 0) data = data.replace(/==?$/, "");
  if (data.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(data)) return null;
  const bytes = new Uint8Array(Math.floor((data.length * 3) / 4));
  let buffer = 0, bits = 0, at = 0;
  for (const character of data) {
    buffer = (buffer << 6) | DECODE.get(character)!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (buffer >> bits) & 0xff;
      buffer &= (1 << bits) - 1;
    }
  }
  return bytes;
}

/** The URL standard's "percent-decode" of a string: its UTF-8 bytes, with each valid `%XX` replaced by the byte. */
export function percentDecode(text: string): Uint8Array {
  const input = encodeUtf8(text);
  const output = new Uint8Array(input.length);
  const hex = (byte: number | undefined): number => (byte === undefined ? -1 : byte >= 0x30 && byte <= 0x39 ? byte - 0x30 : byte >= 0x41 && byte <= 0x46 ? byte - 0x37 : byte >= 0x61 && byte <= 0x66 ? byte - 0x57 : -1);
  let at = 0;
  for (let i = 0; i < input.length; i++) {
    const high = input[i] === 0x25 ? hex(input[i + 1]) : -1;
    const low = high === -1 ? -1 : hex(input[i + 2]);
    if (low === -1) output[at++] = input[i]!;
    else { output[at++] = high * 16 + low; i += 2; }
  }
  return output.subarray(0, at);
}

/** Each byte as the character of that code (the "isomorphic decode"). */
export function latin1(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 4096) result += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return result;
}

/** The index of `needle` in `haystack` at or after `from`, or -1. */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0]!;
  const last = haystack.length - needle.length;
  for (let at = haystack.indexOf(first, from); at !== -1 && at <= last; at = haystack.indexOf(first, at + 1)) {
    let i = 1;
    while (i < needle.length && haystack[at + i] === needle[i]) i++;
    if (i === needle.length) return at;
  }
  return -1;
}
