import { expect, test } from "bun:test";
import { createHarness, find, settle } from "./support/harness.ts";
import type { AnimLog } from "../reanimated-stubs.ts";

/**
 * react-native-animateable-text (SPEC.md, "Foreign views"): `JBAnimatedText` is a text view whose string is the `text` prop, so a
 * Reanimated worklet can set it from the UI thread. The component passes `animatedProps` to the host's animation layer, which attaches
 * it like `animatedStyle` (a descriptor set and a mapper per node) and writes with `updateProps(..., true)`; the first value is in the
 * first commit. The UI-thread commit that Reanimated makes for a `text` update (a shadow-tree clone, like any layout prop) is device work.
 */
const name = "JBAnimatedText";
type App = { hide(): void; resize(size: number): void; count_(): { value: number }; textHandle(): { tag: number } | null };
const log = () => (globalThis as unknown as { __anim: AnimLog }).__anim;

test("the text mounts with the worklet's first value, announced to the engine first, and a plain text keeps its own", async () => {
  const harness = createHarness("android");
  const loaded = await harness.load("text-fixture.svelte");
  const app = loaded.startSurface(151, loaded.Fixture, {}) as App;
  const [animated, plain] = find(harness.roots()[151], name);
  expect(animated.props).toMatchObject({ text: "count 3", numberOfLines: 2, selectionColor: 0xffff0000 | 0, fontSize: 14 });
  for (const key of ["animatedProps", "ref", "nativeProps", "component"]) expect(key in animated.props, key).toBe(false);
  expect(plain.props).toEqual({ text: "plain" });
  harness.expectToldFirst(name);
  expect(app.textHandle()?.tag).toBe(animated.tag);

  // One descriptor set and one mapper, for the animated node only.
  const A = log();
  expect(A.descriptors).toHaveLength(1);
  expect(A.descriptors[0].adds).toEqual([{ tag: animated.tag, shadowNodeWrapper: animated }]);
  expect(A.mappers).toHaveLength(1);
});

test("a text without animatedProps does not load the animation layer", async () => {
  const harness = createHarness("android");
  const loaded = await harness.load("text-static-fixture.svelte");
  loaded.startSurface(152, loaded.Fixture, {});
  const [text] = find(harness.roots()[152], name);
  expect(text.props).toMatchObject({ text: "static", numberOfLines: 1 });
  expect("animatedProps" in text.props).toBe(false);
  // Reanimated's modules (the stubs) are evaluated only when the first node that wants them is built.
  expect((globalThis as { __anim?: unknown }).__anim).toBeUndefined();
  expect((globalThis as { __svelteFabric?: { stats(): { animationLoaded: boolean } } }).__svelteFabric?.stats().animationLoaded).toBe(false);
});

test("the mapper writes the shared value's text as animated props, only when it changed; a clone keeps the mapper and the text; removal stops it", async () => {
  const harness = createHarness("android");
  const loaded = await harness.load("text-fixture.svelte");
  const app = loaded.startSurface(152, loaded.Fixture, {}) as App;
  const A = log();
  const [animated] = find(harness.roots()[152], name);

  A.mappers[0].worklet(); // nothing changed since the first run
  expect(A.updates).toEqual([]);
  app.count_().value = 7; // the UI thread: a new value of the shared value runs the mapper
  A.mappers[0].worklet();
  app.count_().value = 8;
  A.mappers[0].worklet();
  expect(A.updates.map((update) => [update.values, update.animatedProps])).toEqual([[{ text: "count 7" }, true], [{ text: "count 8" }, true]]);
  expect((A.updates[0].descriptors as { id: number }).id).toBe(1);

  // A new style is a clone of the node: the set follows it, the text of the first commit is not sent again.
  harness.calls.length = 0;
  app.resize(20);
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  const [cloned] = find(harness.roots()[152], name);
  expect(cloned).not.toBe(animated);
  expect(cloned.props).toMatchObject({ text: "count 3", fontSize: 20 });
  expect(A.descriptors[0].adds.at(-1)?.shadowNodeWrapper).toBe(cloned);
  expect(A.mappers).toHaveLength(1);
  expect(A.mappers[0].stopped).toBe(false);

  app.hide();
  await settle(loaded);
  expect(A.mappers[0].stopped).toBe(true);
  expect(A.descriptors[0].removes).toEqual([animated.tag]);
});
