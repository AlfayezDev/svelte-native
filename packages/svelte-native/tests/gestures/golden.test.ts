import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load, settle, world, byId, type Loaded, type NativeCall } from "./harness.ts";

/**
 * The native call sequence of react-native-gesture-handler's own detector for twelve gesture shapes, captured by
 * `capture-golden.mjs`, against the Svelte host's: a compiled fixture with `gesture` attributes and a fake native module.
 */
type Vector = { name: string; attach: NativeCall[]; update?: NativeCall[]; drop: NativeCall[] };
const golden = JSON.parse(readFileSync(resolve(import.meta.dirname, "golden/rngh-2.32.0-native-calls.json"), "utf8")) as { version: string; vectors: Vector[] };

/** Handler tags and view tags in order of first appearance, so two runs with different counters compare. */
function normalise(calls: readonly NativeCall[]): NativeCall[] {
  const tags = new Map<number, number>();
  const views = new Map<number, string>();
  const tag = (value: unknown) => { const key = value as number; if (!tags.has(key)) tags.set(key, tags.size + 1); return tags.get(key) as number; };
  const view = (value: unknown) => { const key = value as number; if (!views.has(key)) views.set(key, `view${views.size + 1}`); return views.get(key) as string; };
  return calls.map(([method, ...args]): NativeCall => {
    switch (method) {
      case "createGestureHandler": return [method, args[0], tag(args[1]), args[2]];
      case "attachGestureHandler": return [method, tag(args[0]), view(args[1]), args[2]];
      case "updateGestureHandler": {
        const config = { ...(args[1] as Record<string, unknown>) };
        for (const relation of ["waitFor", "simultaneousHandlers", "blocksHandlers"]) config[relation] = (config[relation] as number[]).map(tag);
        return [method, tag(args[0]), config];
      }
      case "dropGestureHandler": return [method, tag(args[0])];
      default: return [method, ...args];
    }
  });
}
const same = (mine: readonly NativeCall[], expected: readonly NativeCall[]) => {
  // JSON text too: the order of the config keys is what the native module reads first-to-last.
  expect(JSON.stringify(normalise(mine))).toBe(JSON.stringify(normalise(expected)));
};

// The capture script marks callbacks as worklets by setting `__workletHash` on one shared function, which stays set for every
// vector after `pan-worklet`: from there on `js` counts as a worklet too (action type 1). The same sequence is kept so that
// the vectors can be compared as they are.
type Gesture = ReturnType<Loaded["gestures"]["Gesture"]["Pan"]> | ReturnType<Loaded["gestures"]["Gesture"]["Simultaneous"]>;
const callback = () => {};
const worklet = (fn: () => void) => { (fn as { __workletHash?: number }).__workletHash = 1; return fn; };
const shapes = (G: Loaded["gestures"]["Gesture"]): Record<string, () => Gesture> => ({
  "pan-js-offsets": () => G.Pan().onUpdate(callback).activeOffsetX([-10, 10]).failOffsetY([-10, 10]).minPointers(1).maxPointers(2),
  "pan-worklet": () => G.Pan().onStart(worklet(callback)).onUpdate(worklet(callback)).onEnd(worklet(callback)),
  "pan-no-callbacks-counts-as-worklet": () => G.Pan(),
  "pan-mixed-runOnJS": () => G.Pan().runOnJS(true).onUpdate(worklet(callback)).onEnd(callback).hitSlop({ left: -20 }).enabled(false).shouldCancelWhenOutside(true).manualActivation(true),
  "hitslop-number": () => G.Tap().hitSlop(12).onEnd(callback),
  "simultaneous-pan-pinch-rotation": () => G.Simultaneous(G.Pan().onUpdate(callback), G.Pinch().onUpdate(callback), G.Rotation().onUpdate(callback)),
  "exclusive-doubletap-singletap": () => G.Exclusive(G.Tap().numberOfTaps(2).onEnd(callback), G.Tap().onEnd(callback)),
  "race-longpress-tap": () => G.Race(G.LongPress().minDuration(300).maxDistance(10).onStart(callback), G.Tap().maxDuration(250).onEnd(callback)),
  "fling-direction": () => G.Fling().direction(3).numberOfPointers(1).onEnd(callback),
  "manual-touches": () => G.Manual().onTouchesDown(callback).onTouchesMove(callback),
});

test("the golden file is RNGH 2.32.0's and has the twelve shapes the design names", () => {
  expect(golden.version).toBe("2.32.0");
  expect(golden.vectors.map((vector) => vector.name)).toEqual([
    "pan-js-offsets", "pan-worklet", "pan-no-callbacks-counts-as-worklet", "pan-mixed-runOnJS", "hitslop-number", "simultaneous-pan-pinch-rotation",
    "exclusive-doubletap-singletap", "race-longpress-tap", "fling-direction", "manual-touches", "external-relations-native-then-pan", "update-same-shape",
  ]);
});

test("every vector: the native calls of attach, update and drop equal RNGH's own, in order", async () => {
  const m = await load({ fixture: "gesture-fixture.svelte" });
  const app = m.startSurface(41, m.Fixture, {}) as unknown as { set(items: unknown[]): void };
  const G = m.gestures.Gesture;
  const make = shapes(G);
  const take = () => { const calls = [...world().calls]; world().calls.length = 0; return calls; };
  const byName = new Map(golden.vectors.map((vector) => [vector.name, vector]));
  const check = async (name: string, nodes: () => { id: string; gesture: unknown }[], run?: (expected: Vector) => Promise<void>) => {
    const expected = byName.get(name) as Vector;
    app.set(nodes());
    await settle(m);
    same(take(), expected.attach);
    if (run) await run(expected);
    app.set([]);
    await settle(m);
    const dropped = take();
    if (expected.drop.length) same(dropped, expected.drop);
  };
  for (const name of Object.keys(make)) await check(name, () => [{ id: "box", gesture: (make[name] as () => Gesture)() }]);

  // A native view and a pan that names it, on two nodes of one commit: the relations resolve to the first one's tag.
  const scroll = G.Native().disallowInterruption(true).shouldActivateOnStart(false);
  const pan = G.Pan().onUpdate(worklet(callback)).simultaneousWithExternalGesture(scroll).requireExternalGestureToFail(scroll).blocksExternalGesture(scroll);
  await check("external-relations-native-then-pan", () => [{ id: "scroll", gesture: scroll }, { id: "pan", gesture: pan }]);

  // A new gesture object of the same shape: the handler keeps its tag and only its config is sent.
  const first = G.Pan().onUpdate(worklet(callback)).enabled(true);
  await check("update-same-shape", () => [{ id: "box", gesture: first }], async (expected) => {
    app.set([{ id: "box", gesture: G.Pan().onUpdate(worklet(callback)).enabled(false).minDistance(4) }]);
    await settle(m);
    same(take(), expected.update as NativeCall[]);
  });
  expect(byId(41, "box")).toBeUndefined();
});
