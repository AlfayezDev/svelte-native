import { afterAll, test, expect } from "bun:test";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHarness, expoViewConfigs, find, settle } from "./foreign-harness.ts";
import { expoImageHandlers, expoImageProps, resolveContentFit, resolveContentPosition, resolveSfEffect, resolveSource, resolveSources, resolveTransition } from "../src/fabric/foreign-image.ts";
import { restoreStrays } from "./support/host.ts";

/**
 * expo-image (SPEC.md, "Foreign views"): the Svelte component mounts the module's `ExpoImage` view by the name the Expo
 * adapter gives it, with the props its React wrapper builds (`source` and `placeholder` as arrays of sources, `contentFit`
 * from `resizeMode`, a number as `transition`, colours as integers), and maps the view's events to the callbacks.
 */
const modules = resolve(import.meta.dirname, "../../../node_modules");
const harness = createHarness("android", {
  expo: { ExpoImage: expoViewConfigs("expo-image/android/src/main/java/expo/modules/image/ExpoImageModule.kt") },
  natives: { assets: { 7: { uri: "asset:/logo.png", width: 40, height: 30, scale: 2 } } },
});
type Handle = { tag: number } | null;
type App = { setSource(source: unknown): void; eventLog(): unknown[][]; imageHandle(): Handle };
let loaded: Awaited<ReturnType<typeof harness.load>>;
let app: App;

test("the module's own view is the default view of ExpoImage and declares the props the wrapper sends", () => {
  const config = expoViewConfigs("expo-image/android/src/main/java/expo/modules/image/ExpoImageModule.kt")[""];
  expect(Object.keys(config.validAttributes)).toEqual(expect.arrayContaining(["source", "placeholder", "contentFit", "contentPosition", "transition", "tintColor", "cachePolicy", "priority", "recyclingKey", "blurRadius", "autoplay", "allowDownscaling", "decodeFormat"]));
  expect(Object.values(config.directEventTypes ?? {}).map((event) => event.registrationName)).toEqual(["onLoadStart", "onProgress", "onError", "onLoad", "onDisplay"]);
});

test("the component mounts ExpoImage by its adapter name with the normalised props, the engine told first", async () => {
  loaded = await harness.load("foreign-image-fixture.svelte");
  app = loaded.startSurface(31, loaded.Fixture, {}) as App;
  const image = find(harness.roots()[31], "ViewManagerAdapter_ExpoImage")[0];
  expect(image).toBeDefined();
  expect(harness.calls.indexOf("engine.registerForeign ViewManagerAdapter_ExpoImage")).toBeGreaterThanOrEqual(0);
  expect(harness.calls.indexOf("engine.registerForeign ViewManagerAdapter_ExpoImage")).toBeLessThan(harness.calls.indexOf("create ViewManagerAdapter_ExpoImage"));
  expect(image.props.source).toEqual([{ uri: "https://example.com/a.png" }]);
  // A blurhash string is a source with a `blurhash:/` URI and the size in the string (16 x 16 without one).
  expect(image.props.placeholder).toEqual([{ uri: "blurhash:/LEHV6nWB2yk8pyo0adR*.7kCMdnj", width: 32, height: 32 }]);
  expect(image.props.contentFit).toBe("contain");
  expect(image.props.contentPosition).toEqual({ top: "50%", left: "50%" });
  expect(image.props.transition).toEqual({ duration: 200 });
  expect(image.props.cachePolicy).toBe("memory-disk");
  expect(image.props.priority).toBe("high");
  expect(image.props.recyclingKey).toBe("row-1");
  expect(image.props.accessibilityLabel).toBe("A picture");
  // The tint colour is an integer (red, signed ARGB on Android), the style's colours too, and `resizeMode` of the style is not a prop of the view.
  expect(image.props.tintColor).toBe(-65536);
  expect(image.props.backgroundColor).toBe(-16711936);
  expect(image.props.width).toBe(100);
  expect(image.props.height).toBe(80);
  expect(image.props.borderRadius).toBe(8);
  for (const key of ["resizeMode", "alt", "onLoad", "onLoadStart", "onError", "onLoadEnd", "ref", "nativeProps", "component", "symbolWeight", "sfEffect"]) expect(key in image.props, key).toBe(false);
  expect(typeof app.imageHandle()?.tag).toBe("number");
});

test("the view's events reach the callbacks, with the payload as the argument and `onLoadEnd` after a load or an error", async () => {
  const image = find(harness.roots()[31], "ViewManagerAdapter_ExpoImage")[0];
  harness.emit(image.target, "topLoadStart");
  harness.emit(image.target, "topProgress", { loaded: 5, total: 10 });
  harness.emit(image.target, "topLoad", { cacheType: "disk", source: { url: "https://example.com/a.png", width: 10, height: 10, mediaType: null } });
  harness.emit(image.target, "topError", { error: "boom" });
  harness.emit(image.target, "topDisplay");
  expect(app.eventLog()).toEqual([
    ["loadStart"], ["progress", 5, 10], ["load", "disk", "https://example.com/a.png"], ["loadEnd"], ["error", "boom"], ["loadEnd"], ["display"],
  ]);
});

test("a new source is a clone of the same node, not another view", async () => {
  harness.calls.length = 0;
  app.setSource(7);
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(harness.calls).toContain("cloneProps ViewManagerAdapter_ExpoImage");
  expect(find(harness.roots()[31], "ViewManagerAdapter_ExpoImage")[0].props.source).toEqual([{ uri: "asset:/logo.png", width: 40, height: 30, scale: 2 }]);
});

// The library's own normalisation, bundled with `expo` and `expo-modules-core` stubbed, answers what ours answers.
async function library() {
  const bundle = await build({
    stdin: {
      contents: `export * from "expo-image/src/utils/resolveSources.tsx"; export { resolveContentFit, resolveContentPosition, resolveTransition } from "expo-image/src/utils.ts";`,
      resolveDir: modules,
    },
    bundle: true, format: "esm", platform: "neutral", write: false, mainFields: ["main"],
    plugins: [{
      name: "stubs",
      setup(builder) {
        builder.onResolve({ filter: /^(expo|expo-modules-core)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: args.path === "expo" ? "export class SharedRef {}" : "export const Platform = { OS: 'android' };", loader: "js" }));
        builder.onResolve({ filter: /^react-native\/Libraries\/Image\/resolveAssetSource$/ }, () => ({ path: "asset", namespace: "asset" }));
        builder.onLoad({ filter: /.*/, namespace: "asset" }, () => ({ contents: "export default (n) => ({ uri: 'asset:/' + n, width: 1, height: 1, scale: 1 });", loader: "js" }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-expo-image-"));
  try {
    const file = resolve(directory, "library.mjs");
    await writeFile(file, bundle.outputFiles[0].contents);
    return await import(pathToFileURL(file).href) as {
      resolveSources(sources: unknown): unknown; resolveSource(source: unknown): unknown;
      resolveContentFit(fit?: string, mode?: string, symbol?: boolean): string; resolveContentPosition(position?: unknown): unknown; resolveTransition(transition?: unknown, fade?: number): unknown;
    };
  } finally {
    await rm(directory, { recursive: true });
  }
}
const asset = (number: number) => ({ uri: `asset:/${number}`, width: 1, height: 1, scale: 1 });

test("sources resolve as expo-image's own resolveSources does", async () => {
  const reference = await library();
  const { warn, log } = console;
  console.warn = console.log = () => {};
  const sources: unknown[] = [
    undefined, null, "", "https://example.com/a.png", "file:///tmp/a.png", 12, { uri: "https://x/y", headers: { a: "b" }, cacheKey: "k" },
    "blurhash:/LEHV6nWB2yk8pyo0adR*.7kCMdnj", "blurhash:/LEHV6nWB2yk8pyo0adR*.7kCMdnj/32/24", "blurhash:/abc#def?g/8/9", "thumbhash:/1QcSHQRnh493V4dIh4eXh1h4kJUI", "thumbhash:/a/b/c", "sf:star.fill",
    { blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj", width: 10 }, { thumbhash: "abc", height: 4 },
    [], ["https://a", 3, null, { uri: "https://b" }, "blurhash:/x"], [undefined, ""],
  ];
  try {
    for (const source of sources) {
      expect(resolveSources(source as never, asset), JSON.stringify(source)).toEqual(reference.resolveSources(source) as never);
      if (!Array.isArray(source)) expect(resolveSource(source as never, asset), JSON.stringify(source)).toEqual(reference.resolveSource(source) as never);
    }
    for (const fit of [undefined, "contain", "cover", "fill", "none", "scale-down"]) {
      for (const mode of [undefined, "contain", "cover", "stretch", "repeat", "center", "none"]) {
        for (const symbol of [false, true]) expect(resolveContentFit(fit as never, mode as never, symbol), `${fit} ${mode} ${symbol}`).toBe(reference.resolveContentFit(fit, mode, symbol));
      }
    }
    for (const position of [undefined, "center", "top", "right", "bottom left", "left top", "nonsense", { top: 1, left: "20%" }, {}]) expect(resolveContentPosition(position as never), String(position)).toEqual(reference.resolveContentPosition(position) as never);
    for (const transition of [undefined, null, 0, 150, { duration: 100, effect: "flip-from-top" }]) {
      for (const fade of [undefined, 0, 300]) expect(resolveTransition(transition as never, fade), `${JSON.stringify(transition)} ${fade}`).toEqual(reference.resolveTransition(transition, fade) as never);
    }
  } finally {
    console.warn = warn;
    console.log = log;
  }
});

test("a deprecated React Native prop maps to the current one, and an SF symbol's font style becomes its weight and size", () => {
  expect(expoImageProps({ source: "x", resizeMode: "stretch" }, asset, "android").contentFit).toBe("fill");
  expect(expoImageProps({ source: "x", style: { resizeMode: "center" } }, asset, "android").contentFit).toBe("scale-down");
  expect(expoImageProps({ source: "x", style: { resizeMode: "center" }, resizeMode: "cover" }, asset, "android").contentFit).toBe("cover");
  expect(expoImageProps({ source: "x", fadeDuration: 90 }, asset, "android").transition).toEqual({ duration: 90 });
  expect(expoImageProps({ source: "x", defaultSource: { uri: "d" } }, asset, "android").placeholder).toEqual([{ uri: "d" }]);
  expect(expoImageProps({ source: "x", alt: "alt text", accessibilityLabel: "label" }, asset, "android").accessibilityLabel).toBe("label");
  expect(expoImageProps({ source: "x", style: { tintColor: "blue" } }, asset, "android").tintColor).toBe("blue");
  expect(expoImageProps({ source: "x", tintColor: "red", style: { tintColor: "blue" } }, asset, "android").tintColor).toBe("red");
  const symbol = expoImageProps({ source: "sf:star", style: [{ fontSize: 20, fontWeight: 600, color: "orange" }, { margin: 2 }] }, asset, "android");
  expect(symbol).toMatchObject({ contentFit: "contain", symbolWeight: "600", symbolSize: 20, tintColor: "orange", style: { width: 20, height: 20, margin: 2 } });
  expect(symbol.style).not.toHaveProperty("fontSize");
  expect(resolveSfEffect("bounce")).toEqual([{ effect: "bounce" }]);
  expect(resolveSfEffect([{ effect: "pulse", repeat: 2 }, "scale"])).toEqual([{ effect: "pulse", repeat: 2 }, { effect: "scale" }]);
  expect(resolveSfEffect(null)).toBeNull();
});

test("an image the native module loaded is given to the view as its shared object id", () => {
  expect(expoImageProps({ source: { nativeRefType: "image", __expo_shared_object_id__: 9 } }, asset, "android").source).toBe(9);
  expect(expoImageProps({ source: [{ uri: "a" }, "b"] }, asset, "android").source).toEqual([{ uri: "a" }, { uri: "b" }]);
});

test("shadows follow the platform as ExpoImage.render does: Android keeps elevation and loses the shadow props, iOS the other way", () => {
  const style = [{ width: 10, shadowColor: "#000", shadowOffset: { width: 1, height: 2 }, shadowOpacity: 0.5, shadowRadius: 4, elevation: 6, borderRadius: 3 }];
  const asset = () => null;
  expect((expoImageProps({ style }, asset, "android").style as Record<string, unknown>)).toEqual({ width: 10, elevation: 6, borderRadius: 3 });
  expect((expoImageProps({ style }, asset, "ios").style as Record<string, unknown>)).toEqual({
    width: 10, shadowColor: "#000", shadowOffset: { width: 1, height: 2 }, shadowOpacity: 0.5, shadowRadius: 4, borderRadius: 3,
  });
  // The caller's style is not changed.
  expect((style[0] as Record<string, unknown>).elevation).toBe(6);
});

test("the native event handlers: load, progress and error always, display only when the caller asks for it", () => {
  const log: string[] = [];
  expect(Object.keys(expoImageHandlers({}))).toEqual(["onLoadStart", "onLoad", "onProgress", "onError"]);
  const handlers = expoImageHandlers({ onLoad: () => log.push("load"), onLoadEnd: () => log.push("end"), onDisplay: () => log.push("display") });
  expect(Object.keys(handlers)).toEqual(["onLoadStart", "onLoad", "onProgress", "onError", "onDisplay"]);
  handlers.onLoad?.({ nativeEvent: {} });
  handlers.onDisplay?.({ nativeEvent: {} });
  expect(log).toEqual(["load", "end", "display"]);
});

// The harness is created at module scope, outside the per-test restore of `support/preload.ts`: the file puts the global object back itself.
afterAll(restoreStrays);
