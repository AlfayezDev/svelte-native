import { expect, test } from "bun:test";
import { createResponder, type ResponderTree } from "../src/fabric/responder.ts";

// A responder that blocks the native ones (React Native: `onResponderGrant` answers true, and `UIManager.setJSResponder(tag, true)` follows; with
// react-native-gesture-handler patching that call into `handleSetJSResponder`) must reach the native side; one that does not must not.

type Node = { name: string; parent: Node | null; handlers: Record<string, (event?: unknown) => unknown> };
const node = (name: string, parent: Node | null, handlers: Node["handlers"] = {}): Node => ({ name, parent, handlers });

function setup(extra: Partial<ResponderTree<Node>> = {}) {
  const log: string[] = [];
  const tree: ResponderTree<Node> = {
    parent: (n) => n.parent,
    handler: (n, name) => n.handlers[name],
    pressability: () => undefined,
    blockNativeResponder: (n) => { log.push(`block ${n.name}`); },
    releaseNativeResponder: () => { log.push("release"); },
    ...extra,
  };
  return { responder: createResponder(tree), log };
}
const touch = (id = 0) => ({ touches: [{ identifier: id }], changedTouches: [{ identifier: id }], identifier: id });

test("a grant that answers true blocks the native responders, and the release gives them back", () => {
  const view = node("view", null, { onStartShouldSetResponder: () => true, onResponderGrant: () => true });
  const { responder, log } = setup();
  responder.touch(view, "topTouchStart", touch());
  expect(log).toEqual(["block view"]);
  responder.touch(view, "topTouchEnd", touch());
  expect(log).toEqual(["block view", "release"]);
});

test("a termination gives them back too", () => {
  const view = node("view", null, { onStartShouldSetResponder: () => true, onResponderGrant: () => true });
  const { responder, log } = setup();
  responder.touch(view, "topTouchStart", touch());
  responder.touch(view, "topTouchCancel", touch());
  expect(log).toEqual(["block view", "release"]);
});

test("a grant that does not answer true calls nothing, on grant or on release", () => {
  for (const grant of [undefined, () => undefined, () => false, () => 1, () => "yes"]) {
    const view = node("view", null, { onStartShouldSetResponder: () => true, ...(grant ? { onResponderGrant: grant } : {}) });
    const { responder, log } = setup();
    responder.touch(view, "topTouchStart", touch());
    responder.touch(view, "topTouchEnd", touch());
    expect(log).toEqual([]);
  }
});

test("a responder taken over by one that does not block gives them back at once", () => {
  const parent = node("parent", null, { onMoveShouldSetResponder: () => true, onResponderGrant: () => undefined });
  const child = node("child", parent, { onStartShouldSetResponder: () => true, onResponderGrant: () => true, onResponderTerminationRequest: () => true });
  const { responder, log } = setup();
  responder.touch(child, "topTouchStart", touch());
  expect(log).toEqual(["block child"]);
  responder.touch(child, "topTouchMove", touch());
  expect(log).toEqual(["block child", "release"]);
  responder.touch(child, "topTouchEnd", touch());
  expect(log).toEqual(["block child", "release"]);
});

test("a responder taken over by one that blocks too stays blocked until the last release", () => {
  const parent = node("parent", null, { onMoveShouldSetResponder: () => true, onResponderGrant: () => true });
  const child = node("child", parent, { onStartShouldSetResponder: () => true, onResponderGrant: () => true, onResponderTerminationRequest: () => true });
  const { responder, log } = setup();
  responder.touch(child, "topTouchStart", touch());
  responder.touch(child, "topTouchMove", touch());
  responder.touch(child, "topTouchEnd", touch());
  expect(log).toEqual(["block child", "block parent", "release"]);
});

test("a tree without the hooks (no gesture host) grants as before", () => {
  const view = node("view", null, { onStartShouldSetResponder: () => true, onResponderGrant: () => true });
  const { responder } = setup({ blockNativeResponder: undefined, releaseNativeResponder: undefined });
  expect(responder.touch(view, "topTouchStart", touch())).toBe(true);
  expect(responder.touch(view, "topTouchEnd", touch())).toBe(true);
});
