import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadReference } from "../rn-reference.ts";
import { type BundleOptions, load, src } from "../support/bundle.ts";
import { type FakeNode, flatten, settle } from "../support/host.ts";
import { fakeHost } from "../support/fake-host.ts";
import type { PayloadTap } from "../support/payload-tap.ts";

/**
 * The Fabric host against the fake binding: what it builds, clones and commits for a Svelte tree, which payloads it sends, and what it does around a flush that no payload shows
 * (the work it skips for nodes it has not built, and who it sends through the animation layer once that is loaded).
 */
const tap: PayloadTap = { reference: await loadReference("android"), checks: [] };
const host = fakeHost({ globals: { __payloadTap: tap } });

type Handle = { tag: number; measure: (cb: (...a: number[]) => void) => void; measureInWindow: (cb: (...a: number[]) => void) => void; dispatchCommand: (name: string, args?: unknown[]) => void };
type Surface = Pick<typeof import("../../src/fabric/host.ts"), "startSurface" | "fabricStats" | "mayAnimate" | "plainStyle"> & {
  tick: () => Promise<void>;
  Fixture: Parameters<typeof import("../../src/fabric/host.ts").startSurface>[1];
  Shorthand: Parameters<typeof import("../../src/fabric/host.ts").startSurface>[1];
  renderer: typeof import("../../src/renderer.ts").default;
  NativeNode: typeof import("../../src/renderer.ts").NativeNode;
  defineViewKind: typeof import("../../src/fabric/view-configs.ts").defineViewKind;
};

const entry = `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/fabric-fixture.svelte"))};
  import Shorthand from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/host-hints-fixture.svelte"))};
  import renderer, { NativeNode } from ${JSON.stringify(src("renderer.ts"))};
  import { startSurface, fabricStats, mayAnimate, plainStyle } from ${JSON.stringify(src("fabric/host.ts"))};
  import { defineViewKind } from ${JSON.stringify(src("fabric/view-configs.ts"))};
  import { tick } from 'svelte';
  export { startSurface, fabricStats, mayAnimate, plainStyle, defineViewKind, tick, Fixture, Shorthand, renderer, NativeNode };`;
/** `payload-tap` for the tests that compare what the host sends with React Native's; the real tables, with nothing recorded, for the rest. */
const surface = (viewConfigs: NonNullable<BundleOptions["viewConfigs"]>) => load<Surface>({ entry, viewConfigs });

const find = (nodes: FakeNode[], name: string): FakeNode[] => flatten(nodes).filter((node) => node.name === name);
const declaresOf = (nodes: FakeNode[], name: string) => (find(nodes, name)[0]?.target as { hostState?: { declares?: (key: string) => boolean } } | undefined)?.hostState?.declares;

test("the Fabric host mounts, updates and clears a scroll list with one content child", async () => {
  const m = await surface("payload-tap");
  const app = m.startSurface(11, m.Fixture, {}) as { fill: (n: number) => void; clear: () => void; rename: (s: string) => void; pad: (n: number) => void };
  expect(host.calls.at(-1)).toBe("completeRoot");
  let scroll = find(host.roots[11], "RCTScrollView");
  expect(scroll).toHaveLength(1);
  expect(scroll[0].children).toHaveLength(1);
  expect(scroll[0].children[0].name).toBe("RCTView");
  expect(find(host.roots[11], "RCTRawText")[0].props.text).toBe("before");

  host.calls.length = 0;
  app.fill(300);
  await settle(m);
  expect(host.calls.at(-1)).toBe("completeRoot");
  scroll = find(host.roots[11], "RCTScrollView");
  expect(scroll[0].children).toHaveLength(1);
  expect(scroll[0].children[0].children).toHaveLength(300);
  expect(find(host.roots[11], "RCTRawText")).toHaveLength(301);
  expect(find(host.roots[11], "RCTRawText").at(-1)?.props.text).toBe("Row 300");
  expect(m.fabricStats().lastCreated).toBe(900);
  expect(m.fabricStats().animationLoaded).toBe(false); // nothing animated: Reanimated never loaded

  host.calls.length = 0;
  app.rename("after");
  await settle(m);
  expect(find(host.roots[11], "RCTRawText")[0].props.text).toBe("after");
  expect(host.calls.filter((c) => c.startsWith("create"))).toHaveLength(0);
  expect(scroll[0].children[0].children).toHaveLength(300);

  // The content container's own style changes with the rows as they were: the container is cloned with its children kept.
  host.calls.length = 0;
  app.pad(16);
  await settle(m);
  scroll = find(host.roots[11], "RCTScrollView");
  expect((scroll[0].children[0].props as { padding?: number }).padding).toBe(16);
  expect(scroll[0].children[0].children).toHaveLength(300);
  expect(host.calls.filter((c) => c.startsWith("create"))).toHaveLength(0);
  expect(host.calls).toContain("cloneProps RCTView");
  expect(host.calls).toContain("cloneChildren RCTScrollView");

  host.calls.length = 0;
  app.clear();
  await settle(m);
  scroll = find(host.roots[11], "RCTScrollView");
  expect(scroll[0].children).toHaveLength(1);
  expect(scroll[0].children[0].children).toHaveLength(0);

  app.fill(5);
  await settle(m);
  scroll = find(host.roots[11], "RCTScrollView");
  expect(scroll[0].children).toHaveLength(1);
  expect(scroll[0].children[0].children).toHaveLength(5);
});

test("a node's `declares` is made once for its view name, not again on every rebuild", async () => {
  const m = await surface("payload-tap");
  const app = m.startSurface(15, m.Fixture, {}) as { rename: (s: string) => void; fill: (n: number) => void };
  const first = declaresOf(host.roots[15], "RCTText");
  expect(typeof first).toBe("function");
  expect(first?.("notAProp")).toBe(false);
  // The text is rebuilt with its new string: its view name has not changed, so its `declares` is the one it had.
  app.rename("again");
  await settle(m);
  expect(find(host.roots[15], "RCTRawText")[0].props.text).toBe("again");
  expect(declaresOf(host.roots[15], "RCTText")).toBe(first);
  app.fill(3);
  await settle(m);
  expect(declaresOf(host.roots[15], "RCTText")).toBe(first);
});

type DirectApp = { fillDirect: (n: number) => void; layoutLog: () => unknown[][]; handleOf: () => Handle | null };

test("native elements take React Native props as direct attributes and merge them over nativeProps", async () => {
  const m = await surface("payload-tap");
  const app = m.startSurface(12, m.Fixture, {}) as DirectApp;
  const container = find(host.roots[12], "RCTView").find((n) => n.props.testID === "direct");
  expect(container?.props).toEqual({ pointerEvents: "box-none", testID: "direct" });

  // Svelte stringifies a `style` attribute on every element, so the host drops it; `nativeStyle` is the attribute that carries a style object.
  expect(find(host.roots[12], "RCTView").find((n) => n.props.testID === "styled")?.props).toEqual({ testID: "styled" });
  app.fillDirect(3);
  await settle(m);
  const rows = find(host.roots[12], "RCTView").filter((n) => n.props.onLayout === true);
  expect(rows).toHaveLength(3);
  expect(rows.map((n) => n.props.padding)).toEqual([4, 5, 6]);
  expect(rows[0].props.accessible).toBe(true);
  for (const key of ["class", "id", "data-row", "children", "nativeProps", "nativeStyle", "ref"]) expect(key in rows[0].props).toBe(false);
  expect("style" in rows[0].props).toBe(false); // styles are flattened into the payload; the stringified `style="color: red"` never reaches it
  expect(find(host.roots[12], "RCTText").filter((n) => n.props.fontSize === 12)).toHaveLength(3);
  // React Native's Text sends `ellipsizeMode: "tail"` unless told otherwise: without it Fabric measures a paragraph as `clip` and Android draws it as `END`.
  expect(find(host.roots[12], "RCTText").map((n) => n.props.ellipsizeMode)).toEqual(find(host.roots[12], "RCTText").map(() => "tail"));

  expect(app.layoutLog()).toEqual([]);
  host.emit(rows[1].target, "topLayout", { layout: { height: 42 } });
  host.emit(rows[2].target, "topLayout", { layout: { height: 7 } });
  expect(app.layoutLog()).toEqual([[1, 42], [2, 7]]);
  host.emit(rows[0].target, "topScroll", {}); // no handler, and no throw
  expect(app.layoutLog()).toHaveLength(2);
});

test("a ref attribute receives a handle that measures and dispatches commands through the binding", async () => {
  const m = await surface("payload-tap");
  const app = m.startSurface(13, m.Fixture, {}) as DirectApp;
  const handle = app.handleOf();
  expect(handle).not.toBeNull();
  const container = find(host.roots[13], "RCTView").find((n) => n.props.testID === "direct");
  expect(handle?.tag).toBe(container?.tag);
  let measured: number[] = [];
  handle?.measure((...a) => { measured = a; });
  expect(measured).toEqual([1, 2, 3, 4, 5, 6]);
  handle?.measureInWindow((...a) => { measured = a; });
  expect(measured).toEqual([5, 6, 3, 4]);
  handle?.dispatchCommand("focus", [1]);
  expect(host.calls).toContain(`dispatchCommand ${container?.tag} focus [1]`);
});

// Reads what the tests above made the host send, so it runs after them.
test("every payload the host builds for these fixture trees is identical to React Native's, key order included", () => {
  expect(tap.checks.length).toBeGreaterThan(600);
  expect(new Set(tap.checks.map((check) => check.kind))).toEqual(new Set(["create", "diff"]));
  expect(new Set(tap.checks.map((check) => check.view))).toEqual(new Set(["RCTView", "RCTText", "RCTScrollView"]));
  expect(tap.checks.filter((check) => check.mine !== check.reactNative)).toEqual([]);
});

test("a node the host has not built schedules nothing; a node that is attached does", async () => {
  const m = await surface("real");
  const app = m.startSurface(11, m.Fixture, {}) as { fillDirect: (n: number) => void; fill: (n: number) => void };
  const flushes = () => m.fabricStats().flushes;
  const before = flushes();
  // A node Svelte is putting together (its element, its text, an attribute) is not the host's business until it is attached.
  const element = new m.NativeNode("element", "native-view");
  element.setProp("testID", "loose");
  element.setProp("nativeStyle", { padding: 1 });
  const text = new m.NativeNode("text", "", "hello");
  text.setText("again");
  const fragment = new m.NativeNode("fragment");
  m.renderer.insert(fragment, element, null);
  m.renderer.insert(element, text, null);
  await settle(m);
  expect(flushes()).toBe(before);
  // What reaches the surface does: the rows a fixture mounts are built from nodes that were all unbuilt a moment before.
  app.fill(5);
  await settle(m);
  expect(flushes()).toBe(before + 1);
  expect(m.fabricStats().lastCreated).toBe(15); // 5 rows of a view, a text and its string
});

test("mayAnimate: plain nodes stay out of the animation layer, the ones it needs go through", async () => {
  const m = await surface("real");
  const shared = { value: 1, _isReanimatedSharedValue: true };
  expect(m.mayAnimate({ nativeStyle: { padding: 1 }, style: { padding: 10, backgroundColor: "#fff", borderRadius: 8 }, testID: "a" })).toBe(false);
  expect(m.mayAnimate({ style: [{ padding: 10 }, null, [{ margin: 2 }], false] })).toBe(false);
  expect(m.mayAnimate({})).toBe(false);
  expect(m.mayAnimate({ animatedStyle: () => ({}) })).toBe(true);
  expect(m.mayAnimate({ animatedProps: () => ({}) })).toBe(true);
  expect(m.mayAnimate({ entering: {} })).toBe(true);
  expect(m.mayAnimate({ exiting: {} })).toBe(true);
  expect(m.mayAnimate({ layout: {} })).toBe(true);
  expect(m.mayAnimate({ animationName: {} })).toBe(true);
  expect(m.mayAnimate({ transitionProperty: "opacity" })).toBe(true);
  expect(m.mayAnimate({ transition: "opacity 300ms" })).toBe(true); // Reanimated's shorthand
  expect(m.mayAnimate({ style: { animationDuration: "1s" } })).toBe(true);
  expect(m.mayAnimate({ style: [{ padding: 1 }, { transitionDuration: "1s" }] })).toBe(true);
  expect(m.mayAnimate({ style: { transition: "opacity 300ms" } })).toBe(true);
  expect(m.mayAnimate({ style: [{ padding: 1 }, { transition: "opacity 300ms" }] })).toBe(true);
  expect(m.mayAnimate({ style: { opacity: shared } })).toBe(true);
  expect(m.mayAnimate({ style: { transform: [{ translateX: shared }] } })).toBe(true);
  expect(m.mayAnimate({ style: [{ padding: 1 }, { opacity: shared }] })).toBe(true);
  expect(m.plainStyle(undefined)).toBe(true);
  expect(m.plainStyle("padding: 1")).toBe(true);
  expect(m.plainStyle({ animation: 1 })).toBe(true); // Reanimated has no `animation` shorthand (yet): `animationName` and the like are CSS keys, a bare `animation` is not
  expect(m.plainStyle({ transition: "opacity 300ms" })).toBe(false); // the `transition` shorthand is
});

test("a node whose only animation is the `transition` shorthand loads the animation layer", async () => {
  const m = await surface("real");
  const app = m.startSurface(21, m.Shorthand, {}) as { useShorthand: () => void };
  expect(m.fabricStats().animationLoaded).toBe(false); // a plain first screen boots without the layer
  app.useShorthand();
  await settle(m);
  expect(m.fabricStats().animationLoaded).toBe(true);
  const node = find(host.roots[21] ?? [], "RCTView").find((view) => view.props.testID === "shorthand");
  expect(node?.props).toEqual({ testID: "shorthand", padding: 2 }); // the shorthand is for the layer, not the native view
});

test("a node's `declares` follows its view config when the kind is defined anew", async () => {
  const m = await surface("real");
  const app = m.startSurface(22, m.Fixture, {}) as { rename: (s: string) => void };
  await settle(m);
  const state = (name: string) => (find(host.roots[22] ?? [], name)[0]?.target as { hostState?: { declares?: (key: string) => boolean } } | undefined)?.hostState;
  const before = state("RCTText")?.declares;
  const view = state("RCTView")?.declares;
  expect(before?.("customProp")).toBe(false);
  m.defineViewKind("RCTText", { plain: "customProp" });
  app.rename("again");
  await settle(m);
  const after = state("RCTText")?.declares;
  expect(after).not.toBe(before);
  expect(after?.("customProp")).toBe(true);
  expect(state("RCTView")?.declares).toBe(view); // a view name that was not defined anew keeps its function
});
