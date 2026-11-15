import { makeRnBlob, RnFormData, rnReads, useFake } from "./support/setup.ts";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Blob, File } from "../../../src/fetch/blob.ts";
import { fetch } from "../../../src/fetch/fetch.ts";
import { FormData } from "../../../src/fetch/form-data.ts";
import { Request } from "../../../src/fetch/request.ts";
import { Response } from "../../../src/fetch/response.ts";
import { createProject } from "../../support/project.ts";
import { seededBytes } from "./support/server.ts";

const fake = useFake();

beforeEach(() => { fake.log.length = 0; rnReads.length = 0; });

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
type Part = { name: string; filename: string | null; type: string | null; length: number; sha256: string; text: string | null };
const echo = async (body: unknown): Promise<Part[]> => {
  const response = await fetch(`${fake.base}/multipart`, { method: "POST", body: body as never });
  const json = await response.json() as { parts?: Part[]; error?: string };
  if (json.parts === undefined) throw new Error(json.error);
  return json.parts;
};
const project = createProject();
afterAll(() => project.remove());

describe("the standard's API", () => {
  test("append keeps duplicates in order; get, getAll and has", () => {
    const form = new FormData();
    form.append("a", "1");
    form.append("b", "2");
    form.append("a", "3");
    expect(form.get("a")).toBe("1");
    expect(form.getAll("a")).toEqual(["1", "3"]);
    expect(form.get("missing")).toBeNull();
    expect(form.getAll("missing")).toEqual([]);
    expect(form.has("b")).toBe(true);
    expect(form.has("c")).toBe(false);
    expect([...form]).toEqual([["a", "1"], ["b", "2"], ["a", "3"]]);
  });

  test("set replaces the first entry of the name in place and drops the others, or appends", () => {
    const form = new FormData();
    form.append("a", "1");
    form.append("b", "2");
    form.append("a", "3");
    form.set("a", "9");
    expect([...form]).toEqual([["a", "9"], ["b", "2"]]);
    form.set("z", "last");
    expect([...form].at(-1)).toEqual(["z", "last"]);
  });

  test("delete removes every entry of the name", () => {
    const form = new FormData();
    form.append("a", "1");
    form.append("b", "2");
    form.append("a", "3");
    form.delete("a");
    expect([...form]).toEqual([["b", "2"]]);
  });

  test("a value that is not a Blob is its string; a lone surrogate is U+FFFD", () => {
    const form = new FormData();
    form.append("n", 5 as never);
    form.append("o", { toString: () => "obj" } as never);
    form.append("s", "\ud800");
    form.append("\udc00name", "v");
    expect(form.get("n")).toBe("5");
    expect(form.get("o")).toBe("obj");
    expect(form.get("s")).toBe("�");
    expect(form.has("�name")).toBe(true);
  });

  test("a Blob becomes a File named blob, or named by the third argument; a File is kept", async () => {
    const form = new FormData();
    const blob = new Blob(["abc"], { type: "text/plain" });
    const file = new File(["def"], "d.txt", { type: "text/plain", lastModified: 77 });
    form.append("b", blob);
    form.append("n", blob, "named.txt");
    form.append("f", file);
    form.append("r", file, "renamed.txt");
    const [b, n, f, r] = [form.get("b"), form.get("n"), form.get("f"), form.get("r")] as File[];
    expect(b).toBeInstanceOf(File);
    expect([b!.name, b!.type, b!.size]).toEqual(["blob", "text/plain", 3]);
    expect(n!.name).toBe("named.txt");
    expect(f).toBe(file);
    expect([r!.name, r!.lastModified]).toEqual(["renamed.txt", 77]);
    expect(await r!.text()).toBe("def");
  });

  test("a filename goes with a Blob only", () => {
    expect(() => new FormData().append("a", "text", "name.txt")).toThrow(TypeError);
  });

  test("iteration: entries, keys, values, forEach", () => {
    const form = new FormData();
    form.append("a", "1");
    form.append("b", "2");
    expect([...form.keys()]).toEqual(["a", "b"]);
    expect([...form.values()]).toEqual(["1", "2"]);
    expect([...form.entries()]).toEqual([["a", "1"], ["b", "2"]]);
    const seen: unknown[] = [];
    form.forEach((value, name, owner) => seen.push([value, name, owner === form]));
    expect(seen).toEqual([["1", "a", true], ["2", "b", true]]);
    expect(() => form.forEach(1 as never)).toThrow(TypeError);
  });

  test("missing arguments, and a form argument, are TypeErrors", () => {
    const form = new FormData();
    expect(() => (form.append as (...a: unknown[]) => void)("a")).toThrow(TypeError);
    expect(() => (form.get as (...a: unknown[]) => void)()).toThrow(TypeError);
    expect(() => (form.set as (...a: unknown[]) => void)("a")).toThrow(TypeError);
    expect(() => new (FormData as unknown as new (form: unknown) => FormData)({})).toThrow(TypeError);
    expect(Object.prototype.toString.call(form)).toBe("[object FormData]");
  });
});

describe("React Native's FormData, which XMLHttpRequest sends", () => {
  test("ours is one: networking's `instanceof FormData` and `getParts()` see it", () => {
    expect(new FormData()).toBeInstanceOf(RnFormData);
    const form = new FormData();
    form.append("title", "hello");
    expect(form.getParts()).toEqual([{ string: "hello", headers: { "content-disposition": 'form-data; name="title"' }, fieldName: "title" }]);
  });

  test("getParts gives one of our Files as the uri of the file native code wrote, with its name and type in the headers", async () => {
    const form = new FormData();
    const data = seededBytes(2048, 4);
    form.append("photo", new File([data], "my photo/1.jpg", { type: "image/jpeg" }));
    form.append("raw", new Blob([data]), "raw.bin");
    form.append("plain", new File(["x"], "n.txt"));
    const [photo, raw, plain] = form.getParts();
    expect(photo!.uri!.startsWith("file://")).toBe(true);
    expect(await Bun.file(fileURLToPath(photo!.uri!)).bytes()).toEqual(data);
    expect(photo!.headers).toEqual({ "content-disposition": 'form-data; name="photo"; filename="my%20photo_1.jpg"', "content-type": "image/jpeg" });
    expect(photo!.fieldName).toBe("photo");
    expect(raw!.headers["content-type"]).toBe("application/octet-stream");
    expect(plain!.headers["content-type"]).toBe("application/octet-stream");
    expect(fake.log.filter((entry) => entry === "blob.objectURL").length).toBe(3);
  });

  test("a React Native file object is kept as given and passes through getParts as React Native's does", () => {
    const form = new FormData();
    const file = { uri: "file:///a/b.png", name: "b.png", type: "image/png" };
    form.append("pic", file);
    expect(form.get("pic")).toBe(file);
    expect(form.getParts()[0]).toEqual({ ...file, headers: { "content-disposition": 'form-data; name="pic"; filename="b.png"', "content-type": "image/png" }, fieldName: "pic" });
    form.set("pic", { uri: "file:///a/c.png" }, "renamed.png");
    expect((form.get("pic") as { name: string }).name).toBe("renamed.png");
  });

  test("a React Native Blob value is kept as given", () => {
    const rn = makeRnBlob(new Uint8Array([1, 2]), "image/png");
    const form = new FormData();
    form.append("rn", rn);
    expect(form.get("rn")).toBe(rn as never);
  });
});

describe("as a fetch body (multipart/form-data)", () => {
  test("strings and files arrive as the standard encodes them, byte for byte", async () => {
    const big = seededBytes(300000, 21);
    const form = new FormData();
    form.append("title", "héllo ✓");
    form.append("blob", new Blob([big], { type: "application/x-big" }));
    form.append("file", new File(["file text"], 'we"ird\nname.txt', { type: "text/plain" }));
    form.append("untyped", new File([new Uint8Array([0, 1, 2])], "u.bin"));
    form.append("title", "second");
    const parts = await echo(form);
    expect(parts.map((part) => [part.name, part.filename, part.type, part.length])).toEqual([
      ["title", null, null, Buffer.byteLength("héllo ✓")],
      ["blob", "blob", "application/x-big", 300000],
      ["file", "we%22ird%0Aname.txt", "text/plain", 9],
      ["untyped", "u.bin", "application/octet-stream", 3],
      ["title", null, null, 6],
    ]);
    expect(parts[0]!.text).toBe("héllo ✓");
    expect(parts[1]!.sha256).toBe(sha256(big));
    expect(parts[2]!.text).toBe("file text");
    expect(parts[3]!.sha256).toBe(sha256(new Uint8Array([0, 1, 2])));
  });

  test("the body is one native Blob of strings and the files' own segments: the bytes are not read into JavaScript", async () => {
    const form = new FormData();
    form.append("blob", new Blob([seededBytes(100000, 2)]));
    fake.log.length = 0;
    await echo(form);
    expect(fake.log.filter((entry) => entry.startsWith("blob."))).toEqual([]);
  });

  test("names and values have their line breaks normalized to CRLF, and quotes and line breaks in a name are escaped", async () => {
    const form = new FormData();
    form.append("a\nb\"c", "x\ny\rz\r\nw");
    const [part] = await echo(form);
    expect(part!.name).toBe("a%0D%0Ab%22c");
    expect(part!.text).toBe("x\r\ny\r\nz\r\nw");
  });

  test("the Content-Type is multipart/form-data with a boundary", async () => {
    const form = new FormData();
    form.append("a", "1");
    const response = await fetch(`${fake.base}/echo`, { method: "POST", body: form });
    const seen = await response.json() as { headers: [string, string][] };
    const type = seen.headers.find(([name]) => name === "content-type")![1];
    expect(type).toMatch(/^multipart\/form-data; boundary=----SvelteNativeFormBoundary[A-Za-z0-9]{16}$/);
  });

  test("a multipart/form-data Content-Type the caller set without the body's boundary, or with another one, is replaced by the body's: the server can then parse the body", async () => {
    const form = new FormData();
    form.append("a", "1");
    form.append("f", new File(["file text"], "f.txt", { type: "text/plain" }));
    for (const given of ["multipart/form-data", "Multipart/Form-Data; charset=utf-8", "multipart/form-data; boundary=zzz", 'multipart/form-data; boundary=""']) {
      const request = new Request(`${fake.base}/multipart`, { method: "POST", body: form, headers: { "Content-Type": given } });
      expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=----SvelteNativeFormBoundary[A-Za-z0-9]{16}$/);
      const sent = await (await fetch(`${fake.base}/multipart`, { method: "POST", body: form, headers: { "content-type": given } })).json() as { parts?: Part[]; error?: string };
      expect([given, sent.error, sent.parts?.map((part) => part.name)]).toEqual([given, undefined, ["a", "f"]]);
      const response = new Response(form, { headers: { "content-type": given } });
      expect(response.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=----SvelteNativeFormBoundary/);
      expect((await response.formData()).get("a")).toBe("1");
    }
  });

  test("a Content-Type that is not multipart/form-data, or that names the body's own boundary (a Blob typed with one), is the caller's", () => {
    const form = new FormData();
    for (const given of ["application/x-custom", "text/plain", "multipart/mixed; boundary=x"]) {
      expect(new Request(`${fake.base}/echo`, { method: "POST", body: form, headers: { "content-type": given } }).headers.get("content-type")).toBe(given);
    }
    const blob = new Blob(["--b--\r\n"], { type: "multipart/form-data; boundary=b" });
    for (const given of ["multipart/form-data; boundary=b", 'Multipart/Form-Data; charset=utf-8; boundary="b"']) {
      expect(new Request(`${fake.base}/echo`, { method: "POST", body: blob, headers: { "content-type": given } }).headers.get("content-type")).toBe(given);
    }
  });

  test("a Blob whose own type is multipart/form-data with a boundary replaces a bare one the same way", () => {
    const blob = new Blob(["--b--\r\n"], { type: "multipart/form-data; boundary=b" });
    expect(new Request(`${fake.base}/echo`, { method: "POST", body: blob, headers: { "content-type": "multipart/form-data" } }).headers.get("content-type")).toBe("multipart/form-data; boundary=b");
    expect(new Request(`${fake.base}/echo`, { method: "POST", body: blob, headers: { "content-type": "application/json" } }).headers.get("content-type")).toBe("application/json");
  });

  test("the entries are those at the time the body was made", async () => {
    const form = new FormData();
    form.append("a", "1");
    const request = new Request(`${fake.base}/multipart`, { method: "POST", body: form });
    form.append("b", "2");
    const parts = await (await fetch(request)).json() as { parts: Part[] };
    expect(parts.parts.map((part) => part.name)).toEqual(["a"]);
  });

  test("a React Native file object is opened by native code (blobFromURI) and sent as a file", async () => {
    const path = project.path("rn-file.bin");
    const data = seededBytes(70000, 8);
    writeFileSync(path, data);
    const form = new FormData();
    form.append("upload", { uri: pathToFileURL(path).href, name: "rn-file.bin", type: "application/x-rn" });
    form.append("anonymous", { uri: pathToFileURL(path).href });
    fake.log.length = 0;
    const parts = await echo(form);
    expect(parts.map((part) => [part.name, part.filename, part.type, part.length, part.sha256])).toEqual([
      ["upload", "rn-file.bin", "application/x-rn", 70000, sha256(data)],
      ["anonymous", null, "application/octet-stream", 70000, sha256(data)],
    ]);
    expect(fake.log.filter((entry) => entry === "blobFromURI").length).toBe(2);
    expect(fake.log.filter((entry) => entry.startsWith("blob."))).toEqual([]);
  });

  test("a React Native file object whose file is missing is a network error", async () => {
    const form = new FormData();
    form.append("upload", { uri: "file:///no/such/file.png", name: "x.png" });
    await expect(echo(form)).rejects.toMatchObject({ code: "ERR_FETCH_NETWORK" });
  });

  test("a React Native Blob value is read through React Native's FileReader and sent as a file", async () => {
    const data = seededBytes(5000, 6);
    const form = new FormData();
    form.append("rn", makeRnBlob(data, "image/png"));
    const parts = await echo(form);
    expect(parts[0]).toMatchObject({ name: "rn", filename: "blob", type: "image/png", length: 5000, sha256: sha256(data) });
    expect(rnReads.length).toBe(1);
  });

  test("a FormData of React Native's own class (a library imported it) is sent too", async () => {
    const plain = new RnFormData();
    plain.append("a", "1");
    plain.append("f", { uri: pathToFileURL(project.path("rn-file.bin")).href, name: "f.bin", type: "application/octet-stream" });
    const parts = await echo(plain);
    expect(parts.map((part) => [part.name, part.filename])).toEqual([["a", null], ["f", "f.bin"]]);
  });

  test("an empty FormData is a body with no parts", async () => {
    expect(await echo(new FormData())).toEqual([]);
  });
});
