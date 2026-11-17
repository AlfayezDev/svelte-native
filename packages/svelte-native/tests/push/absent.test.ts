// `push` in an app whose config has push off (`src/push/absent.ts`, which the library's Metro config bundles in the client's place): it answers as the client does
// in a build without the native module.
import { expect, spyOn, test } from "bun:test";
import { MISSING_PUSH as clientMessage } from "../../src/push/client.ts";
import { MISSING_PUSH } from "../../src/push/missing.ts";

test("warns once when it loads, and answers as a build without push: denied, no token, subscribe null, listeners that hear nothing", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const { push } = await import("../../src/push/absent.ts");
    expect(warn.mock.calls).toEqual([[MISSING_PUSH]]);
    expect([push.permission, push.token]).toEqual(["denied", null]);
    expect(await push.subscribe({ save: () => { throw new Error("never called"); } })).toBeNull();
    await push.unsubscribe();
    expect(typeof push.on("message", () => {})).toBe("function");
    // The same mistakes as the client's are the same errors.
    await expect(push.subscribe({} as never)).rejects.toThrow("push.subscribe takes `{ save }`");
    expect(() => push.on("tap" as never, () => {})).toThrow('"tap" is not an event of push');
    expect(warn.mock.calls).toHaveLength(1);
  } finally {
    warn.mockRestore();
  }
});

test("the warning is the client's", () => {
  expect(MISSING_PUSH).toBe(clientMessage);
});
