import { expect, test } from "bun:test";
import { createHarness, find, settle } from "./foreign-harness.ts";
import { generateHeaderForNative, selectedTrack, videoSource, videoViewType, ViewType } from "../src/fabric/foreign-video.ts";

/**
 * react-native-video 6 (SPEC.md, "Foreign views"): `RCTVideo` is a legacy view manager, mounted by name through React Native's
 * Fabric interop. The component builds `src` the way the library's `Video.tsx` does, maps the callbacks to the view's `onVideo*`
 * events and calls the library's `VideoManager` module with the view's tag for `seek` and the other functions of its ref.
 */
type Handle = { seek(time: number, tolerance?: number): void; pause(): Promise<void>; resume(): Promise<void>; setVolume(volume: number): Promise<void>; getCurrentPosition(): Promise<number>; setSource(source?: unknown): Promise<void>; host: { tag: number } };
type App = { setPaused(paused: boolean): void; setSource(source: unknown): void; eventLog(): unknown[][]; videoHandle(): Handle | null };

function manager() {
  const calls: unknown[][] = [];
  const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); return undefined; };
  return {
    calls,
    module: {
      seekCmd: record("seekCmd"), setPlayerPauseStateCmd: record("setPlayerPauseStateCmd"), setVolumeCmd: record("setVolumeCmd"), setFullScreenCmd: record("setFullScreenCmd"),
      setSourceCmd: record("setSourceCmd"), enterPictureInPictureCmd: record("enterPictureInPictureCmd"), exitPictureInPictureCmd: record("exitPictureInPictureCmd"),
      getCurrentPosition: (tag: number) => { calls.push(["getCurrentPosition", tag]); return 4200; },
    },
  };
}

test("the component mounts RCTVideo with the library's native props, the engine told first, and a poster above it", async () => {
  const video = manager();
  const harness = createHarness("android", { natives: { modules: { VideoManager: video.module }, assets: { 9: { uri: "asset:/clip.mp4" } } } });
  const loaded = await harness.load("foreign-video-fixture.svelte");
  const app = loaded.startSurface(61, loaded.Fixture, {}) as App;
  const roots = harness.roots()[61];
  const native = find(roots, "RCTVideo")[0];
  expect(native).toBeDefined();
  const container = find(roots, "RCTView").find((node) => node.children.includes(native));
  // The view fills a container that carries the style; the poster is an image beside it until the first frame.
  expect(container?.props.height).toBe(120);
  expect(container?.children.map((node) => node.name)).toEqual(["RCTVideo", "RCTImageView"]);
  expect(harness.calls.indexOf("engine.registerForeign RCTVideo")).toBeGreaterThanOrEqual(0);
  expect(harness.calls.indexOf("engine.registerForeign RCTVideo")).toBeLessThan(harness.calls.indexOf("create RCTVideo"));
  expect(native.props.src).toEqual({
    uri: "https://example.com/v.mp4", isNetwork: true, isAsset: false, isLocalAssetFile: false, shouldCache: false, type: "", mainVer: 0, patchVer: 0,
    requestHeaders: [{ key: "a", value: "b" }], startPosition: -1,
  });
  expect(native.props).toMatchObject({
    paused: false, muted: true, repeat: true, resizeMode: "cover", rate: 1.5, volume: 0.5, controls: true, viewType: ViewType.SURFACE,
    selectedTextTrack: { type: "index", value: "2" }, position: "absolute", left: 0, top: 0, right: 0, bottom: 0,
  });
  // The shutter colour is converted (signed ARGB on Android); the component's own props and callbacks are not the view's.
  expect(native.props.shutterColor).toBe(-15654349);
  for (const key of ["source", "poster", "onLoad", "onProgress", "onEnd", "onError", "onReadyForDisplay", "ref", "nativeProps", "component"]) expect(key in native.props, key).toBe(false);
  // Handlers stay in JavaScript (the host registers them by the view config's event names); the native view emits every event.
  expect(Object.keys(native.props).filter((key) => /^on[A-Z]/.test(key))).toEqual([]);

  // Events reach the callbacks, with the event's payload as the argument; the first frame takes the poster away.
  harness.emit(native.target, "topVideoLoadStart", {});
  harness.emit(native.target, "topVideoLoad", { duration: 3.5 });
  harness.emit(native.target, "topVideoProgress", { currentTime: 1.25 });
  harness.emit(native.target, "topVideoError", { error: { errorString: "boom" } });
  harness.emit(native.target, "topVideoEnd", {});
  expect(app.eventLog()).toEqual([["loadStart"], ["load", 3.5], ["progress", 1.25], ["error", "boom"], ["end"]]);
  // The text track data loses the `target` the native event carries (Video.tsx deletes it from a copy).
  const trackEvent = { subtitleTracks: [{ text: "hello" }], target: 61 };
  harness.emit(native.target, "topTextTrackDataChanged", trackEvent);
  expect(app.eventLog().at(-1)).toEqual(["trackData", { subtitleTracks: [{ text: "hello" }] }]);
  expect(trackEvent.target).toBe(61);
  harness.emit(native.target, "topReadyForDisplay", {});
  await settle(loaded);
  expect(app.eventLog().at(-1)).toEqual(["ready"]);
  expect(find(harness.roots()[61], "RCTImageView")).toEqual([]);

  // A prop is a clone of the same node.
  harness.calls.length = 0;
  app.setPaused(true);
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(find(harness.roots()[61], "RCTVideo")[0].props.paused).toBe(true);

  // The ref's functions call the library's module with the view's tag.
  const handle = app.videoHandle() as Handle;
  expect(handle.host.tag).toBe(native.tag);
  handle.seek(12.5, 1);
  handle.seek(3);
  await handle.pause();
  await handle.resume();
  await handle.setVolume(0.25);
  expect(await handle.getCurrentPosition()).toBe(4200);
  expect(() => handle.seek(Number.NaN)).toThrow("Specified time is not a number");
  expect(video.calls).toEqual([
    ["seekCmd", native.tag, 12.5, 1], ["seekCmd", native.tag, 3, 0],
    ["setPlayerPauseStateCmd", native.tag, true], ["setPlayerPauseStateCmd", native.tag, false], ["setVolumeCmd", native.tag, 0.25], ["getCurrentPosition", native.tag],
  ]);
  // `setSource` converts the source as the prop does (an asset number becomes its URI).
  await handle.setSource(9);
  expect(video.calls.at(-1)).toMatchObject(["setSourceCmd", native.tag, { uri: "asset:/clip.mp4", isNetwork: false, isAsset: true, isLocalAssetFile: true, startPosition: -1 }]);
  // No frame commands: the library's functions go through its module, not through Fabric's command queue.
  expect(harness.calls.filter((call) => call.startsWith("fabric.dispatchCommand"))).toEqual([]);
});

test("a new source is a clone of the same node, and iOS has no view type or CMCD", async () => {
  const harness = createHarness("ios", { natives: { modules: { VideoManager: manager().module } } });
  const loaded = await harness.load("foreign-video-fixture.svelte");
  const app = loaded.startSurface(62, loaded.Fixture, {}) as App;
  harness.calls.length = 0;
  app.setSource({ uri: "file:///data/a.mp4", cmcd: true });
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  const native = find(harness.roots()[62], "RCTVideo")[0];
  expect(native.props.src).toMatchObject({ uri: "file:///data/a.mp4", isNetwork: false, isAsset: true, isLocalAssetFile: true });
  expect((native.props.src as Record<string, unknown>).cmcd).toBeUndefined();
});

test("on iOS the callbacks that were given reach the interop layer as handler props, and their events reach the callbacks", async () => {
  const harness = createHarness("ios", { natives: { modules: { VideoManager: manager().module } } });
  const loaded = await harness.load("foreign-video-fixture.svelte");
  const app = loaded.startSurface(63, loaded.Fixture, {}) as App;
  const native = find(harness.roots()[63], "RCTVideo")[0];
  // React Native's interop makes a native event block only for an event prop that is `true`; the view's block stays nil otherwise and the event is never sent.
  const handlers = Object.keys(native.props).filter((key) => /^on[A-Z]/.test(key)).sort();
  expect(handlers).toEqual(["onReadyForDisplay", "onTextTrackDataChanged", "onVideoEnd", "onVideoError", "onVideoLoad", "onVideoLoadStart", "onVideoProgress"]);
  for (const key of handlers) expect(native.props[key], key).toBe(true);
  harness.emit(native.target, "topVideoLoadStart", {});
  harness.emit(native.target, "topVideoLoad", { duration: 3.5 });
  harness.emit(native.target, "topVideoProgress", { currentTime: 1.25 });
  harness.emit(native.target, "topVideoError", { error: { errorString: "boom" } });
  harness.emit(native.target, "topVideoEnd", {});
  expect(app.eventLog()).toEqual([["loadStart"], ["load", 3.5], ["progress", 1.25], ["error", "boom"], ["end"]]);
  // A prop update keeps them: the clone carries only what changed.
  harness.calls.length = 0;
  app.setPaused(true);
  await settle(loaded);
  expect(find(harness.roots()[63], "RCTVideo")[0].props.paused).toBe(true);
  expect(Object.keys(find(harness.roots()[63], "RCTVideo")[0].props).filter((key) => /^on[A-Z]/.test(key)).sort()).toEqual(handlers);
});

test("the source conversion follows react-native-video's component", () => {
  const asset = (number: number) => (number === 1 ? { uri: "asset:/a.mp4" } : null);
  expect(videoSource(undefined, asset, "android")).toBeUndefined();
  expect(videoSource({ uri: "/data/a.mp4" }, asset, "android")).toMatchObject({ uri: "file:///data/a.mp4", isNetwork: false, isAsset: true, isLocalAssetFile: false });
  expect(videoSource({ uri: "./a.mp4" }, asset, "ios")).toMatchObject({ isLocalAssetFile: true });
  expect(videoSource({ uri: 1 }, asset, "android")).toMatchObject({ uri: "asset:/a.mp4", isLocalAssetFile: true });
  expect(videoSource(1, asset, "android")).toMatchObject({ uri: "asset:/a.mp4", isLocalAssetFile: true });
  expect(videoSource({ uri: "rtsp://x/y", startPosition: 5, type: "m3u8", shouldCache: true }, asset, "android")).toMatchObject({ isNetwork: true, startPosition: 5, type: "m3u8", shouldCache: true });
  // A field of the source wins over the component-level default.
  expect(videoSource({ uri: "https://a", minLoadRetryCount: 2 }, asset, "android", { minLoadRetryCount: 5, contentStartTime: 7 })).toMatchObject({ minLoadRetryCount: 2, contentStartTime: 7 });
  expect(videoSource({ uri: "https://a", drm: { type: "widevine", licenseServer: "https://l", headers: { k: "v" }, getLicense: () => "x" } }, asset, "android").drm).toEqual({
    type: "widevine", licenseServer: "https://l", headers: [{ key: "k", value: "v" }], contentId: undefined, certificateUrl: undefined, base64Certificate: undefined, useExternalGetLicense: true, multiDrm: undefined, localSourceEncryptionKeyScheme: undefined,
  });
  expect(videoSource({ uri: "https://a", cmcd: { request: { a: 1 } } }, asset, "android")?.cmcd).toEqual({ mode: 1, request: [{ key: "a", value: 1 }], session: undefined, object: undefined, status: undefined });
  expect(videoSource({ uri: "https://a", cmcd: true }, asset, "android")?.cmcd).toEqual({ mode: 1 });
  expect(() => videoSource({ uri: "https://a", cmcd: [] as never }, asset, "android")).toThrow("Invalid CMCD configuration");
  expect(videoSource({ uri: "https://a", ad: { type: "ssai", streamType: "live", assetKey: "k" } as never }, asset, "android")?.ad).toMatchObject({ type: "ssai", streamType: "live", assetKey: "k" });
  expect(videoSource({ uri: "https://a" }, asset, "android", { adTagUrl: "https://ads" })?.ad).toEqual({ type: "csai", adTagUrl: "https://ads", adLanguage: undefined });
  expect(generateHeaderForNative({ x: "y" })).toEqual([{ key: "x", value: "y" }]);
  expect(generateHeaderForNative(undefined)).toEqual([]);
});

test("track selections are strings and the view type follows the library's rules", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    expect(selectedTrack(undefined, "selectedTextTrack")).toBeUndefined();
    expect(selectedTrack({ type: "language", value: "en" }, "selectedTextTrack")).toEqual({ type: "language", value: "en" });
    expect(selectedTrack({ type: "index", value: 1 }, "selectedAudioTrack")).toEqual({ type: "index", value: "1" });
    expect(selectedTrack({ type: "index", value: {} as never }, "selectedAudioTrack")).toBeUndefined();
    expect(videoViewType({})).toBe(ViewType.SURFACE);
    expect(videoViewType({ useTextureView: true })).toBe(ViewType.TEXTURE);
    expect(videoViewType({ useSecureView: true })).toBe(ViewType.SURFACE_SECURE);
    expect(videoViewType({ viewType: ViewType.TEXTURE })).toBe(ViewType.TEXTURE);
    expect(videoViewType({ drm: { type: "widevine" }, useTextureView: true })).toBe(ViewType.SURFACE);
    expect(videoViewType({ drm: { type: "widevine" }, viewType: ViewType.TEXTURE, useSecureView: true })).toBe(ViewType.SURFACE_SECURE);
  } finally {
    console.warn = warn;
  }
});
