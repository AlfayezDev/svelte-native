import { describe, expect, test } from "bun:test";
import { decodeKey, encodeKey } from "../../src/local-storage.ts";
import { createStorage, memoryBackend, type StorageBackend } from "../../src/web-storage.ts";

/**
 * The web's `Storage` on a backend that keeps strings (`src/web-storage.ts`): what `localStorage` and `sessionStorage` are on the device. The expectations are the browser's, the
 * HTML standard's `Storage` interface and the WebIDL rules for an interface with named properties; the MMKV backend and the globals are in web-apis.test.ts.
 */
const storage = (): Storage => createStorage(memoryBackend());

describe("the members", () => {
  test("getItem is null for a key that is not there; setItem stores and getItem reads it back", () => {
    const local = storage();
    expect(local.getItem("theme")).toBeNull();
    local.setItem("theme", "dark");
    expect(local.getItem("theme")).toBe("dark");
    local.setItem("theme", "light");
    expect(local.getItem("theme")).toBe("light");
    expect(local.length).toBe(1);
  });

  test("keys and values are converted with String(): a number, a boolean, null, undefined and an object's toString", () => {
    const local = storage();
    local.setItem(1 as unknown as string, 2 as unknown as string);
    local.setItem("flag", true as unknown as string);
    local.setItem("nothing", null as unknown as string);
    local.setItem("undefined", undefined as unknown as string);
    local.setItem("object", { toString: () => "converted" } as unknown as string);
    local.setItem("array", [1, 2] as unknown as string);
    expect(local.getItem("1")).toBe("2");
    expect(local.getItem(1 as unknown as string)).toBe("2");
    expect(local.getItem("flag")).toBe("true");
    expect(local.getItem("nothing")).toBe("null");
    expect(local.getItem("undefined")).toBe("undefined");
    expect(local.getItem("object")).toBe("converted");
    expect(local.getItem("array")).toBe("1,2");
    expect(local.getItem({ toString: () => "flag" } as unknown as string)).toBe("true");
  });

  test("a value whose conversion throws leaves the storage as it was", () => {
    const local = storage();
    local.setItem("kept", "yes");
    const bad = { toString: () => { throw new Error("no string"); } };
    expect(() => local.setItem("kept", bad as unknown as string)).toThrow("no string");
    expect(() => local.setItem(bad as unknown as string, "x")).toThrow("no string");
    expect([local.getItem("kept"), local.length]).toEqual(["yes", 1]);
  });

  test("removeItem removes one key, and none that is not there; clear removes all", () => {
    const local = storage();
    local.setItem("a", "1");
    local.setItem("b", "2");
    expect(local.removeItem("a")).toBeUndefined();
    local.removeItem("missing");
    expect([local.getItem("a"), local.getItem("b"), local.length]).toEqual([null, "2", 1]);
    expect(local.clear()).toBeUndefined();
    expect([local.getItem("b"), local.length]).toEqual([null, 0]);
  });

  test("key(n) is the nth key, and null past the end; the index is an unsigned long (a string of digits, a fraction, NaN as 0, a negative number wrapping round)", () => {
    const local = storage();
    local.setItem("a", "1");
    local.setItem("b", "2");
    expect([local.key(0), local.key(1), local.key(2)]).toEqual(["a", "b", null]);
    expect([local.key("1" as unknown as number), local.key(1.9), local.key(Number.NaN), local.key(-1), local.key(2 ** 32 + 1)]).toEqual(["b", "b", "a", null, "b"]);
  });

  test("a call without its arguments is a TypeError that says how many were wanted", () => {
    const local = storage() as unknown as Record<string, (...args: unknown[]) => unknown>;
    expect(() => local.getItem?.()).toThrow(new TypeError("Failed to execute 'getItem' on 'Storage': 1 argument required, but only 0 present."));
    expect(() => local.removeItem?.()).toThrow(new TypeError("Failed to execute 'removeItem' on 'Storage': 1 argument required, but only 0 present."));
    expect(() => local.key?.()).toThrow(new TypeError("Failed to execute 'key' on 'Storage': 1 argument required, but only 0 present."));
    expect(() => local.setItem?.()).toThrow(new TypeError("Failed to execute 'setItem' on 'Storage': 2 arguments required, but only 0 present."));
    expect(() => local.setItem?.("only a key")).toThrow(new TypeError("Failed to execute 'setItem' on 'Storage': 2 arguments required, but only 1 present."));
    // `undefined` passed is an argument: it is the string "undefined".
    local.setItem?.(undefined, "x");
    expect(local.getItem?.(undefined)).toBe("x");
  });

  test("a method taken off the object works (a browser says \"Illegal invocation\"): nothing reads `this`", () => {
    const { getItem, setItem, key, removeItem, clear } = storage();
    setItem("a", "1");
    expect([getItem("a"), key(0)]).toEqual(["1", "a"]);
    removeItem("a");
    clear();
    expect(getItem("a")).toBeNull();
  });

  test("it is a Storage by its tag, and two storages share nothing", () => {
    const first = storage();
    const second = storage();
    first.setItem("a", "1");
    expect(second.getItem("a")).toBeNull();
    expect(Object.prototype.toString.call(first)).toBe("[object Storage]");
  });
});

describe("keys as properties, as a browser's storage has them", () => {
  test("reading, writing and deleting a property is getItem, setItem and removeItem; a missing key reads as undefined", () => {
    const local = storage();
    local.theme = "dark";
    expect(local.getItem("theme")).toBe("dark");
    expect(local.theme).toBe("dark");
    local.theme = 5;
    expect(local.getItem("theme")).toBe("5");
    expect(local.missing).toBeUndefined();
    expect(delete local.theme).toBe(true);
    expect([local.getItem("theme"), local.theme, local.length]).toEqual([null, undefined, 0]);
    expect(delete local.missing).toBe(true);
  });

  test("`in`, hasOwnProperty, Object.keys, Object.entries, for...in and JSON.stringify see the keys, and nothing else", () => {
    const local = storage();
    local.setItem("b", "2");
    local.setItem("a", "1");
    expect(["a" in local, "z" in local, Object.hasOwn(local, "a"), Object.hasOwn(local, "z")]).toEqual([true, false, true, false]);
    expect(Object.keys(local)).toEqual(["b", "a"]);
    expect(Object.entries(local)).toEqual([["b", "2"], ["a", "1"]]);
    expect(Object.getOwnPropertyNames(local)).toEqual(["b", "a"]);
    const seen: string[] = [];
    for (const name in local) seen.push(name);
    expect(seen).toEqual(["b", "a"]);
    expect(JSON.stringify(local)).toBe('{"b":"2","a":"1"}');
    expect({ ...local }).toEqual({ b: "2", a: "1" });
    expect(Object.getOwnPropertyDescriptor(local, "a")).toEqual({ value: "1", writable: true, enumerable: true, configurable: true });
    expect(Object.getOwnPropertyDescriptor(local, "z")).toBeUndefined();
  });

  test("the members stay the members: an item with a member's name (or `toString`) is reached by getItem, and the property is still the member", () => {
    const local = storage();
    for (const name of ["getItem", "setItem", "removeItem", "clear", "key", "length", "toString", "constructor", "hasOwnProperty"]) local.setItem(name, `item ${name}`);
    for (const name of ["getItem", "setItem", "removeItem", "clear", "key", "toString", "constructor", "hasOwnProperty"]) expect(typeof local[name]).toBe("function");
    expect(local.getItem("getItem")).toBe("item getItem");
    expect(local.getItem("length")).toBe("item length");
    // `length` is the count of the keys, and the items of those names are not listed as properties.
    expect(local.length).toBe(9);
    expect(Object.keys(local)).toEqual([]);
    expect(["length" in local, "getItem" in local]).toEqual([true, true]);
    expect(local.toString()).toBe("[object Storage]");
  });

  test("a property write is an item whatever the name: `storage.length = 5` stores the item \"length\", as a browser does, and `length` stays the count", () => {
    const local = storage();
    local.length = 5;
    local.getItem = "x";
    expect(local.getItem("length")).toBe("5");
    expect(local.length).toBe(2);
    expect(typeof local.getItem).toBe("function");
    expect((local.getItem as (key: string) => string | null)("getItem")).toBe("x");
  });

  test("symbols are ordinary properties of the object: never items", () => {
    const local = storage();
    const mark = Symbol("mark");
    local[mark as unknown as string] = "kept";
    expect(local[mark as unknown as string]).toBe("kept");
    expect(local.length).toBe(0);
    expect(Object.keys(local)).toEqual([]);
    expect(mark in local).toBe(true);
    expect(delete local[mark as unknown as string]).toBe(true);
    expect(mark in local).toBe(false);
    expect(local[Symbol.iterator as unknown as string]).toBeUndefined();
  });

  test("defining a data property stores it; defining an accessor is a TypeError", () => {
    const local = storage();
    Object.defineProperty(local, "k", { value: 7 });
    expect(local.getItem("k")).toBe("7");
    expect(() => Object.defineProperty(local, "g", { get: () => "x" })).toThrow(TypeError);
    expect(local.getItem("g")).toBeNull();
  });
});

describe("a backend of its own", () => {
  test("the storage keeps nothing: every call goes to the backend, in the order of its keys", () => {
    const calls: string[] = [];
    const entries = new Map<string, string>();
    const backend: StorageBackend = {
      get length() { calls.push("length"); return entries.size; },
      get: (key) => { calls.push(`get ${key}`); return entries.get(key); },
      set: (key, value) => { calls.push(`set ${key}=${value}`); entries.set(key, value); },
      remove: (key) => { calls.push(`remove ${key}`); entries.delete(key); },
      clear: () => { calls.push("clear"); entries.clear(); },
      keys: () => { calls.push("keys"); return [...entries.keys()]; },
    };
    const local = createStorage(backend);
    expect(calls).toEqual([]);
    local.setItem("a", 1 as unknown as string);
    local.getItem("a");
    local.a = "2";
    local.removeItem("a");
    local.clear();
    expect(local.length).toBe(0);
    expect(calls).toEqual(["set a=1", "get a", "set a=2", "remove a", "clear", "length"]);
    // Creating the storage and asking the global for it reads nothing: a typeof does not start the backend.
    expect(typeof createStorage(backend)).toBe("object");
    expect(calls).toHaveLength(6);
  });
});

describe("the keys MMKV stores for the empty key and for keys that start like it", () => {
  const keys = ["", "\0", "\0\0", "\0a", "a\0", "a", "\0\0a", "\u0001", " ", "\\"];

  test("MMKV refuses an empty key: the encoded key is never empty, and decoding gives the key back", () => {
    for (const key of keys) {
      expect(encodeKey(key), JSON.stringify(key)).not.toBe("");
      expect(decodeKey(encodeKey(key)), JSON.stringify(key)).toBe(key);
    }
  });

  test("two keys never share an encoding, and an ordinary key is stored as it is", () => {
    expect(new Set(keys.map(encodeKey)).size).toBe(keys.length);
    for (const key of ["a", "theme", "a\0", "\u0001", " "]) expect(encodeKey(key)).toBe(key);
  });
});
