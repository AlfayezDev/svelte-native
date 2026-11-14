import "./setup.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stringify } from "devalue";
import { File } from "../../src/fetch/blob.ts";
import { kitRoot } from "../../src/remote/transform.ts";
import { loadClient } from "../remote-harness.ts";

test("native File -> explicit adapter -> form.submit -> Kit server parser preserves bytes and metadata", async () => {
  const client = await loadClient(`export * from "../src/remote/index.ts"; export { form } from "../src/remote/runtime.ts";`);
  const kit = await import(pathToFileURL(join(kitRoot(), "src/runtime/form-utils.js")).href);
  const bytes = new Uint8Array([0, 255, 195, 169, 42]);
  const file = new File([bytes], "native.bin", { type: "application/octet-stream", lastModified: 123 });
  const adapted = await client.NativeFile.from(file);
  expect(adapted.bytes()).toEqual(bytes);
  const form = client.form("h/upload");
  expect(() => form.fields.photo.as("file").onValueChange(file)).toThrow(/NativeFile/);
  form.fields.photo.as("file").onValueChange(adapted);
  let calls = 0;
  client.configureRemote({ origin: "https://upload.example", fetch: async (url: string, init: RequestInit) => {
    calls++;
    expect(init.credentials).toBe("include");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("origin")).toBe("https://upload.example");
    const { data } = await kit.deserialize_binary_form(new Request(url, init), "h/upload");
    expect(data.photo.name).toBe("native.bin");
    expect(data.photo.type).toBe("application/octet-stream");
    expect(data.photo.lastModified).toBe(123);
    expect(data.photo.size).toBe(bytes.length);
    expect(new Uint8Array(await data.photo.arrayBuffer())).toEqual(bytes);
    return Response.json({ type: "result", data: stringify({ _: { issues: [], result: "uploaded" } }) });
  } });
  try {
    expect(await form.submit()).toBe(true);
    expect(calls).toBe(1);
    expect(form.result).toBe("uploaded");
  } finally {
    client.resetRemoteConfig();
  }
});
