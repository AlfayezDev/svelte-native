import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHarness, find } from "./foreign-harness.ts";
import { parseRiveColor, riveAssetSource, riveError, riveResource } from "../src/fabric/foreign-rive.ts";

/**
 * rive-react-native (SPEC.md, "Foreign views"): `RiveReactNativeView` is a legacy view manager mounted through Fabric's interop. The
 * component resolves the file as the library's container does, sends its events with the payloads the library unpacks and its `ref`
 * functions are the manager's commands, by name, with the library's arguments.
 */
const modules = resolve(import.meta.dirname, "../../../node_modules/rive-react-native");
type Handle = Record<string, (...args: unknown[]) => unknown> & { host: { tag: number } };
type App = { eventLog(): unknown[][]; riveHandle(): Handle };
const name = "RiveReactNativeView";
const assets = { 9: { uri: "animations/logo" } };

test("the container holds the children behind the view, which carries the file, the library's defaults and the converted assets", async () => {
  const harness = createHarness("android", { natives: { assets } });
  const loaded = await harness.load("foreign-rive-fixture.svelte");
  const app = loaded.startSurface(121, loaded.Fixture, {}) as App;
  const views = find(harness.roots()[121], name);
  expect(views).toHaveLength(3);
  const [first, second, third] = views;
  // A container with the style, the children in a view of their own behind the animation.
  const container = find(harness.roots()[121], "RCTView").find((node) => node.children.includes(first));
  expect(container?.children.map((node) => node.name)).toEqual(["RCTView", name]);
  expect(container?.props).toMatchObject({ height: 120, flexGrow: 1 });
  expect(find(container?.children.slice(0, 1) ?? [], "RCTRawText").map((node) => node.props.text)).toEqual(["behind"]);
  expect(container?.children[0].props).toMatchObject({ position: "absolute", width: "100%", height: "100%" });

  expect(first.props).toMatchObject({
    url: "https://cdn.rive.app/animations/vehicles.riv", artboardName: "Main", stateMachineName: "State Machine 1", fit: "cover", alignment: "topLeft", layoutScaleFactor: 2,
    autoplay: true, isUserHandlingErrors: true, dataBinding: { type: "autobind", value: false }, flex: 1,
    referencedAssets: {
      font: { source: { sourceUrl: "https://example.com/f.ttf" } }, logo: { source: { sourceAssetId: "animations/logo" } }, local: { source: { sourceAsset: "pic.png", path: "assets" } },
    },
  });
  // The second has no onError (the library then logs errors itself), a name instead of a URL, and no autoplay.
  expect(second.props).toMatchObject({ resourceName: "rating", autoplay: false, animationName: "idle", isUserHandlingErrors: false, fit: "contain", alignment: "center" });
  for (const key of ["url", "layoutScaleFactor", "referencedAssets", "artboardName"]) expect(key in second.props, key).toBe(false);
  // A `require`d asset: on Android its URI is the resource name.
  expect(third.props.resourceName).toBe("animations/logo");
  for (const key of ["source", "onPlay", "onError", "ref", "nativeProps", "component", "children"]) expect(key in first.props, key).toBe(false);
  expect(harness.calls.indexOf(`engine.registerForeign ${name}`)).toBeGreaterThanOrEqual(0);
  expect(harness.calls.indexOf(`engine.registerForeign ${name}`)).toBeLessThan(harness.calls.indexOf(`create ${name}`));
  expect(typeof app.riveHandle().host.tag).toBe("number");
});

test("on iOS the component gives the interop layer a handler prop for every event of the manager, whichever callbacks it was given, and the events reach the callbacks", async () => {
  const harness = createHarness("ios", { natives: { assets } });
  const loaded = await harness.load("foreign-rive-fixture.svelte");
  const app = loaded.startSurface(123, loaded.Fixture, {}) as App;
  const [first, second] = find(harness.roots()[123], name);
  // React Native's interop makes a native event block only for an event prop that is `true`; the view's block stays nil otherwise and the event is never sent.
  // The component gives every handler of the library, which forwards to the callbacks that exist, so the first view and the second send the same list.
  const expected = ["onError", "onLoopEnd", "onPause", "onPlay", "onRiveEventReceived", "onStateChanged", "onStop"];
  for (const view of [first, second]) {
    expect(Object.keys(view.props).filter((key) => /^on[A-Z]/.test(key)).sort()).toEqual(expected);
    for (const key of expected) expect(view.props[key], key).toBe(true);
  }
  harness.emit(first.target, "topPlay", { animationName: "idle", isStateMachine: false });
  harness.emit(first.target, "topError", { type: "FileNotFound", message: "missing" });
  expect(app.eventLog()).toEqual([["play", "idle", false], ["error", "FileNotFound", "missing"]]);
});

test("the events reach the callbacks with the library's arguments; an error of an unknown type is only warned about", async () => {
  const harness = createHarness("android", { natives: { assets } });
  const loaded = await harness.load("foreign-rive-fixture.svelte");
  const app = loaded.startSurface(122, loaded.Fixture, {}) as App;
  const [view] = find(harness.roots()[122], name);
  const warn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    harness.emit(view.target, "topPlay", { animationName: "idle", isStateMachine: false });
    harness.emit(view.target, "topPause", { animationName: "idle", isStateMachine: false });
    harness.emit(view.target, "topStop", { animationName: "", isStateMachine: true });
    harness.emit(view.target, "topLoopEnd", { animationName: "idle", loopMode: "pingPong" });
    harness.emit(view.target, "topStateChanged", { stateMachineName: "State Machine 1", stateName: "hover" });
    harness.emit(view.target, "topRiveEventReceived", { riveEvent: { name: "Click", type: 128, properties: { n: 1 } } });
    harness.emit(view.target, "topError", { type: "IncorrectArtboardName", message: "no such artboard" });
    harness.emit(view.target, "topError", { type: "Brand new", message: "?" });
  } finally {
    console.warn = warn;
  }
  expect(app.eventLog()).toEqual([
    ["play", "idle", false], ["pause", "idle", false], ["stop", "", true], ["loop", "idle", "pingPong"], ["state", "State Machine 1", "hover"],
    ["rive", { name: "Click", type: 128, properties: { n: 1 } }], ["error", "IncorrectArtboardName", "no such artboard"],
  ]);
  expect(warnings).toEqual([["[Rive] Unknown error type received from native: ", "Brand new"]]);
  const config = loaded.configs.viewConfigFor(name, "android");
  expect(config.events.get("topPlay")).toBe("onPlay");
  expect(config.events.get("topRiveEventReceived")).toBe("onRiveEventReceived");
});

const log = console.error;
beforeAll(() => { console.error = () => {}; });
afterAll(() => { console.error = log; });

test("the ref's functions are the manager's commands, in the library's names and argument order; the getters call its module with the tag", async () => {
  const calls: string[] = [];
  const state = { RiveReactNativeModule: {
    getBooleanState: (tag: number, input: string) => { calls.push(`module getBooleanState ${tag} ${input}`); return Promise.resolve(true); },
    getNumberState: (tag: number, input: string) => { calls.push(`module getNumberState ${tag} ${input}`); return Promise.resolve(4); },
    getBooleanStateAtPath: (tag: number, input: string, path: string) => { calls.push(`module getBooleanStateAtPath ${tag} ${input} ${path}`); return Promise.resolve(false); },
    getNumberStateAtPath: () => Promise.reject(new Error("no such input")),
  } };
  const harness = createHarness("android", { natives: { modules: state, assets } });
  const loaded = await harness.load("foreign-rive-fixture.svelte");
  const app = loaded.startSurface(123, loaded.Fixture, {}) as App;
  const handle = app.riveHandle();
  const warn = console.warn;
  console.warn = () => {};
  harness.calls.length = 0;
  try {
    handle.play();
    handle.play("run", "loop", "forwards", true);
    handle.pause(); handle.stop(); handle.reset();
    handle.fireState("machine", "go");
    handle.setInputState("machine", "on", true);
    handle.setInputState("machine", "level", 3);
    handle.setInputState("machine", "ignored", "x");
    handle.fireStateAtPath("go", "a/b");
    handle.setInputStateAtPath("on", false, "a/b");
    handle.setInputStateAtPath("level", 2, "a/b");
    handle.touchBegan(10, 20); handle.touchEnded(Number.NaN, 1);
    handle.setTextRunValue("title", "Hi"); handle.setTextRunValue("", "dropped"); handle.setTextRunValueAtPath("title", "Hi", "a");
    handle.setBoolean("flag", true); handle.setString("name", "n"); handle.setNumber("count", 2); handle.setEnum("mode", "dark"); handle.trigger("fire");
    handle.setColor("flag", "#ff8800cc"); handle.setColor("c", { r: 1, g: 2, b: 3, a: 4 }); handle.setColor("bad", "orange");
  } finally {
    console.warn = warn;
  }
  const dispatched = harness.calls.map((call) => call.replace("fabric.dispatchCommand RiveReactNativeView ", ""));
  expect(dispatched).toEqual([
    'play ["","auto","auto",false]', 'play ["run","loop","forwards",true]', "pause []", "stop []", "reset []",
    'fireState ["machine","go"]', 'setBooleanState ["machine","on",true]', 'setNumberState ["machine","level",3]',
    'fireStateAtPath ["go","a/b"]', 'setBooleanStateAtPath ["on",false,"a/b"]', 'setNumberStateAtPath ["level",2,"a/b"]',
    "touchBegan [10,20]", 'setTextRunValue ["title","Hi"]', 'setTextRunValueAtPath ["title","Hi","a"]',
    'setBooleanPropertyValue ["flag",true]', 'setStringPropertyValue ["name","n"]', 'setNumberPropertyValue ["count",2]', 'setEnumPropertyValue ["mode","dark"]', 'fireTriggerProperty ["fire"]',
    'setColorPropertyValue ["flag",255,136,0,204]', 'setColorPropertyValue ["c",1,2,3,4]', 'setColorPropertyValue ["bad",0,0,0,255]',
  ]);
  const tag = handle.host.tag;
  expect(await handle.getBooleanState("on")).toBe(true);
  expect(await handle.getNumberState("level")).toBe(4);
  expect(await handle.getBooleanStateAtPath("on", "a/b")).toBe(false);
  expect(await handle.getNumberStateAtPath("level", "a/b")).toBeNull(); // a failing read is logged and answers null
  expect(calls).toEqual([`module getBooleanState ${tag} on`, `module getNumberState ${tag} level`, `module getBooleanStateAtPath ${tag} on a/b`]);
});

test("a component without a file fails as the library's does", async () => {
  const harness = createHarness("android");
  const loaded = await harness.load("foreign-rive-fixture.svelte");
  expect(() => loaded.startSurface(124, loaded.Fixture, { initial: { bad: true } })).toThrow("Invalid Rive resource. Please provide a valid resource.");
});

test("the file is resolved as the library's container does", () => {
  const asset = (uri?: string) => () => (uri === undefined ? null : { uri });
  expect(riveResource({ resourceName: "a", url: "https://b", source: 1 }, asset("x"))).toEqual({ resourceName: "a" });
  expect(riveResource({ url: "https://b", source: 1 }, asset("x"))).toEqual({ url: "https://b" });
  expect(riveResource({ source: { uri: "http://localhost:8081/assets/a.riv?hash=1" } }, asset())).toEqual({ url: "http://localhost:8081/assets/a.riv?hash=1" });
  expect(riveResource({ source: 3 }, asset("rating_animation"))).toEqual({ resourceName: "rating_animation" });
  expect(riveResource({ source: 3 }, asset("file:///var/App.app/anims/a.riv"))).toEqual({ resourceName: "anims/a" });
  expect(riveResource({ source: 3 }, asset("file:///var/mobile/Documents/update/a.riv"))).toEqual({ url: "file:///var/mobile/Documents/update/a.riv" });
  expect(riveResource({ source: 3 }, asset())).toEqual({});
  expect(riveResource({}, asset("x"))).toEqual({});
  // The converted sources of referenced assets.
  expect(riveAssetSource({ uri: "https://x/y.png" }, asset())).toEqual({ sourceUrl: "https://x/y.png" });
  expect(riveAssetSource({ fileName: "f.ttf" }, asset())).toEqual({ sourceAsset: "f.ttf" });
  expect(() => riveAssetSource(4, asset())).toThrow("Invalid asset source provided.");
  expect(() => riveAssetSource({} as never, asset())).toThrow("Invalid source provided.");
  expect(riveError({ type: "MalformedFile", message: "m" })).toEqual({ type: "MalformedFile", message: "m" });
  expect(riveError({ type: "Nope", message: "m" })).toBeNull();
  expect(parseRiveColor("#0a0b0c")).toEqual({ r: 10, g: 11, b: 12, a: 255 });
});

test("the static config lists the props the Android manager sets and the events it sends, and the iOS manager's exported properties", async () => {
  const manager = readFileSync(resolve(modules, "android/src/main/java/com/rivereactnative/RiveReactNativeViewManager.kt"), "utf8");
  const view = readFileSync(resolve(modules, "android/src/main/java/com/rivereactnative/RiveReactNativeView.kt"), "utf8");
  const ios = readFileSync(resolve(modules, "ios/RiveReactNativeViewManager.m"), "utf8");
  const props = [...manager.matchAll(/@ReactProp\(name = "(\w+)"\)/g)].map((match) => match[1] as string).sort();
  const iosProps = [...ios.matchAll(/RCT_EXPORT_VIEW_PROPERTY\((\w+), (?!RCTDirectEventBlock)/g)].map((match) => match[1] as string).sort();
  const events = [...(/enum class Events[\s\S]*?;\n/.exec(view)?.[0] ?? "").matchAll(/"(on\w+)"/g)].map((match) => `top${(match[1] as string).slice(2)}`).sort();
  const iosEvents = [...ios.matchAll(/RCT_EXPORT_VIEW_PROPERTY\(on(\w+), RCTDirectEventBlock\)/g)].map((match) => `top${match[1]}`).sort();
  expect(props.length).toBeGreaterThan(10);
  expect(iosProps).toEqual(props);
  expect(iosEvents).toEqual(events);
  expect(events.length).toBe(7);
  const loaded = await createHarness("android").load("foreign-rive-fixture.svelte");
  for (const platform of ["android", "ios"] as const) {
    const config = loaded.configs.viewConfigFor(name, platform);
    const base = loaded.configs.viewConfigFor("RCTView", platform);
    // The view manager's events are props on iOS only (the interop layer builds a native event block for each handler prop it is sent).
    const handlers = platform === "ios" ? events.map((type) => `on${type.slice(3)}`) : [];
    expect(Object.keys(config.attributes).filter((key) => !(key in base.attributes)).sort(), platform).toEqual([...props, ...handlers].sort());
    const viewEvents = new Set(base.events.keys());
    expect([...config.events.keys()].filter((type) => !viewEvents.has(type)).sort(), platform).toEqual(events);
  }
});
