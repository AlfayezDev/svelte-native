import { afterAll, beforeAll, expect, test } from "bun:test";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHarness, find, settle, type Platform } from "./foreign-harness.ts";
import { validateCaptureOptions, type CaptureOptions } from "../src/fabric/foreign-capture.ts";

/**
 * react-native-view-shot (SPEC.md, "Foreign views"): the library's module draws the view a React tag names. On iOS React Native
 * mounts every view, so the module finds the host's handles; on Android the engine's views are not in React Native's mounting
 * manager, so `SvelteEngine.captureView` draws those and the module draws what it answers null for (a foreign view and what is inside
 * it). The options are the library's own (`validateOptions` of `index.tsx`, run below), and `ViewShot` is its container.
 */
type Handle = { capture(): Promise<string>; host: { tag: number } };
type App = { eventLog(): unknown[][]; capture(): Promise<string>; shotHandle(): Handle; plainHandle(): { tag: number }; captureHandle(handle: unknown, options?: CaptureOptions): Promise<string> };
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
const base = { format: "png", quality: 1, result: "base64", snapshotContentContainer: false, handleGLSurfaceViewOnAndroid: false };

async function mount(platform: Platform, root: number, natives: Parameters<typeof createHarness>[1] = {}, mode?: string, options?: CaptureOptions) {
  const viewShot = fakeViewShot();
  const harness = createHarness(platform, { natives: { turbo: { RNViewShot: viewShot.module }, ...natives?.natives } });
  const loaded = await harness.load("foreign-capture-fixture.svelte");
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

  // A plain handle, with options: validated first (width and quality as given, a bad format back to png).
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (message: string) => { warnings.push(message); };
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  try {
    viewShot.log.length = 0;
    await app.captureHandle(app.plainHandle(), { width: 20, height: 10, quality: 0.5, format: "gif" as never, result: "data-uri" });
  } finally {
    console.warn = warn;
    (globalThis as { __DEV__?: boolean }).__DEV__ = undefined;
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

test("a failed capture is reported to onCaptureFailure and rejects; the previous file is released after the next capture; no view is an error", async () => {
  const failing = await mount("ios", 114);
  failing.harness.natives.turbo.RNViewShot = fakeViewShot({ fail: "No view found with reactTag" }).module;
  failing.harness.emit(failing.shot.target, "topLayout", layout);
  await expect(failing.app.capture()).rejects.toThrow("No view found with reactTag");
  expect(failing.app.eventLog()).toEqual([["failure", "No view found with reactTag"]]);

  const { harness, app, shot, viewShot } = await mount("ios", 115);
  harness.emit(shot.target, "topLayout", layout);
  await app.capture();
  await app.capture();
  await new Promise((resolveWait) => setTimeout(resolveWait, 600));
  expect(viewShot.log.filter((line) => line.startsWith("release"))).toEqual(["release file:///module-1.png"]);
  await expect(app.captureHandle(null)).rejects.toThrow("no view to capture");
});

test("captureMode mount captures once after the first layout; continuous captures again whenever the last capture is new", async () => {
  const mounted = await mount("ios", 116, {}, "mount");
  mounted.harness.emit(mounted.shot.target, "topLayout", layout);
  await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  expect(mounted.app.eventLog()).toEqual([["capture", "file:///module-1.png"]]);

  const scope = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
  const saved = [scope.requestAnimationFrame, scope.cancelAnimationFrame];
  scope.requestAnimationFrame = (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 4);
  scope.cancelAnimationFrame = (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle);
  try {
    const running = await mount("ios", 117, {}, "continuous");
    running.harness.emit(running.shot.target, "topLayout", layout);
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    expect(running.app.eventLog().length).toBeGreaterThan(2);
    // Leaving stops the loop.
    running.loaded.stopSurface(117);
    const count = running.app.eventLog().length;
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    expect(running.app.eventLog().length).toBe(count);
    // Every capture after the first released the one before it, half a second later: let those finish with this test's module.
    await new Promise((resolveWait) => setTimeout(resolveWait, 520));
    expect(running.viewShot.log.filter((line) => line.startsWith("release")).length).toBe(count - 1);
  } finally {
    [scope.requestAnimationFrame, scope.cancelAnimationFrame] = saved;
  }
});

// The library's own `captureRef`, bundled with React Native stubbed, normalises the options as ours does.
let library: Record<Platform, (view: unknown, options?: object) => Promise<string>>;
const calls: { tag: unknown; options: object }[] = [];
const warnings: string[] = [];
const warn = console.warn;
beforeAll(async () => {
  const load = async (platform: Platform) => {
    const bundle = await build({
      stdin: { contents: `export { captureRef } from "react-native-view-shot/src/index.tsx";`, resolveDir: resolve(import.meta.dirname, "../../../node_modules") },
      bundle: true, format: "esm", platform: "neutral", write: false, mainFields: ["main"], conditions: ["browser"],
      plugins: [{
        name: "view-shot-stubs",
        setup(builder) {
          builder.onResolve({ filter: /^react-native$/ }, (args) => ({ path: args.path, namespace: "stub" }));
          builder.onResolve({ filter: /\/RNViewShot$/ }, (args) => ({ path: args.path, namespace: "stub" }));
          builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: args.path === "react-native"
              ? `export const View = () => null; export const Platform = { OS: ${JSON.stringify(platform)} }; export const findNodeHandle = (view) => view?.tag;`
              : "export default { captureRef: (tag, options) => { globalThis.__viewShotCalls.push({ tag, options }); return Promise.resolve('uri'); } };",
            loader: "js",
          }));
        },
      }],
    });
    const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-view-shot-"));
    try {
      const file = resolve(directory, "library.mjs");
      await writeFile(file, bundle.outputFiles[0].contents);
      return (await import(pathToFileURL(file).href) as { captureRef: (view: unknown, options?: object) => Promise<string> }).captureRef;
    } finally {
      await rm(directory, { recursive: true });
    }
  };
  (globalThis as Record<string, unknown>).__viewShotCalls = calls;
  library = { android: await load("android"), ios: await load("ios") };
});
afterAll(() => { console.warn = warn; (globalThis as Record<string, unknown>).__DEV__ = undefined; });

test("options are validated and defaulted as the library does, on both platforms", async () => {
  const cases: (CaptureOptions | undefined)[] = [
    undefined, {}, { format: "jpg", quality: 0.4, result: "base64" }, { format: "webm" }, { format: "raw", result: "zip-base64" }, { result: "data-uri", width: 30, height: 40 },
    { width: -1, height: 0 }, { quality: 2 }, { quality: "high" as never }, { snapshotContentContainer: "yes" as never, handleGLSurfaceViewOnAndroid: 1 as never }, { format: "gif" as never, result: "file" as never },
    { fileName: "shot", useRenderInContext: true },
  ];
  (globalThis as Record<string, unknown>).__DEV__ = true;
  console.warn = (message: string) => { warnings.push(message); };
  for (const platform of ["android", "ios"] as const) {
    for (const input of cases) {
      calls.length = 0;
      warnings.length = 0;
      await library[platform](7, input);
      const reference = { options: calls[0]?.options, warning: warnings[0] };
      const ours = validateCaptureOptions(input, platform);
      expect(ours.options, `${platform} ${JSON.stringify(input)}`).toEqual(reference.options as CaptureOptions);
      // The same options are reported. (The library names the default it fell back to in the format and result messages, not the value it was given.)
      const named = (lines: string[]) => lines.map((line) => /option (\w+)/.exec(line)?.[1]);
      expect(named(ours.errors), `${platform} ${JSON.stringify(input)}`).toEqual(named((reference.warning ?? "").split("\n").slice(1)));
    }
  }
});
