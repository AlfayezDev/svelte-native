// A remote form with a file, on the device's own `Blob`, `File` and `fetch` (the library's, over the fake native module): the file's bytes stay native
// from the `File` to the request, and the server's SvelteKit parser reads what was sent.
import { fake } from "./setup.ts";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stringify } from "devalue";
import { Blob as NativeBlob, File as NativeFile } from "../../src/fetch/blob.ts";
import { fetch as nativeFetch } from "../../src/fetch/fetch.ts";
import { kitRoot } from "../../src/remote/transform.ts";
import { loadClient } from "../remote-harness.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
test("a form with a File sends the file's native bytes through the library's fetch, and SvelteKit's parser reads them", async () => {
  const client = await loadClient(`export * from "../src/remote/index.ts"; export { form } from "../src/remote/runtime.ts";`);
  const kit = await import(pathToFileURL(join(kitRoot(), "src/runtime/form-utils.js")).href);
  const bytes = new Uint8Array([0, 255, 195, 169, 42, ...new Uint8Array(70_000).fill(7)]);
  const saved = { Blob: globalThis.Blob, File: globalThis.File };
  Object.assign(globalThis, { Blob: NativeBlob, File: NativeFile }); // what the device's globals are
  try {
    const file = new NativeFile([bytes], "photo.bin", { type: "application/octet-stream", lastModified: 123 });
    const form = client.form("h/upload");
    form.fields.title.as("text").onChangeText("Sunset");
    form.fields.photo.as("file").onValueChange(file);
    let sent: { body: unknown; echo: { bodyLength: number; bodySha256: string } } | undefined;
    let parsed: Record<string, any> | undefined;
    client.configureRemote({
      origin: "https://upload.example",
      fetch: async (url: string, init: RequestInit) => {
        // The library's fetch sends the body as it is (a native Blob of the parts), to the test server.
        const echo = await (await nativeFetch(`${fake.base}/echo`, { method: "POST", body: init.body })).json() as { bodyLength: number; bodySha256: string };
        sent = { body: init.body, echo };
        const raw = new Uint8Array(await (init.body as NativeBlob).arrayBuffer());
        parsed = (await kit.deserialize_binary_form(new Request(url, { method: "POST", headers: init.headers, body: raw }), "h/upload")).data;
        return Response.json({ type: "result", data: stringify({ _: { issues: [], result: "uploaded" } }) });
      },
    });
    expect(await form.submit()).toBe(true);
    expect(form.result).toBe("uploaded");
    expect(sent!.body).toBeInstanceOf(NativeBlob);
    const raw = new Uint8Array(await (sent!.body as NativeBlob).arrayBuffer());
    expect(sent!.echo.bodyLength).toBe(raw.length);
    expect(sent!.echo.bodySha256).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(parsed!.title).toBe("Sunset");
    expect(parsed!.photo.name).toBe("photo.bin");
    expect(parsed!.photo.type).toBe("application/octet-stream");
    expect(parsed!.photo.lastModified).toBe(123);
    expect(new Uint8Array(await parsed!.photo.arrayBuffer())).toEqual(bytes);
  } finally {
    Object.assign(globalThis, saved);
    client.resetRemoteConfig();
  }
});

test("on a build without the library's fetch module (React Native's Blob, which takes no bytes), a form with a file says so; one without files is sent as before", async () => {
  const client = await loadClient(`export * from "../src/remote/index.ts"; export { form } from "../src/remote/runtime.ts";`);
  const saved = globalThis.Blob;
  class RnLikeBlob { constructor(parts: unknown[] = []) { if (parts.some((part) => ArrayBuffer.isView(part))) throw new Error("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported"); } }
  (globalThis as any).Blob = RnLikeBlob;
  try {
    const bodies: unknown[] = [];
    client.configureRemote({ origin: "https://upload.example", fetch: async (_url: string, init: RequestInit) => { bodies.push(init.body); return Response.json({ type: "result", data: stringify({ _: { issues: [], result: "ok" } }) }); } });
    const plain = client.form("h/plain");
    plain.fields.title.as("text").onChangeText("a");
    expect(await plain.submit()).toBe(true);
    expect(bodies[0]).toBeInstanceOf(Uint8Array);
    const upload = client.form("h/upload");
    upload.fields.photo.as("file").onValueChange(new File([new Uint8Array([1])], "a.bin"));
    expect(await upload.submit()).toBe(false);
    expect(String(upload.error?.message ?? "")).toBe("Internal Error");
    expect(bodies).toHaveLength(1);
  } finally {
    globalThis.Blob = saved;
    client.resetRemoteConfig();
  }
});
