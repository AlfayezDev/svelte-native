import { makeRnBlob, restoreObjectURLs, rnReads, useFake } from "./support/setup.ts";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Blob, File, blobFromNative } from "../../../src/fetch/blob.ts";
import { FileReader } from "../../../src/fetch/file-reader.ts";
import { patchObjectURLs } from "../../../src/fetch/url.ts";
import { createProject } from "../../support/project.ts";
import { seededBytes } from "./support/server.ts";

const fake = useFake();
const project = createProject();
afterAll(() => project.remove());

beforeEach(() => { fake.log.length = 0; rnReads.length = 0; });

const bytesOf = async (blob: Blob): Promise<number[]> => [...(await blob.bytes())];

describe("Blob construction", () => {
  test("parts of every kind are joined in order", async () => {
    const buffer = new Uint8Array([104, 105]).buffer; // "hi"
    const view = new DataView(new Uint8Array([0, 33, 34, 0]).buffer, 1, 2); // "!\""
    const part = new Blob(["[", new Uint8Array([97, 98, 99, 100]).subarray(1, 3), "]"]);
    const blob = new Blob(["a", buffer, view, part, 7 as never, { toString: () => "obj" } as never, new Uint16Array([0x4241])]);
    expect(await blob.text()).toBe("ahi!\"[bc]7objAB");
    expect(blob.size).toBe(15);
  });

  test("no parts is an empty Blob; the parts must be an iterable", async () => {
    expect(new Blob().size).toBe(0);
    expect(new Blob([]).size).toBe(0);
    expect(new Blob(undefined, {}).size).toBe(0);
    expect(await new Blob(new Set(["a", "b"])).text()).toBe("ab");
    for (const bad of ["abc", 5, {}, null, true]) expect(() => new Blob(bad as never)).toThrow(TypeError);
    expect(() => new Blob([], 5 as never)).toThrow(TypeError);
  });

  test("a multi-byte string counts its UTF-8 bytes and a lone surrogate is U+FFFD", async () => {
    const blob = new Blob(["héllo ✓ \u{1F600}", "\ud800x"]);
    expect(blob.size).toBe(Buffer.byteLength("héllo ✓ \u{1F600}") + 4);
    expect(await blob.text()).toBe("héllo ✓ \u{1F600}�x");
  });

  test("the type is lower-cased, and empty when it has a character outside U+0020 to U+007E", () => {
    expect(new Blob([], { type: "Text/Plain;Charset=UTF-8" }).type).toBe("text/plain;charset=utf-8");
    expect(new Blob([], { type: "text/plainĀ" }).type).toBe("");
    expect(new Blob([], { type: "text/\nplain" }).type).toBe("");
    expect(new Blob([], { type: "" }).type).toBe("");
    expect(new Blob().type).toBe("");
  });

  test("endings: transparent keeps line breaks, native makes them LF", async () => {
    expect(await new Blob(["a\r\nb\rc\nd"]).text()).toBe("a\r\nb\rc\nd");
    expect(await new Blob(["a\r\nb\rc\nd"], { endings: "transparent" }).text()).toBe("a\r\nb\rc\nd");
    expect(await new Blob(["a\r\nb\rc\nd"], { endings: "native" }).text()).toBe("a\nb\nc\nd");
    expect(() => new Blob([], { endings: "bad" as never })).toThrow(TypeError);
    // Binary parts are never rewritten.
    expect([...(await new Blob([new Uint8Array([13, 10])], { endings: "native" }).bytes())]).toEqual([13, 10]);
  });

  test("a React Native Blob cannot be a part: it can only be read asynchronously", () => {
    expect(() => new Blob([makeRnBlob(new Uint8Array([1]))])).toThrow(/React Native Blob/);
  });

  test("the bytes of a view are the view's, and a later change to the buffer does not reach the Blob", async () => {
    const source = new Uint8Array([1, 2, 3, 4]);
    const blob = new Blob([source.subarray(1, 3)]);
    source[1] = 99;
    expect(await bytesOf(blob)).toEqual([2, 3]);
  });

  test("it is a Blob to Object.prototype.toString, and its methods need a Blob", () => {
    expect(Object.prototype.toString.call(new Blob())).toBe("[object Blob]");
    expect(() => Reflect.get(Blob.prototype, "size", {})).toThrow(TypeError);
  });
});

describe("slice", () => {
  const blob = new Blob(["0123456789"], { type: "text/plain" });
  const sliced = async (...args: [number?, number?, string?]) => (await blob.slice(...args).text());

  test("start and end, negative from the end, clamped to the size", async () => {
    expect(await sliced()).toBe("0123456789");
    expect(await sliced(3)).toBe("3456789");
    expect(await sliced(3, 6)).toBe("345");
    expect(await sliced(-3)).toBe("789");
    expect(await sliced(2, -2)).toBe("234567");
    expect(await sliced(-100, 4)).toBe("0123");
    expect(await sliced(5, 100)).toBe("56789");
    expect(await sliced(100)).toBe("");
    expect(await sliced(6, 3)).toBe("");
    expect(await sliced(0, -100)).toBe("");
    expect(await sliced(undefined, 4)).toBe("0123");
    expect(await sliced(Number.NaN, 4)).toBe("0123");
    expect(await sliced(1.9, 4.9)).toBe("123");
    expect(await sliced(-Infinity, Infinity)).toBe("0123456789");
  });

  test("the slice has the type given (normalized), not the Blob's", () => {
    expect(blob.slice().type).toBe("");
    expect(blob.slice(0, 1, "IMAGE/PNG").type).toBe("image/png");
    expect(blob.slice(0, 1, "xĀ").type).toBe("");
  });

  test("a slice of a slice, and slices joined, copy no bytes through JavaScript", async () => {
    const big = new Blob([seededBytes(300000, 5)]);
    fake.log.length = 0;
    const joined = new Blob([big.slice(10, 200000).slice(5, 1000), "x", big.slice(-5)]);
    expect(joined.size).toBe(995 + 1 + 5);
    expect(fake.log).toEqual([]);
    const expected = [...seededBytes(300000, 5).subarray(15, 1010), 120, ...seededBytes(300000, 5).subarray(299995)];
    expect(await bytesOf(joined)).toEqual(expected);
  });
});

describe("reading", () => {
  test("arrayBuffer, bytes and text", async () => {
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), "héllo ", new Uint8Array([0xc3, 0x28]), " wörld ✓"]);
    expect(await blob.text()).toBe("héllo �( wörld ✓");
    const buffer = await blob.arrayBuffer();
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBe(blob.size);
    expect((await blob.bytes()).byteLength).toBe(blob.size);
    expect(await new Blob().text()).toBe("");
    expect((await new Blob().arrayBuffer()).byteLength).toBe(0);
  });

  test("stream: 64 KiB chunks in order, then done", async () => {
    const data = seededBytes(200000, 9);
    const blob = new Blob([data]);
    const reader = blob.stream().getReader();
    const sizes: number[] = [];
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sizes.push(value.length);
      parts.push(value);
    }
    expect(sizes).toEqual([65536, 65536, 65536, 3392]);
    expect(Buffer.concat(parts).equals(data)).toBe(true);
  });

  test("stream: an empty Blob ends at once without a native read, and nothing is read until pulled", async () => {
    fake.log.length = 0;
    const empty = new Blob().stream();
    expect((await empty.getReader().read()).done).toBe(true);
    const stream = new Blob(["abc"]).stream();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fake.log).toEqual([]);
    expect(await new Response(stream).text()).toBe("abc");
  });

  test("a Blob over a file (blobFromURI) reads its range, slices, and joins with strings", async () => {
    const path = project.path("f.bin");
    const data = seededBytes(5000, 3);
    writeFileSync(path, data);
    const handle = await fake.module.blobFromURI(pathToFileURL(path).href, "application/x-test");
    const blob = blobFromNative(handle);
    expect(blob.size).toBe(5000);
    expect(blob.type).toBe("application/x-test");
    expect(await bytesOf(blob.slice(100, 110))).toEqual([...data.subarray(100, 110)]);
    expect(await bytesOf(new Blob(["<", blob.slice(4990), ">"]))).toEqual([60, ...data.subarray(4990), 62]);
    await expect(fake.module.blobFromURI("file:///definitely/not/here", "")).rejects.toMatchObject({ code: "ERR_FETCH_NETWORK" });
  });
});

describe("File", () => {
  test("name, lastModified, type and the Blob it is", async () => {
    const file = new File(["abc"], "a.txt", { type: "Text/Plain", lastModified: 1234 });
    expect(file.name).toBe("a.txt");
    expect(file.lastModified).toBe(1234);
    expect(file.type).toBe("text/plain");
    expect(file.size).toBe(3);
    expect(await file.text()).toBe("abc");
    expect(file).toBeInstanceOf(Blob);
    expect(Object.prototype.toString.call(file)).toBe("[object File]");
    expect(Math.abs(new File([], "n").lastModified - Date.now())).toBeLessThan(5000);
    expect(file.slice(1).constructor).toBe(Blob);
  });

  test("both arguments are required", () => {
    expect(() => new (File as unknown as new (...a: unknown[]) => File)([])).toThrow(TypeError);
  });
});

describe("FileReader", () => {
  function read(method: "readAsArrayBuffer" | "readAsText" | "readAsDataURL" | "readAsBinaryString", blob: unknown, ...rest: unknown[]) {
    const reader = new FileReader();
    const events: string[] = [];
    const states: number[] = [];
    for (const type of ["loadstart", "progress", "load", "abort", "error", "loadend"]) reader.addEventListener(type, () => { events.push(type); states.push(reader.readyState); });
    const done = new Promise<void>((resolve) => reader.addEventListener("loadend", () => resolve()));
    (reader[method] as (...a: unknown[]) => void)(blob, ...rest);
    return { reader, events, states, done };
  }

  test("readAsText, readAsArrayBuffer, readAsDataURL and readAsBinaryString", async () => {
    const blob = new Blob(["héllo"], { type: "text/plain" });
    const text = read("readAsText", blob);
    expect(text.reader.readyState).toBe(1);
    expect(text.reader.result).toBeNull();
    await text.done;
    expect(text.reader.result).toBe("héllo");
    expect(text.reader.readyState).toBe(2);
    expect(text.reader.error).toBeNull();

    const buffer = read("readAsArrayBuffer", blob);
    await buffer.done;
    expect(new Uint8Array(buffer.reader.result as ArrayBuffer)).toEqual(new Uint8Array(Buffer.from("héllo")));

    const url = read("readAsDataURL", blob);
    await url.done;
    expect(url.reader.result).toBe(`data:text/plain;base64,${Buffer.from("héllo").toString("base64")}`);
    const untyped = read("readAsDataURL", new Blob([new Uint8Array([255, 0, 1])]));
    await untyped.done;
    expect(untyped.reader.result).toBe("data:application/octet-stream;base64,/wAB");

    const binary = read("readAsBinaryString", blob);
    await binary.done;
    expect(binary.reader.result).toBe("hÃ©llo");
  });

  test("events: loadstart, load, loadend, in that order, with the state at each", async () => {
    const run = read("readAsText", new Blob(["x"]));
    await run.done;
    expect(run.events).toEqual(["loadstart", "load", "loadend"]);
    expect(run.states).toEqual([1, 2, 2]);
  });

  test("a handler property is a listener, and null removes it", async () => {
    const reader = new FileReader();
    const seen: string[] = [];
    reader.onload = () => seen.push("load");
    reader.onloadend = () => seen.push("loadend");
    reader.onerror = () => seen.push("error");
    expect(typeof reader.onload).toBe("function");
    expect(reader.onabort).toBeNull();
    reader.readAsText(new Blob(["x"]));
    await new Promise<void>((resolve) => reader.addEventListener("loadend", () => resolve()));
    expect(seen).toEqual(["load", "loadend"]);
    reader.onload = null;
    expect(reader.onload).toBeNull();
  });

  test("a legacy encoding is decoded with TextDecoder, and an unknown one is UTF-8", async () => {
    const latin = read("readAsText", new Blob([new Uint8Array([0x68, 0xe9])]), "iso-8859-1");
    await latin.done;
    expect(latin.reader.result).toBe("hé");
    const unknown = read("readAsText", new Blob(["é"]), "no-such-encoding");
    await unknown.done;
    expect(unknown.reader.result).toBe("é");
  });

  test("reading again while loading throws InvalidStateError; afterwards it is allowed", async () => {
    const run = read("readAsText", new Blob(["x"]));
    expect(() => run.reader.readAsText(new Blob(["y"]))).toThrow(expect.objectContaining({ name: "InvalidStateError" }));
    await run.done;
    run.reader.readAsText(new Blob(["y"]));
    await new Promise<void>((resolve) => run.reader.addEventListener("loadend", () => resolve(), { once: true }));
    expect(run.reader.result).toBe("y");
  });

  test("abort during a read: abort then loadend, no load, result null", async () => {
    const run = read("readAsText", new Blob(["x"]));
    run.reader.abort();
    expect(run.reader.readyState).toBe(2);
    expect(run.reader.result).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run.events).toEqual(["abort", "loadend"]);
    expect(run.reader.result).toBeNull();
    // abort with nothing loading does nothing
    const idle = new FileReader();
    idle.abort();
    expect(idle.readyState).toBe(0);
  });

  test("something that is not a Blob is a TypeError", () => {
    expect(() => new FileReader().readAsText({} as never)).toThrow(TypeError);
    expect(() => new FileReader().readAsArrayBuffer(null as never)).toThrow(TypeError);
  });

  test("a React Native Blob is read through React Native's FileReader", async () => {
    const rn = makeRnBlob(new Uint8Array(Buffer.from("héllo rn")), "text/plain");
    const text = read("readAsText", rn);
    await text.done;
    expect(text.reader.result).toBe("héllo rn");
    const url = read("readAsDataURL", rn);
    await url.done;
    expect(url.reader.result).toBe(`data:text/plain;base64,${Buffer.from("héllo rn").toString("base64")}`);
    expect(rnReads.length).toBe(2);
    expect(fake.log).toEqual([]);
  });

  test("the constants are on the class and the instance", () => {
    expect([FileReader.EMPTY, FileReader.LOADING, FileReader.DONE]).toEqual([0, 1, 2]);
    expect(new FileReader().DONE).toBe(2);
  });
});

describe("object URLs", () => {
  const URLClass = URL as unknown as { createObjectURL: (blob: unknown) => string; revokeObjectURL: (url: string) => void };
  restoreObjectURLs();

  test("createObjectURL is a file URL of the Blob's bytes, stable for the same Blob; revokeObjectURL deletes the file", async () => {
    patchObjectURLs();
    const blob = new Blob(["object url bytes"], { type: "text/plain" });
    const url = URLClass.createObjectURL(blob);
    expect(url.startsWith("file://")).toBe(true);
    expect(await Bun.file(fileURLToPath(url)).text()).toBe("object url bytes");
    expect(URLClass.createObjectURL(blob)).toBe(url);
    expect(URLClass.createObjectURL(new Blob(["other"]))).not.toBe(url);
    URLClass.revokeObjectURL(url);
    expect(existsSync(fileURLToPath(url))).toBe(false);
    expect(() => URLClass.revokeObjectURL("https://example.com/x")).not.toThrow();
    expect(fake.log.filter((entry) => entry === "revokeObjectURL").length).toBe(2);
  });

  test("a File is a Blob for it; what is not one of ours goes to what the runtime had", () => {
    patchObjectURLs();
    const url = URLClass.createObjectURL(new File(["x"], "x.txt"));
    expect(url.startsWith("file://")).toBe(true);
    expect(() => URLClass.createObjectURL({})).toThrow();
  });
});
