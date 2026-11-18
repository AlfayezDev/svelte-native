import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readerFor } from "../../src/doctor/resolve.ts";
import { workletsProblems } from "../../src/doctor/shapes.ts";
import { vendored } from "../support/paths.ts";

/**
 * `vendor-patches/react-native-worklets/0001-ui-frame-only-on-demand.patch`, applied to the library's copy of react-native-worklets (`vendor/`): the UI runtime's `requestAnimationFrame` queue asks the native side for a frame
 * only while a callback or finalizer is waiting. Upstream re-requests the next frame from every flush, forever, so once the
 * runtime exists the main thread runs a Choreographer callback, a JNI call and a Hermes call on every frame with an empty queue
 * (about 12 % of an idle screen's main-thread samples on the Galaxy A16). The test runs the library's own function against a
 * fake native side; it fails when the copy does not carry the patch.
 */
type Scope = {
  __nativeRequestAnimationFrame?: (callback: (timestamp: number) => void) => void;
  __callMicrotasks?: () => void;
  requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
  requestAnimationFrameFinalizer?: (callback: () => void) => void;
  __flushAnimationFrame?: unknown;
  cancelAnimationFrame?: unknown;
  __frameTimestamp?: number;
};
const scope = globalThis as unknown as Scope;
const keys = ["__nativeRequestAnimationFrame", "__callMicrotasks", "requestAnimationFrame", "requestAnimationFrameFinalizer", "__flushAnimationFrame", "cancelAnimationFrame", "__frameTimestamp"] as const;
const saved = Object.fromEntries(keys.map((key) => [key, scope[key]]));
afterEach(() => { for (const key of keys) (scope as Record<string, unknown>)[key] = saved[key]; });

async function runtime() {
  const file = join(vendored("react-native-worklets"), "lib/module/runLoop/uiRuntime/requestAnimationFrame.js");
  const { setupRequestAnimationFrame } = await import(pathToFileURL(file).href) as { setupRequestAnimationFrame(): void };
  const requested: ((timestamp: number) => void)[] = [];
  scope.__nativeRequestAnimationFrame = (callback) => { requested.push(callback); };
  scope.__callMicrotasks = () => {};
  setupRequestAnimationFrame();
  /** One native frame: the callback the runtime asked for runs with the timestamp. */
  const frame = (timestamp: number) => { const callback = requested.shift(); if (!callback) throw new Error("no frame was requested"); callback(timestamp); };
  return { requested, frame };
}

test("the runtime asks for no frame until something waits for one", async () => {
  const { requested } = await runtime();
  expect(requested.length).toBe(0);
});

test("a queued callback asks for one frame, and an empty queue does not ask for the next", async () => {
  const { requested, frame } = await runtime();
  const ran: number[] = [];
  scope.requestAnimationFrame?.((timestamp) => ran.push(timestamp));
  scope.requestAnimationFrame?.((timestamp) => ran.push(timestamp + 1));
  expect(requested.length).toBe(1);
  frame(10);
  expect(ran).toEqual([10, 11]);
  expect(requested.length).toBe(0);
});

test("a callback that requests another keeps the loop going, until it stops", async () => {
  const { requested, frame } = await runtime();
  let remaining = 3;
  const step = (): void => { if (--remaining > 0) scope.requestAnimationFrame?.(step); };
  scope.requestAnimationFrame?.(step);
  frame(1); frame(2);
  expect(requested.length).toBe(1);
  frame(3);
  expect(remaining).toBe(0);
  expect(requested.length).toBe(0);
});

test("a finalizer asks for a frame and runs after the callbacks of that frame", async () => {
  const { requested, frame } = await runtime();
  const order: string[] = [];
  scope.requestAnimationFrameFinalizer?.(() => order.push("finalizer"));
  expect(requested.length).toBe(1);
  scope.requestAnimationFrame?.(() => order.push("callback"));
  expect(requested.length).toBe(1);
  frame(5);
  expect(order).toEqual(["callback", "finalizer"]);
  expect(requested.length).toBe(0);
});

test("a cancelled callback leaves at most one empty frame behind", async () => {
  const { requested, frame } = await runtime();
  const handle = scope.requestAnimationFrame?.(() => { throw new Error("cancelled callbacks must not run"); }) ?? -1;
  (scope.cancelAnimationFrame as (handle: number) => void)(handle);
  frame(1);
  expect(requested.length).toBe(0);
});

test("the copy has the patch's shape, the one `svelte-native doctor` looks for in an app", () => {
  expect(workletsProblems(readerFor(vendored("react-native-worklets")))).toEqual([]);
});
