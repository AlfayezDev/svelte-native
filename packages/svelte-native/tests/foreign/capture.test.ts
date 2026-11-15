import { afterEach, expect, jest, spyOn, test } from "bun:test";
import { createHarness, find, settle, type Platform } from "./support/harness.ts";
import { loadLibrary } from "./support/library.ts";
import { validateCaptureOptions, type CaptureOptions } from "../../src/fabric/foreign-capture.ts";

/**
 * react-native-view-shot (SPEC.md, "Foreign views"): the library's module draws the view a React tag names. On iOS React Native
 * mounts every view, so the module finds the host's handles; on Android the engine's views are not in React Native's mounting
 * manager, so `SvelteEngine.captureView` draws those and the module draws what it answers null for (a foreign view and what is inside
 * it). The options are the library's own (`validateOptions` of `index.tsx`, run below), and `ViewShot` is its container.
 */
type Handle = { capture(): Promise<string>; host: { tag: number } };
type App = { hide(): void; shotRef(): Handle | null; eventLog(): unknown[][]; capture(): Promise<string>; shotHandle(): Handle; plainHandle(): { tag: number }; captureHandle(handle: unknown, options?: CaptureOptions): Promise<string> };
const layout = { layout: { x: 0, y: 0, width: 100, height: 50 } };

function fakeViewShot(answers: { fail?: string } = {}) {
  const log: string[] = [];
  let count = 0;
  const module = {
    captureRef(tag: number, options: object) { log.push(`captureRef ${tag} ${JSON.stringify(options)}`); return answers.fail ? Promise.reject(new Error(answers.fail)) : Promise.resolve(`file:///module-${++count}.png`); },
    captureScreen(options: object) { log.push(`captureScreen ${JSON.stringify(options)}`); return Promise.resolve("file:///screen.png"); },
    releaseCapture(uri: string) { log.push(`release ${uri}`); },
  };
  return { module, log };
}
/** The file of an earlier capture is released half a second after the next one: a test that waits for it installs a fake clock once its harness is built, and this puts the real one back. */
afterEach(() => { jest.useRealTimers(); });
const releaseDelay = (): void => { jest.advanceTimersByTime(600); };
const base = { format: "png", quality: 1, result: "base64", snapshotContentContainer: false, handleGLSurfaceViewOnAndroid: false };

async function mount(platform: Platform, root: number, natives: Parameters<typeof createHarness>[1] = {}, mode?: string, options?: CaptureOptions) {
  const viewShot = fakeViewShot();
  const harness = createHarness(platform, { natives: { turbo: { RNViewShot: viewShot.module }, ...natives?.natives } });
  const loaded = await harness.load("capture-fixture.svelte");
  const app = loaded.startSurface(root, loaded.Fixture, { mode, ...(options ? { options } : null) }) as App;
  const shot = find(harness.roots()[root], "RCTView").find((node) => node.props.collapsable === false && node.props.width === 100) as ReturnType<typeof find>[number];
  return { harness, loaded, app, shot, viewShot };
}

test("Android: the engine draws an engine view and the library's module is not asked; ViewShot waits for the first layout", async () => {
  const { harness, loaded, app, shot, viewShot } = await mount("android", 111, { natives: { engineCapture: "data:image/png;base64,AAAA" } });
  // The container is a native view of its own (not flattened away) and its handle has `capture()`.
  expect(shot.props).toMatchObject({ collapsable: false, width: 100, height: 50 });
  const handle = app.shotHandle();
  expect(typeof handle.host.tag).toBe("number");

  let settled = false;
  const pending = app.capture().then((uri) => { settled = true; return uri; });
  await settle(loaded);
  expect(settled).toBe(false);
  harness.emit(shot.target, "topLayout", layout);
  expect(await pending).toBe("data:image/png;base64,AAAA");
  expect(harness.calls.filter((call) => call.startsWith("engine.captureView"))).toEqual([`engine.captureView ${handle.host.tag} ${JSON.stringify(base)}`]);
  expect(viewShot.log).toEqual([]);
  expect(app.eventLog()).toEqual([["capture", "data:image/png;base64,AAAA"]]);
});

test("Android: a tag the engine does not own goes to the library's module with the same options", async () => {
  const { harness, app, shot, viewShot } = await mount("android", 112, { natives: { engineCapture: null } });
  harness.emit(shot.target, "topLayout", layout);
  const tag = app.shotHandle().host.tag;
  expect(await app.capture()).toBe("file:///module-1.png");
  expect(harness.calls.filter((call) => call.startsWith("engine.captureView"))).toEqual([`engine.captureView ${tag} ${JSON.stringify(base)}`]);
  expect(viewShot.log).toEqual([`captureRef ${tag} ${JSON.stringify(base)}`]);

  // A plain handle, with options: validated first (width and quality as given, a bad format back to png). The development warning needs `__DEV__`, which goes with the
  // harness's globals when the test ends.
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  let warnings: unknown[] = [];
  try {
    viewShot.log.length = 0;
    await app.captureHandle(app.plainHandle(), { width: 20, height: 10, quality: 0.5, format: "gif" as never, result: "data-uri" });
    warnings = warn.mock.calls.map((args) => args[0]);
  } finally {
    warn.mockRestore();
  }
  expect(viewShot.log).toEqual([`captureRef ${app.plainHandle().tag} ${JSON.stringify({ format: "png", quality: 0.5, result: "data-uri", snapshotContentContainer: false, handleGLSurfaceViewOnAndroid: false, width: 20, height: 10 })}`]);
  expect(warnings).toEqual(["react-native-view-shot: bad options:\n- option format 'gif' is not in valid formats: png | jpg | webm | raw"]);
});

test("Android: every option reaches the library's module for a view the engine does not own; only an engine view is refused one it does not capture", async () => {
  // The engine's contract (`Capture.kt`, `CaptureRules.plan`): the view is looked up first, null for a foreign or unknown tag, a rejection for an engine view with an option it does not capture.
  const foreignTags = new Set<number>();
  const engine = (tag: number, options: Record<string, unknown>) => {
    if (foreignTags.has(tag)) return null;
    if (options.format === "raw" || options.result === "zip-base64" || options.snapshotContentContainer === true) return new Error("Unsupported option for an engine view");
    return "data:image/png;base64,ENGINE";
  };
  const odd = { format: "raw", result: "zip-base64", snapshotContentContainer: true, handleGLSurfaceViewOnAndroid: true } as const;
  const { harness, app, shot, viewShot } = await mount("android", 118, { natives: { engineCapture: engine } }, undefined, odd);
  const map = app.plainHandle();
  foreignTags.add(map.tag);
  // A map, a video: the engine answers null and the module gets the options as given (the library draws its SurfaceView with the flag).
  expect(await app.captureHandle(map, odd)).toBe("file:///module-1.png");
  expect(viewShot.log).toEqual([`captureRef ${map.tag} ${JSON.stringify({ ...base, ...odd, result: "zip-base64" })}`]);
  // An unknown tag is the module's as well.
  viewShot.log.length = 0;
  foreignTags.add(999_999);
  expect(await app.captureHandle({ tag: 999_999 }, { handleGLSurfaceViewOnAndroid: true })).toBe("file:///module-2.png");
  expect(viewShot.log).toEqual([`captureRef 999999 ${JSON.stringify({ ...base, result: "tmpfile", handleGLSurfaceViewOnAndroid: true })}`]);

  // An engine view is refused: the rejection reaches the caller and ViewShot's onCaptureFailure, and the module is not asked.
  viewShot.log.length = 0;
  harness.emit(shot.target, "topLayout", layout);
  await expect(app.captureHandle(app.shotHandle().host, { format: "raw" })).rejects.toThrow("Unsupported option for an engine view");
  await expect(app.capture()).rejects.toThrow("Unsupported option for an engine view");
  expect(app.eventLog()).toEqual([["failure", "Unsupported option for an engine view"]]);
  expect(viewShot.log).toEqual([]);
  // The SurfaceView overlay is accepted for an engine view (PixelCopy of the surfaces, `Capture.kt`).
  expect(await app.captureHandle(app.shotHandle().host, { handleGLSurfaceViewOnAndroid: true })).toBe("data:image/png;base64,ENGINE");
  expect(viewShot.log).toEqual([]);
});

test("iOS: React Native mounts every view, so the module takes the handle's tag and the engine is not asked", async () => {
  const { harness, app, shot, viewShot } = await mount("ios", 113);
  harness.emit(shot.target, "topLayout", layout);
  const tag = app.shotHandle().host.tag;
  expect(await app.capture()).toBe("file:///module-1.png");
  expect(viewShot.log).toEqual([`captureRef ${tag} ${JSON.stringify(base)}`]);
  expect(harness.calls.some((call) => call.startsWith("engine.captureView"))).toBe(false);
  // The formats and results of iOS are fewer.
  expect(validateCaptureOptions({ format: "webm", result: "zip-base64" }, "ios")).toEqual({
    options: { format: "png", quality: 1, result: "tmpfile", snapshotContentContainer: false, handleGLSurfaceViewOnAndroid: false },
    errors: ["option format 'webm' is not in valid formats: png | jpg", "option result 'zip-base64' is not in valid formats: tmpfile | base64 | data-uri"],
  });
});

test("iOS: the module's answers reach the caller as they are (a plain path, not a URI), the release is given the same string, and width and height are not scaled", async () => {
  // What RNViewShot.mm answers on iOS: React Native's temporary path, no scheme (`native-host/contracts/capture-ios.test.ts` reads that from the library's source).
  const directory = "/var/mobile/Containers/Data/Application/6F1A2B3C-0000-4000-8000-000000000001/tmp/ReactNative";
  const { harness, app, shot, viewShot } = await mount("ios", 121);
  jest.useFakeTimers();
  let count = 0;
  harness.natives.turbo.RNViewShot = {
    captureRef: (tag: number, options: object) => { viewShot.log.push(`captureRef ${tag} ${JSON.stringify(options)}`); return Promise.resolve(`${directory}/FILE-${++count}.png`); },
    captureScreen: () => Promise.resolve(""),
    releaseCapture: (uri: string) => { viewShot.log.push(`release ${uri}`); },
  };
  harness.emit(shot.target, "topLayout", layout);
  const first = await app.capture();
  expect(first).toBe(`${directory}/FILE-1.png`);
  expect(app.eventLog()).toEqual([["capture", `${directory}/FILE-1.png`]]);
  // Another capture releases the previous file with the string the module made, which is what its `hasPrefix:` compares (a `file://` prefix would turn the release into a no-op).
  expect(await app.capture()).toBe(`${directory}/FILE-2.png`);
  releaseDelay();
  expect(viewShot.log.filter((line) => line.startsWith("release"))).toEqual([`release ${directory}/FILE-1.png`]);
  // A size is the caller's number for the module, on iOS in points; the wrapper does not multiply it by the screen's scale.
  viewShot.log.length = 0;
  expect(await app.captureHandle(app.plainHandle(), { result: "tmpfile", width: 40, height: 30 })).toBe(`${directory}/FILE-3.png`);
  expect(viewShot.log).toEqual([`captureRef ${app.plainHandle().tag} ${JSON.stringify({ format: "png", quality: 1, result: "tmpfile", snapshotContentContainer: false, handleGLSurfaceViewOnAndroid: false, width: 40, height: 30 })}`]);
});

test("a failed capture is reported to onCaptureFailure and rejects; the previous file is released after the next capture; no view is an error", async () => {
  const failing = await mount("ios", 114);
  failing.harness.natives.turbo.RNViewShot = fakeViewShot({ fail: "No view found with reactTag" }).module;
  failing.harness.emit(failing.shot.target, "topLayout", layout);
  await expect(failing.app.capture()).rejects.toThrow("No view found with reactTag");
  expect(failing.app.eventLog()).toEqual([["failure", "No view found with reactTag"]]);

  const { harness, app, shot, viewShot } = await mount("ios", 115);
  jest.useFakeTimers();
  harness.emit(shot.target, "topLayout", layout);
  await app.capture();
  await app.capture();
  releaseDelay();
  expect(viewShot.log.filter((line) => line.startsWith("release"))).toEqual(["release file:///module-1.png"]);
  await expect(app.captureHandle(null)).rejects.toThrow("no view to capture");
});

/** Unmounting a `ViewShot` cancels its frame loop, which the test runtime has no function for. */
const withFrames = async (run: () => Promise<void>) => {
  const scope = globalThis as { cancelAnimationFrame?: unknown };
  const saved = scope.cancelAnimationFrame;
  scope.cancelAnimationFrame = () => {};
  try { await run(); } finally { scope.cancelAnimationFrame = saved; }
};

test("a capture that outlives its ViewShot never settles, calls no callback, and does not reach the module before the layout", async () => {
  await withFrames(async () => {
  const { harness, loaded, app, shot, viewShot } = await mount("ios", 119);
  let settled = false;
  void app.capture().then(() => { settled = true; }, () => { settled = true; });
  await settle(loaded);
  app.hide();
  await settle(loaded);
  await settle(loaded);
  // The ref heard null: the component drops its handle (and the caller's ref gets null).
  expect(app.shotRef()).toBeNull();
  // The layout of a view that is gone still arrives: the pending capture finds no view and waits for ever.
  harness.emit(shot.target, "topLayout", layout);
  await settle(loaded);
  await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  expect(settled).toBe(false);
  expect(viewShot.log).toEqual([]);
  expect(app.eventLog()).toEqual([]);
  });
});

test("a capture in flight when its ViewShot goes away still answers its caller, but tells no callback and releases nothing", async () => {
  await withFrames(async () => {
  const { harness, loaded, app, shot, viewShot } = await mount("ios", 120);
  let answer: ((uri: string) => void) | null = null;
  let refuse: ((error: Error) => void) | null = null;
  harness.natives.turbo.RNViewShot = {
    captureRef: () => new Promise<string>((resolveCapture, rejectCapture) => { if (!answer) answer = resolveCapture; else refuse = rejectCapture; }),
    captureScreen: () => Promise.resolve(""),
    releaseCapture: (uri: string) => { viewShot.log.push(`release ${uri}`); },
  };
  harness.emit(shot.target, "topLayout", layout);
  const first = app.capture();
  const second = app.capture();
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  app.hide();
  await settle(loaded);
  await settle(loaded);
  (answer as unknown as (uri: string) => void)("file:///late.png");
  await expect(first).resolves.toBe("file:///late.png");
  (refuse as unknown as (error: Error) => void)(new Error("gone"));
  await expect(second).rejects.toThrow("gone");
  await new Promise((resolveWait) => setTimeout(resolveWait, 600));
  expect(app.eventLog()).toEqual([]);
  expect(viewShot.log).toEqual([]);
  });
});

test("captureMode mount captures once after the first layout; continuous captures again whenever the last capture is new", async () => {
  const mounted = await mount("ios", 116, {}, "mount");
  mounted.harness.emit(mounted.shot.target, "topLayout", layout);
  await until(() => mounted.app.eventLog().length > 0);
  expect(mounted.app.eventLog()).toEqual([["capture", "file:///module-1.png"]]);

  const scope = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
  const saved = [scope.requestAnimationFrame, scope.cancelAnimationFrame];
  scope.requestAnimationFrame = (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 4);
  scope.cancelAnimationFrame = (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle);
  let stop: (() => void) | undefined;
  try {
    const running = await mount("ios", 117, {}, "continuous");
    stop = () => { stop = undefined; running.loaded.stopSurface(117); };
    running.harness.emit(running.shot.target, "topLayout", layout);
    // The frames are 4 ms timers: wait for the third capture rather than for a time, which a busy machine stretches.
    await until(() => running.app.eventLog().length > 2);
    expect(running.app.eventLog().length).toBeGreaterThan(2);
    // Leaving stops the loop.
    stop?.();
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    const count = running.app.eventLog().length;
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    expect(running.app.eventLog().length).toBe(count);
    // Every capture after the first released the one before it, half a second later: let those finish with this test's module.
    const released = () => running.viewShot.log.filter((line) => line.startsWith("release")).length;
    await until(() => released() === count - 1);
    expect(released()).toBe(count - 1);
  } finally {
    // A failed assertion must not leave the frame loop and the release timers running into the next tests.
    stop?.();
    [scope.requestAnimationFrame, scope.cancelAnimationFrame] = saved;
  }
});

/** Polls `condition` every 10 ms for at most five seconds. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition() && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10));
}

// The library's own `captureRef`, bundled with React Native stubbed, normalises the options as ours does. The module it calls is a stand-in that records what it was given
// in `calls`, which the bundle exports for the test to read; `__DEV__` is true in the bundle, so the library reports bad options.
type Library = { captureRef(view: unknown, options?: object): Promise<string>; calls: { tag: unknown; options: object }[] };
const library = (platform: Platform) => loadLibrary<Library>({
  entry: `export { captureRef } from "react-native-view-shot/src/index.tsx"; export { calls } from "view-shot-calls";`,
  conditions: ["browser"],
  define: { __DEV__: "true" },
  stubs: [
    ["view-shot-calls", "export const calls = [];"],
    ["react-native", `export const View = () => null; export const Platform = { OS: ${JSON.stringify(platform)} }; export const findNodeHandle = (view) => view?.tag;`],
    [/\/RNViewShot$/, "import { calls } from 'view-shot-calls'; export default { captureRef: (tag, options) => { calls.push({ tag, options }); return Promise.resolve('uri'); } };"],
  ],
});

test("options are validated and defaulted as the library does, on both platforms", async () => {
  const cases: (CaptureOptions | undefined)[] = [
    undefined, {}, { format: "jpg", quality: 0.4, result: "base64" }, { format: "webm" }, { format: "raw", result: "zip-base64" }, { result: "data-uri", width: 30, height: 40 },
    { width: -1, height: 0 }, { quality: 2 }, { quality: "high" as never }, { snapshotContentContainer: "yes" as never, handleGLSurfaceViewOnAndroid: 1 as never }, { format: "gif" as never, result: "file" as never },
    { fileName: "shot", useRenderInContext: true },
  ];
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    for (const platform of ["android", "ios"] as const) {
      const reference = await library(platform);
      for (const input of cases) {
        reference.calls.length = 0;
        warn.mockClear();
        await reference.captureRef(7, input);
        const expected = { options: reference.calls[0]?.options, warning: warn.mock.calls[0]?.[0] as string | undefined };
        const ours = validateCaptureOptions(input, platform);
        expect(ours.options, `${platform} ${JSON.stringify(input)}`).toEqual(expected.options as CaptureOptions);
        // The same options are reported. (The library names the default it fell back to in the format and result messages, not the value it was given.)
        const named = (lines: string[]) => lines.map((line) => /option (\w+)/.exec(line)?.[1]);
        expect(named(ours.errors), `${platform} ${JSON.stringify(input)}`).toEqual(named((expected.warning ?? "").split("\n").slice(1)));
      }
    }
  } finally {
    warn.mockRestore();
  }
});
