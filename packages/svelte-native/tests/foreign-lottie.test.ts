import { expect, test } from "bun:test";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHarness, find, settle } from "./foreign-harness.ts";
import { lottieSources, lottieSpeed, type LottieSource } from "../src/fabric/foreign-lottie.ts";

/**
 * lottie-react-native 7 (SPEC.md, "Foreign views"): `LottieAnimationView` is a codegen Fabric component, mounted by name. The
 * component resolves `source` into the native source props as the library does, plays from its ref when `autoPlay` is set, and
 * `play`, `pause`, `reset` and `resume` are the library's commands, dispatched through Fabric to the view.
 */
type Handle = { play(start?: number, end?: number): void; pause(): void; reset(): void; resume(): void; host: { tag: number } };
type App = { setSource(source: unknown): void; setProgress(progress: number): void; eventLog(): unknown[][]; lottieHandle(): Handle | null };
const animation = { v: "5.7.0", fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [] };

test("the component mounts LottieAnimationView with the library's source props, converted colour filters and defaults", async () => {
  const harness = createHarness("android");
  const loaded = await harness.load("foreign-lottie-fixture.svelte");
  const app = loaded.startSurface(81, loaded.Fixture, {}) as App;
  const [lottie, timed] = find(harness.roots()[81], "LottieAnimationView");
  expect(harness.calls.indexOf("engine.registerForeign LottieAnimationView")).toBeGreaterThanOrEqual(0);
  expect(harness.calls.indexOf("engine.registerForeign LottieAnimationView")).toBeLessThan(harness.calls.indexOf("create LottieAnimationView"));
  expect(lottie.props).toMatchObject({
    sourceJson: JSON.stringify(animation), progress: 0.25, autoPlay: true, loop: false, speed: 2, resizeMode: "contain", cacheComposition: true,
    enableMergePathsAndroidForKitKatAndAbove: false, enableSafeModeAndroid: false, textFiltersAndroid: [], textFiltersIOS: [], width: 100, height: 100,
    colorFilters: [{ keypath: "layer", color: -65536 }],
  });
  for (const key of ["source", "duration", "onAnimationFinish", "ref", "nativeProps", "component"]) expect(key in lottie.props, key).toBe(false);
  // `duration` makes the animation last that long: 60 frames at 30 per second in 1000 ms is a speed of 2, whatever `speed` says.
  expect(timed.props.speed).toBe(2);

  // `autoPlay` plays from the ref, as the library's does: a whole-animation play command through Fabric.
  expect(typeof app.lottieHandle()?.host.tag).toBe("number");
  expect(harness.calls.filter((call) => call.startsWith("fabric.dispatchCommand"))).toEqual(["fabric.dispatchCommand LottieAnimationView play [-1,-1]"]);

  harness.calls.length = 0;
  const handle = app.lottieHandle() as Handle;
  handle.play(10, 40);
  handle.pause();
  handle.resume();
  handle.reset();
  expect(harness.calls).toEqual([
    "fabric.dispatchCommand LottieAnimationView play [10,40]", "fabric.dispatchCommand LottieAnimationView pause []",
    "fabric.dispatchCommand LottieAnimationView resume []", "fabric.dispatchCommand LottieAnimationView reset []",
  ]);

  // The view's events: finish with the cancel flag, failure with the message, loaded without arguments.
  harness.emit(lottie.target, "topAnimationLoaded", {});
  harness.emit(lottie.target, "topAnimationFinish", { isCancelled: true });
  harness.emit(lottie.target, "topAnimationFailure", { error: "bad json" });
  expect(app.eventLog()).toEqual([["loaded"], ["finish", true], ["failure", "bad json"]]);
  expect(loaded.configs.viewConfigFor("LottieAnimationView", "android").events.get("topAnimationFinish")).toBe("onAnimationFinish");

  // A new progress is a clone of the same node, and a source that does not change nothing else.
  harness.calls.length = 0;
  app.setProgress(0.75);
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(find(harness.roots()[81], "LottieAnimationView")[0].props.progress).toBe(0.75);
});

test("a name, a URL, a .lottie file and a require()d asset each go in their own source prop, and no source mounts nothing", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const harness = createHarness("ios", { natives: { assets: { 5: { uri: "asset:/hello.lottie" } } } });
    const loaded = await harness.load("foreign-lottie-fixture.svelte");
    const app = loaded.startSurface(82, loaded.Fixture, {}) as App;
    // The previous source's prop is removed with a null, as every diff does.
    const sourceProps = () => {
      const props = find(harness.roots()[82], "LottieAnimationView")[0].props;
      return Object.fromEntries(["sourceName", "sourceJson", "sourceURL", "sourceDotLottieURI"].filter((key) => props[key] != null).map((key) => [key, props[key]]));
    };
    for (const [source, expected] of [
      ["spinner", { sourceName: "spinner" }],
      [{ uri: "https://example.com/a.json" }, { sourceURL: "https://example.com/a.json" }],
      [{ uri: "https://example.com/a.lottie?x=1" }, { sourceDotLottieURI: "https://example.com/a.lottie?x=1" }],
      [5, { sourceDotLottieURI: "asset:/hello.lottie" }],
    ] as const) {
      app.setSource(source);
      await settle(loaded);
      expect(sourceProps(), JSON.stringify(source)).toEqual(expected);
    }
    app.setSource(null);
    await settle(loaded);
    expect(find(harness.roots()[82], "LottieAnimationView").length).toBe(1);
  } finally {
    console.warn = warn;
  }
});

// The library's own `parsePossibleSources`, bundled with `react-native` stubbed, answers what ours answers.
async function library() {
  const bundle = await build({
    stdin: { contents: `export { parsePossibleSources } from "lottie-react-native/src/LottieView/utils.ts";`, resolveDir: resolve(import.meta.dirname, "../../../node_modules") },
    bundle: true, format: "esm", platform: "neutral", write: false, mainFields: ["main"],
    plugins: [{
      name: "stubs",
      setup(builder) {
        builder.onResolve({ filter: /^react-native$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const Image = { resolveAssetSource: (n) => ({ uri: 'asset:/' + n }) };", loader: "js" }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-lottie-"));
  try {
    const file = resolve(directory, "library.mjs");
    await writeFile(file, bundle.outputFiles[0].contents);
    return await import(pathToFileURL(file).href) as { parsePossibleSources(source: unknown): unknown };
  } finally {
    await rm(directory, { recursive: true });
  }
}

test("source and speed resolve as lottie-react-native's own code does", async () => {
  const reference = await library();
  const sources: LottieSource[] = ["spinner", "", 3, { uri: "https://a/b.json" }, { uri: "file:///a.lottie" }, { uri: "" }, animation, { ...animation, op: 90 }, {} as never];
  for (const source of sources) {
    expect(lottieSources(source, (asset) => ({ uri: `asset:/${asset}` })), JSON.stringify(source)).toEqual(reference.parsePossibleSources(source) as never);
  }
  const json = lottieSources(animation, () => null);
  expect(lottieSpeed(1, 1000, animation, json)).toBe(2);
  expect(lottieSpeed(1, 2000, animation, json)).toBe(1);
  expect(lottieSpeed(3, undefined, animation, json)).toBe(3);
  expect(lottieSpeed(3, 1000, "spinner", lottieSources("spinner", () => null))).toBe(3);
});
