import { test, expect, spyOn } from "bun:test";
import { load, settle, callsOf, anim, world } from "./support/harness.ts";

/**
 * The development guards: a UI-thread callback that captured a Svelte signal, a gesture whose callbacks are some worklets and some
 * not, a callback Reanimated cannot send to the UI thread. Closures here are written the way the worklets plugin writes them
 * (`tests/compiler/gesture-worklets.test.ts` runs the real plugin over real fixtures); `__DEV__` is false in the last test.
 */
type App = { set(items: { id: string; gesture?: unknown }[]): void };
const signal = () => ({ f: 4, v: 0, reactions: null, equals: () => true, rv: 0, wv: 1 });
/** A worklet with the given closure; `closure` undefined leaves `__closure` off, as a callback with no captures has none to check. */
const worklet = (closure?: Record<string, unknown>) => {
  const fn = () => {};
  (fn as { __workletHash?: number }).__workletHash = 7;
  if (closure) (fn as { __closure?: unknown }).__closure = closure;
  return fn;
};
const plain = () => () => {};

async function mount(options: { dev?: boolean } = {}) {
  const m = await load({ fixture: "gesture-fixture.svelte", dev: options.dev });
  const app = m.startSurface(101, m.Fixture, {}) as unknown as App;
  return { m, app, G: m.gestures.Gesture };
}

test("a UI-thread callback whose closure holds a Svelte signal is refused before anything reaches native, with the variable named", async () => {
  const { m, G } = await mount();
  const message = (error: unknown) => (error as Error).message;
  let caught = "";
  try { m.startSurface(102, m.Fixture, { initial: [{ id: "a", gesture: G.Pan().onUpdate(worklet({ $: {}, count: signal() })) }] }); } catch (error) { caught = message(error); }
  expect(caught).toBe("[svelte-native gestures] The onUpdate callback of Gesture.Pan() runs on the UI thread but reads the state \"count\". Svelte compiles that read into a call on its own signal, which the UI runtime cannot use. Copy the value into a SharedValue (createSharedValue) and read that, or run the gesture on the JS thread with .runOnJS(true), where callbacks read live state.");
  expect(callsOf("createGestureHandler")).toEqual([]);
  expect(anim().eventHandlers ?? []).toHaveLength(0);
  expect(world().log).not.toContain("enableGestures");
});

test("each Svelte read is named: several states, a $derived, the props, the runtime alone", async () => {
  const { m, G } = await mount();
  const refused = (callback: () => void) => { try { m.startSurface(103, m.Fixture, { initial: [{ id: "a", gesture: G.Tap().onEnd(callback) }] }); } catch (error) { return (error as Error).message; } return ""; };
  expect(refused(worklet({ $: {}, a: signal(), b: signal(), c: 1 }))).toContain('reads the state "a" and the state "b".');
  expect(refused(worklet({ $: {}, doubled: { ...signal(), fn: () => 1, deps: [] } }))).toContain('reads the state "doubled".');
  expect(refused(worklet({ $$props: {}, $: {} }))).toContain("reads the component's props ($props).");
  expect(refused(worklet({ $$props: {}, $: {}, count: signal() }))).toContain('reads the state "count" and the component\'s props ($props).');
  expect(refused(worklet({ $: {} }))).toContain("reads Svelte's compiled runtime ($).");
  expect(refused(worklet({ $: {} }))).toContain("The onEnd callback of Gesture.Tap()");
});

test("what a UI-thread callback may capture passes: SharedValues, numbers, strings, plain objects, other worklets and functions", async () => {
  const { m, app, G } = await mount();
  const shared = { value: 0, _isReanimatedSharedValue: true };
  app.set([{ id: "a", gesture: G.Pan().onUpdate(worklet({ shared, limit: 4, label: "x", options: { a: 1, v: 2 }, helper: worklet(), remote: () => {}, notASignal: { f: 1, v: 2 } })).onEnd(worklet()) }]);
  await settle(m);
  expect(callsOf("attachGestureHandler")[0]?.[3]).toBe(1);
});

test("a callback that is not a UI-thread worklet is not checked: the gesture runs on the JS thread, where reading live state is the point", async () => {
  const { m, app, G } = await mount();
  const reads = worklet({ $: {}, count: signal() });
  app.set([{ id: "a", gesture: G.Pan().runOnJS(true).onUpdate(reads) }, { id: "b", gesture: G.Tap().onEnd(Object.assign(plain(), { __closure: { $: {}, count: signal() } })) }]);
  await settle(m);
  expect(callsOf("attachGestureHandler").map((call) => call[3])).toEqual([4, 4]);
});

test("a new gesture object whose callback captures a signal is refused on update, and the attached handler is left as it was", async () => {
  const { m, app, G } = await mount();
  app.set([{ id: "a", gesture: G.Pan().onUpdate(worklet({ x: { value: 1, _isReanimatedSharedValue: true } })) }]);
  await settle(m);
  const before = world().calls.length;
  m.flushSync(() => app.set([{ id: "a", gesture: G.Pan().onUpdate(worklet({ $: {}, count: signal() })) }]));
  expect(() => m.flush()).toThrow('reads the state "count"');
  await settle(m);
  expect(world().calls.length).toBe(before);
});

test("mixed worklet and JS callbacks without .runOnJS(true) are reported as an error and the gesture runs on the JS thread", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    const { m, app, G } = await mount();
    app.set([{ id: "mixed", gesture: G.Pan().onUpdate(worklet()).onEnd(plain()) }, { id: "explicit", gesture: G.Pan().runOnJS(true).onUpdate(worklet()).onEnd(plain()) }, { id: "uniform", gesture: G.Pan().onUpdate(worklet()).onEnd(worklet()) }]);
    await settle(m);
    expect(error.mock.calls.map((call) => String(call[0]))).toEqual([expect.stringContaining("Some of the callbacks in Gesture.Pan() are worklets and some are not")]);
    expect(error.mock.calls[0]?.[0]).toContain(".runOnJS(true)");
    expect(callsOf("attachGestureHandler").map((call) => call[3])).toEqual([4, 4, 1]);
  } finally {
    error.mockRestore();
  }
});

test("a callback Reanimated cannot send to the UI thread is named in the error, with its gesture", async () => {
  const m = await load({ fixture: "gesture-fixture.svelte" });
  const G = m.gestures.Gesture;
  // Reanimated's module is evaluated by the first Gesture read; its fake mutable fails on a function marked `__bad`.
  const pan = G.Pan().onStart(worklet()).onUpdate(Object.assign(worklet({ x: 1 }), { __bad: true })).onEnd(worklet());
  const bad = (value: unknown): boolean => typeof value === "function" ? (value as { __bad?: boolean }).__bad === true : Array.isArray(value) ? value.some(bad) : value !== null && typeof value === "object" && Object.values(value).some(bad);
  anim().onWrite = (_mutable, next) => { if (bad(next)) throw new Error("could not serialise a worklet closure"); };
  let caught = "";
  try { m.startSurface(104, m.Fixture, { initial: [{ id: "a", gesture: pan }] }); } catch (error) { caught = (error as Error).message; }
  expect(caught).toContain("Reanimated could not send the onUpdate callback of Gesture.Pan() to the UI thread: could not serialise a worklet closure.");
  expect(caught).toContain(".runOnJS(true)");
  expect(callsOf("createGestureHandler")).toEqual([]);
  expect(anim().eventHandlers?.[0]?.tags.size).toBe(0); // nothing stays registered for the failed attach
});

test("in a release build none of the guards run", async () => {
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    const { m, app, G } = await mount({ dev: false });
    app.set([
      { id: "state", gesture: G.Pan().onUpdate(worklet({ $: {}, count: signal() })) },
      { id: "mixed", gesture: G.Tap().onEnd(worklet()).onBegin(plain()) },
    ]);
    await settle(m);
    expect(callsOf("attachGestureHandler")).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});
