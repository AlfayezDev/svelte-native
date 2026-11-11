import { expect, test } from "bun:test";
import { all, host, load, settle } from "./html-harness.ts";

// Bun runs every test file in one process, and other files install a fake Fabric binding of their own after this harness has loaded. The bundled host reads the binding when
// it is evaluated, so `load()` must install the harness's fake again: on CI another file's fake was read and every tree was empty.
test("a fake binding another file installed after the harness loaded does not take the host", async () => {
  const foreign = { createNode: () => ({}), cloneNodeWithNewChildren: (n: unknown) => n, cloneNodeWithNewProps: (n: unknown) => n, cloneNodeWithNewChildrenAndProps: (n: unknown) => n, appendChild() {}, createChildSet: () => [], appendChildToSet() {}, completeRoot() {}, registerEventHandler() {} };
  (globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = foreign;
  const m = await load();
  m.startSurface(901, m.Fixture, {});
  await settle(m);
  expect(all(host.roots[901] ?? []).length).toBeGreaterThan(5);
});
