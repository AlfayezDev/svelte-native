import { test, expect } from "bun:test";
import { load, settle, world, byId, callsOf } from "./support/harness.ts";

// A JS responder that blocks the native ones reaches react-native-gesture-handler's module (`handleSetJSResponder`), as React Native's
// UIManager.setJSResponder does once RNGH has patched it, and only when the gesture host is loaded. When a grant blocks and when a release gives the responders back (a termination,
// a grant that answers nothing or false) is `responder-native.test.ts`'s, on a fake tree; this file shows the wiring to the real module.

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
const responderCalls = () => callsOf("handleSetJSResponder", "handleClearJSResponder");

test("an app that never used a gesture never touches RNGH's module, whatever its responders answer", async () => {
  const { m, send } = await mount();
  send("responder", "topTouchStart");
  send("responder", "topTouchEnd");
  expect(world().calls).toEqual([]);
  expect(m.fabricStats().gesturesLoaded).toBe(false);
});

test("a grant that answers true tells the module with the node's tag, and the release clears it", async () => {
  const { m, app, send, G } = await mount();
  app.setGesture(G.Pan().onUpdate(() => {}).runOnJS(true));
  await settle(m);
  expect(m.fabricStats().gesturesLoaded).toBe(true);
  world().calls.length = 0;
  send("responder", "topTouchStart");
  expect(responderCalls()).toEqual([["handleSetJSResponder", byId(62, "responder")?.tag, true]]);
  send("responder", "topTouchEnd");
  expect(responderCalls()).toEqual([["handleSetJSResponder", byId(62, "responder")?.tag, true], ["handleClearJSResponder"]]);
});
