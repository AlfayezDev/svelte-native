// The HTTP server the fetch checks run against: the host checks of the native module, and the device checks of the showcase's Web APIs screen. Plain node:http
// (Node strips its types), no dependencies. Usage: node tests/fetch/server.ts [--port 8787]. Run it with Node, not Bun: Bun 1.3's node:http stalls the
// third request on a kept-alive connection, and the platforms' clients reuse connections. An Android emulator reaches it after
// `adb reverse tcp:8787 tcp:8787`; the iOS Simulator reaches the Mac's localhost, so it runs there too.
//
// Routes (every response carries `Cache-Control: no-store`):
//   GET  /bytes?n=N&seed=S      N bytes (default 1024) of a seeded xorshift32 stream: the client recomputes them with `seededBytes`. Content-Type application/octet-stream.
//   ANY  /echo                  JSON: { method, url, headers (pairs as received, names lower case), bodyLength, bodySha256 (hex), bodyText (when <= 64 KiB and valid UTF-8, else null) }.
//   POST /multipart             Parses a multipart/form-data body. JSON: { parts: [{ name, filename, type, length, sha256, text }] } (text when <= 4 KiB, else null).
//   GET  /redirect?n=N&status=S  A redirect chain of N hops (status S, default 302) ending at /echo. /redirect?to=URL&status=S redirects once to URL.
//   GET  /status/CODE            An empty response with that status (and reason phrase Node knows).
//   GET  /set-cookie?name=&value=  Sets a cookie (Path=/). GET /cookies answers JSON { cookie: the Cookie header or null }.
//   GET  /stream?chunks=N&size=B&delay=MS  N chunks of B bytes of `seededBytes(N*B, 7)`, MS apart (chunked transfer encoding).
//   GET  /utf8                   The bytes EF BB BF (a BOM), "héllo ", C3 28 (invalid), " wörld ✓": a client's UTF-8 decode reads "héllo �( wörld ✓".
//   GET  /gzip                   "compressed ".repeat(1000), gzip-encoded (Content-Encoding: gzip).
//   GET  /headers                Response headers: X-One: 1, X-Multi: a and X-Multi: b, Set-Cookie: a=1 and Set-Cookie: b=2 (each on a line of its own).
//   GET  /hang                   Sends the head, then one byte, then never ends (for abort checks).
//   GET  /no-head                Never answers (for abort-before-head checks).
//   GET  /large?mb=M             M MiB (default 8) of `seededBytes(M*1MiB, 11)`, sent in 64 KiB writes (for backpressure and memory checks).
import { createHash } from "node:crypto";
import { createServer, STATUS_CODES, type IncomingMessage, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";

/** xorshift32 bytes from `seed` (a zero seed is 1): what /bytes, /stream and /large send. */
export function seededBytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function utf8OrNull(bytes: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

function headerPairs(req: IncomingMessage): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) pairs.push([req.rawHeaders[i]!.toLowerCase(), req.rawHeaders[i + 1]!]);
  return pairs;
}

function parseMultipart(body: Buffer, contentType: string): { name: string; filename: string | null; type: string | null; length: number; sha256: string; text: string | null }[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new Error("no boundary");
  const boundary = Buffer.from(`--${match[1] ?? match[2]}`);
  const parts = [];
  let at = body.indexOf(boundary);
  while (at !== -1) {
    const start = at + boundary.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const headEnd = body.indexOf("\r\n\r\n", start);
    const next = body.indexOf(boundary, headEnd);
    if (headEnd === -1 || next === -1) throw new Error("truncated multipart body");
    const head = body.subarray(start + 2, headEnd).toString("utf8");
    const content = body.subarray(headEnd + 4, next - 2); // the CRLF before the next boundary belongs to the delimiter
    const disposition = /content-disposition:([^\r\n]*)/i.exec(head)?.[1] ?? "";
    const name = /\bname="([^"]*)"/.exec(disposition)?.[1] ?? "";
    const filename = /\bfilename="([^"]*)"/.exec(disposition)?.[1] ?? null;
    const type = /content-type:\s*([^\r\n]*)/i.exec(head)?.[1]?.trim() ?? null;
    parts.push({ name, filename, type, length: content.length, sha256: sha256(content), text: content.length <= 4096 ? utf8OrNull(content) : null });
    at = next;
  }
  return parts;
}

const utf8Sample = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("héllo "), Buffer.from([0xc3, 0x28]), Buffer.from(" wörld ✓")]);
const gzipSample = gzipSync(Buffer.from("compressed ".repeat(1000)));

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const query = url.searchParams;
  const int = (name: string, fallback: number) => (query.has(name) ? Number.parseInt(query.get(name)!, 10) : fallback);
  const path = url.pathname;
  // A HEAD response has no body. Node's http drops one; Bun's node:http sends it, and on a kept-alive connection those bytes would be read as the
  // start of the next response. Closing the connection after a HEAD keeps the next request on a fresh one.
  if (req.method === "HEAD") res.setHeader("Connection", "close");

  if (path === "/bytes") {
    const bytes = seededBytes(int("n", 1024), int("seed", 1));
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length, "Cache-Control": "no-store" });
    res.end(bytes);
  } else if (path === "/echo") {
    const body = await readBody(req);
    json(res, { method: req.method, url: req.url, headers: headerPairs(req), bodyLength: body.length, bodySha256: sha256(body), bodyText: body.length <= 65536 ? utf8OrNull(body) : null });
  } else if (path === "/multipart") {
    const body = await readBody(req);
    try {
      json(res, { parts: parseMultipart(body, req.headers["content-type"] ?? "") });
    } catch (error) {
      json(res, { error: String(error) }, 400);
    }
  } else if (path === "/redirect") {
    const status = int("status", 302);
    const to = query.get("to");
    const n = int("n", 1);
    const location = to ?? (n > 1 ? `/redirect?n=${n - 1}&status=${status}` : "/echo");
    res.writeHead(status, { Location: location, "Content-Length": 0, "Cache-Control": "no-store" });
    res.end();
  } else if (path.startsWith("/status/")) {
    const code = Number.parseInt(path.slice("/status/".length), 10);
    res.writeHead(code, STATUS_CODES[code] ?? "", { "Content-Length": 0, "Cache-Control": "no-store" });
    res.end();
  } else if (path === "/set-cookie") {
    res.writeHead(200, { "Set-Cookie": `${query.get("name") ?? "c"}=${query.get("value") ?? "1"}; Path=/`, "Content-Length": 0, "Cache-Control": "no-store" });
    res.end();
  } else if (path === "/cookies") {
    json(res, { cookie: req.headers.cookie ?? null });
  } else if (path === "/stream") {
    const chunks = int("chunks", 5), size = int("size", 1024), delay = int("delay", 100);
    const bytes = seededBytes(chunks * size, 7);
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" });
    for (let i = 0; i < chunks; i++) {
      res.write(bytes.subarray(i * size, (i + 1) * size));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    res.end();
  } else if (path === "/utf8") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": utf8Sample.length, "Cache-Control": "no-store" });
    res.end(utf8Sample);
  } else if (path === "/gzip") {
    res.writeHead(200, { "Content-Type": "text/plain", "Content-Encoding": "gzip", "Content-Length": gzipSample.length, "Cache-Control": "no-store" });
    res.end(gzipSample);
  } else if (path === "/headers") {
    res.writeHead(200, [["X-One", "1"], ["X-Multi", "a"], ["X-Multi", "b"], ["Set-Cookie", "a=1"], ["Set-Cookie", "b=2"], ["Content-Length", "0"], ["Cache-Control", "no-store"]].flat());
    res.end();
  } else if (path === "/hang") {
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" });
    res.write(Buffer.from([1]));
  } else if (path === "/no-head") {
    // never answers
  } else if (path === "/large") {
    const total = int("mb", 8) * 1024 * 1024;
    const bytes = seededBytes(total, 11);
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": total, "Cache-Control": "no-store" });
    let at = 0;
    const pump = () => {
      while (at < total) {
        const ok = res.write(bytes.subarray(at, Math.min(at + 65536, total)));
        at += 65536;
        if (!ok) return void res.once("drain", pump);
      }
      res.end();
    };
    pump();
  } else {
    json(res, { error: `no route ${path}` }, 404);
  }
}

const isMain = import.meta.main ?? process.argv[1]?.endsWith("server.ts");
if (isMain) {
  const portFlag = process.argv.indexOf("--port");
  const port = portFlag === -1 ? 8787 : Number.parseInt(process.argv[portFlag + 1]!, 10);
  createServer((req, res) => void handle(req, res).catch((error) => { res.destroy(error as Error); })).listen(port, "0.0.0.0", () => console.log(`fetch test server on :${port}`));
}

export { handle };
