import { test, expect } from "bun:test";
import { compile } from "svelte/compiler";
import { lowerPrimitives } from "../../src/lower.ts";
import { load, settle, world, byId, callsOf, nodesOf, type NativeCall } from "./harness.ts";

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

test("lowering keeps `use:gesture` quiet, and still warns about other actions and about a gesture import from elsewhere", () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const imports = `<script>\n  import { View } from "@example/svelte-native";\n  import { gesture } from "@example/svelte-native/gestures";\n  import { tap } from "./actions";\n</script>\n`;
  const out = lowerPrimitives(`${imports}<View use:gesture={pan}>a</View><View use:tap>b</View>`, { filename: "a.svelte", warn });
  expect(out).toContain("<native-view use:gesture={pan}>a</native-view>");
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("use:tap");

  warnings.length = 0;
  const other = `<script>\n  import { View } from "@example/svelte-native";\n  import { gesture } from "./mine";\n</script>\n<View use:gesture={pan}>a</View>`;
  lowerPrimitives(other, { filename: "b.svelte", warn });
  expect(warnings).toHaveLength(1);

  // An alias is still the action.
  warnings.length = 0;
  lowerPrimitives(`<script>\n  import { View } from "@example/svelte-native";\n  import { gesture as drag } from "@example/svelte-native/gestures";\n</script>\n<View use:drag={pan}>a</View>`, { filename: "c.svelte", warn });
  expect(warnings).toEqual([]);
});

test("the lowered and the component form of a primitive compile to the same host tag with the attribute", () => {
  const source = `<script>\n  import { View } from "@example/svelte-native";\n  let { pan } = $props();\n</script>\n<View gesture={pan} />`;
  const code = compile(lowerPrimitives(source), { filename: "f.svelte", generate: "client", runes: true, experimental: { customRenderer: "@example/svelte-native/renderer" } }).js.code;
  expect(code).toContain("native-view");
  expect(code).toContain("'gesture'");
});
