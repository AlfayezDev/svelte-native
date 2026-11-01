import { test, expect } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import ts from "typescript";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { reactNativeConverters } from "./rn-reference.ts";
import { specOf } from "./foreign-harness.ts";

/**
 * Foreign views on the JavaScript side (SPEC.md, "Foreign views"): the host mounts a component by its Fabric name,
 * tells the engine about it before the first commit, routes commands by whether the node is the engine's or React
 * Native's, and the three Svelte components (WebView, MapView + Marker, ForeignView) put the props the native side expects
 * on the node. The native halves (C++ delegate, Kotlin frame) are device work.
 */
type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
const calls: string[] = [];
let roots: Record<number, FakeNode[]> = {};
let handler: ((target: unknown, type: string, event: object) => void) | undefined;
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown> | null, target: unknown) { calls.push(`create ${name}`); return { tag, name, props: { ...props }, children: [], sealed: false, target }; },
  cloneNodeWithNewChildren(node: FakeNode) { return { ...node, children: [], sealed: false }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneProps ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneBoth ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
  appendChild(parent: FakeNode, child: FakeNode) { parent.children.push(child); },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) { roots[root] = set.children; },
  measure() {},
  measureInWindow() {},
  dispatchCommand(node: FakeNode, name: string, args: unknown[]) { calls.push(`fabric.dispatchCommand ${node.name} ${name} ${JSON.stringify(args)}`); },
  setNativeProps(node: FakeNode, props: object) { calls.push(`fabric.setNativeProps ${node.name} ${JSON.stringify(props)}`); },
  registerEventHandler(next: typeof handler) { handler = next; },
};
const engine = {
  install: () => true,
  dispatchCommand: (tag: number, name: string, args: unknown[]) => { calls.push(`engine.dispatchCommand ${tag} ${name} ${JSON.stringify(args)}`); },
  setNativeProps: (tag: number, props: object) => { calls.push(`engine.setNativeProps ${tag} ${JSON.stringify(props)}`); },
  registerForeign: (name: string) => { calls.push(`engine.registerForeign ${name}`); return true; },
};
const callable: Record<string, () => Record<string, (event: object) => void>> = {};
const answers: [boolean, number][] = [];
(globalThis as Record<string, unknown>).nativeFabricUIManager = fake;
(globalThis as Record<string, unknown>).RN$registerCallableModule = (name: string, factory: () => Record<string, (event: object) => void>) => { callable[name] = factory; };
(globalThis as Record<string, unknown>).expo = {
  getViewConfig: (moduleName: string, viewName: string) => {
    if (moduleName === "Thing" && viewName === "View") return { validAttributes: { someProp: true }, directEventTypes: { topSomethingHappened: { registrationName: "onSomethingHappened" } } };
    // expo-video's two native views declare the same props and events.
    if (moduleName === "ExpoVideo" && (viewName === "SurfaceVideoView" || viewName === "TextureVideoView")) return { validAttributes: { player: true, nativeControls: true, contentFit: true }, directEventTypes: { topFirstFrameRender: { registrationName: "onFirstFrameRender" } } };
    return null;
  },
};

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/TurboModule/TurboModuleRegistry": "export const getEnforcing = (name) => globalThis.__webViewModule(name);",
  "react-native/Libraries/Linking/Linking": "export default { openURL: (url) => { globalThis.__opened.push(url); return Promise.resolve(); } };",
  "expo-modules-core": "export const requireOptionalNativeModule = (name) => (name === 'SvelteEngine' ? globalThis.__engine : null);",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};
(globalThis as Record<string, unknown>).__engine = engine;
(globalThis as Record<string, unknown>).__opened = [] as string[];
(globalThis as Record<string, unknown>).__webViewModule = (name: string) => name === "RNMapsAirModule"
  ? { getCamera: (tag: number) => Promise.resolve({ center: { latitude: tag, longitude: 2 }, zoom: 5, pitch: 0, heading: 0 }) }
  : { shouldStartLoadWithLockIdentifier: (shouldStart: boolean, lock: number) => answers.push([shouldStart, lock]) };

async function load() {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './foreign-fixture.svelte';
        import { startSurface } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export * as foreign from '../src/fabric/foreign.ts';
        export * as configs from '../src/fabric/view-configs.ts';
        export { startSurface, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    plugins: [...reactNativeConverters("android"), {
      name: "foreign-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-foreign-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}
const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((n) => [...(n.name === name ? [n] : []), ...find(n.children, name)]);
const settle = async (m: { tick: () => Promise<void> }) => { await m.tick(); await Promise.resolve(); await Promise.resolve(); };

type Commands = { dispatchCommand: (name: string, args?: unknown[]) => void };
type App = {
  setHtml: (html: string) => void; messageLog: () => string[]; loadLog: () => string[][]; requestLog: () => string[]; deny: (value: boolean) => void;
  webView: () => (Record<string, (...args: unknown[]) => void> & { host: Commands }) | null;
  map: () => (Record<string, (...args: unknown[]) => void> & { host: Commands }) | null;
  engineView: () => Commands | null;
  foreignChild: () => Commands | null;
  panCount: () => number;
  setSurface: (type: "surfaceView" | "textureView") => void; firstFrames: () => number;
};

let m: Awaited<ReturnType<typeof load>>;
let app: App;
test("the host mounts foreign components by name, with the props their view configs list, and tells the engine first", async () => {
  m = await load();
  calls.length = 0; roots = {};
  app = m.startSurface(21, m.Fixture, {}) as App;
  const web = find(roots[21], "RNCWebView")[0];
  let map = find(roots[21], "RNMapsMapView")[0];
  expect(web).toBeDefined();
  expect(map).toBeDefined();
  // The map's children wait for its `onMapReady`, as react-native-maps' own component does (a marker added earlier makes the native map throw).
  expect(map.children).toEqual([]);
  expect(find(roots[21], "RNMapsMarker")).toEqual([]);
  handler?.(map.target, "topMapReady", {});
  await settle(m);
  map = find(roots[21], "RNMapsMapView")[0];
  const marker = find(roots[21], "RNMapsMarker")[0];
  expect(marker).toBeDefined();
  // The marker is a child of the map in the shadow tree, next to a plain view.
  expect(map.children.map((n) => n.name)).toEqual(["RNMapsMarker", "RCTView"]);
  // Each name is registered with the engine once, before the first node of it is created.
  expect(calls.filter((c) => c.startsWith("engine.registerForeign"))).toEqual([
    "engine.registerForeign RNCWebView", "engine.registerForeign RNMapsMapView", "engine.registerForeign ViewManagerAdapter_Thing_View",
    "engine.registerForeign ViewManagerAdapter_ExpoVideo_SurfaceVideoView", "engine.registerForeign RNMapsMarker",
  ]);
  for (const name of ["RNCWebView", "RNMapsMapView", "RNMapsMarker", "ViewManagerAdapter_ExpoVideo_SurfaceVideoView"]) {
    expect(calls.indexOf(`engine.registerForeign ${name}`), name).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf(`engine.registerForeign ${name}`), name).toBeLessThan(calls.indexOf(`create ${name}`));
  }
  // The WebView's props: the defaults of react-native-webview's component, the source with its headers as a list, the messaging name, the style flattened.
  expect(web.props.newSource).toEqual({ html: "<p>one</p>", headers: [{ name: "a", value: "b" }] });
  expect(web.props.messagingEnabled).toBe(true);
  expect(String(web.props.messagingModuleName)).toMatch(/^WebViewMessageHandler\d+$/);
  expect(web.props.javaScriptEnabled).toBe(true);
  expect(web.props.height).toBe(200);
  expect(web.props.backgroundColor).toBeDefined();
  for (const key of ["component", "ref", "nativeProps", "children", "onMessage", "source", "originWhitelist"]) expect(key in web.props, key).toBe(false);
  // The map and the marker: their own props, objects as they are, colours converted.
  expect(map.props.initialRegion).toEqual({ latitude: 1, longitude: 2, latitudeDelta: 0.1, longitudeDelta: 0.1 });
  // A pan handler asks the native map to send pans, as react-native-maps' own component does.
  expect(map.props.handlePanDrag).toBe(true);
  expect(marker.props.coordinate).toEqual({ latitude: 1, longitude: 2 });
  expect(marker.props.title).toBe("Here");
  expect(typeof marker.props.pinColor).toBe("number");
});

test("props and sources update through a clone of the same node", async () => {
  calls.length = 0;
  app.setHtml("<p>two</p>");
  await settle(m);
  expect(calls.filter((c) => c.startsWith("create"))).toEqual([]);
  const web = find(roots[21], "RNCWebView")[0];
  expect(web.props.newSource).toEqual({ html: "<p>two</p>", headers: [{ name: "a", value: "b" }] });
});

test("commands go to the engine for its views and through Fabric for foreign views and what is inside them", async () => {
  calls.length = 0;
  app.engineView()?.dispatchCommand("focus", []);
  expect(calls).toEqual([expect.stringMatching(/^engine\.dispatchCommand \d+ focus \[\]$/)]);

  calls.length = 0;
  app.webView()?.injectJavaScript("1 + 1");
  app.webView()?.reload();
  app.webView()?.postMessage("hello");
  expect(calls).toEqual([
    'fabric.dispatchCommand RNCWebView injectJavaScript ["1 + 1"]',
    "fabric.dispatchCommand RNCWebView reload []",
    'fabric.dispatchCommand RNCWebView postMessage ["hello"]',
  ]);

  calls.length = 0;
  app.map()?.animateToRegion({ latitude: 3, longitude: 4, latitudeDelta: 1, longitudeDelta: 1 }, 100);
  app.map()?.fitToCoordinates([{ latitude: 1, longitude: 2 }], { top: 5 }, false);
  expect(calls).toEqual([
    'fabric.dispatchCommand RNMapsMapView animateToRegion ["{\\"latitude\\":3,\\"longitude\\":4,\\"latitudeDelta\\":1,\\"longitudeDelta\\":1}",100]',
    'fabric.dispatchCommand RNMapsMapView fitToCoordinates ["[{\\"latitude\\":1,\\"longitude\\":2}]","{\\"top\\":5,\\"right\\":0,\\"bottom\\":0,\\"left\\":0}",false]',
  ]);

  // A plain view inside a foreign view is mounted by React Native too, so it is commanded through Fabric as well.
  calls.length = 0;
  app.foreignChild()?.dispatchCommand("anything", [1]);
  expect(calls).toEqual(['fabric.dispatchCommand RCTView anything [1]']);
});

test("events of a foreign view reach the handlers by the registration names of its config", async () => {
  const web = find(roots[21], "RNCWebView")[0];
  handler?.(web.target, "topLoadingStart", { url: "about:blank" });
  handler?.(web.target, "topLoadingFinish", { url: "about:blank" });
  expect(app.loadLog()).toEqual([["start", "about:blank"], ["load", "about:blank"], ["end", "about:blank"]]);
  expect(m.configs.viewConfigFor("RNCWebView", "android").events.get("topMessage")).toBe("onMessage");
  expect(m.configs.viewConfigFor("RNMapsMapView", "android").events.get("topRegionChangeComplete")).toBe("onRegionChangeComplete");
  const map = find(roots[21], "RNMapsMapView")[0];
  handler?.(map.target, "topPanDrag", {});
  handler?.(map.target, "topPanDrag", {});
  expect(app.panCount()).toBe(2);
});

test("messages and navigation requests come through the callable module, by the instance's messaging name", async () => {
  const web = find(roots[21], "RNCWebView")[0];
  const name = String(web.props.messagingModuleName);
  expect(typeof callable.RNCWebViewMessagingModule).toBe("function");
  const module = callable.RNCWebViewMessagingModule();
  module.onMessage({ nativeEvent: { data: "from the page" }, messagingModuleName: name });
  module.onMessage({ nativeEvent: { data: "someone else's" }, messagingModuleName: "WebViewMessageHandler999" });
  expect(app.messageLog()).toEqual(["from the page"]);

  // An http page passes the whitelist and the handler: the native view is answered with its lock.
  module.onShouldStartLoadWithRequest({ nativeEvent: { url: "https://example.com/a", lockIdentifier: 7 }, messagingModuleName: name });
  expect(answers.at(-1)).toEqual([true, 7]);
  app.deny(true);
  module.onShouldStartLoadWithRequest({ nativeEvent: { url: "https://example.com/b", lockIdentifier: 8 }, messagingModuleName: name });
  expect(answers.at(-1)).toEqual([false, 8]);
  app.deny(false);
  // A scheme outside the whitelist is refused and handed to the system, without asking the handler.
  const before = app.requestLog().length;
  module.onShouldStartLoadWithRequest({ nativeEvent: { url: "intent://x", lockIdentifier: 9 }, messagingModuleName: name });
  expect(answers.at(-1)).toEqual([false, 9]);
  expect((globalThis as { __opened: string[] }).__opened).toEqual(["intent://x"]);
  expect(app.requestLog()).toHaveLength(before);
});

test("an Expo module's view takes its config from the module and a name with its adapter prefix", () => {
  const name = m.foreign.expoViewName("Thing", "View");
  expect(name).toBe("ViewManagerAdapter_Thing_View");
  expect(m.configs.viewConfigFor(name, "android").events.get("topSomethingHappened")).toBe("onSomethingHappened");
  expect(m.configs.createPayload({ someProp: 3, ignored: 1 }, m.configs.viewConfigFor(name, "android"))).toEqual({ someProp: 3 });
  expect(() => m.foreign.expoViewName("Thing", "Missing")).toThrow("has no view Missing");
  expect(m.foreign.sharedObjectId({ __expo_shared_object_id__: 12 })).toBe(12);
  expect(m.foreign.sharedObjectId(5)).toBe(5);
  expect(m.foreign.sharedObjectId(null)).toBeNull();
  expect(m.foreign.sharedObjectId({})).toBeNull();
});

test("the video view mounts the Expo view of its surface type, takes the player's shared object id and reports its events", async () => {
  const video = find(roots[21], "ViewManagerAdapter_ExpoVideo_SurfaceVideoView")[0];
  expect(video).toBeDefined();
  expect(video.props.player).toBe(7);
  expect(video.props.nativeControls).toBe(false);
  expect("surfaceType" in video.props).toBe(false);
  handler?.(video.target, "topFirstFrameRender", {});
  expect(app.firstFrames()).toBe(1);
  // The other surface is another native view: the component is replaced and the engine is told its name before it is created.
  calls.length = 0;
  app.setSurface("textureView");
  await settle(m);
  expect(find(roots[21], "ViewManagerAdapter_ExpoVideo_SurfaceVideoView")).toEqual([]);
  expect(find(roots[21], "ViewManagerAdapter_ExpoVideo_TextureVideoView")[0]?.props.player).toBe(7);
  expect(calls.indexOf("engine.registerForeign ViewManagerAdapter_ExpoVideo_TextureVideoView")).toBeLessThan(calls.indexOf("create ViewManagerAdapter_ExpoVideo_TextureVideoView"));
  expect(m.foreign.sharedObjectId({ __expo_shared_object_id__: 9 })).toBe(9);
  expect(m.foreign.sharedObjectId(undefined)).toBeNull();
});

test("the map handle reads the camera back through the library's TurboModule, by the view's tag", async () => {
  const handle = m.foreign.mapHandle({ tag: 7, dispatchCommand: () => {} });
  expect(await handle.getCamera()).toEqual({ center: { latitude: 7, longitude: 2 }, zoom: 5, pitch: 0, heading: 0 });
});

test("origin whitelist and source conversion follow react-native-webview", () => {
  const { passesOriginWhitelist, nativeWebViewSource } = m.foreign;
  expect(passesOriginWhitelist(["http://*", "https://*"], "https://example.com/path?q=1")).toBe(true);
  expect(passesOriginWhitelist(["https://*"], "http://example.com")).toBe(false);
  expect(passesOriginWhitelist([], "about:blank")).toBe(true);
  expect(passesOriginWhitelist(["https://*.example.com"], "https://a.example.com")).toBe(true);
  expect(passesOriginWhitelist(["https://*.example.com"], "https://example.org")).toBe(false);
  expect(nativeWebViewSource(undefined, () => null)).toBeUndefined();
  expect(nativeWebViewSource({ uri: "https://a" }, () => null)).toEqual({ uri: "https://a" });
  expect(nativeWebViewSource(3, () => ({ uri: "asset:/x" }))).toEqual({ uri: "asset:/x" });
  expect(nativeWebViewSource(3, () => null)).toBeUndefined();
});

// The attribute tables are what each library's codegen spec declares: every prop of the spec that is not an event handler
// is an attribute, every handler is an event of the same name, and nothing else is in the table.
const modules = resolve(import.meta.dirname, "../../../node_modules");
const kinds: [string, string, string, string][] = [
  ["RNCWebView", "react-native-webview/src/RNCWebViewNativeComponent.ts", "NativeProps", "react-native-webview"],
  ["RNMapsMapView", "react-native-maps/src/specs/NativeComponentMapView.ts", "MapFabricNativeProps", "react-native-maps"],
  ["RNMapsMarker", "react-native-maps/src/specs/NativeComponentMarker.ts", "MarkerFabricNativeProps", "react-native-maps"],
  ["RCTVideo", "react-native-video/src/specs/VideoNativeComponent.ts", "VideoNativeProps", "react-native-video"],
  ["LottieAnimationView", "lottie-react-native/src/specs/LottieAnimationViewNativeComponent.ts", "NativeProps", "lottie-react-native"],
];
for (const [name, file, interfaceName] of kinds) {
  test(`the static config of ${name} lists exactly the props and events its spec declares`, () => {
    const spec = specOf(file, interfaceName);
    expect(spec.viewProps).toBe(true);
    const config = m.configs.viewConfigFor(name, "android");
    expect(config.foreign).toBe(false);
    const attributes = Object.keys(config.attributes);
    const base = Object.keys(m.configs.viewConfigFor("RCTView", "android").attributes);
    // What the config adds to a view's attributes is the spec's non-handler props (a handler prop is sent only by the view's own list when it is in the generated config, which Android's is not).
    const own = attributes.filter((key) => !base.includes(key)).sort();
    const wanted = spec.props.filter((key) => !base.includes(key)).sort();
    expect(own).toEqual(wanted);
    const events = [...config.events.values()].filter((registration) => spec.handlers.includes(registration)).sort();
    const declared = spec.handlers.filter((handlerName) => [...config.events.values()].includes(handlerName)).sort();
    expect(events).toEqual(declared);
    // Every event the config knows (beyond the view's own) is a handler of the spec.
    const viewEvents = new Set(m.configs.viewConfigFor("RCTView", "android").events.values());
    for (const registration of config.events.values()) if (!viewEvents.has(registration)) expect(spec.handlers, `${name} ${registration}`).toContain(registration);
    // And every handler of the spec is an event of the config.
    const known = new Set(config.events.values());
    expect(spec.handlers.filter((handlerName) => !known.has(handlerName)), `${name} handlers without an event`).toEqual([]);
  });
}

// The view managers React Native creates on demand are listed by name in `app.config.ts`; a name that drifts from the
// package's own would leave a component without a manager, so the names are read back from the packages' sources.
test("the on-demand view manager names are the ones the packages register", async () => {
  const { default: config } = await import("../../../apps/platform/app.config.ts");
  const entry = config.plugins.find((plugin): plugin is [string, { androidOnDemandViewManagers: Record<string, string[]> }] => Array.isArray(plugin) && plugin[0] === "@rasheed/svelte-native/expo");
  const listed = entry?.[1].androidOnDemandViewManagers ?? {};
  expect(Object.keys(listed).sort()).toEqual([
    "com.airbnb.android.react.lottie.LottiePackage", "com.brentvatne.react.ReactVideoPackage", "com.horcrux.svg.SvgPackage", "com.reactnativecommunity.webview.RNCWebViewPackage", "com.reactnativefastshadow.FastShadowPackage",
    "com.reactnativereanimatedtext.ReanimatedTextPackage", "com.rivereactnative.RiveReactNativePackage", "com.rnmaps.maps.MapsPackage", "org.wonday.pdf.RNPDFPackage",
  ]);

  const maps = resolve(modules, "react-native-maps/android/src/main/java/com/rnmaps");
  const mapsSource = ts.sys.readFile(resolve(maps, "maps/MapsPackage.java")) ?? "";
  const created = [...new Set([...mapsSource.matchAll(/new (\w+Manager)\(/g)].map((match) => match[1]))];
  const fabricNames = created.flatMap((manager) => {
    const source = ts.sys.readFile(resolve(maps, `fabric/${manager}.java`));
    return source === undefined ? [] : [...source.matchAll(/String REACT_CLASS = "(\w+)"/g)].map((match) => match[1]);
  });
  // Fabric components only: the old architecture managers (`maps/*Manager.java`) have no component descriptor.
  expect([...listed["com.rnmaps.maps.MapsPackage"]].sort()).toEqual([...fabricNames].sort());
  expect(fabricNames).toContain("RNMapsMapView");

  const webview = ts.sys.readFile(resolve(modules, "react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewManagerImpl.kt")) ?? "";
  expect(listed["com.reactnativecommunity.webview.RNCWebViewPackage"]).toEqual([/const val NAME = "(\w+)"/.exec(webview)?.[1]]);

  // react-native-video and lottie-react-native: one view manager each, and the package kind decides which wrapper React Native gets.
  const video = resolve(modules, "react-native-video/android/src/main/java/com/brentvatne");
  expect(listed["com.brentvatne.react.ReactVideoPackage"]).toEqual([/REACT_CLASS = "(\w+)"/.exec(ts.sys.readFile(resolve(video, "exoplayer/ReactExoplayerViewManager.kt")) ?? "")?.[1]]);
  // Plain packages (`ReactPackage`), whose modules come from `createNativeModules`: the video package's `VideoManager` is one of them.
  const videoPackage = ts.sys.readFile(resolve(video, "react/ReactVideoPackage.kt")) ?? "";
  expect(videoPackage).toMatch(/class ReactVideoPackage\([^)]*\) : ReactPackage\b/);
  expect(videoPackage).toContain("VideoManagerModule(reactContext)");
  const lottie = resolve(modules, "lottie-react-native/android/src/main/java/com/airbnb/android/react/lottie");
  expect(listed["com.airbnb.android.react.lottie.LottiePackage"]).toEqual([/REACT_CLASS = "(\w+)"/.exec(ts.sys.readFile(resolve(lottie, "LottieAnimationViewManagerImpl.kt")) ?? "")?.[1]]);
  expect(ts.sys.readFile(resolve(lottie, "LottiePackage.kt"))).toMatch(/class LottiePackage : ReactPackage\b/);
  expect(ts.sys.readFile(resolve(modules, "react-native-pdf/android/src/main/java/org/wonday/pdf/RNPDFPackage.java"))).toMatch(/class RNPDFPackage implements ReactPackage\b/);

  // The four packages after them: plain `ReactPackage`s too (Rive's native modules come from `createNativeModules`), one view manager each.
  const pdf = ts.sys.readFile(resolve(modules, "react-native-pdf/android/src/main/java/org/wonday/pdf/PdfManager.java")) ?? "";
  expect(listed["org.wonday.pdf.RNPDFPackage"]).toEqual([/REACT_CLASS = "(\w+)"/.exec(pdf)?.[1]]);
  const rive = resolve(modules, "rive-react-native/android/src/main/java/com/rivereactnative");
  expect(listed["com.rivereactnative.RiveReactNativePackage"]).toEqual([/override fun getName\(\) = "(\w+)"/.exec(ts.sys.readFile(resolve(rive, "RiveReactNativeViewManager.kt")) ?? "")?.[1]]);
  const rivePackage = ts.sys.readFile(resolve(rive, "RiveReactNativePackage.kt")) ?? "";
  expect(rivePackage).toMatch(/class RiveReactNativePackage : ReactPackage\b/);
  expect(rivePackage).toContain("RiveReactNativeRendererModule(reactContext), RiveReactNativeModule(reactContext)");
  const shadow = resolve(modules, "react-native-fast-shadow/android/src/main/java/com/reactnativefastshadow");
  expect(listed["com.reactnativefastshadow.FastShadowPackage"]).toEqual([/REACT_CLASS = "(\w+)"/.exec(ts.sys.readFile(resolve(shadow, "FastShadowViewManager.java")) ?? "")?.[1]]);
  expect(ts.sys.readFile(resolve(shadow, "FastShadowPackage.java"))).toMatch(/class FastShadowPackage implements ReactPackage\b/);
  const text = resolve(modules, "react-native-animateable-text/android/src/main/java/com/reactnativereanimatedtext");
  expect(listed["com.reactnativereanimatedtext.ReanimatedTextPackage"]).toEqual([/REACT_CLASS = "(\w+)"/.exec(ts.sys.readFile(resolve(text, "JBAnimatedTextViewManager.java")) ?? "")?.[1]]);
  expect(ts.sys.readFile(resolve(text, "ReanimatedTextPackage.kt"))).toMatch(/class ReanimatedTextPackage : ReactPackage\b/);
  // react-native-svg: a `BaseReactPackage` (the wrapper serves its two TurboModules as before) with one view manager per Fabric component; the names are the
  // `REACT_CLASS` of each manager in `RenderableViewManager` and `SvgViewManager`.
  const svg = resolve(modules, "react-native-svg/android/src/main/java/com/horcrux/svg");
  const svgManagers = [...(ts.sys.readFile(resolve(svg, "RenderableViewManager.java")) ?? "").matchAll(/REACT_CLASS = "(\w+)"/g), ...(ts.sys.readFile(resolve(svg, "SvgViewManager.java")) ?? "").matchAll(/REACT_CLASS = "(\w+)"/g)].map((match) => match[1]);
  expect(svgManagers.length).toBe(29);
  expect([...listed["com.horcrux.svg.SvgPackage"]].sort()).toEqual([...svgManagers].sort());
  expect(ts.sys.readFile(resolve(svg, "SvgPackage.java"))).toMatch(/class SvgPackage extends BaseReactPackage implements ViewManagerOnDemandReactPackage/);
  // react-native-view-shot and react-native-blob-util have no view, so nothing of theirs is deferred.
  for (const key of Object.keys(listed)) expect(key).not.toMatch(/viewshot|ReactNativeBlobUtil/);
});
