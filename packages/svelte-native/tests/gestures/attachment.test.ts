import { expect, test } from "bun:test";
import { gesture, gestureAttachment } from "../../src/gestures/action.ts";
import type { GestureAttribute } from "../../src/gestures/types.ts";
import { load, settle, world, byId, callsOf } from "./harness.ts";

const value = () => ({} as GestureAttribute);
function host() {
  const props = new Map<string, unknown>();
  let removed = 0;
  return {
    get removed() { return removed; },
    getProp: (key: string) => props.get(key),
    setProp: (key: string, next: unknown) => { props.set(key, next); },
    removeProp: (key: string) => { removed++; props.delete(key); },
  };
}

test("gesture action updates, clears and destroys idempotently; destroyed handles cannot reinstall", () => {
  const node = host(), first = value(), next = value();
  const action = gesture(node, first);
  expect(node.getProp("gesture")).toBe(first);
  action.update(next); expect(node.getProp("gesture")).toBe(next);
  action.update(undefined); expect(node.getProp("gesture")).toBeUndefined();
  action.destroy(); action.destroy(); action.update(first);
  expect(node.removed).toBe(1); expect(node.getProp("gesture")).toBeUndefined();
});

test("old cleanup cannot erase a newer attachment, even when both use the same gesture", () => {
  const node = host(), shared = value();
  const older = gesture(node, shared);
  const detach = gestureAttachment(shared)(node);
  older.update(value()); older.destroy();
  expect(node.getProp("gesture")).toBe(shared); expect(node.removed).toBe(0);
  detach(); detach();
  expect(node.getProp("gesture")).toBeUndefined(); expect(node.removed).toBe(1);
});

test("direct attribute replacements survive stale action updates and attachment cleanup", () => {
  const node = host(), replacement = value();
  const action = gesture(node, value());
  node.setProp("gesture", replacement);
  action.update(value()); action.destroy();
  expect(node.getProp("gesture")).toBe(replacement); expect(node.removed).toBe(0);
  const detach = gestureAttachment(value())(node);
  node.setProp("gesture", replacement); detach();
  expect(node.getProp("gesture")).toBe(replacement); expect(node.removed).toBe(0);
});

test("Svelte attachment follows reactive compositions and releases native handlers on unmount", async () => {
  const m = await load({ fixture: "attachment-fixture.svelte" });
  const G = m.gestures.Gesture;
  const first = G.Exclusive(G.Tap().numberOfTaps(2), G.Tap());
  const surface = m.startSurface(91, m.Fixture, { first }) as unknown as { use(next: unknown): void; hide(): void };
  await settle(m);
  expect(callsOf("attachGestureHandler")).toHaveLength(2);
  for (const call of callsOf("attachGestureHandler")) expect(call[2]).toBe(byId(91, "attachment")?.tag);
  world().calls.length = 0;
  surface.use(G.Pan().runOnJS(true).minDistance(7));
  await settle(m);
  expect(callsOf("dropGestureHandler")).toHaveLength(2);
  expect(callsOf("attachGestureHandler")).toHaveLength(1);
  const pan = callsOf("createGestureHandler")[0]?.[2];
  expect(pan).toBeDefined();
  world().calls.length = 0;
  surface.hide(); await settle(m);
  expect(callsOf("dropGestureHandler")).toEqual([["dropGestureHandler", pan]]);
});
