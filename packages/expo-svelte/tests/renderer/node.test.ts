import { test, expect } from "bun:test";
import renderer, { setInvalidationSink, type NativeNode } from "../../src/renderer.ts";

const names = (node: NativeNode) => node.getSnapshot().children.map((child) => child.name || child.getSnapshot().text);

test("children are linked in order, moved before anchors and removed", () => {
  const parent = renderer.createElement("native-view");
  const a = renderer.createElement("a");
  const b = renderer.createElement("b");
  const c = renderer.createElement("c");
  renderer.insert(parent, a, null);
  renderer.insert(parent, c, null);
  renderer.insert(parent, b, c);
  expect(names(parent)).toEqual(["a", "b", "c"]);
  expect(renderer.getFirstChild(parent)).toBe(a);
  expect(renderer.getNextSibling(a)).toBe(b);
  expect(renderer.getNextSibling(c)).toBeNull();
  expect(renderer.getLastChild(parent)).toBe(c);
  expect(renderer.getParent(b)).toBe(parent);
  const before = parent.getSnapshot();
  expect(parent.getSnapshot()).toBe(before);
  renderer.insert(parent, c, a);
  expect(names(parent)).toEqual(["c", "a", "b"]);
  expect(parent.getSnapshot()).not.toBe(before);
  renderer.insert(parent, c, c);
  expect(names(parent)).toEqual(["c", "a", "b"]);
  renderer.remove(a);
  expect(a.parent).toBeNull();
  expect(renderer.getNextSibling(c)).toBe(b);
  expect(b.previousSibling).toBe(c);
  expect(names(parent)).toEqual(["c", "b"]);
  expect(() => renderer.insert(parent, a, renderer.createElement("stranger"))).toThrow("anchor");
});

test("fragments insert all of their children and text replaces element content", () => {
  const parent = renderer.createElement("native-view");
  const fragment = renderer.createFragment();
  const x = renderer.createTextNode("x");
  const y = renderer.createElement("y");
  renderer.insert(fragment, x, null);
  renderer.insert(fragment, y, null);
  const anchor = renderer.createComment("anchor");
  renderer.insert(parent, anchor, null);
  renderer.insert(parent, fragment, anchor);
  expect(names(parent)).toEqual(["x", "y", "anchor"]);
  expect(fragment.firstChild).toBeNull();
  expect(renderer.getNodeValue(anchor)).toBe("anchor");
  renderer.setText(x, "changed");
  expect(renderer.getNodeValue(x)).toBe("changed");
  renderer.setText(parent, "only text");
  expect(parent.getSnapshot().children).toHaveLength(1);
  expect(parent.getSnapshot().children[0].getSnapshot().text).toBe("only text");
  expect(y.parent).toBeNull();
});

test("attributes change snapshots only when values change", () => {
  const node = renderer.createElement("native-text");
  renderer.setAttribute(node, "nativeProps", { testID: "a" });
  const snapshot = node.getSnapshot();
  renderer.setAttribute(node, "nativeProps", snapshot.props.nativeProps);
  expect(node.getSnapshot()).toBe(snapshot);
  expect(renderer.hasAttribute(node, "nativeProps")).toBe(true);
  expect(renderer.getAttribute(node, "missing")).toBeNull();
  renderer.removeAttribute(node, "missing");
  expect(node.getSnapshot()).toBe(snapshot);
  renderer.removeAttribute(node, "nativeProps");
  expect(renderer.hasAttribute(node, "nativeProps")).toBe(false);
});

test("the invalidation sink hears each change with its reason", () => {
  const heard: [NativeNode, string][] = [];
  setInvalidationSink((node, reason) => heard.push([node, reason]));
  try {
    const parent = renderer.createElement("native-view");
    const text = renderer.createTextNode("before");
    renderer.insert(parent, text, null);
    renderer.setAttribute(parent, "nativeProps", { style: {} });
    renderer.setText(text, "after");
    renderer.remove(text);
    expect(heard).toEqual([[parent, "children"], [parent, "props"], [text, "text"], [parent, "children"]]);
  } finally { setInvalidationSink(null); }
});

test("dispatchers stay stable while listeners come and go", () => {
  const parent = renderer.createElement("native-view");
  const calls: unknown[][] = [];
  const first = (...args: unknown[]) => calls.push(["first", ...args]);
  const second = (...args: unknown[]) => calls.push(["second", ...args]);
  renderer.addEventListener(parent, "press", first);
  const dispatcher = parent.dispatcher("press");
  renderer.addEventListener(parent, "press", second);
  expect(parent.dispatcher("press")).toBe(dispatcher);
  dispatcher("event");
  expect(calls).toEqual([["first", "event"], ["second", "event"]]);
  renderer.removeEventListener(parent, "press", first);
  renderer.removeEventListener(parent, "press", second);
  expect(parent.listeners.has("press")).toBe(false);
  dispatcher("ignored");
  expect(calls).toHaveLength(2);
});

test("nodes share one read-only empty props object and one empty children array until they are written to, and a write copies", () => {
  const first = renderer.createElement("native-view");
  const second = renderer.createElement("native-text");
  const text = renderer.createTextNode("hello");
  const empty = first.getSnapshot();
  // Nothing allocated per node: the same frozen objects, whatever the kind.
  expect(second.getSnapshot().props).toBe(empty.props);
  expect(text.getSnapshot().props).toBe(empty.props);
  expect(second.getSnapshot().children).toBe(empty.children);
  expect(Object.isFrozen(empty.props)).toBe(true);
  expect(Object.isFrozen(empty.children)).toBe(true);

  // A first attribute copies: the node has an object of its own, the shared one stays empty, and a snapshot handed out earlier is not touched.
  first.setProp("testID", "one");
  const own = first.peekProps();
  expect(own).not.toBe(empty.props);
  expect(own).toEqual({ testID: "one" });
  expect(empty.props).toEqual({});
  expect(second.getSnapshot().props).toBe(empty.props);
  // The next write changes that object in place until a snapshot goes out; then a write copies again and the snapshot keeps what it saw.
  first.setProp("nativeID", "a");
  expect(first.peekProps()).toBe(own);
  const out = first.getSnapshot();
  expect(out.props).toEqual({ testID: "one", nativeID: "a" });
  first.setProp("nativeID", "b");
  expect(first.getSnapshot().props).not.toBe(out.props);
  expect(out.props).toEqual({ testID: "one", nativeID: "a" });
  // Removing what is not there neither copies nor reports.
  const heard: unknown[] = [];
  setInvalidationSink((node, reason) => heard.push([node, reason]));
  try {
    second.removeProp("never set");
    expect(second.getSnapshot().props).toBe(empty.props);
    expect(heard).toEqual([]);
  } finally { setInvalidationSink(null); }

  // The first child copies the children: the node gets an array of its own, the shared one stays empty.
  const child = renderer.createElement("native-view");
  renderer.insert(first, child, null);
  expect(first.getSnapshot().children).toEqual([child]);
  expect(first.getSnapshot().children).not.toBe(empty.children);
  expect(empty.children).toEqual([]);
  expect(second.getSnapshot().children).toBe(empty.children);
  expect(first.getSnapshot().children).not.toBe(empty.children);
});

test("a changed prop is reported once, an unchanged write and the removal of a missing prop are not, and setProps never writes to the object it is given", () => {
  const node = renderer.createElement("native-view");
  node.setProp("a", 1);
  node.setProp("b", 2);
  const heard: string[] = [];
  setInvalidationSink((_node, reason) => heard.push(reason));
  try {
    node.setProp("a", 1); // unchanged
    node.removeProp("missing");
    expect(heard).toEqual([]);
    node.setProp("a", 9);
    expect(node.getProp("a")).toBe(9);
    node.removeProp("b");
    expect(node.hasProp("b")).toBe(false);
    expect(heard).toEqual(["props", "props"]);
    const whole = { x: 1 };
    node.setProps(whole);
    node.setProp("y", 2);
    expect(whole).toEqual({ x: 1 });
    expect(node.getSnapshot().props).toEqual({ x: 1, y: 2 });
  } finally { setInvalidationSink(null); }
});
