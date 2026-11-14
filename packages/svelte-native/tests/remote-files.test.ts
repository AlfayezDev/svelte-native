import { describe, expect, test } from "bun:test";
import { BinaryFormBlob, NativeFile } from "../src/remote/files.ts";

describe("byte-backed native uploads", () => {
  test("async adaptation checks declared size and metadata before reading, then checks actual size", async () => {
    let reads = 0;
    const file = { name: "a.bin", type: "application/octet-stream", size: 2, lastModified: 123, arrayBuffer: async () => { reads++; return new Uint8Array([1, 2]).buffer; } };
    await expect(NativeFile.from(file, { maxBytes: 1 })).rejects.toThrow(/upload limit/);
    await expect(NativeFile.from({ ...file, name: "../a" })).rejects.toThrow(/filename/);
    await expect(NativeFile.from({ ...file, size: NaN })).rejects.toThrow(/size/);
    expect(reads).toBe(0);
    const adapted = await NativeFile.from(file);
    expect(adapted.bytes()).toEqual(new Uint8Array([1, 2]));
    expect(reads).toBe(1);
    await expect(NativeFile.from({ ...file, size: 1 })).rejects.toThrow(/declared size/);
    await expect(NativeFile.from({ ...file, arrayBuffer: async () => { throw new Error("read failed"); } })).rejects.toThrow("read failed");
  });
  test("snapshots Buffer subclasses whose slice shares storage", () => {
    const bytes = Buffer.from([1, 2]);
    const file = new NativeFile(bytes, "buffer.bin");
    bytes.fill(0);
    expect([...file.bytes()]).toEqual([1, 2]);
  });
  test("snapshots input bytes and does not expose mutable storage", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const file = new NativeFile(bytes.subarray(1), "sample.bin", { type: "APPLICATION/OCTET-STREAM", lastModified: 123 });
    bytes.fill(0);
    file.bytes().fill(0);
    expect([...file.bytes()]).toEqual([2, 3]);
    expect(file.size).toBe(2);
    expect(file.type).toBe("application/octet-stream");
    expect(file.lastModified).toBe(123);
  });
  test("enforces explicit byte and filename boundaries", () => {
    expect(() => new NativeFile(new Uint8Array(2), "a", { maxBytes: 1 })).toThrow(RangeError);
    expect(() => new NativeFile(new Uint8Array(), "a", { maxBytes: NaN })).toThrow(RangeError);
    for (const name of ["", "../secret", "C:\\secret", "a\n"]) {
      expect(() => new NativeFile(new Uint8Array(), name)).toThrow(TypeError);
    }
    expect(() => new NativeFile("file:///secret" as unknown as Uint8Array, "a")).toThrow(TypeError);
    for (const lastModified of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new NativeFile(new Uint8Array(), "a", { lastModified })).toThrow(/safe integer/);
    }
    expect(new NativeFile(new Uint8Array(), "a", { lastModified: 123.9 }).lastModified).toBe(123);
    expect(() => new NativeFile(new Uint8Array(), 123 as unknown as string)).toThrow(TypeError);
    expect(new NativeFile(new Uint8Array(), "empty", { maxBytes: 0 }).size).toBe(0);
  });
  test("binary form adapter appends exact bytes, including zero bytes", () => {
    const blob = new BinaryFormBlob([new Uint8Array([1, 0]), "é", new NativeFile(new Uint8Array([255, 0]), "a")]);
    expect([...blob.bytes()]).toEqual([1, 0, 195, 169, 255, 0]);
    blob.bytes().fill(0);
    expect(blob.size).toBe(6);
    expect(blob.bytes()[0]).toBe(1);
  });
});
