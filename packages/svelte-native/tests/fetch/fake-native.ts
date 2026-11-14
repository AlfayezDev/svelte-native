// A JavaScript implementation of the native module's contract (`src/fetch/native.ts`), for host checks of the JavaScript layer: real HTTP with node:http against `server.ts` (started in
// this process, on a random port: the routes the devices use), `file://` through node:fs, and a Blob that is a list of segments (buffers and ranges of files) exactly as the contract
// describes. It also counts what crosses into JavaScript (`log`), so a check can say that a response read as a Blob did not read its bytes.
import { mkdirSync, mkdtempSync, openSync, readSync, closeSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";
import type { HeaderList, NativeRequestInit, NativeResponseHead, SvelteFetchModule } from "../../src/fetch/native.ts";
import { handle } from "./server.ts";

type Segment = { kind: "bytes"; bytes: Uint8Array } | { kind: "file"; path: string; start: number; end: number };

const failure = (code: string, message: string): Error => Object.assign(new Error(message), { code });
const exact = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

export type Fake = {
  module: SvelteFetchModule;
  /** `http://127.0.0.1:<port>`. */
  base: string;
  /** Every call that carries bytes into JavaScript or starts native work, in order: "blob.bytes", "request.read", ... */
  log: string[];
  /** The Cookie headers native code has sent (its "system cookie store" is per host). */
  cookies: Map<string, Map<string, string>>;
  blobDirectory: string;
  /** The requests `start` is running (not yet ended or cancelled). */
  live: Set<unknown>;
  /** What each `start` was given, in order: the headers as native code received them from JavaScript, before the fake's own HTTP client joins them. */
  starts: { url: string; init: NativeRequestInit }[];
};

export async function startFake(): Promise<Fake> {
  const log: string[] = [];
  const blobDirectory = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "svelte-fetch-blobs-"));
  mkdirSync(blobDirectory, { recursive: true });
  const cookies = new Map<string, Map<string, string>>();
  const live = new Set<unknown>();
  const starts: Fake["starts"] = [];
  let objectCount = 0;

  function readSegment(segment: Segment, from: number, to: number): Uint8Array {
    if (segment.kind === "bytes") return segment.bytes.subarray(from, to);
    const out = new Uint8Array(to - from);
    const fd = openSync(segment.path, "r");
    try {
      readSync(fd, out, 0, out.length, segment.start + from);
    } finally {
      closeSync(fd);
    }
    return out;
  }
  const lengthOf = (segment: Segment): number => (segment.kind === "bytes" ? segment.bytes.length : segment.end - segment.start);

  class FakeNativeBlob {
    segments: Segment[] = [];
    size = 0;
    type: string;
    #objectURL: string | undefined;

    constructor(parts: (FakeNativeBlob | Uint8Array | string)[], type: string) {
      this.type = type;
      for (const part of parts) {
        if (part instanceof FakeNativeBlob) this.segments.push(...part.segments);
        else if (typeof part === "string") this.segments.push({ kind: "bytes", bytes: new TextEncoder().encode(part) });
        else this.segments.push({ kind: "bytes", bytes: part.slice() });
      }
      this.size = this.segments.reduce((sum, segment) => sum + lengthOf(segment), 0);
    }

    slice(start: number, end: number, type: string): FakeNativeBlob {
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > this.size) throw new RangeError(`slice(${start}, ${end}) is outside 0..${this.size}`);
      const result = new FakeNativeBlob([], type);
      let at = 0;
      for (const segment of this.segments) {
        const length = lengthOf(segment);
        const from = Math.max(start - at, 0), to = Math.min(end - at, length);
        if (from < to) {
          result.segments.push(segment.kind === "bytes" ? { kind: "bytes", bytes: segment.bytes.subarray(from, to) } : { kind: "file", path: segment.path, start: segment.start + from, end: segment.start + to });
        }
        at += length;
      }
      result.size = end - start;
      return result;
    }

    all(): Uint8Array {
      const out = new Uint8Array(this.size);
      let at = 0;
      for (const segment of this.segments) {
        const bytes = readSegment(segment, 0, lengthOf(segment));
        out.set(bytes, at);
        at += bytes.length;
      }
      return out;
    }

    async bytes(): Promise<ArrayBuffer> {
      log.push("blob.bytes");
      return exact(this.all());
    }

    async text(): Promise<string> {
      log.push("blob.text");
      return new TextDecoder("utf-8").decode(this.all());
    }

    async read(offset: number, length: number): Promise<ArrayBuffer> {
      log.push("blob.read");
      const bytes = this.all();
      return exact(bytes.subarray(Math.min(offset, bytes.length), Math.min(offset + length, bytes.length)));
    }

    objectURL(): string {
      log.push("blob.objectURL");
      // As both native implementations: written on the first call, and written again at the same URL when it was revoked since.
      if (this.#objectURL === undefined) this.#objectURL = pathToFileURL(join(blobDirectory, `${++objectCount}.bin`)).href;
      const path = fileURLToPath(this.#objectURL);
      if (!existsSync(path)) writeFileSync(path, this.all());
      return this.#objectURL;
    }
  }

  const cookieHeader = (host: string): string | undefined => {
    const jar = cookies.get(host);
    return jar === undefined || jar.size === 0 ? undefined : [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  };

  const REDIRECTS = [301, 302, 303, 307, 308];

  class FakeNativeRequest {
    #cancelled = false;
    #current: { destroy(): void } | undefined;
    #chunks: Uint8Array[] = [];
    #unread = 0;
    #ended = false;
    #error: Error | undefined;
    #wake: (() => void)[] = [];
    #mode: "read" | "whole" | undefined;
    #resume: (() => void) | undefined;
    #pending = new Set<(error: Error) => void>();
    /** Rejects the `start` that is waiting for a head: the contract has `cancel` do that whatever the platform's client does to a request it destroys. */
    #abortHead: (() => void) | undefined;
    maxUnread = 0;
    paused = 0;

    constructor() {
      live.add(this);
    }

    cancel(): void {
      log.push("request.cancel");
      if (this.#ended && this.#chunks.length === 0) return;
      this.#cancelled = true;
      this.#current?.destroy();
      this.#abortHead?.();
      live.delete(this);
      for (const reject of this.#pending) reject(failure("ERR_FETCH_ABORTED", "The request was cancelled"));
      this.#pending.clear();
      this.#signal();
    }

    #signal(): void {
      for (const wake of this.#wake.splice(0)) wake();
    }

    #wait(): Promise<void> {
      return new Promise((resolve, reject) => {
        const fail = (error: Error) => reject(error);
        this.#pending.add(fail);
        this.#wake.push(() => { this.#pending.delete(fail); resolve(); });
      });
    }

    async start(url: string, init: NativeRequestInit, body: FakeNativeBlob | Uint8Array | string | null): Promise<NativeResponseHead> {
      log.push("request.start");
      starts.push({ url, init });
      const bytes = body === null ? null : typeof body === "string" ? new TextEncoder().encode(body) : body instanceof FakeNativeBlob ? body.all() : body.slice();
      let method = init.method;
      let payload = bytes;
      let headers: HeaderList = init.headers;
      let current = url;
      let redirected = false;
      for (let hops = 0; ; hops++) {
        if (this.#cancelled) throw failure("ERR_FETCH_ABORTED", "The request was cancelled");
        const head = await this.#once(current, method, headers, payload, init);
        if (REDIRECTS.includes(head.status) && head.location !== undefined && init.redirect !== "manual") {
          head.discard();
          if (init.redirect === "error") throw failure("ERR_FETCH_REDIRECT", `The server redirected ${current}`);
          if (hops >= 20) throw failure("ERR_FETCH_REDIRECT", "Too many redirects");
          current = new URL(head.location, current).href;
          redirected = true;
          if (head.status === 303 || ((head.status === 301 || head.status === 302) && method === "POST")) {
            if (method !== "HEAD") method = "GET";
            payload = null;
            headers = headers.filter(([name]) => !["content-type", "content-length"].includes(name));
          }
          continue;
        }
        return { status: head.status, statusText: head.statusText, headers: head.headers, url: current, redirected };
      }
    }

    async #once(url: string, method: string, headers: HeaderList, payload: Uint8Array | null, init: NativeRequestInit) {
      const target = new URL(url);
      if (target.protocol === "file:") {
        let file: Uint8Array;
        try {
          file = readFileSync(fileURLToPath(target));
        } catch (error) {
          throw failure("ERR_FETCH_NETWORK", `${(error as Error).message}`);
        }
        this.#chunks.push(file);
        this.#unread = file.length;
        this.#ended = true;
        return { status: 200, statusText: "OK", headers: [["content-length", String(file.length)]] as HeaderList, location: undefined, discard() {} };
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") throw failure("ERR_FETCH_URL", `unsupported scheme ${target.protocol}`);
      const outgoing: OutgoingHttpHeaders = {};
      for (const [name, value] of headers) outgoing[name] = outgoing[name] === undefined ? value : `${String(outgoing[name])}, ${value}`;
      outgoing["accept-encoding"] ??= "gzip";
      if (init.credentials === "include") {
        const cookie = cookieHeader(target.host);
        if (cookie !== undefined) outgoing.cookie = outgoing.cookie === undefined ? cookie : `${String(outgoing.cookie)}; ${cookie}`;
      }
      if (payload !== null) outgoing["content-length"] = payload.length;
      return new Promise<{ status: number; statusText: string; headers: HeaderList; location: string | undefined; discard(): void }>((resolve, reject) => {
        const send = target.protocol === "https:" ? httpsRequest : httpRequest;
        this.#abortHead = () => reject(failure("ERR_FETCH_ABORTED", "The request was cancelled"));
        const req = send(target, { method, headers: outgoing }, (res: IncomingMessage) => {
          this.#abortHead = undefined;
          const raw: HeaderList = [];
          for (let i = 0; i < res.rawHeaders.length; i += 2) raw.push([res.rawHeaders[i]!, res.rawHeaders[i + 1]!]);
          if (init.credentials === "include") {
            for (const [name, value] of raw) {
              if (name.toLowerCase() !== "set-cookie") continue;
              const [pair] = value.split(";");
              const [cookieName, ...rest] = pair!.split("=");
              if (!cookies.has(target.host)) cookies.set(target.host, new Map());
              cookies.get(target.host)!.set(cookieName!.trim(), rest.join("="));
            }
          }
          // Like the system's client, merge the repeated headers' values except Set-Cookie on Android (OkHttp keeps them apart): the fake keeps every pair as received.
          const gzip = /gzip/i.test(String(res.headers["content-encoding"] ?? ""));
          const source = gzip ? res.pipe(createGunzip()) : res;
          this.#current = { destroy: () => { res.destroy(); req.destroy(); } };
          const discard = (): void => { res.destroy(); };
          resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? "", headers: raw, location: res.headers.location, discard });
          if (REDIRECTS.includes(res.statusCode ?? 0) && init.redirect !== "manual") return;
          source.on("data", (chunk: Buffer) => {
            this.#chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length).slice());
            this.#unread += chunk.length;
            this.maxUnread = Math.max(this.maxUnread, this.#unread);
            if (this.#unread > 1048576) { this.paused++; res.pause(); this.#resume = () => res.resume(); }
            this.#signal();
          });
          source.on("end", () => { this.#ended = true; this.#signal(); });
          source.on("error", (error: Error) => { this.#error = failure("ERR_FETCH_NETWORK", error.message); this.#signal(); });
          res.on("error", (error: Error) => { this.#error = failure("ERR_FETCH_NETWORK", error.message); this.#signal(); });
          res.on("close", () => { if (!res.complete && !this.#cancelled) { this.#error ??= failure("ERR_FETCH_NETWORK", "The connection closed before the body was complete"); this.#signal(); } });
        });
        this.#current = { destroy: () => req.destroy() };
        req.on("error", (error: Error) => reject(this.#cancelled ? failure("ERR_FETCH_ABORTED", "The request was cancelled") : failure("ERR_FETCH_NETWORK", error.message)));
        if (this.#cancelled) req.destroy();
        req.end(payload === null ? undefined : Buffer.from(payload));
      });
    }

    #take(kind: "read" | "whole"): void {
      if (this.#mode !== undefined && (this.#mode !== kind || kind === "whole")) throw failure("ERR_FETCH_BODY_USED", "The body has already been consumed");
      this.#mode = kind;
    }

    async #next(max: number): Promise<Uint8Array | null> {
      for (;;) {
        if (this.#cancelled) throw failure("ERR_FETCH_ABORTED", "The request was cancelled");
        const first = this.#chunks[0];
        if (first !== undefined) {
          const part = first.subarray(0, max);
          if (part.length === first.length) this.#chunks.shift();
          else this.#chunks[0] = first.subarray(max);
          this.#unread -= part.length;
          if (this.#unread <= 1048576 && this.#resume !== undefined) { const resume = this.#resume; this.#resume = undefined; resume(); }
          return part;
        }
        if (this.#error !== undefined) throw this.#error;
        if (this.#ended) return null;
        await this.#wait();
      }
    }

    async #all(): Promise<Uint8Array> {
      const parts: Uint8Array[] = [];
      for (let part = await this.#next(1 << 30); part !== null; part = await this.#next(1 << 30)) parts.push(part);
      live.delete(this);
      const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of parts) { out.set(part, at); at += part.length; }
      return out;
    }

    async read(maxBytes: number): Promise<ArrayBuffer | null> {
      log.push("request.read");
      this.#take("read");
      const chunk = await this.#next(maxBytes);
      if (chunk === null) { live.delete(this); return null; }
      return exact(chunk);
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
      log.push("request.arrayBuffer");
      this.#take("whole");
      return exact(await this.#all());
    }

    async text(): Promise<string> {
      log.push("request.text");
      this.#take("whole");
      return new TextDecoder("utf-8").decode(await this.#all());
    }

    async blob(type: string): Promise<FakeNativeBlob> {
      log.push("request.blob");
      this.#take("whole");
      return new FakeNativeBlob([await this.#all()], type);
    }
  }

  const server = createServer((req, res) => void handle(req, res).catch((error) => { res.destroy(error as Error); }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  server.unref();
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;

  const module = {
    NativeBlob: FakeNativeBlob,
    NativeRequest: FakeNativeRequest,
    async blobFromURI(uri: string, type: string) {
      log.push("blobFromURI");
      let path: string;
      try {
        path = fileURLToPath(uri);
        const size = statSync(path).size;
        const blob = new FakeNativeBlob([], type);
        blob.segments.push({ kind: "file", path, start: 0, end: size });
        blob.size = size;
        return blob;
      } catch (error) {
        throw failure("ERR_FETCH_NETWORK", (error as Error).message);
      }
    },
    revokeObjectURL(url: string) {
      log.push("revokeObjectURL");
      try {
        const path = fileURLToPath(url);
        if (path.startsWith(blobDirectory) && existsSync(path)) rmSync(path);
      } catch {
        // not a file URL: ignored, as the contract says
      }
    },
  } as unknown as SvelteFetchModule;

  return { module, base, log, cookies, blobDirectory, live, starts };
}
