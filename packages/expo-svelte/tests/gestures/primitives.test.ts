import { test, expect } from "bun:test";
import { load, settle, world, byId, callsOf, nodesOf, type NativeCall } from "./support/harness.ts";

/** The `gesture` attribute on every primitive that forwards attributes, on the sugar (`<GestureDetector>`, `use:gesture`), and on the lowered tags. */
const j = () => () => {};
const w = () => { const fn = () => {}; (fn as { __workletHash?: number }).__workletHash = 1; return fn; };
const ids = ["view", "pressable", "scroll", "image", "text", "animated", "component", "detector", "action"] as const;

test("gesture attaches to the node's own view on View, Pressable, ScrollView, Image, Text, AnimatedView, and through GestureDetector and use:gesture", async () => {
  const m = await load({ fixture: "primitives-fixture.svelte" });
  const G = m.gestures.Gesture;
  const gestures = Object.fromEntries(ids.map((id, index) => [id, index % 2 ? G.Tap().onEnd(j()) : G.Pan().onUpdate(w())]));
  m.startSurface(71, m.Fixture, { gestures });
  await settle(m);
  const attaches = callsOf("attachGestureHandler");
  expect(attaches).toHaveLength(ids.length);
  for (const id of ids) {
    const node = byId(71, id);
    expect(node, id).toBeDefined();
    expect(attaches.filter((call) => call[2] === node?.tag), id).toHaveLength(1);
  }
  // One extra view for <GestureDetector>: a View of its own around the child; the others attach to the element itself.
  const detector = byId(71, "detector");
  expect(detector?.name).toBe("RCTView");
  expect(detector?.children).toHaveLength(1);
  expect(detector?.children[0]?.name).toBe("RCTText");
  // A view keeps its native view: no collapsing on any view that carries a gesture, and `gesture` never reaches a payload.
  for (const id of ["view", "pressable", "animated", "component", "detector", "action"] as const) expect(byId(71, id)?.props.collapsable, id).toBe(false);
  for (const node of nodesOf(71)) expect("gesture" in node.props).toBe(false);
});

test("use:gesture follows its parameter and removes the gesture when the element is destroyed", async () => {
  const m = await load({ fixture: "action-fixture.svelte" });
  const G = m.gestures.Gesture;
  const surface = m.startSurface(72, m.Fixture, { first: G.Pan().onUpdate(w()).minDistance(1) }) as unknown as { use(next: unknown): void; hide(): void };
  await settle(m);
  const tag = callsOf("createGestureHandler")[0]?.[2] as number;
  expect(callsOf("attachGestureHandler")[0]?.[2]).toBe(byId(72, "action")?.tag);
  world().calls.length = 0;
  surface.use(G.Pan().onUpdate(w()).minDistance(9));
  await settle(m);
  expect(world().calls.map((call) => call[0])).toEqual(["updateGestureHandler", "flushOperations"]);
  expect(world().calls[0]?.[2]).toMatchObject({ minDist: 9 });
  world().calls.length = 0;
  surface.hide();
  await settle(m);
  expect(world().calls).toEqual([["dropGestureHandler", tag], ["flushOperations"]] as NativeCall[]);
});

test("a GestureDetector without a gesture is an error", async () => {
  const m = await load({ fixture: "primitives-fixture.svelte" });
  expect(() => m.startSurface(73, m.Fixture, { gestures: {} })).toThrow(); // `gestures.detector` is undefined here
});
