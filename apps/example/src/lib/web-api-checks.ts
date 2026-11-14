// The device checks of the web APIs Svelte Native backs with native code: `fetch` and `Blob` (the SvelteFetch module), `crypto` (react-native-quick-crypto),
// `localStorage` (MMKV) and `navigator` (the clipboard through the SvelteClipboard module, the language, `canShare`, `vibrate`, and the geolocation over expo-location's). They run against the library's test server (packages/svelte-native/tests/fetch/server.ts) when the Web APIs screen opens with
// `?checks=<origin>`: `svelte-native://web-apis?checks=http://localhost:8787` (an Android emulator after `adb reverse tcp:8787 tcp:8787`; the iOS
// Simulator reaches the Mac's localhost). A release build talks plain HTTP only when it was built with SVELTE_NATIVE_REMOTE_ORIGIN=http://localhost:8787,
// which makes the plugin allow it. Every result is logged as `[web-apis] …`, the last line `[web-apis] done pass=N fail=N skip=N`,
// and the lines are posted to the server's /report at the end, which prints them.

import { Platform } from "@alfayez/svelte-native/platform";

export type CheckResult = { name: string; status: "pass" | "fail" | "skip"; detail: string; ms: number };

class Skip extends Error {}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The server's xorshift32 stream (`seededBytes` in server.ts). */
export function seeded(length: number, seed: number): Uint8Array<ArrayBuffer> {
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

function expectBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length === expected.length, `length ${actual.length}, expected ${expected.length}`);
  for (let i = 0; i < expected.length; i++) expect(actual[i] === expected[i], `byte ${i} is ${actual[i]}, expected ${expected[i]}`);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** SHA-256 in plain JavaScript, so the fetch checks do not depend on the `crypto` they are not about. */
export function sha256(bytes: Uint8Array): string {
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[] as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(32));
  h.forEach((word, i) => out.setUint32(i * 4, word));
  return hex(new Uint8Array(out.buffer));
}

async function errorName(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).name;
  }
  return "(resolved)";
}

type Echo = { method: string; headers: [string, string][]; bodyLength: number; bodySha256: string; bodyText: string | null };
const header = (echo: Echo, name: string) => echo.headers.find(([key]) => key === name)?.[1] ?? null;
const echo = async (origin: string, init: RequestInit): Promise<Echo> => (await (await fetch(`${origin}/echo`, init)).json()) as Echo;

const checks: [name: string, run: (origin: string) => Promise<string>][] = [
  ["binary GET, 64 KiB", async (o) => {
    const bytes = new Uint8Array(await (await fetch(`${o}/bytes?n=65536&seed=3`)).arrayBuffer());
    expectBytes(bytes, seeded(65536, 3));
    return `${bytes.length} bytes`;
  }],
  ["binary GET, 8 MiB", async (o) => {
    const started = Date.now();
    const bytes = new Uint8Array(await (await fetch(`${o}/large?mb=8`)).arrayBuffer());
    const ms = Date.now() - started;
    expectBytes(bytes, seeded(8 * 1024 * 1024, 11));
    return `${bytes.length} bytes in ${ms} ms`;
  }],
  ["body stream, chunk by chunk", async (o) => {
    const reader = (await fetch(`${o}/stream?chunks=5&size=1000&delay=80`)).body!.getReader();
    const chunks: Uint8Array[] = [];
    for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value);
    expectBytes(concat(chunks), seeded(5000, 7));
    expect(chunks.length >= 2, `one chunk for a body sent in five`);
    return `${chunks.length} chunks`;
  }],
  ["text(): UTF-8 with a BOM and an invalid byte", async (o) => {
    const text = await (await fetch(`${o}/utf8`)).text();
    expect(text === "héllo �( wörld ✓", JSON.stringify(text));
    return text;
  }],
  ["POST a string: default Content-Type", async (o) => {
    const body = await echo(o, { method: "POST", body: "héllo" });
    expect(body.method === "POST", body.method);
    expect(header(body, "content-type") === "text/plain;charset=UTF-8", String(header(body, "content-type")));
    expect(body.bodyText === "héllo", String(body.bodyText));
    return "text/plain;charset=UTF-8";
  }],
  ["POST bytes, 100 kB", async (o) => {
    const bytes = seeded(100_000, 5);
    const body = await echo(o, { method: "POST", body: bytes });
    expect(body.bodyLength === bytes.length && body.bodySha256 === sha256(bytes), `${body.bodyLength} bytes, ${body.bodySha256}`);
    return "sha256 matches";
  }],
  ["POST a Blob of a string, bytes and a slice", async (o) => {
    const blob = new Blob(["head:", seeded(5000, 9), new Blob(["xtail"]).slice(1)], { type: "application/x-test" });
    const body = await echo(o, { method: "PUT", body: blob });
    const expected = concat([new TextEncoder().encode("head:"), seeded(5000, 9), new TextEncoder().encode("tail")]);
    expect(header(body, "content-type") === "application/x-test", String(header(body, "content-type")));
    expect(body.bodySha256 === sha256(expected), `${body.bodyLength} bytes, sha256 differs`);
    return `${blob.size} bytes`;
  }],
  ["FormData: a field and a file", async (o) => {
    const form = new FormData();
    form.append("a", "1");
    const file = seeded(20_000, 4);
    form.append("file", new Blob([file], { type: "application/octet-stream" }), "f.bin");
    const { parts } = (await (await fetch(`${o}/multipart`, { method: "POST", body: form })).json()) as { parts: { name: string; filename: string | null; type: string | null; sha256: string; text: string | null }[] };
    expect(parts.length === 2, `${parts.length} parts`);
    expect(parts[0]!.name === "a" && parts[0]!.text === "1", JSON.stringify(parts[0]));
    expect(parts[1]!.name === "file" && parts[1]!.filename === "f.bin" && parts[1]!.sha256 === sha256(file), JSON.stringify({ ...parts[1], text: undefined }));
    return "2 parts";
  }],
  ["POST bytes: not typed as a form", async (o) => {
    const body = await echo(o, { method: "POST", body: seeded(64, 8) });
    const type = header(body, "content-type");
    // The standard sends no Content-Type. On iOS URLSession would call such a POST body a form; the library sends application/octet-stream instead.
    expect(type === null || (Platform.OS === "ios" && type === "application/octet-stream"), `Content-Type: ${type}`);
    return type ?? "none, as the standard says";
  }],
  ["POST a 9 MiB Blob (a streamed upload)", async (o) => {
    const bytes = seeded(9 * 1024 * 1024, 13);
    const body = await echo(o, { method: "POST", body: new Blob([bytes]) });
    expect(body.bodyLength === bytes.length && body.bodySha256 === sha256(bytes), `${body.bodyLength} bytes, ${body.bodySha256}`);
    return `${body.bodyLength} bytes`;
  }],
  ["FormData: a { uri } file part", async (o) => {
    const file = seeded(300_000, 12);
    const uri = URL.createObjectURL(new Blob([file]));
    const form = new FormData();
    // React Native's own way to send a local file: an object with its uri, which the library reads natively.
    form.append("doc", { uri, name: "doc.bin", type: "application/octet-stream" } as unknown as Blob);
    const { parts } = (await (await fetch(`${o}/multipart`, { method: "POST", body: form })).json()) as { parts: { name: string; filename: string | null; type: string | null; sha256: string; length: number }[] };
    URL.revokeObjectURL(uri);
    expect(parts.length === 1 && parts[0]!.filename === "doc.bin" && parts[0]!.type === "application/octet-stream" && parts[0]!.sha256 === sha256(file), JSON.stringify(parts));
    return `${parts[0]!.length} bytes`;
  }],
  ["URLSearchParams body", async (o) => {
    const body = await echo(o, { method: "POST", body: new URLSearchParams({ x: "1", y: "é" }) });
    expect(header(body, "content-type") === "application/x-www-form-urlencoded;charset=UTF-8", String(header(body, "content-type")));
    expect(body.bodyText === "x=1&y=%C3%A9", String(body.bodyText));
    return String(body.bodyText);
  }],
  ["redirect: follow", async (o) => {
    const response = await fetch(`${o}/redirect?n=3`);
    expect(response.redirected && response.url.endsWith("/echo") && response.status === 200, `${response.status} ${response.url} redirected=${response.redirected}`);
    return response.url;
  }],
  ["redirect: 20 hops followed, 21 an error", async (o) => {
    const twenty = await fetch(`${o}/redirect?n=20`);
    expect(twenty.status === 200 && twenty.redirected, `20 hops: ${twenty.status}`);
    const name = await errorName(fetch(`${o}/redirect?n=21`));
    expect(name === "TypeError", `21 hops: ${name}`);
    return "20 ok, 21 TypeError";
  }],
  ["redirect: error", async (o) => {
    const name = await errorName(fetch(`${o}/redirect?n=1`, { redirect: "error" }));
    expect(name === "TypeError", name);
    return name;
  }],
  ["redirect: manual", async (o) => {
    const response = await fetch(`${o}/redirect?n=2&status=307`, { redirect: "manual" });
    expect(response.status === 307 && response.headers.get("location") === "/redirect?n=1&status=307", `${response.status} ${response.headers.get("location")}`);
    return "307 with its Location";
  }],
  ["status 404", async (o) => {
    const response = await fetch(`${o}/status/404`);
    expect(response.status === 404 && !response.ok, `${response.status} ok=${response.ok}`);
    return `${response.status} "${response.statusText}"`;
  }],
  ["response headers", async (o) => {
    const headers = (await fetch(`${o}/headers`)).headers;
    expect(headers.get("x-one") === "1" && headers.get("x-multi") === "a, b", `${headers.get("x-one")} / ${headers.get("x-multi")}`);
    const cookies = headers.getSetCookie();
    expect(cookies.length >= 1, "no Set-Cookie");
    return `getSetCookie: ${cookies.length}`;
  }],
  ["gzip, decoded", async (o) => {
    const text = await (await fetch(`${o}/gzip`)).text();
    expect(text === "compressed ".repeat(1000), `${text.length} characters`);
    return `${text.length} characters`;
  }],
  ["abort before the response", async (o) => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 200);
    const name = await errorName(fetch(`${o}/no-head`, { signal: controller.signal }));
    expect(name === "AbortError" && Date.now() - started < 2000, `${name} after ${Date.now() - started} ms`);
    return `${Date.now() - started} ms`;
  }],
  ["abort while reading the body", async (o) => {
    const controller = new AbortController();
    const reader = (await fetch(`${o}/hang`, { signal: controller.signal })).body!.getReader();
    const first = await reader.read();
    expect(!first.done && first.value.length >= 1, "no first byte");
    controller.abort();
    const name = await errorName(reader.read());
    expect(name === "AbortError", name);
    return name;
  }],
  ["AbortSignal.timeout", async (o) => {
    const name = await errorName(fetch(`${o}/no-head`, { signal: AbortSignal.timeout(300) }));
    expect(name === "TimeoutError", name);
    return name;
  }],
  ["cookies: include and omit", async (o) => {
    const value = `v${Date.now()}`;
    await fetch(`${o}/set-cookie?name=sn&value=${value}`);
    const sent = ((await (await fetch(`${o}/cookies`)).json()) as { cookie: string | null }).cookie;
    expect(sent?.includes(`sn=${value}`) === true, `Cookie: ${sent}`);
    const omitted = ((await (await fetch(`${o}/cookies`, { credentials: "omit" })).json()) as { cookie: string | null }).cookie;
    expect(omitted === null, `omit sent Cookie: ${omitted}`);
    return "sent, then not";
  }],
  ["blob(), slice and an object URL", async (o) => {
    const blob = await (await fetch(`${o}/bytes?n=4096&seed=2`)).blob();
    expect(blob instanceof Blob && blob.size === 4096 && blob.type === "application/octet-stream", `${blob.size} ${blob.type}`);
    expectBytes(new Uint8Array(await blob.slice(100, 200).arrayBuffer()), seeded(4096, 2).subarray(100, 200));
    const url = URL.createObjectURL(blob);
    expectBytes(new Uint8Array(await (await fetch(url)).arrayBuffer()), seeded(4096, 2));
    URL.revokeObjectURL(url);
    const name = await errorName(fetch(url));
    expect(name === "TypeError", `after revoke: ${name}`);
    return url.slice(0, 7);
  }],
  ["data: URL", async () => {
    const text = await (await fetch("data:text/plain;base64,aGk=")).text();
    expect(text === "hi", text);
    return text;
  }],
  ["clone() reads twice", async (o) => {
    const response = await fetch(`${o}/bytes?n=1000&seed=6`);
    const copy = response.clone();
    const [a, b] = await Promise.all([response.arrayBuffer(), copy.arrayBuffer()]);
    expectBytes(new Uint8Array(a), seeded(1000, 6));
    expectBytes(new Uint8Array(b), seeded(1000, 6));
    return "both 1000 bytes";
  }],
  ["FileReader.readAsDataURL", async () => {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob(["hi"], { type: "text/plain" }));
    });
    expect(url === "data:text/plain;base64,aGk=", url);
    return url;
  }],
  ["a refused connection", async () => {
    const name = await errorName(fetch("http://127.0.0.1:1/"));
    expect(name === "TypeError", name);
    return name;
  }],
  ["crypto", async () => {
    if (typeof crypto === "undefined" || !crypto.subtle) throw new Skip("no crypto.subtle");
    const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc"))));
    expect(digest === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", digest);
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(crypto.randomUUID()), "randomUUID format");
    const random = crypto.getRandomValues(new Uint8Array(32));
    expect(random.some((byte) => byte !== 0), "32 zero bytes");
    return "digest, randomUUID, getRandomValues";
  }],
  ["localStorage", async () => {
    if (typeof localStorage === "undefined") throw new Skip("no localStorage");
    localStorage.setItem("checks.probe", "1");
    expect(localStorage.getItem("checks.probe") === "1", "getItem after setItem");
    localStorage.removeItem("checks.probe");
    expect(localStorage.getItem("checks.probe") === null, "getItem after removeItem");
    const runs = Number(localStorage.getItem("checks.runs") ?? 0) + 1;
    localStorage.setItem("checks.runs", String(runs));
    return `run ${runs} on this install (a number above 1 means it survived a restart)`;
  }],
  ["clipboard: writeText, readText", async () => {
    if (typeof navigator.clipboard === "undefined") throw new Skip("no navigator.clipboard");
    const text = `svelte-native ✓ ${Date.now()}`;
    await navigator.clipboard.writeText(text);
    const read = await navigator.clipboard.readText();
    expect(read === text, `read ${JSON.stringify(read)}`);
    return `${text.length} characters back`;
  }],
  ["clipboard: text/html item", async () => {
    if (typeof navigator.clipboard === "undefined") throw new Skip("no navigator.clipboard");
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": "Bold", "text/html": "<b>Bold</b>" })]);
    const [item] = await navigator.clipboard.read();
    expect(item !== undefined, "nothing read back");
    expect(item.types.includes("text/plain"), `types ${item.types.join(", ")}`);
    expect((await (await item.getType("text/plain")).text()) === "Bold", "plain text");
    if (!item.types.includes("text/html")) return `types ${item.types.join(", ")} (the system kept no HTML)`;
    const html = await (await item.getType("text/html")).text();
    expect(html.includes("<b>Bold</b>"), `html ${JSON.stringify(html)}`);
    return `types ${item.types.join(", ")}`;
  }],
  ["navigator: language, canShare, vibrate", async () => {
    expect(/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(navigator.language), `language ${navigator.language}`);
    expect(navigator.languages[0] === navigator.language, "languages[0]");
    expect(navigator.canShare({ url: "https://svelte.dev" }) && !navigator.canShare({ url: "relative" }), "canShare");
    expect(navigator.vibrate(0) === true, "vibrate(0)");
    return `language ${navigator.language}`;
  }],
  // The location capability (expo-location, `capabilities.location` in app.config.ts). The permission is asked for on the first call: grant it ahead
  // (`adb shell pm grant … android.permission.ACCESS_FINE_LOCATION`, `xcrun simctl privacy … grant location …`) for a run nobody watches.
  ["geolocation: a position, a watch, the permission", async () => {
    if (typeof navigator.geolocation === "undefined") throw new Skip("no navigator.geolocation");
    const options = { enableHighAccuracy: true, timeout: 20_000 };
    const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
    const { latitude, longitude, accuracy } = position.coords;
    expect(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && accuracy >= 0, `coords ${JSON.stringify(position.coords)}`);
    expect(position.timestamp > Date.now() - 24 * 3600_000, `timestamp ${position.timestamp}`);
    const watched = await new Promise<GeolocationPosition>((resolve, reject) => {
      const id = navigator.geolocation.watchPosition((next) => { navigator.geolocation.clearWatch(id); resolve(next); }, (error) => { navigator.geolocation.clearWatch(id); reject(error); }, { ...options, maximumAge: 60_000 });
    });
    expect(Number.isFinite(watched.coords.latitude), "watched position");
    const status = await navigator.permissions.query({ name: "geolocation" });
    expect(status.state === "granted", `permission ${status.state}`);
    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)} ±${Math.round(accuracy)} m, permission ${status.state}`;
  }],
];

export const checkCount = checks.length;

export async function runChecks(origin: string, report: (result: CheckResult) => void): Promise<{ pass: number; fail: number; skip: number }> {
  const totals = { pass: 0, fail: 0, skip: 0 };
  const lines: string[] = [];
  const log = (line: string) => { lines.push(line); console.log(line); };
  for (const [name, run] of checks) {
    const started = Date.now();
    let result: CheckResult;
    try {
      result = { name, status: "pass", detail: await run(origin), ms: Date.now() - started };
    } catch (error) {
      result = { name, status: error instanceof Skip ? "skip" : "fail", detail: error instanceof Error ? error.message : String(error), ms: Date.now() - started };
    }
    totals[result.status]++;
    log(`[web-apis] ${result.status} ${name}: ${result.detail} (${result.ms} ms)`);
    report(result);
  }
  log(`[web-apis] done pass=${totals.pass} fail=${totals.fail} skip=${totals.skip}`);
  // The same lines to the test server, which prints them: a Release iOS build sends console.log nowhere a script can read.
  await fetch(`${origin}/report`, { method: "POST", body: lines.join("\n") }).catch(() => undefined);
  return totals;
}
