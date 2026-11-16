// The library's AppRegistry is the one every library that imports `AppRegistry` from `react-native` gets, and it runs React Native's headless tasks:
// what Android's HeadlessJsTaskContext calls (`startHeadlessTask`) for a background launch, which Expo's task service starts for every background task.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { src, load } from "../support/bundle.ts";
import { type GlobalSnapshot, snapshotGlobals } from "../support/globals.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Support = { finished: number[]; retried: number[]; retryPosted: boolean };
/** React Native's `HeadlessJsTaskError`, which the bundle's stub hands out: a task throws one to ask for a retry. */
class HeadlessJsTaskError extends Error {}

// The stubs read `globalThis.__support` (what native code is told) and `__TaskError` when the bundle is evaluated, so a test sets them before it loads the registry.
let globals: GlobalSnapshot;
beforeEach(() => { globals = snapshotGlobals(); (globalThis as any).__TaskError = HeadlessJsTaskError; });
afterEach(() => globals.restore());

/** The registry module bundled with React Native's two headless-task modules stubbed: `globalThis.__support` records what native code is told. */
const registry = (): Promise<any> => load({
  entry: `export * from ${JSON.stringify(src("fabric/app-registry.ts"))};`,
  stubs: {
    "react-native/Libraries/ReactNative/NativeHeadlessJsTaskSupport": `const s = globalThis.__support; export default s && { notifyTaskFinished: (id) => { s.finished.push(id); }, notifyTaskRetry: async (id) => { s.retried.push(id); return s.retryPosted; } };`,
    // React Native's class, as the test defines it (a task throws one to ask for a retry).
    "react-native/Libraries/ReactNative/HeadlessJsTaskError": "export default globalThis.__TaskError;",
  },
  converters: false,
});

const settle = () => new Promise((done) => setTimeout(done, 0));
function quiet<T>(run: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  return run().finally(() => { console.warn = warn; console.error = error; });
}

describe("headless tasks", () => {
  test("a registered task runs with its data and is finished when its promise settles, either way; an unknown key is finished at once", async () => {
    const support: Support = { finished: [], retried: [], retryPosted: false };
    (globalThis as any).__support = support;
    const m = await registry();
    const seen: unknown[] = [];
    let release!: () => void;
    m.AppRegistry.registerHeadlessTask("expo-task-manager", () => async () => {});
    m.AppRegistry.registerHeadlessTask("sync", () => (data: unknown) => { seen.push(data); return new Promise<void>((done) => { release = done; }); });
    m.AppRegistry.registerHeadlessTask("broken", () => async () => { throw new Error("no network"); });
    m.AppRegistry.registerHeadlessTask("throws-at-once", () => () => { throw new Error("sync throw"); });
    await quiet(async () => {
      m.AppRegistry.startHeadlessTask(1, "expo-task-manager", {});
      m.AppRegistry.startHeadlessTask(2, "sync", { since: 3 });
      await settle();
      expect(seen).toEqual([{ since: 3 }]);
      expect(support.finished).toEqual([1]);
      release();
      await settle();
      expect(support.finished).toEqual([1, 2]);
      m.AppRegistry.startHeadlessTask(3, "broken", null);
      m.AppRegistry.startHeadlessTask(4, "throws-at-once", null);
      m.AppRegistry.startHeadlessTask(5, "nobody", null);
      await settle();
    });
    expect(support.finished).toEqual([1, 2, 5, 3, 4]);
    expect(support.retried).toEqual([]);
  });

  test("a HeadlessJsTaskError asks for a retry, and the task is finished when none is posted; any other failure is not a retry", async () => {
    const support: Support = { finished: [], retried: [], retryPosted: true };
    (globalThis as any).__support = support;
    const m = await registry();
    m.AppRegistry.registerHeadlessTask("retry", () => async () => { throw new HeadlessJsTaskError("later"); });
    m.AppRegistry.registerHeadlessTask("fails", () => async () => { throw new Error("no"); });
    await quiet(async () => {
      m.AppRegistry.startHeadlessTask(7, "retry", null);
      await settle();
      expect(support.retried).toEqual([7]);
      expect(support.finished).toEqual([]); // the retry was posted: the native side runs it again
      support.retryPosted = false;
      m.AppRegistry.startHeadlessTask(8, "retry", null);
      m.AppRegistry.startHeadlessTask(9, "fails", null);
      await settle();
      await settle();
    });
    expect(support.retried).toEqual([7, 8]);
    expect(support.finished.sort()).toEqual([8, 9]);
  });

  test("cancelHeadlessTask calls the task's cancel provider; registering a key twice warns and replaces it", async () => {
    (globalThis as any).__support = { finished: [], retried: [], retryPosted: false };
    const m = await registry();
    const cancelled: string[] = [];
    const warnings: unknown[] = [];
    const { warn } = console;
    console.warn = (...args: unknown[]) => { warnings.push(args[0]); };
    try {
      m.AppRegistry.registerCancellableHeadlessTask("upload", () => async () => {}, () => () => { cancelled.push("first"); });
      m.AppRegistry.registerCancellableHeadlessTask("upload", () => async () => {}, () => () => { cancelled.push("second"); });
    } finally { console.warn = warn; }
    m.AppRegistry.cancelHeadlessTask(9, "upload");
    expect(cancelled).toEqual(["second"]);
    expect(String(warnings[0])).toContain("called multiple times for same key 'upload'");
    expect(() => m.AppRegistry.cancelHeadlessTask(10, "nobody")).toThrow("No task canceller registered for key 'nobody'");
  });

  test("the runnables are as before, and React Native's root-wrapping hooks are accepted", async () => {
    const m = await registry();
    const runs: unknown[] = [];
    expect(m.AppRegistry.registerRunnable("main", (parameters: unknown) => { runs.push(parameters); })).toBe("main");
    const { log } = console;
    console.log = () => {};
    try { m.AppRegistry.runApplication("main", { rootTag: 11 }); } finally { console.log = log; }
    expect(runs).toEqual([{ rootTag: 11 }]);
    expect(m.AppRegistry.getAppKeys()).toEqual(["main"]);
    expect(typeof m.AppRegistry.getRunnable("main")).toBe("function");
    expect(() => m.AppRegistry.runApplication("other", { rootTag: 12 })).toThrow('"other" has not been registered');
    for (const hook of ["setWrapperComponentProvider", "setRootViewStyleProvider", "setComponentProviderInstrumentationHook"]) expect(m.AppRegistry[hook](() => null)).toBeUndefined();
    // `react-native`'s `index.js` reads `require('./Libraries/ReactNative/AppRegistry').AppRegistry`, and AppRegistryImpl is a module of named functions: both shapes are here.
    for (const name of Object.keys(m.AppRegistry)) expect(m[name]).toBe(m.AppRegistry[name]);
  });
});

test("without the native support module (iOS has none), a task still runs and nothing is notified", async () => {
  (globalThis as any).__support = undefined;
  const m = await registry();
  let ran = false;
  m.AppRegistry.registerHeadlessTask("ios", () => async () => { ran = true; });
  m.AppRegistry.startHeadlessTask(1, "ios", null);
  await settle();
  expect(ran).toBe(true);
});
