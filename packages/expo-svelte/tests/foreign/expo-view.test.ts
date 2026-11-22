import { expect, test } from "bun:test";
import { createHarness, find, settle, type ExpoViewConfig, type Platform } from "./support/harness.ts";

/**
 * The generic Expo view (`ExpoView`, `defineExpoView`; SPEC.md, "Foreign views"): any module's view by name, with what Expo's React adapter
 * does and nothing of a library's own JavaScript. The module here is made up (`Thing`: a view with props, events and native functions, a
 * second view with neither, and `Plain`, whose only view has no name); the native halves are device work.
 */
const NAME = "ViewManagerAdapter_Thing_View";
const configs: Record<string, Record<string, ExpoViewConfig>> = {
  Thing: {
    View: {
      validAttributes: { facing: true, zoom: true, player: true, count: true, nothing: true, settings: true },
      directEventTypes: { topReady: { registrationName: "onReady" }, topFail: { registrationName: "onFail" } },
    },
    Other: { validAttributes: { zoom: true }, directEventTypes: null },
  },
  Plain: { "": { validAttributes: { zoom: true }, directEventTypes: null } },
};
type ViewThis = { nativeTag: number };
const natives: unknown[][] = [];
// What the module object holds for the view's functions (`ViewPrototypes`): Android has one only for a view with async functions, so `Other` has none.
const expoModules = {
  Thing: {
    ViewPrototypes: {
      Thing_View: {
        takePicture(this: ViewThis, options: unknown) { natives.push(["takePicture", this.nativeTag, options]); return Promise.resolve("picture"); },
        focus(this: ViewThis) { natives.push(["focus", this.nativeTag]); },
      },
    },
  },
};
type Handle = { tag: number; nativeTag: number; takePicture(options?: unknown): Promise<string>; focus(): void; dispatchCommand(name: string, args?: unknown[]): void; position(): number[] };
type App = {
  setZoom(zoom: number): void; setModule(module: string, view: string): void; setShown(shown: boolean): void; setReady(handler: (event: unknown) => void): void; useRef(index: number): void;
  eventLog(): unknown[][]; handleLog(): (Handle | null)[]; otherHandleLog(): (Handle | null)[];
};

async function mount(platform: Platform, root: number) {
  natives.length = 0;
  const harness = createHarness(platform, { expo: configs, expoModules });
  const loaded = await harness.load("expo-view-fixture.svelte");
  const app = loaded.startSurface(root, loaded.Fixture, {}) as App;
  return { harness, loaded, app, nodes: (name = NAME) => find(harness.roots()[root] ?? [], name) };
}

for (const platform of ["android", "ios"] as const) {
  test(`${platform}: the props the view declares reach it; the others, the component's own and the handlers do not`, async () => {
    const { harness, nodes } = await mount(platform, 51);
    const view = nodes()[0];
    expect(view).toBeDefined();
    // The engine is told the name before the view is created (SPEC.md, "Foreign views").
    harness.expectToldFirst(NAME);
    expect(view.props).toMatchObject({ facing: "back", zoom: 1, count: 3, height: 100 });
    // A prop the module's view does not declare is dropped, as it is for every foreign view; so are `module`, `view`, `ref`, the handlers and `children`.
    for (const key of ["undeclared", "module", "view", "ref", "children", "component", "nativeProps", "onReady", "onFail"]) expect(key in view.props, key).toBe(false);
    // The style is the host's: its colours are converted as for any view.
    expect(typeof view.props.backgroundColor).toBe("number");
  });
}

test("a shared object is given as its id; a number, null and a nested shared object are as given", async () => {
  const { nodes } = await mount("android", 52);
  const props = nodes()[0].props;
  expect(props.player).toBe(12);
  expect(props.zoom).toBe(1);
  expect(props.count).toBe(3);
  expect(props.nothing ?? null).toBeNull();
  // Only a top-level prop is converted, as in Expo's adapter.
  expect(props.settings).toEqual({ player: { __expo_shared_object_id__: 12 } });
});

test("an event reaches the handler prop as React Native's event object with its payload, and a new handler is not a prop change", async () => {
  const { harness, loaded, app, nodes } = await mount("android", 53);
  const view = nodes()[0];
  harness.emit(view.target, "topReady", { ok: true });
  harness.emit(view.target, "topFail", { message: "no camera" });
  expect(app.eventLog()).toEqual([["ready", { nativeEvent: { ok: true } }], ["fail", { nativeEvent: { message: "no camera" } }]]);
  harness.calls.length = 0;
  app.setReady((event) => app.eventLog().push(["again", event]));
  await settle(loaded);
  harness.emit(nodes()[0].target, "topReady", { ok: false });
  expect(app.eventLog().at(-1)).toEqual(["again", { nativeEvent: { ok: false } }]);
  expect(harness.calls).toEqual([]);
});

test("children are mounted inside the native view", async () => {
  const { nodes } = await mount("android", 54);
  expect(nodes()[0].children.map((node) => node.name)).toEqual(["RCTView"]);
  expect(nodes()[0].children[0]?.props.height).toBe(4);
});

test("a prop update is a clone of the same node", async () => {
  const { harness, loaded, app, nodes } = await mount("android", 55);
  harness.calls.length = 0;
  app.setZoom(2.5);
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(nodes()[0].props.zoom).toBe(2.5);
});

test("ref: the host handle with the view's functions, which run with this.nativeTag the handle's tag", async () => {
  const { harness, loaded, app, nodes } = await mount("android", 56);
  const [handle] = app.handleLog() as Handle[];
  expect(app.handleLog()).toHaveLength(1);
  expect(handle.tag).toBe(nodes()[0].tag);
  expect(handle.nativeTag).toBe(handle.tag);
  // The view's functions, called as methods: the native side reads `this.nativeTag`.
  await expect(handle.takePicture({ quality: 1 })).resolves.toBe("picture");
  expect(natives).toEqual([["takePicture", handle.tag, { quality: 1 }]]);
  // A view function wins over the host method of its name (`focus` also exists on the host handle).
  handle.focus();
  expect(natives.at(-1)).toEqual(["focus", handle.tag]);
  expect(harness.calls.filter((call) => call.startsWith("fabric.dispatchCommand"))).toEqual([]);
  // The host's methods still work, bound to the host, also when taken off the handle.
  const { dispatchCommand } = handle;
  dispatchCommand("snap", [1]);
  handle.dispatchCommand("snap", [2]);
  expect(harness.calls.filter((call) => call.startsWith("fabric.dispatchCommand"))).toEqual([`fabric.dispatchCommand ${NAME} snap [1]`, `fabric.dispatchCommand ${NAME} snap [2]`]);
  expect(handle.position().length).toBeGreaterThan(0);
  // The same object after updates, and the callback is not called again.
  app.setZoom(3);
  await settle(loaded);
  app.setReady(() => {});
  await settle(loaded);
  expect(app.handleLog()).toEqual([handle]);
  expect(app.handleLog()[0]).toBe(handle);
});

test("ref: null when the view goes away, and a view without native functions gives the host handle alone", async () => {
  const { loaded, app, nodes } = await mount("android", 57);
  const [handle] = app.handleLog() as Handle[];
  app.setShown(false);
  await settle(loaded);
  await settle(loaded);
  expect(nodes()).toEqual([]);
  expect(app.handleLog()).toEqual([handle, null]);
  // `Other` has no entry in the module's `ViewPrototypes`.
  app.setShown(true);
  app.setModule("Thing", "Other");
  await settle(loaded);
  await settle(loaded);
  const other = nodes("ViewManagerAdapter_Thing_Other")[0];
  expect(other).toBeDefined();
  const last = app.handleLog().at(-1) as Handle;
  expect(last.tag).toBe(other.tag);
  expect(last.nativeTag).toBe(other.tag);
  expect("takePicture" in last).toBe(false);
  expect(Object.getPrototypeOf(last)).toBe(Object.prototype);
  expect(typeof last.dispatchCommand).toBe("function");
});

test("another view is another node: the new view's handle is handed over and the old ref hears null", async () => {
  const { loaded, app, nodes } = await mount("android", 58);
  const [first] = app.handleLog() as Handle[];
  app.setModule("Thing", "Other");
  await settle(loaded);
  await settle(loaded);
  expect(nodes()).toEqual([]);
  expect(nodes("ViewManagerAdapter_Thing_Other")).toHaveLength(1);
  // The host tells the ref of a node that was taken out of the tree after the flush that built the new one.
  const handles = app.handleLog();
  expect(handles).toHaveLength(3);
  expect(handles[0]).toBe(first);
  expect(handles.filter((handle) => handle === null)).toHaveLength(1);
  const second = handles.find((handle) => handle !== null && handle !== first) as Handle;
  expect(second.tag).toBe(nodes("ViewManagerAdapter_Thing_Other")[0]?.tag ?? -1);
  expect(second.tag).not.toBe(first.tag);
});

test("a new ref callback hears the handle, the old one null, and the handle is another object for it", async () => {
  const { loaded, app } = await mount("android", 59);
  const [first] = app.handleLog() as Handle[];
  app.useRef(1);
  await settle(loaded);
  expect(app.handleLog()).toEqual([first, null]);
  const [second] = app.otherHandleLog() as Handle[];
  expect(app.otherHandleLog()).toHaveLength(1);
  expect(second.tag).toBe(first.tag);
});

test("defineExpoView: the component is ExpoView with the module and view fixed, and its props stay reactive", async () => {
  natives.length = 0;
  const harness = createHarness("android", { expo: configs, expoModules });
  const loaded = await harness.load("expo-view-defined-fixture.svelte");
  const app = loaded.startSurface(60, loaded.Fixture, {}) as unknown as { setZoom(zoom: number): void; eventLog(): unknown[]; handleLog(): (Handle | null)[] };
  const roots = () => harness.roots()[60] ?? [];
  // `module="Plain" view="Other"` is ignored: the factory's module and view are mounted, and `Plain`'s only view has no name.
  const view = find(roots(), NAME)[0];
  const plain = find(roots(), "ViewManagerAdapter_Plain")[0];
  expect(view).toBeDefined();
  expect(plain).toBeDefined();
  expect(find(roots(), "ViewManagerAdapter_Plain_Other")).toEqual([]);
  expect(view.props).toMatchObject({ facing: "front", zoom: 1 });
  expect(view.children.map((node) => node.name)).toEqual(["RCTView"]);
  expect(plain.props.zoom).toBe(1);
  // A prop update after the mount reaches the native node, through the proxy, as a clone.
  harness.calls.length = 0;
  app.setZoom(4);
  await settle(loaded);
  expect(harness.calls.filter((call) => call.startsWith("create"))).toEqual([]);
  expect(find(roots(), NAME)[0]?.props.zoom).toBe(4);
  expect(find(roots(), "ViewManagerAdapter_Plain")[0]?.props.zoom).toBe(4);
  // Events and `ref` go through the same way.
  harness.emit(view.target, "topReady", { ok: 1 });
  expect(app.eventLog()).toEqual([{ nativeEvent: { ok: 1 } }]);
  const [handle] = app.handleLog() as Handle[];
  expect(handle.tag).toBe(view.tag);
  await handle.takePicture();
  expect(natives).toEqual([["takePicture", view.tag, undefined]]);
});

test("a view the module does not have is an error that says which, and what to do", async () => {
  const harness = createHarness("android", { expo: configs, expoModules });
  const loaded = await harness.load("expo-view-missing-fixture.svelte");
  expect(() => loaded.startSurface(61, loaded.Fixture, { view: "Nope" })).toThrow(/Expo module Missing has no view Nope: .*not in this build.*rebuild the native app/);
  expect(() => loaded.startSurface(62, loaded.Fixture, {})).toThrow(/Expo module Missing has no view: .*rebuild the native app/);
  expect(() => loaded.foreign.expoViewName("Thing", "Missing")).toThrow("Expo module Thing has no view Missing");
});

test("a dedicated wrapper's colour props still apply when the generic view mounted the same view first", async () => {
  const harness = createHarness("android", { expo: { Tinted: { "": { validAttributes: { tintColor: true, size: true }, directEventTypes: null } } } });
  const loaded = await harness.load("expo-view-missing-fixture.svelte");
  const config = (name: string) => loaded.configs.viewConfigFor(name, "android");
  const name = loaded.foreign.expoViewName("Tinted");
  expect(loaded.configs.createPayload({ tintColor: "#ff0000", size: 2 }, config(name))).toEqual({ tintColor: "#ff0000", size: 2 });
  expect(loaded.foreign.expoViewName("Tinted", undefined, { colors: "tintColor" })).toBe(name);
  expect(loaded.configs.createPayload({ tintColor: "#ff0000", size: 2 }, config(name))).toEqual({ tintColor: -65536, size: 2 });
  // A caller that names nothing leaves the definition as the dedicated wrapper made it.
  loaded.foreign.expoViewName("Tinted");
  expect(loaded.configs.createPayload({ tintColor: "#ff0000" }, config(name))).toEqual({ tintColor: -65536 });
});
