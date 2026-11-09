import { test, expect, spyOn } from "bun:test";
import { loadOracle } from "./oracle.ts";
import { load, settle, world, anim, byId, callsOf } from "./harness.ts";

/**
 * Event routing. A gesture on the JS thread receives its events on `RCTDeviceEventEmitter`; one on the UI thread has them run by
 * Reanimated in a worklet. Both are checked against react-native-gesture-handler's own `onGestureHandlerEvent` (bundled as the
 * oracle): the same event sequence must call the same callbacks with the same arguments in the same order.
 */
const oracle = await loadOracle();
type Entry = [name: string, ...args: unknown[]];
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value) ?? "null");
/** The handler tag is a counter of its own module instance: both sides log it as "T". */
const scrub = (log: Entry[], tag: number): Entry[] => JSON.parse(JSON.stringify(log).replaceAll(`"handlerTag":${tag}`, '"handlerTag":"T"'));
const worklet = <T extends (...args: never[]) => void>(fn: T) => { (fn as { __workletHash?: number }).__workletHash = 1; return fn; };

const State = { UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5 };
const base = (handlerTag: number) => ({ handlerTag, numberOfPointers: 1, pointerType: 0 });
const change = (handlerTag: number, oldState: number, state: number, x = 0, y = 0) => ({ ...base(handlerTag), oldState, state, translationX: x, translationY: y });
const update = (handlerTag: number, x: number, y: number) => ({ ...base(handlerTag), state: State.ACTIVE, translationX: x, translationY: y });
const touch = (handlerTag: number, eventType: number) => ({ ...base(handlerTag), state: State.BEGAN, eventType, numberOfTouches: 1, allTouches: [{ id: 0, x: 1, y: 2, absoluteX: 3, absoluteY: 4 }], changedTouches: [{ id: 0, x: 1, y: 2, absoluteX: 3, absoluteY: 4 }] });
const sequences: Record<string, (tag: number) => object[]> = {
  "begin, start, updates, end": (t) => [change(t, 0, 2), change(t, 2, 4), update(t, 5, 1), update(t, 12, 3), update(t, 20, 4), change(t, 4, 5, 20, 4)],
  "fails before it activates": (t) => [change(t, 0, 2), change(t, 2, 1)],
  "cancelled while active": (t) => [change(t, 0, 2), change(t, 2, 4), update(t, 3, 3), change(t, 4, 3, 3, 3)],
  "activates straight from undetermined": (t) => [change(t, 0, 4), update(t, 1, 1), change(t, 4, 5, 1, 1)],
  "touch events of every kind, the unset type ignored": (t) => [touch(t, 1), touch(t, 2), touch(t, 2), touch(t, 3), touch(t, 4), touch(t, 0)],
  "a state change that changes nothing, and an event for no handler": (t) => [change(t, 2, 2), change(99999, 0, 2), update(99999, 1, 1)],
  "two gestures in a row on one handler": (t) => [change(t, 0, 2), change(t, 2, 4), update(t, 4, 4), change(t, 4, 5, 4, 4), change(t, 0, 2), change(t, 2, 4), update(t, 9, 9), change(t, 4, 5, 9, 9)],
};

const callbackNames = ["onBegin", "onStart", "onUpdate", "onChange", "onEnd", "onFinalize", "onTouchesDown", "onTouchesMove", "onTouchesUp", "onTouchesCancelled"] as const;
/** The part of RNGH's `PanGesture` builder this file chains. */
type Pan = { handlerTag: number; initialize(): void; runOnJS(value: boolean): Pan } & Record<(typeof callbackNames)[number], (callback: (...args: unknown[]) => void) => Pan>;

/** One pan that logs every callback it has; `thread` decides whether the callbacks are worklets. */
function logged(Gesture: { Pan(): unknown }, log: Entry[], thread: "js" | "ui"): Pan {
  const mark = <T extends (...args: never[]) => void>(fn: T) => (thread === "ui" ? worklet(fn) : fn);
  const record = (name: string) => mark((...args: unknown[]) => { log.push([name, ...args.map(clone)]); });
  let pan = Gesture.Pan() as Pan;
  if (thread === "js") pan = pan.runOnJS(true);
  for (const name of callbackNames) pan = pan[name](record(name));
  return pan;
}

/** What RNGH's own receiver does with a sequence for a gesture registered the way its detector registers it. */
function expected(events: (tag: number) => object[]): Entry[] {
  const log: Entry[] = [];
  const pan = logged(oracle.GestureObjects as never, log, "js");
  pan.initialize();
  oracle.registerHandler(pan.handlerTag, pan);
  for (const event of events(pan.handlerTag)) oracle.onGestureHandlerEvent(event);
  oracle.unregisterHandler(pan.handlerTag);
  return scrub(log, pan.handlerTag);
}

async function mounted(thread: "js" | "ui") {
  const m = await load({ fixture: "gesture-fixture.svelte" });
  const app = m.startSurface(51, m.Fixture, {}) as unknown as { set(items: unknown[]): void };
  const log: Entry[] = [];
  app.set([{ id: "box", gesture: logged(m.gestures.Gesture as never, log, thread) }]);
  await settle(m);
  const tag = callsOf("createGestureHandler")[0]?.[2] as number;
  return { m, app, log, tag };
}

for (const [name, events] of Object.entries(sequences)) {
  test(`JS thread: ${name}`, async () => {
    const { log, tag } = await mounted("js");
    expect(callsOf("attachGestureHandler")[0]?.[3]).toBe(4);
    const listeners = world().listeners;
    expect([...listeners.keys()].sort()).toEqual(["onGestureHandlerEvent", "onGestureHandlerStateChange"]);
    for (const event of events(tag)) {
      const channel = (event as { oldState?: number }).oldState != null ? "onGestureHandlerStateChange" : "onGestureHandlerEvent";
      for (const listener of listeners.get(channel) ?? []) listener(event);
    }
    const want = expected(events);
    if (!name.includes("changes nothing")) expect(want.length).toBeGreaterThan(0);
    expect(scrub(log, tag)).toEqual(want);
  });

  test(`UI thread, the ported worklet run on the JS thread: ${name}`, async () => {
    const { log, tag } = await mounted("ui");
    expect(callsOf("attachGestureHandler")[0]?.[3]).toBe(1);
    const [handler] = anim().eventHandlers ?? [];
    expect(handler?.tags).toEqual(new Set([byId(51, "box")?.tag]));
    for (const event of events(tag)) handler?.worklet(event);
    expect(scrub(log, tag)).toEqual(expected(events));
  });
}

test("the JS receiver ignores an event for a handler that was dropped", async () => {
  const { m, app, log, tag } = await mounted("js");
  app.set([]);
  await settle(m);
  for (const listener of world().listeners.get("onGestureHandlerStateChange") ?? []) listener(change(tag, 0, 2));
  expect(log).toEqual([]);
});

test("JS thread: the state manager of a touch callback warns that it works on the UI thread only", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const m = await load({ fixture: "gesture-fixture.svelte" });
    const app = m.startSurface(52, m.Fixture, {}) as unknown as { set(items: unknown[]): void };
    app.set([{ id: "box", gesture: m.gestures.Gesture.Manual().runOnJS(true).onTouchesDown((_event, manager) => { manager.activate(); manager.fail(); }) }]);
    await settle(m);
    const tag = callsOf("createGestureHandler")[0]?.[2] as number;
    for (const listener of world().listeners.get("onGestureHandlerEvent") ?? []) listener(touch(tag, 1));
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("GestureStateManager.activate() works in worklet callbacks only"),
      expect.stringContaining("GestureStateManager.fail() works in worklet callbacks only"),
    ]);
  } finally {
    warn.mockRestore();
  }
});

test("UI thread: a touch callback's state manager calls Reanimated's setGestureState with the handler's tag", async () => {
  const m = await load({ fixture: "gesture-fixture.svelte" });
  const app = m.startSurface(53, m.Fixture, {}) as unknown as { set(items: unknown[]): void };
  app.set([{ id: "box", gesture: m.gestures.Gesture.Manual().onTouchesDown(worklet((_event: unknown, manager: { begin(): void; activate(): void; fail(): void; end(): void }) => { manager.begin(); manager.activate(); manager.end(); manager.fail(); })) }]);
  await settle(m);
  const tag = callsOf("createGestureHandler")[0]?.[2] as number;
  anim().eventHandlers?.[0]?.worklet(touch(tag, 1));
  expect(anim().gestureStates).toEqual([[tag, 2], [tag, 4], [tag, 5], [tag, 1]]);
});

test("UI thread: a callback that is not a worklet is reported, not called", async () => {
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const { log, tag } = await mounted("ui");
    const shared = anim().mutables?.[0] as { value: { isWorklet: boolean[]; onUpdate?: unknown }[] };
    // A handler list in which `onUpdate` is a plain function: a state the detector never builds, but the worklet guards against.
    shared.value = [{ handlerTag: tag, onUpdate: () => { log.push(["called"]); }, isWorklet: [] } as never];
    anim().eventHandlers?.[0]?.worklet(update(tag, 1, 1));
    expect(log).toEqual([]);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringContaining("Animated gesture callback must be a worklet")]);
  } finally {
    warn.mockRestore();
  }
});

