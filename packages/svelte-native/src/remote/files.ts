/** In-memory upload. Read bytes using your platform's picker/file API; a URI is not file content. */
export class NativeFile {
  readonly #data: Uint8Array;
  readonly name: string;
  readonly type: string;
  readonly lastModified: number;

  constructor(bytes: Uint8Array, name: string, options: { type?: string; lastModified?: number; maxBytes?: number } = {}) {
    const limit = options.maxBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("maxBytes must be a non-negative safe integer");
    if (!(bytes instanceof Uint8Array)) throw new TypeError("NativeFile requires Uint8Array contents, not a file URI");
    if (bytes.byteLength > limit) throw new RangeError(`NativeFile exceeds the ${limit} byte upload limit`);
    // Control characters are intentionally rejected from upload filenames.
    // eslint-disable-next-line no-control-regex
    if (typeof name !== "string" || !name || /[\\/\u0000-\u001f]/.test(name)) throw new TypeError("NativeFile requires a filename without path separators or control characters");
    const modified = options.lastModified ?? Date.now();
    if (!Number.isSafeInteger(Math.trunc(modified))) throw new TypeError("lastModified must truncate to a safe integer");
    this.#data = Uint8Array.from(bytes);
    this.name = name;
    this.type = /^[\x20-\x7e]*$/.test(options.type ?? "") ? (options.type ?? "").toLowerCase() : "";
    this.lastModified = Math.trunc(modified);
    Object.freeze(this);
  }
  get size(): number { return this.#data.byteLength; }
  bytes(): Uint8Array { return this.#data.slice(); }
}

/** Private SvelteKit binary-form Blob adapter, not a global Blob replacement. */
export class BinaryFormBlob {
  readonly #data: Uint8Array;
  constructor(parts: ReadonlyArray<Uint8Array | string | NativeFile> = []) {
    const encoder = new TextEncoder();
    const chunks = parts.map((part) => {
      if (typeof part === "string") return encoder.encode(part);
      if (part instanceof Uint8Array) return part;
      if (part instanceof NativeFile) return part.bytes();
      throw new TypeError("Native uploads must use NativeFile with explicitly read bytes");
    });
    this.#data = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) { this.#data.set(chunk, offset); offset += chunk.byteLength; }
  }
  get size(): number { return this.#data.byteLength; }
  bytes(): Uint8Array { return this.#data.slice(); }
}
