import { fake, makeRnBlob, RnFormData, RnXhr } from "./setup.ts";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Blob, File } from "../../src/fetch/blob.ts";
import { FormData } from "../../src/fetch/form-data.ts";
import { patchObjectURLs } from "../../src/fetch/url.ts";
import { patchXHRSend } from "../../src/fetch/xhr.ts";
import { seededBytes } from "./server.ts";

/**
 * `xhr.send` of our Blob, File and FormData. React Native's `convertRequestBody` recognises only its own Blob, so before the wrap an object of ours was handed to networking as it
 * was and an empty body went out. `RnXhr` (setup.ts) converts a body as RN does and reads the file a `{ uri }` body names at the moment of the send, as native code would.
 */
const URLClass = URL as unknown as { createObjectURL: (blob: unknown) => string; revokeObjectURL: (url: string) => void };
const originals = { create: URLClass.createObjectURL, revoke: URLClass.revokeObjectURL };
beforeAll(() => patchXHRSend());
afterAll(() => { URLClass.createObjectURL = originals.create; URLClass.revokeObjectURL = originals.revoke; });
beforeEach(() => { fake.log.length = 0; });

const sent = (body: unknown): RnXhr => {
  const xhr = new RnXhr();
  xhr.send(body);
  return xhr;
};
const exists = (uri: string): boolean => existsSync(fileURLToPath(uri));
const revokes = (): number => fake.log.filter((entry) => entry === "revokeObjectURL").length;

describe("xhr.send of one of our Blobs", () => {
  test("is sent as the { uri } body native networking takes: the file holds the Blob's bytes when it is sent, and is deleted when the request ends", () => {
    const data = seededBytes(5000, 51);
    const xhr = sent(new Blob([data], { type: "image/png" }));
    const body = xhr.sent!.body as { uri: string };
    expect(Object.keys(body)).toEqual(["uri"]);
    expect(body.uri.startsWith("file://")).toBe(true);
    expect(xhr.sent!.file).toEqual(data);
    expect(exists(body.uri)).toBe(true);
    expect(revokes()).toBe(0);
    xhr.finish();
    expect(exists(body.uri)).toBe(false);
    expect(revokes()).toBe(1);
    xhr.finish();
    expect(revokes()).toBe(1);
  });

  test("a File is the same; Android refuses a { uri } body without a Content-Type, so one is set from the Blob's type, application/octet-stream when it has none, and the caller's stays", () => {
    expect(sent(new File(["x"], "x.txt", { type: "text/x-file" })).sent!.headers["content-type"]).toBe("text/x-file");
    expect(sent(new Blob(["x"])).sent!.headers["content-type"]).toBe("application/octet-stream");
    const xhr = new RnXhr();
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(new Blob(["{}"], { type: "text/plain" }));
    expect(xhr.sent!.headers["content-type"]).toBe("application/json");
  });

  test("what React Native's networking understands is passed on as it was: strings, null, its own Blob, a plain React Native FormData", () => {
    expect(sent("text").sent!.body).toEqual({ string: "text" });
    expect(sent(null).sent!.body).toBeNull();
    const rn = makeRnBlob(new Uint8Array([1, 2]));
    expect(sent(rn).sent!.body).toEqual({ blob: rn.data });
    const plain = new RnFormData();
    plain.append("a", "1");
    expect(Object.keys(sent(plain).sent!.body as object)).toEqual(["formData"]);
    expect(fake.log).toEqual([]);
  });

  test("the file stays while another request sending the same Blob still runs, and goes with the last", () => {
    const blob = new Blob(["shared"]);
    const first = sent(blob);
    const second = sent(blob);
    const uri = (first.sent!.body as { uri: string }).uri;
    expect((second.sent!.body as { uri: string }).uri).toBe(uri);
    first.finish();
    expect([exists(uri), revokes()]).toEqual([true, 0]);
    second.finish();
    expect([exists(uri), revokes()]).toEqual([false, 1]);
  });

  test("a URL the app made with URL.createObjectURL is the app's: the end of a request does not delete the file it may be showing", () => {
    patchObjectURLs();
    const blob = new Blob(["shown and sent"]);
    const url = URLClass.createObjectURL(blob);
    const xhr = sent(blob);
    expect((xhr.sent!.body as { uri: string }).uri).toBe(url);
    xhr.finish();
    expect([exists(url), revokes()]).toEqual([true, 0]);
    URLClass.revokeObjectURL(url);
    expect(exists(url)).toBe(false);
    // Revoked by the app, the same Blob sent again is written again, and is the request's to delete.
    const again = sent(blob);
    expect(exists((again.sent!.body as { uri: string }).uri)).toBe(true);
    again.finish();
    expect(exists(url)).toBe(false);
  });

  test("a send that throws deletes the file it wrote and throws the same error", () => {
    const xhr = new RnXhr();
    xhr.failNext = true;
    const blob = new Blob(["never sent"]);
    expect(() => xhr.send(blob)).toThrow("Request has not been opened");
    expect(revokes()).toBe(1);
  });

  test("patching twice wraps once", () => {
    patchXHRSend();
    patchXHRSend();
    const xhr = sent(new Blob(["once"]));
    xhr.finish();
    expect(revokes()).toBe(1);
  });
});

describe("xhr.send of our FormData", () => {
  test("the files getParts() writes for its Blobs are read by networking and deleted when the request ends", () => {
    const form = new FormData();
    const one = seededBytes(1200, 61);
    const two = seededBytes(800, 62);
    form.append("title", "hello");
    form.append("one", new File([one], "one.bin", { type: "application/x-one" }));
    form.append("two", new Blob([two]), "two.bin");
    const xhr = sent(form);
    const parts = xhr.sent!.parts as { uri?: string; file?: Uint8Array; headers: Record<string, string> }[];
    expect(parts.map((part) => part.uri === undefined)).toEqual([true, false, false]);
    expect(parts[1]!.file).toEqual(one);
    expect(parts[2]!.file).toEqual(two);
    expect(parts[1]!.headers["content-type"]).toBe("application/x-one");
    const uris = [parts[1]!.uri!, parts[2]!.uri!];
    expect(uris.map(exists)).toEqual([true, true]);
    xhr.finish();
    expect(uris.map(exists)).toEqual([false, false]);
    expect(revokes()).toBe(2);
  });

  test("a form of strings writes nothing and has nothing to delete; a File in it twice is one file", () => {
    const strings = new FormData();
    strings.append("a", "1");
    sent(strings).finish();
    expect(fake.log.filter((entry) => entry === "blob.objectURL")).toEqual([]);
    expect(revokes()).toBe(0);
    const file = new File(["same"], "same.bin");
    const twice = new FormData();
    twice.append("x", file);
    twice.append("y", file);
    const xhr = sent(twice);
    const parts = xhr.sent!.parts as { uri: string }[];
    expect(parts[0]!.uri).toBe(parts[1]!.uri);
    xhr.finish();
    expect([exists(parts[0]!.uri), revokes()]).toEqual([false, 1]);
  });
});
