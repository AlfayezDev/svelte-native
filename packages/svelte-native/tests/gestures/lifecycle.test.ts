import { test, expect, spyOn } from "bun:test";
import { load, settle, world, anim, byId, callsOf, type Loaded, type NativeCall } from "./harness.ts";

/** Mount, update, destroy and remount of nodes with `gesture` attributes: what the native module and Reanimated are told, and when. */
type App = { set(items: { id: string; gesture?: unknown; collapsable?: boolean }[]): void };
/** Fresh callbacks each time: `w()` is marked as a worklet (what the babel plugin does), `j()` is a plain function. */
const w = () => { const fn = () => {}; (fn as { __workletHash?: number }).__workletHash = 1; return fn; };
const j = () => () => {};
const take = (): NativeCall[] => world().calls.splice(0);
const names = (calls: readonly NativeCall[]) => calls.map((call) => call[0]);

async function mount(options: { dev?: boolean; os?: "android" | "ios"; initial?: unknown[] } = {}) {
  const m = await load({ fixture: "gesture-fixture.svelte", dev: options.dev, os: options.os });
  const app = m.startSurface(61, m.Fixture, { initial: options.initial ?? [] }) as unknown as App;
  return { m, app, G: m.gestures.Gesture };
}
const tagOf = (index = 0) => callsOf("createGestureHandler")[index]?.[2] as number;

test("a node's gesture attaches after the commit, with the engine hook first; update and destroy follow", async () => {
  const { m, app, G } = await mount();
  expect(world().log).toEqual(["completeRoot"]); // an empty surface: no gesture, so nothing was loaded
  expect(m.fabricStats().gesturesLoaded).toBe(false);

  app.set([{ id: "a", gesture: G.Pan().onUpdate(w()).activeOffsetX([-10, 10]) }]);
  await settle(m);
  expect(names(world().calls)).toEqual(["createGestureHandler", "attachGestureHandler", "updateGestureHandler", "flushOperations"]);
  expect(world().log.filter((line) => line !== "completeRoot")).toEqual(["enableGestures", "listen onGestureHandlerEvent", "listen onGestureHandlerStateChange", "native createGestureHandler", "native attachGestureHandler", "native updateGestureHandler", "native flushOperations"]);
  expect(world().log.indexOf("completeRoot")).toBeLessThan(world().log.indexOf("native createGestureHandler"));
  const node = byId(61, "a");
  const tag = tagOf();
  expect(callsOf("attachGestureHandler")[0]).toEqual(["attachGestureHandler", tag, node?.tag, 1]);
  expect(node?.props.collapsable).toBe(false);
  expect("gesture" in (node?.props ?? {})).toBe(false);
  expect(m.fabricStats().gestures).toEqual({ records: 1, handlers: 1, eventHandlers: 1 });

  // One Reanimated registration for the node's tag, and the gesture's callbacks in the shared value the worklet reads.
  const [handler] = anim().eventHandlers ?? [];
  expect(anim().eventHandlers).toHaveLength(1);
  expect(handler?.eventNames).toEqual(["onGestureHandlerStateChange", "onGestureHandlerEvent"]);
  expect(handler?.tags).toEqual(new Set([node?.tag]));
  const shared = anim().mutables?.[0] as { value: { handlerTag: number }[] | null; writes: unknown[] };
  expect(shared.value?.map((callbacks) => callbacks.handlerTag)).toEqual([tag]);

  take();
  app.set([{ id: "a", gesture: G.Pan().onUpdate(w()).activeOffsetX([-4, 4]).minDistance(2) }]);
  await settle(m);
  const update = take();
  expect(names(update)).toEqual(["updateGestureHandler", "flushOperations"]);
  expect(update[0]?.[1]).toBe(tag);
  expect(update[0]?.[2]).toMatchObject({ activeOffsetXStart: -4, activeOffsetXEnd: 4, minDist: 2 });
  expect(shared.writes).toHaveLength(2); // the new gesture's callbacks replace the old ones in the shared value
  expect(handler?.log.filter(([kind]) => kind === "update")).toEqual([]); // no reattach: the same event handler

  app.set([]);
  await settle(m);
  expect(take()).toEqual([["dropGestureHandler", tag], ["flushOperations"]]);
  expect(handler?.tags.size).toBe(0);
  expect(handler?.log.at(-1)).toEqual(["unregister", node?.tag]);
  expect(shared.value).toBeNull();
  expect(m.fabricStats().gestures).toEqual({ records: 0, handlers: 0, eventHandlers: 0 });
  await settle(m);
  expect(world().calls).toEqual([]);
});

test("a gesture whose callbacks are not worklets runs on the JS thread: action type 4 and no Reanimated registration", async () => {
  const { m, app, G } = await mount();
  app.set([{ id: "a", gesture: G.Tap().onEnd(j()) }, { id: "b", gesture: G.Pan().runOnJS(true).onUpdate(w()) }]);
  await settle(m);
  expect(callsOf("attachGestureHandler").map((call) => call[3])).toEqual([4, 4]);
  expect(anim().eventHandlers ?? []).toHaveLength(0);
  expect(m.fabricStats().gestures).toEqual({ records: 2, handlers: 2, eventHandlers: 0 });
});

test("a changed shape, count or thread attaches again: drop, create, a rebuilt event handler, still one registration", async () => {
  const { m, app, G } = await mount();
  app.set([{ id: "a", gesture: G.Pan().onUpdate(w()) }]);
  await settle(m);
  const first = tagOf();
  const node = byId(61, "a");
  take();

  app.set([{ id: "a", gesture: G.Tap().onEnd(w()) }]); // another handler
  await settle(m);
  let calls = take();
  expect(names(calls)).toEqual(["dropGestureHandler", "createGestureHandler", "attachGestureHandler", "updateGestureHandler", "flushOperations"]);
  expect(calls[0]).toEqual(["dropGestureHandler", first]);
  expect(calls[1]?.[1]).toBe("TapGestureHandler");
  const second = calls[1]?.[2] as number;
  expect(second).not.toBe(first);
  expect(anim().eventHandlers).toHaveLength(1);
  expect(anim().eventHandlers?.[0]?.log.filter(([kind]) => kind === "update")).toHaveLength(1);
  expect(anim().eventHandlers?.[0]?.tags).toEqual(new Set([node?.tag]));

  app.set([{ id: "a", gesture: G.Race(G.Tap().onEnd(w()), G.Pan().onEnd(w())) }]); // another count
  await settle(m);
  calls = take();
  expect(names(calls)).toEqual(["dropGestureHandler", "createGestureHandler", "createGestureHandler", "attachGestureHandler", "attachGestureHandler", "updateGestureHandler", "updateGestureHandler", "flushOperations"]);
  expect(m.fabricStats().gestures).toEqual({ records: 1, handlers: 2, eventHandlers: 1 });

  app.set([{ id: "a", gesture: G.Race(G.Tap().onEnd(j()), G.Pan().onEnd(j())) }]); // the thread changed to JS
  await settle(m);
  calls = take();
  expect(calls.filter((call) => call[0] === "attachGestureHandler").map((call) => call[3])).toEqual([4, 4]);
  expect(names(calls).filter((name) => name === "createGestureHandler")).toHaveLength(2);
  expect(anim().eventHandlers?.[0]?.tags.size).toBe(0);
  expect(m.fabricStats().gestures).toEqual({ records: 1, handlers: 2, eventHandlers: 0 });

  app.set([{ id: "a", gesture: G.Pan().onUpdate(w()) }]); // and back to the UI thread: a new registration
  await settle(m);
  expect(anim().eventHandlers).toHaveLength(2);
  expect(anim().eventHandlers?.[1]?.tags).toEqual(new Set([node?.tag]));
  expect(m.fabricStats().gestures).toEqual({ records: 1, handlers: 1, eventHandlers: 1 });
});

test("removing the attribute detaches; the node stays and a new gesture gets fresh handlers", async () => {
  const { m, app, G } = await mount();
  const gesture = G.Pan().onUpdate(w());
  app.set([{ id: "a", gesture }]);
  await settle(m);
  const first = tagOf();
  take();
  app.set([{ id: "a", gesture: undefined }]);
  await settle(m);
  expect(take()).toEqual([["dropGestureHandler", first], ["flushOperations"]]);
  expect(byId(61, "a")).toBeDefined();
  expect(m.fabricStats().gestures?.records).toBe(0);
  app.set([{ id: "a", gesture }]); // the same object again, free since the detach
  await settle(m);
  const again = take();
  expect(names(again)).toEqual(["createGestureHandler", "attachGestureHandler", "updateGestureHandler", "flushOperations"]);
  expect(again[0]?.[2]).not.toBe(first);
});

test("relations by tag across nodes: a gesture that mounts later updates the one that names it, once", async () => {
  const { m, app, G } = await mount();
  const scroll = G.Native().disallowInterruption(true);
  const pan = G.Pan().onUpdate(w()).simultaneousWithExternalGesture(scroll).requireExternalGestureToFail(scroll).blocksExternalGesture(scroll);
  app.set([{ id: "pan", gesture: pan }]);
  await settle(m);
  const panTag = tagOf();
  let calls = take();
  expect(calls.at(-2)).toEqual(["updateGestureHandler", panTag, { waitFor: [], simultaneousHandlers: [], blocksHandlers: [] }]); // nothing to name yet

  app.set([{ id: "pan", gesture: pan }, { id: "scroll", gesture: scroll }]);
  await settle(m);
  calls = take();
  const scrollTag = calls.find((call) => call[0] === "createGestureHandler")?.[2] as number;
  expect(names(calls)).toEqual(["createGestureHandler", "attachGestureHandler", "updateGestureHandler", "updateGestureHandler", "flushOperations"]);
  const updates = Object.fromEntries(calls.filter((call) => call[0] === "updateGestureHandler").map((call) => [call[1] as number, call[2]]));
  expect(updates[panTag]).toEqual({ waitFor: [scrollTag], simultaneousHandlers: [scrollTag], blocksHandlers: [scrollTag] });
  expect(updates[scrollTag]).toMatchObject({ waitFor: [], disallowInterruption: true });
});

test("relations between nodes of one commit are sent once, with both tags known", async () => {
  const { m, app, G } = await mount();
  const scroll = G.Native();
  app.set([{ id: "pan", gesture: G.Pan().onUpdate(w()).requireExternalGestureToFail(scroll) }, { id: "scroll", gesture: scroll }]);
  await settle(m);
  const calls = world().calls;
  expect(callsOf("updateGestureHandler")).toHaveLength(2);
  expect(callsOf("updateGestureHandler")[0]?.[2]).toMatchObject({ waitFor: [tagOf(1)] });
  expect(names(calls).filter((name) => name === "flushOperations")).toHaveLength(1);
});

test("one gesture object on two views throws RNGH's message and attaches nothing for the second", async () => {
  const { G, m } = await (async () => { const m = await load({ fixture: "gesture-fixture.svelte" }); return { m, G: m.gestures.Gesture }; })();
  const shared = G.Pan().onUpdate(w());
  expect(() => m.startSurface(62, m.Fixture, { initial: [{ id: "a", gesture: shared }, { id: "b", gesture: shared }] })).toThrow("Handler with tag 1 already exists. Please ensure that no Gesture instance is used across multiple GestureDetectors.");
  expect(callsOf("createGestureHandler")).toHaveLength(1);
  expect(callsOf("attachGestureHandler")).toHaveLength(1);
});

test("a gesture object handed from a node that left to a new one is not shared", async () => {
  const { m, app, G } = await mount();
  const gesture = G.Pan().onUpdate(w());
  app.set([{ id: "a", gesture }]);
  await settle(m);
  const first = tagOf();
  take();
  app.set([{ id: "b", gesture }]);
  await settle(m);
  const calls = take();
  expect(names(calls)).toEqual(["dropGestureHandler", "createGestureHandler", "attachGestureHandler", "updateGestureHandler", "flushOperations"]);
  expect(calls[0]).toEqual(["dropGestureHandler", first]);
  expect(calls[2]?.[2]).toBe(byId(61, "b")?.tag);
});

test("a hot remount drops every handler before the next surface creates its own; handler tags are fresh each time", async () => {
  const { m, app, G } = await mount();
  const seen: number[] = [];
  app.set([{ id: "a", gesture: G.Race(G.Pan().onUpdate(w()), G.Tap().onEnd(w())) }, { id: "b", gesture: G.Fling().onEnd(j()) }]);
  await settle(m);
  seen.push(...callsOf("createGestureHandler").map((call) => call[2] as number));
  expect(seen).toHaveLength(3);
  for (let remount = 0; remount < 2; remount++) {
    take();
    m.stopSurface(61);
    const next = m.startSurface(61, m.Fixture, {}) as unknown as App;
    next.set([{ id: "a", gesture: G.Race(G.Pan().onUpdate(w()), G.Tap().onEnd(w())) }, { id: "b", gesture: G.Fling().onEnd(j()) }]);
    await settle(m);
    const calls = take();
    const drops = calls.filter((call) => call[0] === "dropGestureHandler").map((call) => call[1] as number);
    expect(drops).toEqual(seen.slice(-3));
    const created = calls.filter((call) => call[0] === "createGestureHandler").map((call) => call[2] as number);
    expect(created).toHaveLength(3);
    for (const tag of created) expect(seen).not.toContain(tag);
    seen.push(...created);
    // Every drop precedes every create, and one flush follows the lot.
    expect(calls.findLastIndex((call) => call[0] === "dropGestureHandler")).toBeLessThan(calls.findIndex((call) => call[0] === "createGestureHandler"));
    expect(names(calls).filter((name) => name === "flushOperations")).toHaveLength(1);
    expect(m.fabricStats().gestures).toEqual({ records: 2, handlers: 3, eventHandlers: 1 });
  }
  await settle(m);
  expect(world().calls).toEqual([]);
});

test("collapsable is forced to false; collapsable={true} warns once in development", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const { m, app, G } = await mount();
    const gesture = G.Pan().onUpdate(w());
    app.set([{ id: "a", gesture, collapsable: true }, { id: "b", gesture: G.Tap().onEnd(j()) }]);
    await settle(m);
    expect(byId(61, "a")?.props.collapsable).toBe(false);
    expect(byId(61, "b")?.props.collapsable).toBe(false);
    app.set([{ id: "a", gesture: G.Pan().onUpdate(w()), collapsable: true }, { id: "b", gesture: G.Tap().onEnd(j()) }]);
    await settle(m);
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("collapsable={true}"))).toHaveLength(1);
  } finally {
    warn.mockRestore();
  }
});

test("a view that never had a gesture is not forced uncollapsed", async () => {
  const { m, app, G } = await mount();
  app.set([{ id: "plain" }, { id: "gestured", gesture: G.Tap().onEnd(j()) }]);
  await settle(m);
  expect("collapsable" in (byId(61, "plain")?.props ?? {})).toBe(false);
  expect(byId(61, "gestured")?.props.collapsable).toBe(false);
});

test("enabled(false) is a config key like any other: sent on create and on update, with no reattach", async () => {
  const { m, app, G } = await mount();
  app.set([{ id: "a", gesture: G.Pan().onUpdate(w()).enabled(false) }]);
  await settle(m);
  expect(callsOf("createGestureHandler")[0]?.[3]).toEqual({ enabled: false });
  const tag = tagOf();
  take();
  app.set([{ id: "a", gesture: G.Pan().onUpdate(w()).enabled(true) }]);
  await settle(m);
  expect(take()).toEqual([["updateGestureHandler", tag, { waitFor: [], simultaneousHandlers: [], blocksHandlers: [], enabled: true }], ["flushOperations"]]);
});

test("the engine hook runs once, before the first attach; without the engine module (iOS) there is none", async () => {
  const android = await mount();
  android.app.set([{ id: "a", gesture: android.G.Tap().onEnd(j()) }]);
  await settle(android.m);
  android.app.set([{ id: "a", gesture: android.G.Tap().onEnd(j()) }, { id: "b", gesture: android.G.Tap().onEnd(j()) }]);
  await settle(android.m);
  expect(world().log.filter((line) => line === "enableGestures")).toHaveLength(1);
  expect(world().log.indexOf("enableGestures")).toBeLessThan(world().log.indexOf("native createGestureHandler"));

  const ios = await load({ fixture: "gesture-fixture.svelte", os: "ios" });
  world().engine = null;
  const surface = ios.startSurface(63, ios.Fixture, {}) as unknown as App;
  surface.set([{ id: "a", gesture: ios.gestures.Gesture.Tap().onEnd(j()) }]);
  await settle(ios);
  expect(world().log).not.toContain("enableGestures");
  expect(callsOf("attachGestureHandler")).toHaveLength(1);
});

test("an engine that answers false for the hook is an error at the first attach, with nothing sent natively", async () => {
  const m = await load({ fixture: "gesture-fixture.svelte" });
  (world().engine as { enableGestures?: () => boolean }).enableGestures = () => false;
  expect(() => m.startSurface(64, m.Fixture, { initial: [{ id: "a", gesture: m.gestures.Gesture.Tap().onEnd(j()) }] })).toThrow("enableGestures() answered false");
  expect(world().calls).toEqual([]);
});

test("a gesture attribute that is not a gesture object is refused", async () => {
  const m = await load({ fixture: "gesture-fixture.svelte" });
  expect(() => m.startSurface(65, m.Fixture, { initial: [{ id: "a", gesture: { onUpdate: j() } }] })).toThrow("takes a Gesture object");
});

test("200 mounts of a view with three gestures, half on each thread, leave nothing behind", async () => {
  const { m, app, G } = await mount();
  for (let round = 0; round < 200; round++) {
    app.set([{ id: `n${round}`, gesture: G.Simultaneous(G.Pan().onUpdate(round % 2 ? w() : j()), G.Pinch().onUpdate(round % 2 ? w() : j()), G.Rotation().onUpdate(round % 2 ? w() : j())) }]);
    await settle(m);
    app.set([]);
    await settle(m);
  }
  const creates = callsOf("createGestureHandler").map((call) => call[2] as number);
  const drops = callsOf("dropGestureHandler").map((call) => call[1] as number);
  expect(creates).toHaveLength(600);
  expect(drops).toEqual(creates);
  expect(m.fabricStats().gestures).toEqual({ records: 0, handlers: 0, eventHandlers: 0 });
  expect((anim().eventHandlers ?? []).filter((handler) => handler.tags.size > 0)).toEqual([]);
  expect((anim().eventHandlers ?? [])).toHaveLength(100);
});

export type { Loaded };

test("a node that animates and has a gesture is served by both layers; Reanimated is loaded once and the engine told once", async () => {
  const m = await load({ fixture: "animated-fixture.svelte" });
  const reanimated: string[] = [];
  world().engine = { install: () => true, enableGestures: () => true, reanimatedLoaded: () => { reanimated.push("loaded"); } } as never;
  const pan = m.gestures.Gesture.Pan().onUpdate(w());
  m.startSurface(66, m.Fixture, { gesture: pan });
  await settle(m);
  const node = byId(66, "both");
  expect(node?.props).toEqual({ testID: "both", padding: 1, opacity: 0.5, collapsable: false });
  expect(anim().mappers).toHaveLength(1);
  expect(callsOf("attachGestureHandler")[0]?.[2]).toBe(node?.tag);
  expect(m.fabricStats()).toMatchObject({ animationLoaded: true, gesturesLoaded: true });
  expect(reanimated).toEqual(["loaded"]);
});
