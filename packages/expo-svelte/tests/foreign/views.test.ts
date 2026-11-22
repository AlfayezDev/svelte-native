import { expect, test } from "bun:test";
import { createHarness, find, settle } from "./support/harness.ts";

/**
 * Foreign views on the JavaScript side (SPEC.md, "Foreign views"): the host mounts a component by its Fabric name,
 * tells the engine about it before the first commit, routes commands by whether the node is the engine's or React
 * Native's, and the three Svelte components (WebView, MapView + Marker, ForeignView) put the props the native side expects
 * on the node. The native halves (C++ delegate, Kotlin frame) are device work. The static view configs of these libraries are compared with
 * their own specs in `tests/upstream/foreign-view-configs.test.ts`.
 */
const camera = { center: { latitude: 7, longitude: 2 }, zoom: 5, pitch: 0, heading: 0 };
const thing = { validAttributes: { someProp: true }, directEventTypes: { topSomethingHappened: { registrationName: "onSomethingHappened" } } };
// expo-video's two native views declare the same props and events.
const videoView = { validAttributes: { player: true, nativeControls: true, contentFit: true }, directEventTypes: { topFirstFrameRender: { registrationName: "onFirstFrameRender" } } };

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

/**
 * The fixture mounted on a harness of its own: each test starts from nothing, and support puts the global object back when it ends. The map's children (a marker and a view)
 * are mounted once it has said it is ready, which a test that is not about the wait has already happened.
 */
async function mount({ mapReady = true } = {}) {
  const answers: [boolean, number][] = [];
  const harness = createHarness("android", {
    expo: { Thing: { View: thing }, ExpoVideo: { SurfaceVideoView: videoView, TextureVideoView: videoView } },
    natives: {
      turbo: {
        RNMapsAirModule: { getCamera: (tag: number) => Promise.resolve({ ...camera, center: { ...camera.center, latitude: tag } }) },
        RNCWebViewModule: { shouldStartLoadWithLockIdentifier: (shouldStart: boolean, lock: number) => answers.push([shouldStart, lock]) },
      },
    },
  });
  const loaded = await harness.load("views-fixture.svelte");
  const app = loaded.startSurface(21, loaded.Fixture, {}) as App;
  const roots = () => harness.roots()[21];
  if (mapReady) {
    harness.emit(find(roots(), "RNMapsMapView")[0].target, "topMapReady", {});
    await settle(loaded);
  }
  return { harness, loaded, app, roots, answers };
}

test("the host mounts foreign components by name, with the props their view configs list, and tells the engine first", async () => {
  const { harness, loaded, roots } = await mount({ mapReady: false });
  const web = find(roots(), "RNCWebView")[0];
  let map = find(roots(), "RNMapsMapView")[0];
  expect(web).toBeDefined();
  expect(map).toBeDefined();
  // The map's children wait for its `onMapReady`, as react-native-maps' own component does (a marker added earlier makes the native map throw).
  expect(map.children).toEqual([]);
  expect(find(roots(), "RNMapsMarker")).toEqual([]);
  harness.emit(map.target, "topMapReady", {});
  await settle(loaded);
  map = find(roots(), "RNMapsMapView")[0];
  const marker = find(roots(), "RNMapsMarker")[0];
  expect(marker).toBeDefined();
  // The marker is a child of the map in the shadow tree, next to a plain view.
  expect(map.children.map((n) => n.name)).toEqual(["RNMapsMarker", "RCTView"]);
  // Each name is registered with the engine once, before the first node of it is created.
  expect(harness.calls.filter((c) => c.startsWith("engine.registerForeign"))).toEqual([
    "engine.registerForeign RNCWebView", "engine.registerForeign RNMapsMapView", "engine.registerForeign ViewManagerAdapter_Thing_View",
    "engine.registerForeign ViewManagerAdapter_ExpoVideo_SurfaceVideoView", "engine.registerForeign RNMapsMarker",
  ]);
  harness.expectToldFirst("RNCWebView", "RNMapsMapView", "RNMapsMarker", "ViewManagerAdapter_ExpoVideo_SurfaceVideoView");
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
  const { harness, loaded, app, roots } = await mount();
  harness.calls.length = 0;
  app.setHtml("<p>two</p>");
  await settle(loaded);
  expect(harness.calls.filter((c) => c.startsWith("create"))).toEqual([]);
  const web = find(roots(), "RNCWebView")[0];
  expect(web.props.newSource).toEqual({ html: "<p>two</p>", headers: [{ name: "a", value: "b" }] });
});

test("commands go to the engine for its views and through Fabric for foreign views and what is inside them", async () => {
  const { harness, app } = await mount();
  harness.calls.length = 0;
  app.engineView()?.dispatchCommand("focus", []);
  expect(harness.calls).toEqual([expect.stringMatching(/^engine\.dispatchCommand \d+ focus \[\]$/)]);

  harness.calls.length = 0;
  app.webView()?.injectJavaScript("1 + 1");
  app.webView()?.reload();
  app.webView()?.postMessage("hello");
  expect(harness.calls).toEqual([
    'fabric.dispatchCommand RNCWebView injectJavaScript ["1 + 1"]',
    "fabric.dispatchCommand RNCWebView reload []",
    'fabric.dispatchCommand RNCWebView postMessage ["hello"]',
  ]);

  harness.calls.length = 0;
  app.map()?.animateToRegion({ latitude: 3, longitude: 4, latitudeDelta: 1, longitudeDelta: 1 }, 100);
  app.map()?.fitToCoordinates([{ latitude: 1, longitude: 2 }], { top: 5 }, false);
  expect(harness.calls).toEqual([
    'fabric.dispatchCommand RNMapsMapView animateToRegion ["{\\"latitude\\":3,\\"longitude\\":4,\\"latitudeDelta\\":1,\\"longitudeDelta\\":1}",100]',
    'fabric.dispatchCommand RNMapsMapView fitToCoordinates ["[{\\"latitude\\":1,\\"longitude\\":2}]","{\\"top\\":5,\\"right\\":0,\\"bottom\\":0,\\"left\\":0}",false]',
  ]);

  // A plain view inside a foreign view is mounted by React Native too, so it is commanded through Fabric as well.
  harness.calls.length = 0;
  app.foreignChild()?.dispatchCommand("anything", [1]);
  expect(harness.calls).toEqual(["fabric.dispatchCommand RCTView anything [1]"]);
});

test("events of a foreign view reach the handlers by the registration names of its config", async () => {
  const { harness, loaded, app, roots } = await mount();
  const web = find(roots(), "RNCWebView")[0];
  harness.emit(web.target, "topLoadingStart", { url: "about:blank" });
  harness.emit(web.target, "topLoadingFinish", { url: "about:blank" });
  expect(app.loadLog()).toEqual([["start", "about:blank"], ["load", "about:blank"], ["end", "about:blank"]]);
  expect(loaded.configs.viewConfigFor("RNCWebView", "android").events.get("topMessage")).toBe("onMessage");
  expect(loaded.configs.viewConfigFor("RNMapsMapView", "android").events.get("topRegionChangeComplete")).toBe("onRegionChangeComplete");
  const map = find(roots(), "RNMapsMapView")[0];
  harness.emit(map.target, "topPanDrag", {});
  harness.emit(map.target, "topPanDrag", {});
  expect(app.panCount()).toBe(2);
});

test("messages and navigation requests come through the callable module, by the instance's messaging name", async () => {
  const { harness, app, roots, answers } = await mount();
  const web = find(roots(), "RNCWebView")[0];
  const name = String(web.props.messagingModuleName);
  expect(typeof harness.callable.RNCWebViewMessagingModule).toBe("function");
  const module = harness.callable.RNCWebViewMessagingModule();
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
  expect(harness.natives.opened).toEqual(["intent://x"]);
  expect(app.requestLog()).toHaveLength(before);
});

test("an Expo module's view takes its config from the module and a name with its adapter prefix", async () => {
  const { loaded } = await mount();
  const name = loaded.foreign.expoViewName("Thing", "View");
  expect(name).toBe("ViewManagerAdapter_Thing_View");
  expect(loaded.configs.viewConfigFor(name, "android").events.get("topSomethingHappened")).toBe("onSomethingHappened");
  expect(loaded.configs.createPayload({ someProp: 3, ignored: 1 }, loaded.configs.viewConfigFor(name, "android"))).toEqual({ someProp: 3 });
  expect(() => loaded.foreign.expoViewName("Thing", "Missing")).toThrow("has no view Missing");
  expect(loaded.foreign.sharedObjectId({ __expo_shared_object_id__: 12 })).toBe(12);
  expect(loaded.foreign.sharedObjectId(5)).toBe(5);
  expect(loaded.foreign.sharedObjectId(null)).toBeNull();
  expect(loaded.foreign.sharedObjectId({})).toBeNull();
});

test("the video view mounts the Expo view of its surface type, takes the player's shared object id and reports its events", async () => {
  const { harness, loaded, app, roots } = await mount();
  const video = find(roots(), "ViewManagerAdapter_ExpoVideo_SurfaceVideoView")[0];
  expect(video).toBeDefined();
  expect(video.props.player).toBe(7);
  expect(video.props.nativeControls).toBe(false);
  expect("surfaceType" in video.props).toBe(false);
  harness.emit(video.target, "topFirstFrameRender", {});
  expect(app.firstFrames()).toBe(1);
  // The other surface is another native view: the component is replaced and the engine is told its name before it is created.
  harness.calls.length = 0;
  app.setSurface("textureView");
  await settle(loaded);
  expect(find(roots(), "ViewManagerAdapter_ExpoVideo_SurfaceVideoView")).toEqual([]);
  expect(find(roots(), "ViewManagerAdapter_ExpoVideo_TextureVideoView")[0]?.props.player).toBe(7);
  harness.expectToldFirst("ViewManagerAdapter_ExpoVideo_TextureVideoView");
  expect(loaded.foreign.sharedObjectId({ __expo_shared_object_id__: 9 })).toBe(9);
  expect(loaded.foreign.sharedObjectId(undefined)).toBeNull();
});

test("the map handle reads the camera back through the library's TurboModule, by the view's tag", async () => {
  const { loaded } = await mount();
  const handle = loaded.foreign.mapHandle({ tag: 7, dispatchCommand: () => {} });
  expect(await handle.getCamera()).toEqual(camera);
});

test("origin whitelist and source conversion follow react-native-webview", async () => {
  const { loaded } = await mount();
  const { passesOriginWhitelist, nativeWebViewSource } = loaded.foreign;
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
