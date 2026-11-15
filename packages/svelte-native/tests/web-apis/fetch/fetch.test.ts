import { makeRnBlob, rnReads, fetchFake } from "./support/setup.ts";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { abortReason, abortWithReason, followSignal, installAbortStatics, listenWhileAlive } from "../../../src/fetch/abort.ts";
import { Blob } from "../../../src/fetch/blob.ts";
import { Headers } from "../../../src/fetch/headers.ts";
import { setNativeModule } from "../../../src/fetch/module.ts";
import { fetch } from "../../../src/fetch/fetch.ts";
import { Request } from "../../../src/fetch/request.ts";
import { Response } from "../../../src/fetch/response.ts";
import { createProject } from "../../support/project.ts";
import { seededBytes } from "./support/server.ts";

const fake = fetchFake();
const project = createProject();
afterAll(() => project.remove());

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const base = fake.base;
type Echo = { method: string; url: string; headers: [string, string][]; bodyLength: number; bodySha256: string; bodyText: string | null };
const echoOf = async (response: Response): Promise<Echo> => (await response.json()) as Echo;
const header = (echo: Echo, name: string): string | undefined => echo.headers.find(([entry]) => entry === name)?.[1];
const settled = async (): Promise<void> => { for (let turn = 0; turn < 20 && fake.live.size > 0; turn++) await new Promise((resolve) => setTimeout(resolve, 10)); };

beforeEach(() => {
  // A test that does not read a body leaves its request running: stop what an earlier test left, so that `fake.live` is this test's alone.
  for (const request of [...fake.live]) (request as { cancel(): void }).cancel();
  fake.live.clear();
  fake.log.length = 0;
});

describe("a response", () => {
  test("status, headers, url and type", async () => {
    const response = await fetch(`${base}/bytes?n=10`);
    expect([response.status, response.statusText, response.ok, response.type, response.url, response.redirected]).toEqual([200, "OK", true, "basic", `${base}/bytes?n=10`, false]);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-length")).toBe("10");
    expect(() => response.headers.set("a", "b")).toThrow(TypeError);
    expect(response).toBeInstanceOf(Response);
  });

  test("arrayBuffer is one native call and its bytes are the server's", async () => {
    const response = await fetch(`${base}/bytes?n=5000&seed=7`);
    const buffer = await response.arrayBuffer();
    expect(Buffer.from(buffer).equals(seededBytes(5000, 7))).toBe(true);
    expect(fake.log).toEqual(["request.start", "request.arrayBuffer"]);
  });

  test("blob() keeps the bytes in native code: no read, no arrayBuffer; the Blob has the Content-Type and slices", async () => {
    const response = await fetch(`${base}/bytes?n=300000&seed=2`);
    const blob = await response.blob();
    expect(fake.log).toEqual(["request.start", "request.blob"]);
    expect([blob.size, blob.type]).toEqual([300000, "application/octet-stream"]);
    expect(Buffer.from(await blob.slice(1000, 1010).arrayBuffer()).equals(seededBytes(300000, 2).subarray(1000, 1010))).toBe(true);
    expect(response.bodyUsed).toBe(true);
  });

  test("text() and json() are one native text call", async () => {
    expect(await (await fetch(`${base}/echo`)).json()).toMatchObject({ method: "GET" });
    expect(fake.log).toEqual(["request.start", "request.text"]);
    fake.log.length = 0;
    expect(await (await fetch(`${base}/utf8`)).text()).toBe("héllo �( wörld ✓");
    expect(fake.log).toEqual(["request.start", "request.text"]);
  });

  test("a gzip response is decoded by the platform", async () => {
    const response = await fetch(`${base}/gzip`);
    expect(await response.text()).toBe("compressed ".repeat(1000));
  });

  test("HEAD, 204, 205 and 304 have no body; others have one, even when empty", async () => {
    const head = await fetch(`${base}/bytes?n=10`, { method: "HEAD" });
    expect([head.status, head.body, head.bodyUsed, await head.text()]).toEqual([200, null, false, ""]);
    for (const code of [204, 205, 304]) {
      const response = await fetch(`${base}/status/${code}`);
      expect([response.status, response.body]).toEqual([code, null]);
    }
    const missing = await fetch(`${base}/status/404`);
    expect([missing.status, missing.statusText, missing.ok]).toEqual([404, "Not Found", false]);
    expect(missing.body).not.toBeNull();
    expect(await missing.text()).toBe("");
    const failure = await fetch(`${base}/nowhere`);
    expect(failure.status).toBe(404);
    expect(await failure.json()).toEqual({ error: "no route /nowhere" });
  });

  test("headers: repeated ones are combined by get, Set-Cookie is listed by getSetCookie, iteration is sorted", async () => {
    const response = await fetch(`${base}/headers`);
    expect(response.headers.get("x-one")).toBe("1");
    expect(response.headers.get("x-multi")).toBe("a, b");
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    const names = [...response.headers.keys()];
    expect(names).toEqual([...names].sort());
    expect(names.filter((name) => name === "set-cookie")).toEqual(["set-cookie", "set-cookie"]);
  });
});

describe("streaming", () => {
  test("the stream pulls 64 KiB reads in order, and the chunks are the server's", async () => {
    const response = await fetch(`${base}/stream?chunks=5&size=1000&delay=5`);
    const reader = response.body!.getReader();
    const parts: Uint8Array[] = [];
    for (let step = await reader.read(); !step.done; step = await reader.read()) parts.push(step.value);
    expect(parts.every((part) => part.length >= 1 && part.length <= 65536)).toBe(true);
    expect(Buffer.concat(parts).equals(seededBytes(5000, 7))).toBe(true);
    expect(fake.log.filter((entry) => entry === "request.read").length).toBeGreaterThanOrEqual(2);
    expect(fake.log).not.toContain("request.arrayBuffer");
  });

  test("a chunk arrives when it is sent, not when the body ends", async () => {
    const response = await fetch(`${base}/stream?chunks=3&size=100&delay=150`);
    const reader = response.body!.getReader();
    const started = Date.now();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(Date.now() - started).toBeLessThan(140 * 2);
    await reader.cancel();
  });

  test("once the stream is touched, consumers read through it", async () => {
    const response = await fetch(`${base}/bytes?n=100000&seed=3`);
    void response.body;
    expect(Buffer.from(await response.arrayBuffer()).equals(seededBytes(100000, 3))).toBe(true);
    expect(fake.log).not.toContain("request.arrayBuffer");
    expect(fake.log).toContain("request.read");
    const other = await fetch(`${base}/utf8`);
    void other.body;
    expect(await other.text()).toBe("héllo �( wörld ✓");
    expect(fake.log).not.toContain("request.text");
    const third = await fetch(`${base}/bytes?n=1000&seed=3`);
    void third.body;
    const blob = await third.blob();
    expect(blob.size).toBe(1000);
    expect(fake.log).not.toContain("request.blob");
  });

  test("an 8 MiB body arrives whole by the stream and by arrayBuffer, with the transfer paused while it is unread", async () => {
    const expected = sha256(seededBytes(8 * 1024 * 1024, 11));
    const response = await fetch(`${base}/large?mb=8`);
    const reader = response.body!.getReader();
    const hash = createHash("sha256");
    let total = 0;
    for (let step = await reader.read(); !step.done; step = await reader.read()) {
      hash.update(step.value);
      total += step.value.length;
      if (total === 65536) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect([total, hash.digest("hex")]).toEqual([8 * 1024 * 1024, expected]);
    expect(sha256(new Uint8Array(await (await fetch(`${base}/large?mb=8`)).arrayBuffer()))).toBe(expected);
  }, 30000);

  test("cancelling the stream stops the transfer", async () => {
    const response = await fetch(`${base}/hang`);
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    await reader.cancel();
    expect(fake.log).toContain("request.cancel");
    await settled();
    expect(fake.live.size).toBe(0);
    expect(response.bodyUsed).toBe(true);
  });
});

describe("request bodies", () => {
  const post = (body: unknown, init: object = {}) => fetch(`${base}/echo`, { method: "POST", body: body as never, ...init }).then(echoOf);

  test("a string is sent as UTF-8 with the default Content-Type", async () => {
    const echo = await post("héllo ✓");
    expect([echo.method, echo.bodyText, header(echo, "content-type")]).toEqual(["POST", "héllo ✓", "text/plain;charset=UTF-8"]);
  });

  test("buffers and views are sent byte for byte, without a Content-Type", async () => {
    const data = seededBytes(70000, 17);
    for (const body of [data, data.buffer.slice(0), new DataView(data.buffer.slice(0)), new Uint8Array([0, ...data, 0]).subarray(1, 70001)]) {
      const echo = await post(body);
      expect([echo.bodyLength, echo.bodySha256, header(echo, "content-type")]).toEqual([70000, sha256(data), undefined]);
    }
  });

  test("a Blob, a File's type and URLSearchParams set their Content-Type; a given one wins", async () => {
    const blob = await post(new Blob(["blob body"], { type: "text/x-blob" }));
    expect([blob.bodyText, header(blob, "content-type")]).toEqual(["blob body", "text/x-blob"]);
    const params = await post(new URLSearchParams({ a: "1 2", b: "é" }));
    expect([params.bodyText, header(params, "content-type")]).toEqual(["a=1+2&b=%C3%A9", "application/x-www-form-urlencoded;charset=UTF-8"]);
    const given = await post("x", { headers: { "Content-Type": "application/x-given" } });
    expect(header(given, "content-type")).toBe("application/x-given");
  });

  test("a large Blob joined from parts is uploaded from native segments, without being read in JavaScript", async () => {
    const parts = [seededBytes(1 << 20, 1), "-middle-", seededBytes(1 << 20, 2)];
    const echo = await post(new Blob(parts));
    expect([echo.bodyLength, echo.bodySha256]).toEqual([2 * (1 << 20) + 8, sha256(Buffer.concat(parts.map((part) => (typeof part === "string" ? Buffer.from(part) : part))))]);
    expect(fake.log.filter((entry) => entry.startsWith("blob."))).toEqual([]);
  });

  test("a body can be sent with PUT, PATCH, DELETE and a non-standard method as given", async () => {
    for (const method of ["PUT", "PATCH", "DELETE", "put"]) {
      const echo = await post("x", { method });
      expect(echo.method).toBe(method.toUpperCase() === "PUT" ? "PUT" : method);
      expect(echo.bodyText).toBe("x");
    }
  });

  test("a ReadableStream body is drained to bytes and then sent", async () => {
    const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([97])); controller.enqueue(new Uint8Array([98, 99])); controller.close(); } });
    const echo = await post(source, { duplex: "half" });
    expect(echo.bodyText).toBe("abc");
  });
});

describe("request headers, method and input", () => {
  test("headers reach the server lower-cased, once each, with the Cookie and User-Agent a caller sets", async () => {
    const echo = await fetch(`${base}/echo`, { credentials: "omit", headers: { "X-Custom": "1", Accept: "application/json", Cookie: "manual=1", "User-Agent": "svelte-native-test" } }).then(echoOf);
    expect(header(echo, "x-custom")).toBe("1");
    expect(header(echo, "accept")).toBe("application/json");
    expect(header(echo, "cookie")).toBe("manual=1");
    expect(header(echo, "user-agent")).toBe("svelte-native-test");
  });

  test("a Request and `init` merge as the standard says", async () => {
    const request = new Request(`${base}/echo`, { method: "POST", body: "from request", headers: { "x-a": "1", "x-b": "2" } });
    const plain = await fetch(request).then(echoOf);
    expect([plain.method, plain.bodyText, header(plain, "x-a"), header(plain, "x-b")]).toEqual(["POST", "from request", "1", "2"]);
    expect(request.bodyUsed).toBe(true);
    const merged = await fetch(new Request(`${base}/echo`, { method: "POST", body: "kept", headers: { "x-a": "1" } }), { headers: { "x-c": "3" } }).then(echoOf);
    expect([merged.bodyText, header(merged, "x-a"), header(merged, "x-c")]).toEqual(["kept", undefined, "3"]);
    const replaced = await fetch(new Request(`${base}/echo`, { method: "POST", body: "old" }), { body: "new" }).then(echoOf);
    expect(replaced.bodyText).toBe("new");
  });

  test("a Request whose body was used cannot be fetched again; a clone can", async () => {
    const request = new Request(`${base}/echo`, { method: "POST", body: "once" });
    const clone = request.clone();
    expect((await fetch(request).then(echoOf)).bodyText).toBe("once");
    await expect(fetch(request)).rejects.toBeInstanceOf(TypeError);
    expect((await fetch(clone).then(echoOf)).bodyText).toBe("once");
  });

  test("the input may be a URL; the fragment is not sent; the query is", async () => {
    const echo = await fetch(new URL(`${base}/echo?x=1&y=%C3%A9#fragment`)).then(echoOf);
    expect(echo.url).toBe("/echo?x=1&y=%C3%A9");
  });

  test("invalid arguments reject (they do not throw): relative URL, GET with a body, a bad method", async () => {
    for (const attempt of [fetch("/relative"), fetch(`${base}/echo`, { body: "x" }), fetch(`${base}/echo`, { method: "bad method" }), fetch(`${base}/echo`, { headers: { "bad name": "x" } }), fetch("https://user:pw@example.com/")]) {
      await expect(attempt).rejects.toBeInstanceOf(TypeError);
    }
  });

  test("a scheme native code does not serve is a network error", async () => {
    await expect(fetch("ftp://example.com/file")).rejects.toThrow(/Network request failed: unsupported URL scheme ftp:/);
    await expect(fetch("blob:https://example.com/uuid")).rejects.toBeInstanceOf(TypeError);
  });
});

describe("redirects", () => {
  test("follow: the final URL and `redirected`; a chain of hops", async () => {
    const response = await fetch(`${base}/redirect?n=3`);
    expect([response.redirected, response.url, response.status]).toEqual([true, `${base}/echo`, 200]);
    expect((await echoOf(response)).method).toBe("GET");
  });

  test("error: a redirect rejects with a TypeError whose cause names it", async () => {
    const error = await fetch(`${base}/redirect?n=1`, { redirect: "error" }).catch((caught: unknown) => caught) as TypeError & { cause: { code: string } };
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^Network request failed: /);
    expect(error.cause.code).toBe("ERR_FETCH_REDIRECT");
    expect((await fetch(`${base}/echo`, { redirect: "error" })).status).toBe(200);
  });

  test("manual: the redirect response itself, with its Location", async () => {
    const response = await fetch(`${base}/redirect?n=2&status=307`, { redirect: "manual" });
    expect([response.status, response.redirected, response.headers.get("location")]).toEqual([307, false, "/redirect?n=1&status=307"]);
    expect(await response.text()).toBe("");
  });

  test("more than 20 hops is a network error", async () => {
    const error = await fetch(`${base}/redirect?n=22`).catch((caught: unknown) => caught) as TypeError & { cause: { code: string } };
    expect(error.cause.code).toBe("ERR_FETCH_REDIRECT");
    expect((await fetch(`${base}/redirect?n=20`)).redirected).toBe(true);
  });

  test("301, 302 and 303 turn a POST into a GET without its body; 307 and 308 keep both", async () => {
    for (const status of [301, 302, 303]) {
      const echo = await fetch(`${base}/redirect?status=${status}`, { method: "POST", body: "payload" }).then(echoOf);
      expect([echo.method, echo.bodyLength]).toEqual(["GET", 0]);
    }
    for (const status of [307, 308]) {
      const echo = await fetch(`${base}/redirect?status=${status}`, { method: "POST", body: "payload" }).then(echoOf);
      expect([echo.method, echo.bodyText]).toEqual(["POST", "payload"]);
    }
  });

  test("a redirect to another URL, absolute", async () => {
    const response = await fetch(`${base}/redirect?to=${encodeURIComponent(`${base}/bytes?n=3`)}`);
    expect([response.url, response.redirected, (await response.arrayBuffer()).byteLength]).toEqual([`${base}/bytes?n=3`, true, 3]);
  });
});

describe("credentials", () => {
  test("same-origin and include use the cookie store both ways; omit neither sends nor stores", async () => {
    await fetch(`${base}/set-cookie?name=kept&value=1`);
    expect((await (await fetch(`${base}/cookies`)).json() as { cookie: string }).cookie).toContain("kept=1");
    expect((await (await fetch(`${base}/cookies`, { credentials: "include" })).json() as { cookie: string }).cookie).toContain("kept=1");
    expect((await (await fetch(`${base}/cookies`, { credentials: "omit" })).json() as { cookie: string | null }).cookie).toBeNull();
    await fetch(`${base}/set-cookie?name=ignored&value=1`, { credentials: "omit" });
    expect((await (await fetch(`${base}/cookies`)).json() as { cookie: string }).cookie).not.toContain("ignored");
  });
});

describe("failures", () => {
  test("a refused connection is a TypeError with native code's error as the cause", async () => {
    const error = await fetch("http://127.0.0.1:1/").catch((caught: unknown) => caught) as TypeError & { cause: Error & { code: string } };
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/^Network request failed: /);
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause.code).toBe("ERR_FETCH_NETWORK");
  });

  test("a file that is not there is a network error too", async () => {
    await expect(fetch("file:///no/such/file.txt")).rejects.toMatchObject({ cause: { code: "ERR_FETCH_NETWORK" } });
  });

  test("a body cut short fails the read with a network error (and the stream errors)", async () => {
    const { createServer } = await import("node:http");
    // The server cuts the connection only once fetch() has resolved: a timer could fire before the head reaches the client, and then fetch() itself
    // fails, which is a different case.
    let cut = (): void => {};
    const server = createServer((_request, response) => { response.writeHead(200, { "content-length": "100" }); response.write("short"); cut = () => response.destroy(); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
    const first = await fetch(url);
    cut();
    await expect(first.text()).rejects.toMatchObject({ message: expect.stringMatching(/^Network request failed/), cause: { code: "ERR_FETCH_NETWORK" } });
    const response = await fetch(url);
    cut();
    const reader = response.body!.getReader();
    await expect((async () => { for (;;) if ((await reader.read()).done) return; })()).rejects.toMatchObject({ message: expect.stringMatching(/^Network request failed/) });
    server.close();
  });
});

describe("data: URLs", () => {
  test("base64 and percent-encoded, with the type", async () => {
    const base64 = await fetch("data:text/plain;base64,aMOpbGxvIOKckw==");
    expect([base64.status, base64.statusText, base64.ok, base64.url, base64.headers.get("content-type")]).toEqual([200, "OK", true, "data:text/plain;base64,aMOpbGxvIOKckw==", "text/plain"]);
    expect(await base64.text()).toBe("héllo ✓");
    expect(await (await fetch("data:text/plain;charset=utf-8,h%C3%A9llo%20%E2%9C%93")).text()).toBe("héllo ✓");
    expect(await (await fetch('data:application/json,{"a":[1,2]}')).json()).toEqual({ a: [1, 2] });
    expect(await (await fetch("data:text/plain,a%2Cb,c")).text()).toBe("a,b,c");
  });

  test("no type is text/plain;charset=US-ASCII, and a type with only parameters gets text/plain", async () => {
    expect((await fetch("data:,hello")).headers.get("content-type")).toBe("text/plain;charset=US-ASCII");
    expect((await fetch("data:;charset=utf-8,hello")).headers.get("content-type")).toBe("text/plain;charset=utf-8");
    expect((await fetch("data:TEXT/HTML;x=Y,<b>")).headers.get("content-type")).toBe("text/html;x=Y");
    expect(await (await fetch("data:,")).text()).toBe("");
  });

  test("binary bytes, a fragment, whitespace in base64, blob() and bytes()", async () => {
    const response = await fetch(`data:application/octet-stream;base64,${Buffer.from([0, 255, 128, 1]).toString("base64")}#ignored`);
    expect([...(await response.bytes())]).toEqual([0, 255, 128, 1]);
    const spaced = await fetch("data:text/plain;base64, aG k=");
    expect(await spaced.text()).toBe("hi");
    const blob = await (await fetch("data:image/png;base64,iVBORw0KGgo=")).blob();
    expect([blob.type, blob.size]).toEqual(["image/png", 8]);
    expect(fake.log).toEqual([]);
  });

  test("an invalid URL or invalid base64 is a network error; the method does not matter (the standard has no method rule for data: URLs)", async () => {
    await expect(fetch("data:text/plain")).rejects.toBeInstanceOf(TypeError);
    await expect(fetch("data:text/plain;base64,a")).rejects.toBeInstanceOf(TypeError);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const response = await fetch("data:text/plain,payload", { method, body: "sent" });
      expect([response.status, await response.text()]).toEqual([200, "payload"]);
    }
    expect((await fetch("data:,x", { method: "OPTIONS" })).status).toBe(200);
  });

  test("the MIME part is read as written, not percent-decoded: an encoded `;base64` is not base64", async () => {
    const encoded = await fetch("data:text/plain%3Bbase64,SGk=");
    // `%` is a token character: the MIME type is `text/plain%3bbase64`, whatever it means to anyone.
    expect([await encoded.text(), encoded.headers.get("content-type")]).toEqual(["SGk=", "text/plain%3bbase64"]);
    expect(await (await fetch("data:text/plain;base64,SGk=")).text()).toBe("Hi");
    // `base64` counts only as the last parameter.
    const notLast = await fetch("data:text/plain;base64;charset=utf-8,SGk=");
    expect([await notLast.text(), notLast.headers.get("content-type")]).toEqual(["SGk=", "text/plain;charset=utf-8"]);
  });

  test("the Content-Type is the serialized MIME type: lower-cased essence and parameter names, values kept, whitespace and repeats dropped", async () => {
    const type = async (href: string) => (await fetch(href)).headers.get("content-type");
    expect(await type("data:text/plain;charset=UTF-8,x")).toBe("text/plain;charset=UTF-8");
    expect(await type('data:TEXT/Plain ; Charset="UTF-8" ;X=1;x=2,hi')).toBe("text/plain;charset=UTF-8;x=1");
    expect(await type('data:text/plain;a="b c";q="x\\"y",x')).toBe('text/plain;a="b c";q="x\\"y"');
    expect(await type("data:text/plain;broken;ok=1;empty=;=noname,x")).toBe("text/plain;ok=1");
    expect(await type("data:text/plain;base64,SGk=")).toBe("text/plain");
    expect(await type("data:text,x")).toBe("text/plain;charset=US-ASCII");
    expect(await type("data:;base64,SGk=")).toBe("text/plain;charset=US-ASCII");
    expect(await type("data:;charset=utf-8,x")).toBe("text/plain;charset=utf-8");
    expect(await type("data:text/bad type,x")).toBe("text/plain;charset=US-ASCII");
  });
});

describe("blob: URLs of React Native's own createObjectURL", () => {
  test("are read through React Native's FileReader: the bytes of the range, with their length", async () => {
    const data = seededBytes(3000, 41);
    const rn = makeRnBlob(data, "image/png");
    rnReads.length = 0;
    const response = await fetch(`blob:${rn.data.blobId}?offset=0&size=3000`);
    expect([response.status, response.url, response.headers.get("content-length")]).toEqual([200, `blob:${rn.data.blobId}?offset=0&size=3000`, "3000"]);
    expect(Buffer.from(await response.arrayBuffer()).equals(data)).toBe(true);
    const part = await fetch(`blob:${rn.data.blobId}?offset=10&size=5`);
    expect([...(await part.bytes())]).toEqual([...data.subarray(10, 15)]);
    expect(rnReads.length).toBe(2);
    expect(fake.log).toEqual([]);
  });

  test("an unknown Blob, a malformed URL and a method but GET are network errors that say what is wrong", async () => {
    await expect(fetch("blob:no-such-blob?offset=0&size=1")).rejects.toThrow(/Network request failed/);
    await expect(fetch("blob:x?offset=a&size=1")).rejects.toThrow(/not a blob: URL of React Native's/);
    await expect(fetch("blob:x")).rejects.toThrow(/not a blob: URL of React Native's/);
    await expect(fetch("blob:x?offset=0&size=1", { method: "POST", body: "y" })).rejects.toThrow(/only be fetched with GET/);
  });
});

describe("repeated request headers", () => {
  test("are sent as one header, the values joined with a comma and a space, at the place the name first appeared", async () => {
    const headers = new Headers([["x-a", "1"], ["x-b", "3"], ["X-A", "2"], ["x-a", "again"]]);
    await fetch(`${base}/echo`, { headers });
    expect(fake.starts.at(-1)!.init.headers).toEqual([["x-a", "1, 2, again"], ["x-b", "3"]]);
    const echo = await fetch(`${base}/echo`, { headers }).then(echoOf);
    expect(echo.headers.filter(([name]) => name === "x-a")).toEqual([["x-a", "1, 2, again"]]);
  });
});

describe("file: URLs", () => {
  test("a file answers 200 with its bytes and its length, and reads as a Blob", async () => {
    const path = project.path("data.bin");
    const data = seededBytes(9000, 31);
    writeFileSync(path, data);
    const response = await fetch(pathToFileURL(path).href);
    expect([response.status, response.headers.get("content-length")]).toEqual([200, "9000"]);
    expect(Buffer.from(await response.arrayBuffer()).equals(data)).toBe(true);
    expect((await (await fetch(pathToFileURL(path).href)).blob()).size).toBe(9000);
  });
});

describe("aborting", () => {
  test("a signal that is already aborted rejects with its reason, before anything is sent", async () => {
    const reason = new Error("never mind");
    const controller = new AbortController();
    controller.abort(reason);
    await expect(fetch(`${base}/echo`, { signal: controller.signal })).rejects.toBe(reason);
    const plain = new AbortController();
    plain.abort();
    const error = await fetch(`${base}/echo`, { signal: plain.signal }).catch((caught: unknown) => caught) as DOMException;
    expect([error.name, error instanceof DOMException]).toEqual(["AbortError", true]);
    expect(fake.log).toEqual([]);
  });

  test("an abort before the head cancels the transfer and rejects with the reason", async () => {
    const reason = new Error("too slow");
    const controller = new AbortController();
    const pending = fetch(`${base}/no-head`, { signal: controller.signal });
    setTimeout(() => controller.abort(reason), 30);
    await expect(pending).rejects.toBe(reason);
    expect(fake.log).toContain("request.cancel");
    await settled();
    expect(fake.live.size).toBe(0);
  });

  test("the default reason is an AbortError DOMException, also for a signal that carries no reason (React Native's AbortController drops it)", async () => {
    const controller = new AbortController();
    const pending = fetch(`${base}/no-head`, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const error = await pending.catch((caught: unknown) => caught) as DOMException;
    expect([error.name, error instanceof DOMException]).toEqual(["AbortError", true]);
    // The same abort on a signal that has no `reason` property (what the controller of React Native's abort-controller makes).
    const target = new EventTarget();
    const signal = { aborted: false, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) } as unknown as AbortSignal;
    const reasonless = fetch(`${base}/no-head`, { signal });
    setTimeout(() => { (signal as { aborted: boolean }).aborted = true; target.dispatchEvent(new Event("abort")); }, 20);
    await expect(reasonless).rejects.toMatchObject({ name: "AbortError" });
  });

  test("an abort while the body is read rejects the read in flight with the reason, and so does the stream afterwards", async () => {
    const reason = new Error("stop reading");
    const controller = new AbortController();
    const response = await fetch(`${base}/hang`, { signal: controller.signal });
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    const pending = reader.read();
    setTimeout(() => controller.abort(reason), 20);
    await expect(pending).rejects.toBe(reason);
    await expect(reader.read()).rejects.toBe(reason);
    await settled();
    expect(fake.live.size).toBe(0);
  });

  test("an abort while nobody reads errors the stream at once", async () => {
    const reason = new Error("idle abort");
    const controller = new AbortController();
    const response = await fetch(`${base}/hang`, { signal: controller.signal });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort(reason);
    await expect(reader.read()).rejects.toBe(reason);
  });

  test("an abort after the head, before the body is touched, rejects text(), arrayBuffer() and blob() with the reason", async () => {
    for (const method of ["text", "arrayBuffer", "blob"] as const) {
      const reason = new Error(`abort ${method}`);
      const controller = new AbortController();
      const response = await fetch(`${base}/hang`, { signal: controller.signal });
      const pending = response[method]();
      setTimeout(() => controller.abort(reason), 20);
      await expect(pending).rejects.toBe(reason);
    }
  });

  test("the abort listener is removed once the body has been read to its end, and the signal is untouched after", async () => {
    const controller = new AbortController();
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const add = controller.signal.addEventListener.bind(controller.signal);
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = ((type: string, listener: never, options?: never) => { if (type === "abort") added.push(listener); add(type, listener, options); }) as never;
    controller.signal.removeEventListener = ((type: string, listener: never, options?: never) => { if (type === "abort") removed.push(listener); remove(type, listener, options); }) as never;
    const response = await fetch(`${base}/bytes?n=10`, { signal: controller.signal });
    expect(added.length).toBe(1);
    await response.arrayBuffer();
    expect(removed).toEqual(added);
    controller.abort();
    expect(fake.log.filter((entry) => entry === "request.cancel")).toEqual([]);
  });

  test("an abort after a null-body response, and after a failed request, leaves nothing listening", async () => {
    const controller = new AbortController();
    const removed: unknown[] = [];
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.removeEventListener = ((type: string, listener: never, options?: never) => { removed.push(type); remove(type, listener, options); }) as never;
    await fetch(`${base}/status/204`, { signal: controller.signal });
    await fetch("http://127.0.0.1:1/", { signal: controller.signal }).catch(() => undefined);
    expect(removed).toEqual(["abort", "abort"]);
  });

  describe("an abort while a ReadableStream body is drained", () => {
    /** A caller's stream that enqueues `chunks` and then waits, never closing; what its source was cancelled with. */
    function stalled(chunks: number[][]): { stream: ReadableStream<Uint8Array>; pulls(): number; cancelled: unknown[] } {
      const cancelled: unknown[] = [];
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk)); },
        pull() { pulls++; return new Promise(() => undefined); },
        cancel(reason) { cancelled.push(reason); },
      });
      return { stream, pulls: () => pulls, cancelled };
    }
    const soon = <T>(promise: Promise<T>): Promise<T | "still pending"> => Promise.race([promise, new Promise<"still pending">((resolve) => setTimeout(() => resolve("still pending"), 150))]);

    for (const [name, chunks] of [["before its first chunk", []], ["after some chunks", [[97], [98, 99]]]] as const) {
      test(`${name}: rejects with the reason at once, cancels the stream with it, and starts no native request`, async () => {
        const reason = new Error("user canceled");
        const controller = new AbortController();
        const body = stalled(chunks.map((chunk) => [...chunk]));
        const started = fake.starts.length;
        const pending = fetch(`${base}/echo`, { method: "POST", body: body.stream, duplex: "half", signal: controller.signal } as RequestInit).catch((caught: unknown) => caught);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(body.pulls()).toBeGreaterThan(0);
        controller.abort(reason);
        expect(await soon(pending)).toBe(reason);
        expect(body.cancelled).toEqual([reason]);
        expect(fake.starts.length).toBe(started);
      });
    }

    test("the default reason is an AbortError, for the fetch and the stream's cancel", async () => {
      const controller = new AbortController();
      const body = stalled([]);
      const pending = fetch(`${base}/echo`, { method: "POST", body: body.stream, duplex: "half", signal: controller.signal } as RequestInit).catch((caught: unknown) => caught);
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
      const error = await soon(pending) as DOMException;
      expect([error.name, (body.cancelled[0] as DOMException | undefined)?.name]).toEqual(["AbortError", "AbortError"]);
    });

    test("a signal that is already aborted cancels the stream body with its reason (the standard's abort of the fetch call)", async () => {
      const reason = new Error("before it started");
      const controller = new AbortController();
      controller.abort(reason);
      const body = stalled([]);
      const started = fake.starts.length;
      await expect(fetch(`${base}/echo`, { method: "POST", body: body.stream, duplex: "half", signal: controller.signal } as RequestInit)).rejects.toBe(reason);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect([body.cancelled, fake.starts.length]).toEqual([[reason], started]);
    });

    test("a stream body that was sent whole is left alone by a later abort", async () => {
      const cancelled: unknown[] = [];
      const controller = new AbortController();
      const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([120])); c.close(); }, cancel(reason) { cancelled.push(reason); } });
      const response = await fetch(`${base}/echo`, { method: "POST", body: stream, duplex: "half", signal: controller.signal } as RequestInit);
      expect((await echoOf(response)).bodyText).toBe("x");
      controller.abort();
      expect(cancelled).toEqual([]);
    });
  });

  test("a signal without `reason` (React Native's abort-controller) has the reason before the abort's listeners run", () => {
    /** React Native's AbortController: `abort()` takes no reason and the signal has no `reason` property. */
    class ReasonlessController {
      readonly signal = Object.assign(new EventTarget(), { aborted: false });
      abort(): void {
        if (this.signal.aborted) return;
        this.signal.aborted = true;
        this.signal.dispatchEvent(new Event("abort"));
      }
    }
    const controller = new ReasonlessController() as unknown as AbortController;
    const seen: unknown[] = [];
    controller.signal.addEventListener("abort", () => seen.push(abortReason(controller.signal)));
    const reason = new DOMException("The operation timed out.", "TimeoutError");
    abortWithReason(controller, reason);
    expect([seen, abortReason(controller.signal)]).toEqual([[reason], reason]);
  });

  describe("AbortSignal.timeout and AbortSignal.any", () => {
    const original = { timeout: (AbortSignal as unknown as { timeout?: unknown }).timeout, any: (AbortSignal as unknown as { any?: unknown }).any };
    afterAll(() => {
      Object.defineProperty(AbortSignal, "timeout", { value: original.timeout, configurable: true, writable: true });
      Object.defineProperty(AbortSignal, "any", { value: original.any, configurable: true, writable: true });
    });

    test("they are added when the runtime lacks them, and the timeout aborts a request with a TimeoutError", async () => {
      Reflect.deleteProperty(AbortSignal, "timeout");
      Reflect.deleteProperty(AbortSignal, "any");
      installAbortStatics();
      expect(typeof AbortSignal.timeout).toBe("function");
      expect(typeof AbortSignal.any).toBe("function");
      const error = await fetch(`${base}/no-head`, { signal: AbortSignal.timeout(30) }).catch((caught: unknown) => caught) as DOMException;
      expect(error.name).toBe("TimeoutError");

      const first = new AbortController();
      const second = new AbortController();
      const combined = AbortSignal.any([first.signal, second.signal]);
      expect(combined.aborted).toBe(false);
      const reason = new Error("second wins");
      second.abort(reason);
      expect(combined.aborted).toBe(true);
      expect(combined.reason).toBe(reason);
      first.abort();
      expect(combined.reason).toBe(reason);
      expect(AbortSignal.any([first.signal]).aborted).toBe(true);
      await expect(fetch(`${base}/echo`, { signal: AbortSignal.any([first.signal]) })).rejects.toBeDefined();
      expect(() => AbortSignal.timeout(-1)).toThrow(TypeError);
      expect(() => AbortSignal.any([{} as never])).toThrow(TypeError);
    });

    test("ones the runtime has are left alone", () => {
      const timeout = AbortSignal.timeout;
      installAbortStatics();
      expect(AbortSignal.timeout).toBe(timeout);
    });
  });
});

describe("what an abort leaves behind", () => {
  /** Counts the abort listeners a signal holds (add minus remove), as the signal's own listener list is not visible. */
  function counting(signal: AbortSignal): { active(): number } {
    let active = 0;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    const listeners = new Set<unknown>();
    signal.addEventListener = ((type: string, listener: never, options?: never) => { if (type === "abort") { listeners.add(listener); active++; } add(type, listener, options); }) as never;
    signal.removeEventListener = ((type: string, listener: never, options?: never) => { if (type === "abort" && listeners.delete(listener)) active--; remove(type, listener, options); }) as never;
    return { active: () => active };
  }
  /** Collects garbage until `check` holds (a collected object's finalizer runs on the event loop, after the collection). */
  async function collectedUntil(check: () => boolean): Promise<boolean> {
    for (let waited = 0; !check() && waited < 4000; waited += 25) {
      Bun.gc(true);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return check();
  }

  test("a response whose body is never read, and which is dropped, takes its listener off the caller's signal", async () => {
    const controller = new AbortController();
    const listeners = counting(controller.signal);
    await (async () => { await fetch(`${base}/bytes?n=10`, { signal: controller.signal }); })();
    expect(listeners.active()).toBe(1);
    expect(await collectedUntil(() => listeners.active() === 0)).toBe(true);
    controller.abort();
  });

  test("a response that is kept still listens, and an abort reaches it", async () => {
    const reason = new Error("kept");
    const controller = new AbortController();
    const listeners = counting(controller.signal);
    const response = await fetch(`${base}/hang`, { signal: controller.signal });
    Bun.gc(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listeners.active()).toBe(1);
    const pending = response.text();
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(listeners.active()).toBe(0);
  });

  test("request.signal, read and dropped, leaves no listener on the caller's signal: one per request would pile up on a screen's signal", async () => {
    const controller = new AbortController();
    const listeners = counting(controller.signal);
    (() => {
      for (let i = 0; i < 20; i++) {
        const request = new Request(`${base}/echo`, { signal: controller.signal });
        void request.signal;
        void request.clone().signal;
      }
    })();
    expect(listeners.active()).toBe(40);
    expect(await collectedUntil(() => listeners.active() === 0)).toBe(true);
  });

  test("a request's signal still follows the caller's with its reason, and the listener goes when it has fired", () => {
    const reason = new Error("followed");
    const controller = new AbortController();
    const listeners = counting(controller.signal);
    const follower = followSignal(controller.signal);
    expect(listeners.active()).toBe(1);
    controller.abort(reason);
    expect([follower.aborted, (follower as { reason?: unknown }).reason, listeners.active()]).toEqual([true, reason, 0]);
  });

  test("where the engine has no FinalizationRegistry, the next listener on the signal sweeps the ones whose target was collected", async () => {
    const registry = globalThis.FinalizationRegistry;
    // @ts-expect-error -- the module under test reads it when it is evaluated
    delete globalThis.FinalizationRegistry;
    let sweeping: typeof import("../../../src/fetch/abort.ts");
    try {
      sweeping = await import("../../../src/fetch/abort.ts?without-a-registry");
    } finally {
      globalThis.FinalizationRegistry = registry;
    }
    const signal = new AbortController().signal;
    const listeners = counting(signal);
    (() => { for (let i = 0; i < 10; i++) sweeping.listenWhileAlive(signal, {}, () => undefined); })();
    expect(listeners.active()).toBe(10);
    await new Promise((resolve) => setTimeout(resolve, 5));
    Bun.gc(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const kept = {};
    sweeping.listenWhileAlive(signal, kept, () => undefined);
    expect([listeners.active(), typeof listenWhileAlive]).toEqual([1, "function"]);
  });

  test("an aborted signal's reason wins whatever error native code reports for the cancelled request, and without an abort that error is the network error", async () => {
    const reason = new Error("raced");
    class Racing {
      async start(): Promise<never> {
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw Object.assign(new Error("socket closed under the request"), { code: "ERR_FETCH_NETWORK" });
      }
      cancel(): void {}
    }
    setNativeModule({ ...fake.module, NativeRequest: Racing } as never);
    try {
      const controller = new AbortController();
      const listeners = counting(controller.signal);
      const pending = fetch(`${base}/echo`, { signal: controller.signal });
      setTimeout(() => controller.abort(reason), 5);
      await expect(pending).rejects.toBe(reason);
      expect(listeners.active()).toBe(0);
      await expect(fetch(`${base}/echo`)).rejects.toMatchObject({ message: expect.stringMatching(/Network request failed: socket closed/) });
    } finally {
      setNativeModule(fake.module);
    }
  });
});
