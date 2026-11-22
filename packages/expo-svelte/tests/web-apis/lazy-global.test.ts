import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { defineLazyGlobal } from "../../src/lazy-global.ts";

/**
 * A lazy global whose loader fails: on a binary without the native library (an update of the JavaScript delivered to an app built before the library was added) a read of `crypto`
 * or `localStorage` used to throw from the getter, so `typeof crypto` and `crypto?.randomUUID` were not feature probes. The read answers `undefined` now, with one warning, and tries
 * the loader again on the next read.
 */
let warn: ReturnType<typeof spyOn>;
beforeEach(() => { warn = spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { warn.mockRestore(); });

describe("defineLazyGlobal", () => {
  test("a loader that throws: the read is undefined, `typeof` and optional chaining probe it, and it is warned about once", () => {
    const scope: Record<string, unknown> = {};
    defineLazyGlobal(scope, "feature", () => { throw new Error("the native library is not linked"); });
    expect(typeof scope.feature).toBe("undefined");
    expect((scope.feature as { member?: unknown } | undefined)?.member).toBeUndefined();
    expect(scope.feature).toBeUndefined();
    expect("feature" in scope).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toBe("expo-svelte: `feature` is not available: the native library is not linked");
  });

  test("the loader is tried again on a later read, and the value it makes then replaces the accessor", () => {
    const scope: Record<string, unknown> = {};
    let linked = false;
    const made = { value: 1 };
    defineLazyGlobal(scope, "feature", () => {
      if (!linked) throw new Error("not linked yet");
      return made;
    });
    expect(scope.feature).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(scope, "feature")!.get).toBeInstanceOf(Function);
    linked = true;
    expect(scope.feature).toBe(made);
    expect(Object.getOwnPropertyDescriptor(scope, "feature")).toEqual({ value: made, writable: true, enumerable: false, configurable: true });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("a loader that keeps failing warns once, not on every read; a thrown value that is not an Error is told as it is", () => {
    const scope: Record<string, unknown> = {};
    defineLazyGlobal(scope, "feature", () => { throw "plain string"; });
    for (let i = 0; i < 5; i++) expect(scope.feature).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("plain string");
  });

  test("a loader that works is called once; a name the scope has already is left alone; an assignment replaces the accessor", () => {
    const scope: Record<string, unknown> = { existing: "platform's" };
    let calls = 0;
    defineLazyGlobal(scope, "feature", () => { calls++; return "made"; });
    defineLazyGlobal(scope, "existing", () => "ours");
    expect([scope.feature, scope.feature, calls, scope.existing]).toEqual(["made", "made", 1, "platform's"]);
    defineLazyGlobal(scope, "assigned", () => { throw new Error("never read"); });
    scope.assigned = "the library's own";
    expect([scope.assigned, warn.mock.calls.length]).toEqual(["the library's own", 0]);
  });

  test("makes nothing until the name is read, then once: the accessor is replaced by the value", () => {
    const scope: Record<string, unknown> = {};
    let made = 0;
    defineLazyGlobal(scope, "thing", () => { made++; return { n: made }; });
    expect(made).toBe(0);
    expect(Object.keys(scope)).toEqual([]);
    expect(typeof Object.getOwnPropertyDescriptor(scope, "thing")?.get).toBe("function");
    const first = scope.thing;
    expect(first).toEqual({ n: 1 });
    expect(scope.thing).toBe(first);
    expect(made).toBe(1);
    expect(Object.getOwnPropertyDescriptor(scope, "thing")).toEqual({ value: first, writable: true, enumerable: false, configurable: true });
  });

  test("a name the scope has keeps its value, whatever it is; an assignment replaces the global as for any other, before the first read or after it", () => {
    const scope: Record<string, unknown> = { had: undefined, other: 1 };
    let made = 0;
    defineLazyGlobal(scope, "had", () => { made++; return 1; });
    defineLazyGlobal(scope, "other", () => { made++; return 2; });
    expect([scope.had, scope.other, made]).toEqual([undefined, 1, 0]);

    defineLazyGlobal(scope, "before", () => { made++; return "made"; });
    scope.before = "assigned";
    expect([scope.before, made]).toEqual(["assigned", 0]);
    defineLazyGlobal(scope, "after", () => { made++; return "made"; });
    expect(scope.after).toBe("made");
    scope.after = "assigned";
    expect(scope.after).toBe("assigned");
  });
});
