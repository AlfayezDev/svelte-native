import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import renderer, { NativeNode, setRefSink } from "../src/renderer.ts";

/**
 * The host hears of a `ref` when its element is in a tree on a surface (`setRefSink`, `fabric/host.ts` `earlyRef`): at once for an element that is, and when the subtree it is in gets there for
 * one that is not: Svelte sets attributes while it builds a subtree and links it into the screen after, and a fork builds a screen off screen that must call no ref until it is committed.
 */
const sink: NativeNode[] = [];
beforeAll(() => setRefSink((node) => sink.push(node)));
afterAll(() => setRefSink(null));
afterEach(() => { sink.length = 0; });

const element = (name: string, ref = false): NativeNode => {
  const node = renderer.createElement(name) as NativeNode;
  if (ref) node.setProp("ref", () => {});
  return node;
};
const surface = (): NativeNode => {
  const root = new NativeNode("fragment");
  root.surfaceRoot = true;
  return root;
};
const insert = (parent: NativeNode, node: NativeNode, anchor: NativeNode | null = null) => (renderer as unknown as { insert(parent: NativeNode, node: NativeNode, anchor: NativeNode | null): void }).insert(parent, node, anchor);
const remove = (node: NativeNode) => (renderer as unknown as { remove(node: NativeNode): void }).remove(node);
const named = (nodes: NativeNode[]) => nodes.map((node) => node.name);

test("a ref set in a subtree that is in no screen is heard when the subtree reaches one, parents first, and once", () => {
  const root = surface();
  const outer = element("outer", true);
  const middle = element("middle");
  const inner = element("inner", true);
  insert(middle, inner);
  insert(outer, middle);
  expect(sink).toEqual([]);
  expect(outer.waiting).toBe(2);
  insert(root, outer);
  expect(named(sink)).toEqual(["outer", "inner"]);
  // Nothing waits any more, and moving the subtree around the screen tells the host nothing more.
  expect([root.waiting, outer.waiting, middle.waiting, inner.waiting]).toEqual([0, 0, 0, 0]);
  const other = element("other");
  insert(root, other);
  insert(other, outer);
  expect(named(sink)).toEqual(["outer", "inner"]);
});

test("a ref set on an element that is on a screen is heard at once, and one set while the element is in a fragment waits for the fragment's children to be moved to a screen", () => {
  const root = surface();
  const on = element("on");
  insert(root, on);
  on.setProp("ref", () => {});
  expect(named(sink)).toEqual(["on"]);
  // What a fork builds: a fragment of its own, whose children are moved to the screen at the commit.
  const fragment = new NativeNode("fragment");
  const panel = element("panel", true);
  insert(fragment, panel);
  insert(fragment, element("plain"));
  expect(named(sink)).toEqual(["on"]);
  expect(fragment.waiting).toBe(1);
  insert(root, fragment);
  expect(named(sink)).toEqual(["on", "panel"]);
  expect(fragment.waiting).toBe(0);
});

test("a subtree that is dropped before it reaches a screen never has its refs heard of, and what waits is not counted in what it was taken out of", () => {
  const root = surface();
  const fragment = new NativeNode("fragment");
  const kept = element("kept", true);
  const dropped = element("dropped", true);
  insert(fragment, kept);
  insert(fragment, dropped);
  expect(fragment.waiting).toBe(2);
  remove(dropped);
  expect(fragment.waiting).toBe(1);
  insert(root, fragment);
  expect(named(sink)).toEqual(["kept"]);
  // The dropped one is on no screen, and calls nothing, when it is given one later it is its own subtree again.
  expect(dropped.waiting).toBe(1);
  insert(root, dropped);
  expect(named(sink)).toEqual(["kept", "dropped"]);
  expect(root.waiting).toBe(0);
});
