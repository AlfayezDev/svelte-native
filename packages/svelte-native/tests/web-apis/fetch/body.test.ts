import { makeRnBlob, rnReads, fetchFake } from "./support/setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { Blob, File } from "../../../src/fetch/blob.ts";
import { fetch } from "../../../src/fetch/fetch.ts";
import { FormData } from "../../../src/fetch/form-data.ts";
import { Headers } from "../../../src/fetch/headers.ts";
import { Request } from "../../../src/fetch/request.ts";
import { Response } from "../../../src/fetch/response.ts";
import { seededBytes } from "./support/server.ts";

const fake = fetchFake();

beforeEach(() => { fake.log.length = 0; rnReads.length = 0; });

const stream = (...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    },
  });
};
const readChunks = async (source: ReadableStream<Uint8Array>): Promise<Uint8Array[]> => {
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  for (let step = await reader.read(); !step.done; step = await reader.read()) chunks.push(step.value);
  return chunks;
};

describe("Response construction", () => {
  test("defaults", async () => {
    const response = new Response();
    expect([response.status, response.statusText, response.ok, response.type, response.url, response.redirected, response.body, response.bodyUsed]).toEqual([200, "", true, "default", "", false, null, false]);
    expect([...response.headers]).toEqual([]);
    expect(await response.text()).toBe("");
    expect(Object.prototype.toString.call(response)).toBe("[object Response]");
  });

  test("a body of each kind has the Content-Type the standard gives it", async () => {
    const type = (body: unknown) => new Response(body as never).headers.get("content-type");
    expect(type("text")).toBe("text/plain;charset=UTF-8");
    expect(type(new URLSearchParams({ a: "b c" }))).toBe("application/x-www-form-urlencoded;charset=UTF-8");
    expect(type(new Blob(["x"], { type: "image/png" }))).toBe("image/png");
    expect(type(new Blob(["x"]))).toBeNull();
    expect(type(new File(["x"], "f.txt", { type: "text/x-file" }))).toBe("text/x-file");
    expect(type(new ArrayBuffer(2))).toBeNull();
    expect(type(new Uint8Array(2))).toBeNull();
    expect(type(new DataView(new ArrayBuffer(2)))).toBeNull();
    expect(type(stream("x"))).toBeNull();
    expect(type(new FormData())).toMatch(/^multipart\/form-data; boundary=/);
    expect(type({})).toBe("text/plain;charset=UTF-8");
    expect(type(null)).toBeNull();
    expect(type(undefined)).toBeNull();
    expect(new Response("x", { headers: { "Content-Type": "application/x-custom" } }).headers.get("content-type")).toBe("application/x-custom");
  });

  test("the body of each kind reads back", async () => {
    expect(await new Response("héllo").text()).toBe("héllo");
    expect(await new Response(new URLSearchParams({ a: "b c", d: "é" })).text()).toBe("a=b+c&d=%C3%A9");
    expect(await new Response(new Blob(["blob ", "text"])).text()).toBe("blob text");
    expect(await new Response(new Uint8Array([104, 105])).text()).toBe("hi");
    expect(await new Response(new DataView(new Uint8Array([0, 104, 105, 0]).buffer, 1, 2)).text()).toBe("hi");
    expect(await new Response(new Uint8Array([0, 104, 105, 0]).subarray(1, 3)).text()).toBe("hi");
    expect(await new Response(new Uint16Array([0x6968]).buffer).text()).toBe("hi");
    expect(await new Response(stream("a", "b", "c")).text()).toBe("abc");
    expect(await new Response({ toString: () => "obj" } as never).text()).toBe("obj");
    expect(await new Response(5 as never).text()).toBe("5");
  });

  test("a buffer is copied: a change afterwards does not reach the body", async () => {
    const source = new Uint8Array([1, 2, 3]);
    const response = new Response(source);
    source[0] = 99;
    expect([...(await response.bytes())]).toEqual([1, 2, 3]);
  });

  test("status must be 200 to 599, statusText a reason phrase, and a null-body status takes no body", () => {
    for (const status of [199, 600, 0, 100, -1, Number.NaN]) expect(() => new Response(null, { status })).toThrow(RangeError);
    for (const status of [200, 404, 599]) expect(new Response(null, { status }).status).toBe(status);
    expect(new Response(null, { status: 404, statusText: "Nope" }).statusText).toBe("Nope");
    expect(new Response(null, { statusText: "\t é" }).statusText).toBe("\t é");
    for (const statusText of ["a\nb", "aĀ", "\u0000"]) expect(() => new Response(null, { statusText })).toThrow(TypeError);
    for (const status of [204, 205, 304]) {
      expect(() => new Response("body", { status })).toThrow(TypeError);
      expect(new Response(null, { status }).body).toBeNull();
    }
    expect(new Response(null, { status: 404 }).ok).toBe(false);
    expect(() => new Response(null, 5 as never)).toThrow(TypeError);
  });

  test("headers come from the init, in any of the Headers forms", () => {
    expect(new Response(null, { headers: [["a", "1"]] }).headers.get("a")).toBe("1");
    expect(new Response(null, { headers: new Headers({ b: "2" }) }).headers.get("b")).toBe("2");
    expect(() => new Response(null, { headers: { "bad name": "1" } })).toThrow(TypeError);
    const response = new Response(null, { headers: { a: "1" } });
    response.headers.append("a", "2");
    expect(response.headers.get("a")).toBe("1, 2");
  });
});

describe("Response statics", () => {
  test("error: status 0, type error, immutable headers, no body", () => {
    const response = Response.error();
    expect([response.status, response.type, response.ok, response.statusText, response.body]).toEqual([0, "error", false, "", null]);
    expect(() => response.headers.append("a", "b")).toThrow(TypeError);
  });

  test("redirect: Location is the parsed URL; the status must be a redirect status; headers are immutable", () => {
    const response = Response.redirect("https://example.com/a b?x=1#h", 301);
    expect([response.status, response.headers.get("location"), response.body]).toEqual([301, "https://example.com/a%20b?x=1#h", null]);
    expect(Response.redirect("https://example.com/").status).toBe(302);
    expect(Response.redirect(new URL("https://example.com/u")).headers.get("location")).toBe("https://example.com/u");
    for (const status of [200, 300, 304, 306, 309]) expect(() => Response.redirect("https://example.com/", status)).toThrow(RangeError);
    expect(() => Response.redirect("/relative")).toThrow(TypeError);
    expect(() => response.headers.set("location", "x")).toThrow(TypeError);
  });

  test("json: serializes, sets Content-Type unless given, keeps the init", async () => {
    const response = Response.json({ a: [1, "é"] }, { status: 201, statusText: "Made", headers: { "x-a": "1" } });
    expect([response.status, response.statusText, response.headers.get("content-type"), response.headers.get("x-a")]).toEqual([201, "Made", "application/json", "1"]);
    expect(await response.json()).toEqual({ a: [1, "é"] });
    expect(Response.json(1, { headers: { "content-type": "application/vnd.x+json" } }).headers.get("content-type")).toBe("application/vnd.x+json");
    expect(await Response.json("s").text()).toBe('"s"');
    expect(() => Response.json(undefined)).toThrow(TypeError);
    expect(() => Response.json(() => 1)).toThrow(TypeError);
    expect(() => Response.json(1n)).toThrow(TypeError);
  });
});

describe("consuming a body", () => {
  test("arrayBuffer, bytes, text, json and blob", async () => {
    expect([...new Uint8Array(await new Response("héllo").arrayBuffer())]).toEqual([...Buffer.from("héllo")]);
    expect((await new Response("héllo").bytes()).constructor).toBe(Uint8Array);
    expect(await new Response('{"a":1}').json()).toEqual({ a: 1 });
    await expect(new Response("{nope").json()).rejects.toBeInstanceOf(SyntaxError);
    const blob = await new Response("abc", { headers: { "content-type": "Text/X-Custom;Charset=UTF-8" } }).blob();
    expect([blob.size, blob.type, await blob.text()]).toEqual([3, "text/x-custom;charset=utf-8", "abc"]);
    expect((await new Response(new Uint8Array([1])).blob()).type).toBe("");
  });

  test("text decodes UTF-8: a byte order mark is dropped, invalid bytes are U+FFFD, in every kind of body and by every route of a network body", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from("héllo "), 0xc3, 0x28, ...Buffer.from(" wörld ✓")]);
    const expected = "héllo �( wörld ✓";
    expect(await new Response(bytes).text()).toBe(expected);
    expect(await new Response(new Blob([bytes])).text()).toBe(expected);
    expect(await new Response(stream(bytes.subarray(0, 5), bytes.subarray(5))).text()).toBe(expected);
    expect(await new Response("﻿abc").text()).toBe("abc");
    expect(await new Response(stream(bytes.subarray(0, 2), bytes.subarray(2))).text()).toBe(expected);
    // The same bytes from the network (the test server's /utf8), read by every route.
    expect(await (await fetch(`${fake.base}/utf8`)).text()).toBe(expected);
    expect(await (await fetch(`${fake.base}/utf8`)).blob().then((blob) => blob.text())).toBe(expected);
    expect(new Uint8Array(await (await fetch(`${fake.base}/utf8`)).arrayBuffer()).length).toBe(bytes.length);
    const touched = await fetch(`${fake.base}/utf8`);
    void touched.body; // once the stream is touched, the consumers read through it
    expect(await touched.text()).toBe(expected);
    expect(await new Response(await (await fetch(`${fake.base}/utf8`)).bytes()).text()).toBe(expected);
  });

  test("bodyUsed turns true when a consumer runs, and a second consumer rejects with a TypeError (a rejection, not a throw)", async () => {
    const response = new Response("x");
    expect(response.bodyUsed).toBe(false);
    const first = response.text();
    expect(response.bodyUsed).toBe(true);
    expect(await first).toBe("x");
    for (const method of ["text", "arrayBuffer", "bytes", "json", "blob", "formData"] as const) {
      const attempt = response[method]();
      expect(attempt).toBeInstanceOf(Promise);
      await expect(attempt).rejects.toBeInstanceOf(TypeError);
    }
  });

  test("a response without a body can be read any number of times and is never used", async () => {
    const response = new Response(null);
    expect(await response.text()).toBe("");
    expect(await response.text()).toBe("");
    expect([...(await response.bytes())]).toEqual([]);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect((await response.blob()).size).toBe(0);
    expect(response.bodyUsed).toBe(false);
    expect(response.body).toBeNull();
  });

  test("body is a ReadableStream, the same one each time; reading it uses the body up", async () => {
    const response = new Response("héllo");
    const body = response.body!;
    expect(body).toBeInstanceOf(ReadableStream);
    expect(response.body).toBe(body);
    expect(response.bodyUsed).toBe(false);
    expect(body.locked).toBe(false);
    const reader = body.getReader();
    expect(body.locked).toBe(true);
    await expect(response.text()).rejects.toBeInstanceOf(TypeError);
    expect(response.bodyUsed).toBe(false);
    const { value } = await reader.read();
    expect(response.bodyUsed).toBe(true);
    expect(new TextDecoder().decode(value)).toBe("héllo");
    expect((await reader.read()).done).toBe(true);
  });

  test("once the stream exists the consumers read it", async () => {
    const response = new Response(new Blob(["through the stream"]));
    void response.body;
    fake.log.length = 0;
    expect(await response.text()).toBe("through the stream");
    expect(response.bodyUsed).toBe(true);
    await expect(response.text()).rejects.toBeInstanceOf(TypeError);
  });

  test("a caller's stream is the body's, and a read of `response.body` uses the body up (the standard's \"disturbed\"), where it used to leave bodyUsed false and text() returning the rest", async () => {
    const source = stream("a", "b", "c");
    const response = new Response(source);
    expect(response.bodyUsed).toBe(false);
    // The caller's stream is locked by a read, not by being given.
    expect(source.locked).toBe(false);
    void response.body;
    expect(source.locked).toBe(false);
    const reader = response.body!.getReader();
    expect(response.bodyUsed).toBe(false);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("a");
    expect(response.bodyUsed).toBe(true);
    reader.releaseLock();
    expect(response.bodyUsed).toBe(true);
    await expect(response.text()).rejects.toBeInstanceOf(TypeError);
  });

  test("cancelling the body of a caller's stream cancels the stream and uses the body up", async () => {
    let cancelled: unknown;
    const source = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array([1])); }, cancel(reason) { cancelled = reason; } });
    const response = new Response(source);
    await response.body!.cancel("done with it");
    expect([cancelled, response.bodyUsed]).toEqual(["done with it", true]);
    await expect(response.text()).rejects.toBeInstanceOf(TypeError);
    // Cancelled before anything was read, so the stream was never locked by the body.
    const early = stream("x");
    const unread = new Response(early);
    await unread.body!.cancel();
    expect([unread.bodyUsed, early.locked]).toEqual([true, false]);
  });

  test("a stream read in whole by a consumer is used up too, a request's likewise, and a stream another reader holds makes the body unusable", async () => {
    const response = new Response(stream("x", "y"));
    expect(await response.text()).toBe("xy");
    expect(response.bodyUsed).toBe(true);
    const request = new Request("https://example.com/", { method: "POST", body: stream("r", "q"), duplex: "half" });
    const reader = request.body!.getReader();
    await reader.read();
    reader.releaseLock();
    expect(request.bodyUsed).toBe(true);
    await expect(request.text()).rejects.toBeInstanceOf(TypeError);
    const source = stream("held");
    const held = new Response(source);
    source.getReader();
    await expect(held.text()).rejects.toBeInstanceOf(TypeError);
  });

  test("cancelling the stream uses the body up", async () => {
    const response = new Response("abc");
    await response.body!.cancel();
    expect(response.bodyUsed).toBe(true);
    await expect(response.text()).rejects.toBeInstanceOf(TypeError);
  });

  test("reading `body` after a consumer ran gives a stream that has nothing, and the body stays used", async () => {
    const response = new Response("abc");
    await response.text();
    expect(response.body).not.toBeNull();
    expect(response.bodyUsed).toBe(true);
    expect(await readChunks(response.body!)).toEqual([]);
  });

  test("a stream that holds a lock or a chunk that is not bytes is refused", async () => {
    const locked = stream("x");
    locked.getReader();
    expect(() => new Response(locked)).toThrow(TypeError);
    const strings = new ReadableStream({ start(controller) { controller.enqueue("not bytes"); controller.close(); } });
    await expect(new Response(strings as never).text()).rejects.toBeInstanceOf(TypeError);
  });

  test("a body stream that errors fails the consumer with that error", async () => {
    const failing = new ReadableStream<Uint8Array>({ pull() { throw new Error("boom"); } });
    await expect(new Response(failing).text()).rejects.toThrow("boom");
  });
});

describe("formData()", () => {
  test("a multipart body made by FormData parses back: strings, files with their bytes, names and types", async () => {
    const data = seededBytes(4000, 12);
    const form = new FormData();
    form.append("title", "héllo ✓");
    form.append("multi", "1");
    form.append("multi", "2");
    form.append("file", new File([data], "ünï.bin", { type: "application/x-bin", lastModified: 5 }));
    form.append("quoted\"name", "q");
    form.append("lines", "a\nb");
    const parsed = await new Response(form).formData();
    expect(parsed.get("title")).toBe("héllo ✓");
    expect(parsed.getAll("multi")).toEqual(["1", "2"]);
    const file = parsed.get("file") as File;
    expect(file).toBeInstanceOf(File);
    expect([file.name, file.type, file.size]).toEqual(["ünï.bin", "application/x-bin", 4000]);
    expect([...(await file.bytes())]).toEqual([...data]);
    expect(parsed.get('quoted"name')).toBe("q");
    expect(parsed.get("lines")).toBe("a\r\nb");
    expect([...parsed.keys()]).toEqual(["title", "multi", "multi", "file", 'quoted"name', "lines"]);
  });

  test("a file part without a type is text/plain; an empty part and an empty file are read", async () => {
    const boundary = "xyz";
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="e"\r\n\r\n\r\n--${boundary}\r\nContent-Disposition: form-data; name="f"; filename="f.txt"\r\n\r\n\r\n--${boundary}--\r\n`;
    const parsed = await new Response(body, { headers: { "content-type": `multipart/form-data; boundary=${boundary}` } }).formData();
    expect(parsed.get("e")).toBe("");
    const file = parsed.get("f") as File;
    expect([file.name, file.type, file.size]).toEqual(["f.txt", "text/plain", 0]);
  });

  test("a quoted boundary, preamble text and an epilogue are accepted", async () => {
    const body = `preamble\r\n--b-1\r\nContent-Disposition: form-data; name="a"\r\nContent-Type: text/plain\r\n\r\nvalue\r\n--b-1--\r\nepilogue`;
    const parsed = await new Response(body, { headers: { "content-type": 'multipart/form-data; boundary="b-1"' } }).formData();
    expect(parsed.get("a")).toBe("value");
  });

  test("application/x-www-form-urlencoded", async () => {
    const parsed = await new Response("a=1&b=%C3%A9&a=x+y", { headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" } }).formData();
    expect(parsed.getAll("a")).toEqual(["1", "x y"]);
    expect(parsed.get("b")).toBe("é");
    expect([...(await new Response(new URLSearchParams({ q: "1" })).formData())]).toEqual([["q", "1"]]);
    expect([...(await new Response("", { headers: { "content-type": "application/x-www-form-urlencoded" } }).formData())]).toEqual([]);
  });

  test("any other Content-Type, a missing boundary and a malformed body are TypeErrors (and the body is used up)", async () => {
    await expect(new Response("a=1").formData()).rejects.toBeInstanceOf(TypeError);
    await expect(new Response("x", { headers: { "content-type": "multipart/form-data" } }).formData()).rejects.toThrow(/boundary/);
    const response = new Response("--b\r\nbroken", { headers: { "content-type": "multipart/form-data; boundary=b" } });
    await expect(response.formData()).rejects.toBeInstanceOf(TypeError);
    expect(response.bodyUsed).toBe(true);
    await expect(new Response("", { headers: { "content-type": "multipart/form-data; boundary=b" } }).formData()).rejects.toBeInstanceOf(TypeError);
  });
});

describe("clone", () => {
  test("a string, buffer or Blob body is shared: both sides read it, in any order", async () => {
    for (const body of ["clone me", new Uint8Array(Buffer.from("clone me")), new Blob(["clone me"])]) {
      const response = new Response(body, { status: 201, headers: { a: "1" } });
      const copy = response.clone();
      expect(await copy.text()).toBe("clone me");
      expect(response.bodyUsed).toBe(false);
      expect(await response.text()).toBe("clone me");
      expect([copy.status, copy.headers.get("a")]).toEqual([201, "1"]);
      expect(copy.headers).not.toBe(response.headers);
    }
  });

  test("a stream body is teed: each side reads the whole of it, and reading one does not use the other up", async () => {
    const response = new Response(stream("one ", "two ", "three"));
    const copy = response.clone();
    expect(response.bodyUsed).toBe(false);
    expect(copy.bodyUsed).toBe(false);
    expect(await copy.text()).toBe("one two three");
    expect(copy.bodyUsed).toBe(true);
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe("one two three");
    expect(response.bodyUsed).toBe(true);
  });

  test("a stream body can be cloned again, and the branches stream in order", async () => {
    const response = new Response(stream("a", "b", "c"));
    const [first, second] = [response.clone(), response.clone()];
    expect(await first.text()).toBe("abc");
    expect(new TextDecoder().decode(Buffer.concat(await readChunks(second.body!)))).toBe("abc");
    expect(await response.text()).toBe("abc");
  });

  test("cloning a used body, or one whose stream is locked, is a TypeError; a bodyless response clones", async () => {
    const used = new Response("x");
    await used.text();
    expect(() => used.clone()).toThrow(TypeError);
    const locked = new Response("x");
    locked.body!.getReader();
    expect(() => locked.clone()).toThrow(TypeError);
    expect(await new Response(null).clone().text()).toBe("");
  });

  test("the headers of a clone keep the original's guard", () => {
    const error = Response.error().clone();
    expect(() => error.headers.set("a", "b")).toThrow(TypeError);
    const mutable = new Response(null).clone();
    mutable.headers.set("a", "b");
    expect(mutable.headers.get("a")).toBe("b");
  });

  test("a response from the network is teed: the original and the clone read the same bytes", async () => {
    const response = await fetch(`${fake.base}/bytes?n=200000&seed=4`);
    const copy = response.clone();
    const [a, b] = await Promise.all([response.arrayBuffer(), copy.arrayBuffer()]);
    expect(Buffer.from(a).equals(seededBytes(200000, 4))).toBe(true);
    expect(Buffer.from(b).equals(seededBytes(200000, 4))).toBe(true);
    expect(fake.log).toContain("request.read");
    expect(fake.log).not.toContain("request.arrayBuffer");
  });
});

describe("a body of another kind", () => {
  test("a React Native Blob is read through its FileReader (the slow path), once, however often it is read", async () => {
    const data = seededBytes(3000, 14);
    const rn = makeRnBlob(data, "image/png");
    const response = new Response(rn as never);
    expect(response.headers.get("content-type")).toBe("image/png");
    const copy = response.clone();
    expect([...(await response.bytes())]).toEqual([...data]);
    expect([...(await copy.bytes())]).toEqual([...data]);
    expect(rnReads.length).toBe(1);
    const sent = await (await fetch(`${fake.base}/echo`, { method: "POST", body: rn as never })).json() as { bodyLength: number };
    expect(sent.bodyLength).toBe(3000);
  });
});

describe("Request construction", () => {
  const url = "https://example.com/path?q=1#frag";

  test("defaults", async () => {
    const request = new Request(url);
    expect([request.method, request.url, request.credentials, request.redirect, request.mode, request.cache, request.referrer, request.referrerPolicy, request.integrity, request.keepalive, request.duplex, request.destination]).toEqual(["GET", url, "same-origin", "follow", "cors", "default", "about:client", "", "", false, "half", ""]);
    expect([request.body, request.bodyUsed]).toEqual([null, false]);
    expect(request.signal.aborted).toBe(false);
    expect(request.signal).toBe(request.signal);
    expect(Object.prototype.toString.call(request)).toBe("[object Request]");
    expect(await request.text()).toBe("");
  });

  test("the URL is parsed and serialized; a relative URL, an invalid one and one with credentials are TypeErrors", () => {
    expect(new Request("https://EXAMPLE.com:443/a/../b").url).toBe("https://example.com/b");
    expect(new Request("https://example.com").url).toBe("https://example.com/");
    expect(new Request(new URL("https://example.com/u")).url).toBe("https://example.com/u");
    expect(new Request("file:///data/a.txt").url).toBe("file:///data/a.txt");
    for (const bad of ["/relative", "example.com", "", "http://", "https://user:pw@example.com/", "https://user@example.com/"]) expect(() => new Request(bad)).toThrow(TypeError);
  });

  test("the method: the standard six are upper-cased, others kept; tokens only; CONNECT, TRACE and TRACK are refused", () => {
    for (const method of ["delete", "get", "head", "options", "post", "put", "Post"]) expect(new Request(url, { method }).method).toBe(method.toUpperCase());
    expect(new Request(url, { method: "patch" }).method).toBe("patch");
    expect(new Request(url, { method: "PATCH" }).method).toBe("PATCH");
    for (const method of ["CONNECT", "trace", "Track", "bad method", "", "a,b"]) expect(() => new Request(url, { method })).toThrow(TypeError);
  });

  test("GET and HEAD take no body, even an empty string", () => {
    expect(() => new Request(url, { body: "x" })).toThrow(TypeError);
    expect(() => new Request(url, { method: "HEAD", body: "" })).toThrow(TypeError);
    expect(() => new Request(url, { method: "get", body: new Uint8Array(0) })).toThrow(TypeError);
    expect(new Request(url, { body: null }).body).toBeNull();
    expect(new Request(url, { body: undefined }).body).toBeNull();
    expect(new Request(url, { method: "POST", body: "" }).bodyUsed).toBe(false);
  });

  test("a body sets the default Content-Type unless one is given, in any case", () => {
    expect(new Request(url, { method: "POST", body: "x" }).headers.get("content-type")).toBe("text/plain;charset=UTF-8");
    expect(new Request(url, { method: "POST", body: "x", headers: { "Content-TYPE": "text/csv" } }).headers.get("content-type")).toBe("text/csv");
    expect(new Request(url, { method: "POST", body: new URLSearchParams("a=1") }).headers.get("content-type")).toBe("application/x-www-form-urlencoded;charset=UTF-8");
    expect(new Request(url, { method: "POST", body: new Uint8Array(1) }).headers.has("content-type")).toBe(false);
  });

  test("a ReadableStream body needs duplex: 'half'", () => {
    expect(() => new Request(url, { method: "POST", body: stream("x") })).toThrow(TypeError);
    expect(() => new Request(url, { method: "POST", body: stream("x"), duplex: "full" as never })).toThrow(TypeError);
    expect(new Request(url, { method: "POST", body: stream("x"), duplex: "half" }).body).toBeInstanceOf(ReadableStream);
  });

  test("options are validated as the standard's enumerations", () => {
    expect(() => new Request(url, { mode: "navigate" })).toThrow(TypeError);
    expect(() => new Request(url, { mode: "bad" as never })).toThrow(TypeError);
    expect(() => new Request(url, { credentials: "bad" as never })).toThrow(TypeError);
    expect(() => new Request(url, { redirect: "bad" as never })).toThrow(TypeError);
    expect(() => new Request(url, { cache: "bad" as never })).toThrow(TypeError);
    expect(() => new Request(url, { cache: "only-if-cached" })).toThrow(TypeError);
    expect(() => new Request(url, { cache: "only-if-cached", mode: "same-origin" })).not.toThrow();
    expect(() => new Request(url, { referrerPolicy: "bad" as never })).toThrow(TypeError);
    expect(new Request(url, { referrerPolicy: "origin" }).referrerPolicy).toBe("origin");
    expect(new Request(url, { referrer: "" }).referrer).toBe("");
    expect(() => new Request(url, { referrer: "::bad" })).toThrow(TypeError);
    expect(() => new Request(url, 5 as never)).toThrow(TypeError);
    const request = new Request(url, { credentials: "include", redirect: "manual", cache: "no-store", integrity: "sha256-x", keepalive: true, mode: "no-cors" });
    expect([request.credentials, request.redirect, request.cache, request.integrity, request.keepalive, request.mode]).toEqual(["include", "manual", "no-store", "sha256-x", true, "no-cors"]);
  });

  test("a Request as the input is copied, init overrides it, and headers are replaced as a whole", async () => {
    const original = new Request(url, { method: "POST", body: "payload", headers: { a: "1", b: "2" }, credentials: "include", redirect: "error" });
    const copy = new Request(original, { headers: { c: "3" } });
    expect([copy.url, copy.method, copy.credentials, copy.redirect]).toEqual([url, "POST", "include", "error"]);
    expect([...copy.headers]).toEqual([["c", "3"]]);
    expect([...original.headers.keys()]).toEqual(["a", "b", "content-type"]);
    expect(original.bodyUsed).toBe(true);
    const another = new Request(url, { method: "POST", body: "payload", headers: { a: "1" } });
    const withBody = new Request(another, { method: "PUT", body: "other" });
    expect([withBody.method, withBody.headers.get("a"), await withBody.text()]).toEqual(["PUT", "1", "other"]);
    expect(another.bodyUsed).toBe(false);
    expect(await another.text()).toBe("payload");
  });

  test("a Request built from a Request takes its body: the original is used up and the new one reads it", async () => {
    const original = new Request(url, { method: "POST", body: "taken" });
    const taken = new Request(original);
    expect(original.bodyUsed).toBe(true);
    expect(taken.bodyUsed).toBe(false);
    await expect(original.text()).rejects.toBeInstanceOf(TypeError);
    expect(await taken.text()).toBe("taken");
    expect(() => new Request(original)).toThrow(TypeError);
    const fresh = new Request(url, { method: "POST", body: "x" });
    await fresh.text();
    expect(() => new Request(fresh)).toThrow(TypeError);
    // A Request with a used body can still be copied when `init` brings a body of its own.
    expect(new Request(fresh, { body: "again" }).method).toBe("POST");
    // And a GET request cannot be made to hold a body it takes from a POST one.
    expect(() => new Request(new Request(url, { method: "POST", body: "x" }), { method: "GET" })).toThrow(TypeError);
  });

  test("the signal: a request's own signal follows the one it was given, with its reason", () => {
    const controller = new AbortController();
    const request = new Request(url, { signal: controller.signal });
    expect(request.signal).not.toBe(controller.signal);
    expect(request.signal.aborted).toBe(false);
    const reason = new Error("stop");
    controller.abort(reason);
    expect(request.signal.aborted).toBe(true);
    expect((request.signal as { reason?: unknown }).reason).toBe(reason);
    expect(new Request(url, { signal: controller.signal }).signal.aborted).toBe(true);
    expect(new Request(url, { signal: null }).signal.aborted).toBe(false);
    expect(() => new Request(url, { signal: {} as never })).toThrow(TypeError);
    const inherited = new Request(new Request(url, { signal: new AbortController().signal }));
    expect(inherited.signal.aborted).toBe(false);
  });

  test("clone copies the request and its body; a used body cannot be cloned", async () => {
    const request = new Request(url, { method: "POST", body: "clone", headers: { a: "1" }, redirect: "manual" });
    const copy = request.clone();
    expect([copy.method, copy.url, copy.redirect, copy.headers.get("a")]).toEqual(["POST", url, "manual", "1"]);
    expect(copy.headers).not.toBe(request.headers);
    expect(await copy.text()).toBe("clone");
    expect(await request.text()).toBe("clone");
    expect(() => request.clone()).toThrow(TypeError);
    const streaming = new Request(url, { method: "POST", body: stream("a", "b"), duplex: "half" });
    const streamed = streaming.clone();
    expect(await streamed.text()).toBe("ab");
    expect(await streaming.text()).toBe("ab");
  });
});
