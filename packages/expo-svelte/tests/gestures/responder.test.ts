import { test, expect } from "bun:test";
import { load, settle, world, byId } from "./support/harness.ts";

// A JS responder that blocks the native ones (its `onResponderGrant` answers true) used to reach react-native-gesture-handler's module as `handleSetJSResponder`, as React Native's
// UIManager.setJSResponder did once RNGH 2 had patched it. RNGH 3's module has neither call, so the host sends nothing, with the gesture host loaded or not (`responder-native.test.ts` is
// the responder's own bookkeeping, which still reports a block and its release to a tree that wires them); this file shows the host wires none to the module.

type App = { setGesture(gesture: unknown): void };
const touch = (type: "topTouchStart" | "topTouchEnd" | "topTouchCancel") => {
  const point = { pageX: 10, pageY: 10, locationX: 10, locationY: 10, identifier: 0, target: 1, timestamp: 1 };
  return { ...point, touches: type === "topTouchStart" ? [point] : [], changedTouches: [point] };
};
async function mount() {
  const m = await load({ fixture: "responder-fixture.svelte" });
  const app = m.startSurface(62, m.Fixture, {}) as unknown as App;
  await settle(m);
  const send = (id: string, type: Parameters<typeof touch>[0]) => world().dispatch?.(byId(62, id)?.target, type, touch(type));
  return { m, app, send, G: m.gestures.Gesture };
}
test("an app that never used a gesture never touches RNGH's module, whatever its responders answer", async () => {
  const { m, send } = await mount();
  send("responder", "topTouchStart");
  send("responder", "topTouchEnd");
  expect(world().calls).toEqual([]);
  expect(m.fabricStats().gesturesLoaded).toBe(false);
});

test("a grant that answers true tells RNGH's module nothing, loaded or not: it has no JS-responder calls", async () => {
  const { m, app, send, G } = await mount();
  app.setGesture(G.Pan().onUpdate(() => {}).runOnJS(true));
  await settle(m);
  expect(m.fabricStats().gesturesLoaded).toBe(true);
  world().calls.length = 0;
  send("responder", "topTouchStart");
  send("responder", "topTouchEnd");
  expect(world().calls).toEqual([]);
  expect(byId(62, "responder")).toBeDefined();
});
