import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { AnimLog } from "../support/reanimated-stubs.ts";
import { baseStubs, load, src } from "../support/bundle.ts";
import { type FakeNode, flatten } from "../support/host.ts";
import { fakeHost } from "../support/fake-host.ts";

/**
 * Reanimated's `entering`, `exiting` and `layout` props (`fabric/animation.ts`, with the fakes of `reanimated-stubs.ts` recorded on `globalThis.__anim`): registered by nativeID before
 * the commit that inserts the node and never in the payload, by tag after the mounting commit, registered again when they change or go, and carried over when an element is made
 * again as another component.
 */
const host = fakeHost();
const log = () => (globalThis as unknown as { __anim: AnimLog }).__anim;

/** How many layout configs Reanimated had been given at each commit: a nativeID-keyed `entering` has to be there before the commit that inserts its node. */
const configsAtCommit: number[] = [];
const completeRoot = host.fake.completeRoot;
host.fake.completeRoot = (root, set) => {
  configsAtCommit.push(log()?.layoutConfigs?.length ?? 0);
  completeRoot(root, set);
};

const stubs = {
  ...baseStubs(),
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
};

type Mounted = { startSurface: typeof import("../../src/fabric/host.ts").startSurface; tick: () => Promise<void>; Fixture: never };
const mount = (fixture = "layout-animation-fixture.svelte") => {
  configsAtCommit.length = 0;
  return load<Mounted>({
    entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures", fixture))};
      import { startSurface } from ${JSON.stringify(src("fabric/host.ts"))};
      import { tick } from 'svelte';
      export { startSurface, tick, Fixture };`,
    stubs,
    converters: false,
  });
};

const find = (nodes: FakeNode[], name: string): FakeNode[] => flatten(nodes).filter((node) => node.name === name);
const byId = (root: number, id: string) => find(host.roots[root] ?? [], "RCTView").find((n) => n.props.testID === id) as FakeNode;
type App = { showEntering: () => void; swapLayout: () => void; dropExiting: () => void };
const configs = () => log().layoutConfigs ?? [];

test("entering is registered under a nativeID before the commit that inserts the node, and never reaches the payload", async () => {
  const m = await mount();
  m.startSurface(41, m.Fixture, {});
  const plain = byId(41, "entering");
  expect(plain).toBeDefined();
  const entering = configs().filter((c) => c.type === 1);
  expect(entering).toHaveLength(1);
  expect(entering[0].config).toEqual({ build: "entering" });
  expect(configs().indexOf(entering[0])).toBeLessThan(configsAtCommit[0] as number);
  expect(plain.props.nativeID).toBe(String(entering[0].viewTag));
  for (const key of ["entering", "exiting", "layout"]) expect(key in plain.props).toBe(false);
  // not a tag: Reanimated moves nativeID-keyed configs to the tag when it sees the inserted view
  expect(entering[0].viewTag).not.toBe(plain.tag);
});

test("exiting and layout are registered by tag after the mounting commit", async () => {
  const m = await mount();
  m.startSurface(42, m.Fixture, {});
  const node = byId(42, "entering");
  const rest = configs().filter((c) => c.type !== 1);
  expect(rest.map((c) => [c.viewTag, c.type, c.config])).toEqual([
    [node.tag, 2, { fade: "out" }],
    [node.tag, 3, { move: "a" }],
  ]);
  expect(configsAtCommit[0]).toBe(1); // only ENTERING existed at the first completeRoot
});

test("layout and exiting re-register when the prop changes or goes away; unchanged props do not", async () => {
  const m = await mount();
  const app = m.startSurface(43, m.Fixture, {}) as App;
  const before = configs().length;
  await m.tick();
  expect(configs()).toHaveLength(before);
  app.swapLayout();
  await m.tick();
  const node = byId(43, "entering");
  expect(configs().slice(before).map((c) => [c.viewTag, c.type, c.config])).toEqual([[node.tag, 3, { move: "b" }]]);
  app.dropExiting();
  await m.tick();
  expect(configs().slice(before + 1).map((c) => [c.viewTag, c.type, c.config])).toEqual([[node.tag, 2, undefined]]);
  expect("exiting" in byId(43, "entering").props).toBe(false);
});

test("entering appearing after the first mount is ignored, as in AnimatedComponent", async () => {
  const m = await mount();
  const app = m.startSurface(44, m.Fixture, {}) as App;
  const before = configs().filter((c) => c.type === 1).length;
  app.showEntering();
  await m.tick();
  expect(configs().filter((c) => c.type === 1)).toHaveLength(before + 1); // the second node's own mount, not the first node's update
  expect(byId(44, "late").props.nativeID).toBeDefined();
});

test("an element that is made again as another component (a span of a run, then a text of its own) takes its layout animation to its new tag and lets the old view go", async () => {
  const m = await mount("remake-fixture.svelte");
  const app = m.startSurface(45, m.Fixture, {}) as { setOn(value: boolean): void };
  const remade = (): FakeNode => {
    const walk = (nodes: FakeNode[]): FakeNode | undefined => { for (const node of nodes) { const found = node.props.testID === "remade" ? node : walk(node.children); if (found) return found; } return undefined; };
    return walk(host.roots[45] ?? []) as FakeNode;
  };
  const first = remade();
  expect(first.name).toBe("RCTText");
  expect(configs().map((c) => [c.viewTag, c.type, c.config])).toEqual([[first.tag, 3, { move: "a" }]]);
  expect(log().removable).toHaveLength(0);
  app.setOn(true);
  await m.tick();
  const second = remade();
  expect(second.name).toBe("RCTVirtualText");
  expect(second.tag).not.toBe(first.tag);
  // The layout config of the new view is registered by the new tag, and the old view's animation record was let go of (its shadow node is marked removable).
  expect(configs().at(-1)).toMatchObject({ viewTag: second.tag, type: 3, config: { move: "a" } });
  expect(log().removable).toHaveLength(1);
  app.setOn(false);
  await m.tick();
  const third = remade();
  expect(third.name).toBe("RCTText");
  expect(configs().at(-1)).toMatchObject({ viewTag: third.tag, type: 3 });
  expect(log().removable).toHaveLength(2);
});
