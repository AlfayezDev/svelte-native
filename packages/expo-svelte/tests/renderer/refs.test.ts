import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { createHarness, settle } from "../foreign/support/harness.ts";

/**
 * `ref` follows React's contract (SPEC.md, "Refs"): the handle when the element is built, `ref(null)` when it is destroyed, and when the
 * attribute changes the old callback hears null before the new one gets the handle. Svelte does not tell the host about a node that is
 * destroyed (a removal and a move are both an unlink), so the host finds the dead ones itself.
 */
type App = { set(values: { show?: boolean; which?: number; order?: string[]; shotWhich?: number; shotShown?: boolean }): void; events(): unknown[][]; clear(): void };
async function mount(root: number) {
  const harness = createHarness("android");
  // A `ViewShot` cancels its frame loop when it is destroyed; the test runtime has no such function. Set after the harness took its snapshot of the global object, so its restore takes it away.
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame ??= () => {};
  const loaded = await harness.load(resolve(import.meta.dirname, "fixtures/refs-fixture.svelte"));
  const app = loaded.startSurface(root, loaded.Fixture, {}) as App;
  return { app, loaded, harness };
}
const sorted = (events: unknown[][]) => events.map((event) => event.map(String).join(":")).sort();

test("a ref hears null when its element is destroyed, once, with the subtree's refs", async () => {
  const { app, loaded } = await mount(150);
  expect(sorted(app.events())).toEqual(["a:handle", "child:handle", "w1:function", "x:handle", "y:handle", "z:handle"]);
  app.clear();
  app.set({ show: false });
  await settle(loaded);
  // The element and its child go together (the parent first, as React detaches).
  expect(app.events()).toEqual([["a", null], ["child", null]]);
  app.set({ show: true });
  await settle(loaded);
  app.clear();
  app.set({ show: false });
  await settle(loaded);
  await settle(loaded);
  expect(app.events()).toEqual([["a", null], ["child", null]]);
});

test("a changed ref: the old callback hears null, then the new one gets the handle; a removed ref hears null", async () => {
  const { app, loaded } = await mount(151);
  app.clear();
  app.set({ which: 1 });
  await settle(loaded);
  expect(app.events()).toEqual([["a", null], ["b", "handle"]]);
  app.clear();
  app.set({ which: 2 });
  await settle(loaded);
  expect(app.events()).toEqual([["b", null]]);
  app.clear();
  app.set({ which: 0 });
  await settle(loaded);
  expect(app.events()).toEqual([["a", "handle"]]);
});

test("moving an element is not destroying it, and removing one of a list nulls only that one", async () => {
  const { app, loaded } = await mount(152);
  app.clear();
  app.set({ order: ["z", "x", "y"] });
  await settle(loaded);
  expect(app.events()).toEqual([]);
  app.set({ order: ["z", "y"] });
  await settle(loaded);
  expect(app.events()).toEqual([["x", null]]);
});

test("stopping the surface nulls the refs that are left, once", async () => {
  const { app, loaded } = await mount(153);
  app.clear();
  loaded.stopSurface(153);
  await settle(loaded);
  await settle(loaded);
  expect(sorted(app.events())).toEqual(["a:null", "child:null", "w1:null", "x:null", "y:null", "z:null"]);
});

test("a component that wraps its ref: a new `ref` prop is called as the host calls any ref, and the callback that got the handle hears null at the end", async () => {
  const { app, loaded } = await mount(154);
  app.clear();
  app.set({ shotWhich: 1 });
  await settle(loaded);
  expect(app.events()).toEqual([["w1", null], ["w2", "function"]]);
  app.clear();
  app.set({ shotShown: false });
  await settle(loaded);
  await settle(loaded);
  expect(app.events()).toEqual([["w2", null]]);
});
