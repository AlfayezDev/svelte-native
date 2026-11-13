import "./setup.ts";
import { describe, expect, test } from "bun:test";
import { Headers } from "../../src/fetch/headers.ts";
import { headersFromNative, headerPairs, setHeadersGuard } from "../../src/fetch/headers.ts";

describe("Headers construction", () => {
  test("from pairs, a record, another Headers, and any iterable of pairs", () => {
    expect([...new Headers([["A", "1"], ["b", "2"]])]).toEqual([["a", "1"], ["b", "2"]]);
    expect([...new Headers({ B: "2", A: "1" })]).toEqual([["a", "1"], ["b", "2"]]);
    expect([...new Headers(new Headers({ x: "y" }))]).toEqual([["x", "y"]]);
    expect([...new Headers(new Map([["k", "v"]]))]).toEqual([["k", "v"]]);
    expect([...new Headers()]).toEqual([]);
    expect([...new Headers(undefined)]).toEqual([]);
  });

  test("a record contributes its own enumerable string keys only", () => {
    const record = Object.create({ inherited: "no" }) as Record<string, string>;
    record.own = "yes";
    Object.defineProperty(record, "hidden", { value: "no", enumerable: false });
    record[Symbol("s") as unknown as string] = "no";
    expect([...new Headers(record)]).toEqual([["own", "yes"]]);
  });

  test("invalid inits are TypeErrors", () => {
    expect(() => new Headers(null as never)).toThrow(TypeError);
    expect(() => new Headers(1 as never)).toThrow(TypeError);
    expect(() => new Headers("a" as never)).toThrow(TypeError);
    expect(() => new Headers([["a"]] as never)).toThrow(TypeError);
    expect(() => new Headers([["a", "b", "c"]] as never)).toThrow(TypeError);
    expect(() => new Headers(["ab"] as never)).toThrow(TypeError);
    expect(() => new Headers({ "bad name": "x" })).toThrow(TypeError);
  });
});

describe("names and values", () => {
  test("a name is an HTTP token", () => {
    for (const name of ["", "a b", "a:b", "a\nb", "é", "a(b)", "a,b"]) expect(() => new Headers().append(name, "x")).toThrow(TypeError);
    for (const name of ["a", "A-b_c", "x.y", "!#$%&'*+-.^_`|~"]) expect(() => new Headers().append(name, "x")).not.toThrow();
    expect(() => new Headers().get("a b")).toThrow(TypeError);
    expect(() => new Headers().has("")).toThrow(TypeError);
    expect(() => new Headers().delete("é")).toThrow(TypeError);
  });

  test("a value is trimmed of tab, LF, CR and space, and may not hold NUL, CR or LF inside", () => {
    const headers = new Headers();
    headers.append("a", " \t\r\n x y \n");
    expect(headers.get("a")).toBe("x y");
    for (const value of ["a\nb", "a\rb", "a\0b"]) expect(() => headers.set("b", value)).toThrow(TypeError);
    headers.append("empty", "");
    expect(headers.get("empty")).toBe("");
  });

  test("a value is a ByteString: a character above U+00FF is a TypeError, U+00FF is not", () => {
    expect(() => new Headers().append("a", "ā")).toThrow(TypeError);
    expect(() => new Headers().append("a", "✓")).toThrow(TypeError);
    expect(new Headers({ a: "ÿ" }).get("a")).toBe("ÿ");
  });

  test("values that are not strings are converted", () => {
    const headers = new Headers();
    headers.append("n", 5 as never);
    headers.append("u", undefined as never);
    expect(headers.get("n")).toBe("5");
    expect(headers.get("u")).toBe("undefined");
  });

  test("a missing argument is a TypeError", () => {
    const headers = new Headers();
    expect(() => (headers.append as (...a: unknown[]) => void)("a")).toThrow(TypeError);
    expect(() => (headers.set as (...a: unknown[]) => void)("a")).toThrow(TypeError);
    expect(() => (headers.get as (...a: unknown[]) => void)()).toThrow(TypeError);
    expect(() => (headers.has as (...a: unknown[]) => void)()).toThrow(TypeError);
    expect(() => (headers.delete as (...a: unknown[]) => void)()).toThrow(TypeError);
  });
});

describe("the list", () => {
  test("names are case-insensitive; the same name appended twice is read combined", () => {
    const headers = new Headers({ "Content-Type": "text/plain" });
    expect(headers.get("content-type")).toBe("text/plain");
    expect(headers.has("CONTENT-TYPE")).toBe(true);
    headers.append("Accept", "a");
    headers.append("accept", "b");
    expect(headers.get("ACCEPT")).toBe("a, b");
    expect(headers.get("missing")).toBeNull();
    expect(headers.has("missing")).toBe(false);
  });

  test("set replaces every entry of the name with one, in the first one's place", () => {
    const headers = new Headers([["a", "1"], ["b", "2"], ["a", "3"], ["c", "4"]]);
    headers.set("A", "9");
    expect(headerPairs(headers)).toEqual([["a", "9"], ["b", "2"], ["c", "4"]]);
    headers.set("new", "x");
    expect(headerPairs(headers).at(-1)).toEqual(["new", "x"]);
  });

  test("delete removes every entry of the name", () => {
    const headers = new Headers([["a", "1"], ["b", "2"], ["a", "3"]]);
    headers.delete("A");
    expect([...headers]).toEqual([["b", "2"]]);
    expect(() => headers.delete("never-there")).not.toThrow();
  });

  test("iteration is sorted by name and combined; forEach, keys, values and entries agree", () => {
    const headers = new Headers([["Zed", "z"], ["alpha", "1"], ["Alpha", "2"], ["mid", "m"]]);
    expect([...headers]).toEqual([["alpha", "1, 2"], ["mid", "m"], ["zed", "z"]]);
    expect([...headers.keys()]).toEqual(["alpha", "mid", "zed"]);
    expect([...headers.values()]).toEqual(["1, 2", "m", "z"]);
    expect([...headers.entries()]).toEqual([...headers]);
    const seen: unknown[] = [];
    const self = {};
    headers.forEach(function (this: unknown, value, name, owner) { seen.push([value, name, owner === headers, this === self]); }, self);
    expect(seen).toEqual([["1, 2", "alpha", true, true], ["m", "mid", true, true], ["z", "zed", true, true]]);
    expect(() => headers.forEach(1 as never)).toThrow(TypeError);
  });

  test("sorting is by code unit, not by locale", () => {
    const headers = new Headers([["b", "1"], ["B-", "2"], ["a_", "3"], ["a-", "4"], ["a.", "5"]]);
    expect([...headers.keys()]).toEqual(["a-", "a.", "a_", "b", "b-"]);
  });

  test("Set-Cookie is kept apart in iteration and combined by get; getSetCookie lists them", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "a=1");
    headers.append("x", "y");
    headers.append("set-cookie", "b=2; Expires=Wed, 21 Oct 2015 07:28:00 GMT");
    expect(headers.getSetCookie()).toEqual(["a=1", "b=2; Expires=Wed, 21 Oct 2015 07:28:00 GMT"]);
    expect(headers.get("set-cookie")).toBe("a=1, b=2; Expires=Wed, 21 Oct 2015 07:28:00 GMT");
    expect([...headers]).toEqual([["set-cookie", "a=1"], ["set-cookie", "b=2; Expires=Wed, 21 Oct 2015 07:28:00 GMT"], ["x", "y"]]);
    expect(new Headers().getSetCookie()).toEqual([]);
  });

  test("iteration sees changes made during it, as the standard says", () => {
    const headers = new Headers([["a", "1"], ["b", "2"], ["c", "3"]]);
    const seen: string[] = [];
    for (const [name] of headers) {
      seen.push(name);
      if (name === "a") headers.delete("b");
    }
    expect(seen).toEqual(["a", "c"]);
    const added: string[] = [];
    for (const [name] of headers) {
      added.push(name);
      if (name === "a") headers.append("d", "4");
    }
    expect(added).toEqual(["a", "c", "d"]);
  });

  test("a copy shares nothing", () => {
    const original = new Headers({ a: "1" });
    const copy = new Headers(original);
    copy.append("a", "2");
    expect(original.get("a")).toBe("1");
  });

  test("it is a Headers to Object.prototype.toString", () => {
    expect(Object.prototype.toString.call(new Headers())).toBe("[object Headers]");
  });
});

describe("guards", () => {
  test("an immutable list throws on every change and reads as usual", () => {
    const headers = setHeadersGuard(new Headers({ a: "1" }), "immutable");
    expect(() => headers.append("a", "2")).toThrow(TypeError);
    expect(() => headers.set("a", "2")).toThrow(TypeError);
    expect(() => headers.delete("a")).toThrow(TypeError);
    expect(headers.get("a")).toBe("1");
    expect([...headers]).toEqual([["a", "1"]]);
    // A copy is mutable.
    const copy = new Headers(headers);
    copy.append("b", "2");
    expect(copy.get("b")).toBe("2");
  });

  test("an invalid name or value is reported before the guard is", () => {
    const headers = setHeadersGuard(new Headers(), "immutable");
    expect(() => headers.append("a b", "x")).toThrow(/Invalid header name/);
    expect(() => headers.append("a", "x")).toThrow(/immutable/);
  });
});

describe("headers from native code", () => {
  test("are immutable, lower-cased, in order, and not validated", () => {
    const headers = headersFromNative([["Content-Type", " text/plain "], ["X-Odd", "aĀb"], ["Dup", "1"], ["dup", "2"]]);
    expect(headerPairs(headers)).toEqual([["content-type", "text/plain"], ["x-odd", "aĀb"], ["dup", "1"], ["dup", "2"]]);
    expect(headers.get("dup")).toBe("1, 2");
    expect(() => headers.set("a", "b")).toThrow(TypeError);
  });

  test("a Set-Cookie header iOS merged is split where a new cookie starts, and not inside an Expires date", () => {
    const merged = "a=1; Path=/; Expires=Wed, 21 Oct 2015 07:28:00 GMT, b=2; HttpOnly, c=3";
    expect(headersFromNative([["Set-Cookie", merged]]).getSetCookie()).toEqual(["a=1; Path=/; Expires=Wed, 21 Oct 2015 07:28:00 GMT", "b=2; HttpOnly", "c=3"]);
    // Android's separate lines stay separate.
    expect(headersFromNative([["Set-Cookie", "a=1"], ["Set-Cookie", "b=2"]]).getSetCookie()).toEqual(["a=1", "b=2"]);
  });
});
