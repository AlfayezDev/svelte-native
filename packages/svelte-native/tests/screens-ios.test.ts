import { test, expect, afterAll } from "bun:test";
import { build, transform } from "esbuild";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import * as shared from "../src/fabric/navigation.ts";
import * as ios from "../src/fabric/navigation.ios.ts";
import { decodeRecords, navigationProps, parseNativeID } from "../src/fabric/navigation.ts";
import { colorToWire, encodeNativeID, headerHeight, mergeScreenOptions, navigationTags, normalizeDetents, sheetStyle } from "../src/fabric/navigation.ios.ts";

// The iOS bridges of packages/svelte-native/native/svelte-screens-ios: the wire they share with the engine, the view names the
// host picks per platform, and the pure C++ parts of the module (native/Core) built and run here.

const module = resolve(import.meta.dirname, "../native/svelte-screens-ios");

test("the iOS module re-exports the shared encoders and the reference decoder unchanged", () => {
  expect(ios.navigationProps).toBe(shared.navigationProps);
  expect(ios.decodeRecords).toBe(decodeRecords);
  expect(ios.parseNativeID).toBe(parseNativeID);
  expect(encodeNativeID).toBe(shared.encodeNativeID);
  expect(colorToWire).toBe(shared.colorToWire);
  expect(mergeScreenOptions).toBe(shared.mergeScreenOptions);
  expect(normalizeDetents).toBe(shared.normalizeDetents);
  expect(sheetStyle).toBe(shared.sheetStyle);
  expect(headerHeight).toBe(shared.headerHeight);
  expect(navigationTags).toBe(shared.navigationTags);
});

// The host with a fake Fabric binding, as tests/navigation.test.ts builds it, with the platform chosen per run.
type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
let roots: Record<number, FakeNode[]> = {};
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown) { return { tag, name, props: { ...props }, children: [], sealed: false, target }; },
  cloneNodeWithNewChildren(node: FakeNode) { return { ...node, children: [], sealed: false }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
  appendChild(parent: FakeNode, child: FakeNode) { parent.children.push(child); },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) { roots[root] = set.children; },
  registerEventHandler(handler: unknown) { (fake as { handler?: unknown }).handler = handler; },
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  // React Native's registry and `createViewConfig`, recording what the host registers (and refusing a second registration, as the real registry does).
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name, config) => { const known = (globalThis.__registeredViewConfigs ??= new Map()); if (known.has(name)) throw new Error('Tried to register two views with the same name ' + name); known.set(name, config); return name; }; export const get = () => ({});",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => ({ ...partial, base: true });",
  "react-native/Libraries/Utilities/Platform": "export default { get OS() { return globalThis.__navigationOS ?? 'android'; }, Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/Linking/Linking": "export default { addEventListener: () => ({ remove() {} }), getInitialURL: () => Promise.resolve(null) };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

async function load(fixture: string) {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './${fixture}';
        import { startSurface } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "screens-ios-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: resolve(import.meta.dirname, "view-configs-stub.ts") }));
        builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code,
          loader: "js",
        }));
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
          const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
          return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
        });
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-screens-ios-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}

const environment = globalThis as { __navigationOS?: string; __registeredViewConfigs?: Map<string, () => unknown> };
const flatten = (nodes: FakeNode[]): FakeNode[] => nodes.flatMap((node) => [node, ...flatten(node.children)]);
const settle = async (m: { tick: () => Promise<void> }) => { await m.tick(); await Promise.resolve(); await Promise.resolve(); };
const wired = (node: FakeNode) => typeof node.props.nativeID === "string" && node.props.nativeID.startsWith("svelte:");

/** Mounts a fixture on a platform; returns the tags it produced as `[nativeID kind, Fabric component name]` pairs, in tree order. */
async function mount(fixture: string, platform: "android" | "ios", surface: number) {
  environment.__navigationOS = platform;
  environment.__registeredViewConfigs = new Map();
  try {
    const m = await load(fixture);
    roots = {};
    m.startSurface(surface, m.Fixture, {});
    await settle(m);
    const nodes = flatten(roots[surface]).filter(wired);
    return { pairs: nodes.map((node) => [parseNativeID(String(node.props.nativeID))?.kind, node.name] as const), ids: nodes.map((node) => node.props.nativeID) };
  } finally { delete environment.__navigationOS; }
}

test("a hidden Modal mounts no host on iOS (a hidden RCTModalHostView would take every touch), stays until onDismiss after hiding; Android keeps its host", async () => {
  const emit = (target: unknown, type: string) => (fake as unknown as { handler: (t: unknown, type: string, e: object) => void }).handler(target, type, {});
  const modals = (surface: number) => flatten(roots[surface] ?? []).filter((node) => node.name === "RCTModalHostView" || node.name === "ModalHostView");
  for (const platform of ["ios", "android"] as const) {
    environment.__navigationOS = platform;
    environment.__registeredViewConfigs = new Map();
    try {
      const surface = platform === "ios" ? 66 : 67;
      const m = await load("modal-visible-fixture.svelte");
      roots = {};
      const app = m.startSurface(surface, m.Fixture, {}) as { setOpen(value: boolean): void; dismissed(): number };
      await settle(m);
      if (platform === "android") {
        // The engine's host takes no touches and animates its layer from `visible`: it stays mounted, hidden.
        expect(modals(surface).map((node) => node.props.visible)).toEqual([false]);
        continue;
      }
      expect(modals(surface)).toHaveLength(0);
      app.setOpen(true);
      await settle(m);
      expect(modals(surface).map((node) => node.props.visible)).toEqual([true]);
      // UIKit presented the controller (a window, a finished transition): onShow.
      emit(modals(surface)[0]?.target, "topShow");
      await settle(m);
      app.setOpen(false);
      await settle(m);
      // Still there with visible false while UIKit animates the dismissal; gone once it reports onDismiss.
      expect(modals(surface).map((node) => node.props.visible)).toEqual([false]);
      emit(modals(surface)[0]?.target, "topDismiss");
      await settle(m);
      expect(modals(surface)).toHaveLength(0);
      expect(app.dismissed()).toBe(1);
      app.setOpen(true);
      await settle(m);
      expect(modals(surface)).toHaveLength(1);
      // A Modal toggled true to false while its host has no window (a hidden eager tab pane) is never presented: RN emits onDismiss only
      // for a presented controller, so nothing would unmount the hidden host, and it would swallow the pane's touches. No onShow came:
      // it goes away with `visible`, and no dismissal is reported for a modal that was never shown.
      app.setOpen(false);
      await settle(m);
      expect(modals(surface)).toHaveLength(0);
      expect(app.dismissed()).toBe(1);
      // Presented again, after an onShow of the earlier round; the stale onShow does not count for this one.
      app.setOpen(true);
      await settle(m);
      expect(modals(surface).map((node) => node.props.visible)).toEqual([true]);
      app.setOpen(false);
      await settle(m);
      expect(modals(surface)).toHaveLength(0);
      // The sequence of a window that appears late: visible, still no onShow, then onShow, then hidden: the dismissal animates as usual.
      app.setOpen(true);
      await settle(m);
      emit(modals(surface)[0]?.target, "topShow");
      await settle(m);
      app.setOpen(false);
      await settle(m);
      expect(modals(surface).map((node) => node.props.visible)).toEqual([false]);
      emit(modals(surface)[0]?.target, "topDismiss");
      await settle(m);
      expect(modals(surface)).toHaveLength(0);
      expect(app.dismissed()).toBe(2);
    } finally { delete environment.__navigationOS; }
  }
});

test("the host mounts the screen tags as the Svelte components on iOS and as RCTView on Android, with the same nativeIDs", async () => {
  const android = await mount("screen-fixture.svelte", "android", 61);
  const phone = await mount("screen-fixture.svelte", "ios", 62);
  expect(new Set(android.pairs.map(([, name]) => name))).toEqual(new Set(["RCTView"]));
  expect(phone.pairs).toEqual(android.pairs.map(([kind]) => [kind, kind === "stack" ? "SvelteStack" : kind === "screen" ? "SvelteScreen" : kind === "header" ? "SvelteHeader" : "SvelteHeaderSlot"]));
  expect(phone.pairs.map(([kind]) => kind)).toEqual(expect.arrayContaining(["stack", "screen", "header"]));
  expect(phone.ids).toEqual(android.ids);
});

test("tabs, tab panes and their stacks mount as the Svelte components on iOS; the tab icon view stays RCTView", async () => {
  const android = await mount("tabs-fixture.svelte", "android", 63);
  const phone = await mount("tabs-fixture.svelte", "ios", 64);
  expect(new Set(android.pairs.map(([, name]) => name))).toEqual(new Set(["RCTView"]));
  const names: Record<string, string> = { stack: "SvelteStack", screen: "SvelteScreen", header: "SvelteHeader", tabs: "SvelteTabs", tab: "SvelteTab", "tab-icon": "RCTView" };
  expect(phone.pairs).toEqual(android.pairs.map(([kind]) => [kind, names[String(kind)]]));
  const kinds = phone.pairs.map(([kind]) => kind);
  expect(kinds).toContain("tabs");
  expect(kinds.filter((kind) => kind === "tab")).toHaveLength(3);
  expect(kinds).toContain("tab-icon");
  expect(phone.ids).toEqual(android.ids);
});

test("a toolbar, its items and its center mount as the Svelte components on iOS and as RCTView on Android, with the same nativeIDs", async () => {
  const android = await mount("toolbar-fixture.svelte", "android", 76);
  const phone = await mount("toolbar-fixture.svelte", "ios", 77);
  expect(new Set(android.pairs.map(([, name]) => name))).toEqual(new Set(["RCTView"]));
  const names: Record<string, string> = { stack: "SvelteStack", screen: "SvelteScreen", header: "SvelteHeader", toolbar: "SvelteToolbar", "toolbar-item": "SvelteToolbarItem", "toolbar-center": "SvelteToolbarCenter" };
  expect(phone.pairs).toEqual(android.pairs.map(([kind]) => [kind, names[String(kind)]]));
  const kinds = phone.pairs.map(([kind]) => kind);
  expect(kinds.filter((kind) => kind === "toolbar")).toHaveLength(1);
  expect(kinds.filter((kind) => kind === "toolbar-item")).toHaveLength(5);
  expect(phone.ids).toEqual(android.ids);
});

test("the first iOS navigation node registers the view configs of the nine components, once, with their events", async () => {
  const android = await mount("screen-fixture.svelte", "android", 65);
  expect(android.pairs.length).toBeGreaterThan(0);
  expect(environment.__registeredViewConfigs?.size).toBe(0);
  await mount("screen-fixture.svelte", "ios", 66);
  const configs = environment.__registeredViewConfigs ?? new Map();
  expect([...configs.keys()].sort()).toEqual(["SvelteHeader", "SvelteHeaderSlot", "SvelteScreen", "SvelteStack", "SvelteTab", "SvelteTabs", "SvelteToolbar", "SvelteToolbarCenter", "SvelteToolbarItem"]);
  const configOf = (name: string) => {
    const config = configs.get(name);
    if (!config) throw new Error(`${name} is not registered`);
    return config() as { directEventTypes: Record<string, { registrationName: string }> };
  };
  const eventsOf = (name: string) => configOf(name).directEventTypes;
  expect(configOf("SvelteStack")).toEqual({ uiViewClassName: "SvelteStack", directEventTypes: {}, validAttributes: {}, base: true });
  expect(eventsOf("SvelteScreen")).toEqual({
    topAppear: { registrationName: "onAppear" },
    topDisappear: { registrationName: "onDisappear" },
    topDismissed: { registrationName: "onDismissed" },
    topExited: { registrationName: "onExited" },
    topDetentChange: { registrationName: "onDetentChange" },
  });
  expect(eventsOf("SvelteHeader")).toEqual({ topMetrics: { registrationName: "onMetrics" } });
  expect(eventsOf("SvelteHeaderSlot")).toEqual({ topCancel: { registrationName: "onCancel" } });
  expect(eventsOf("SvelteTabs")).toEqual({ topSelect: { registrationName: "onSelect" }, topMetrics: { registrationName: "onMetrics" } });
  expect(eventsOf("SvelteTab")).toEqual({});
  expect(eventsOf("SvelteToolbar")).toEqual({ topPress: { registrationName: "onPress" }, topMetrics: { registrationName: "onMetrics" } });
  expect(eventsOf("SvelteToolbarItem")).toEqual({});
  expect(eventsOf("SvelteToolbarCenter")).toEqual({});
});

test("a pressable and a block of text are accessibility elements on iOS, so VoiceOver reads a button as a button and the text at all; on Android the engine exposes them itself", async () => {
  const lowered = (platform: "android" | "ios", surface: number) => async () => {
    environment.__navigationOS = platform;
    try {
      const m = await load("pressable-fixture.svelte");
      roots = {};
      m.startSurface(surface, m.Fixture, {});
      await settle(m);
      const byTestID = (id: string) => flatten(roots[surface]).find((node) => node.props.testID === id);
      return { plain: byTestID("plain")?.props.accessible, hidden: byTestID("hidden")?.props.accessible, passive: byTestID("passive")?.props.accessible, label: byTestID("plain")?.props.accessibilityLabel, words: byTestID("words")?.props.accessible, silent: byTestID("silent")?.props.accessible };
    } finally { delete environment.__navigationOS; }
  };
  expect(await lowered("ios", 67)()).toEqual({ plain: true, hidden: false, passive: undefined, label: "Go", words: true, silent: false });
  expect(await lowered("android", 68)()).toEqual({ plain: undefined, hidden: false, passive: undefined, label: "Go", words: undefined, silent: false });
});

// The pure C++ parts of the module, built with the system compiler and compared with the reference implementations.
const compiler = Bun.which("c++") ?? Bun.which("clang++") ?? Bun.which("g++");
let driver: string | undefined;
afterAll(async () => { if (driver) await rm(dirname(driver), { recursive: true }); });
async function run(mode: "records" | "plan" | "detent", lines: string[]): Promise<string[]> {
  expect(compiler, "the native decoder test needs a C++ compiler on PATH (c++, clang++ or g++)").toBeTruthy();
  if (!driver) {
    const directory = await mkdtemp(resolve(tmpdir(), "svelte-screens-ios-core-"));
    driver = resolve(directory, "records_dump");
    const build = spawnSync(compiler as string, ["-std=c++20", "-Wall", "-Wextra", "-Werror", "-O1", "-o", driver, resolve(module, "test/records_dump.cpp"), resolve(module, "native/Core/SvelteNativeID.cpp")], { encoding: "utf8" });
    expect(build.stderr).toBe("");
    expect(build.status).toBe(0);
  }
  const result = spawnSync(driver, [mode], { input: `${lines.join("\n")}\n`, encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout.split("\n").slice(0, -1);
}

/** The records the C++ reader printed for each id equal what the reference decoder returns (through JSON, as NaN and Infinity cannot cross it). */
function expectSameRecords(ids: readonly string[], printed: readonly string[]) {
  expect(printed).toHaveLength(ids.length);
  for (const [index, id] of ids.entries()) expect(JSON.parse(printed[index]), id).toEqual(JSON.parse(JSON.stringify(decodeRecords(id))));
}

const golden = [
  "svelte:stack",
  "svelte:screen;a=2;p=push;g=1;s=default;b=1",
  "svelte:screen;a=1;p=transparentModal;g=0;s=slide_from_bottom;b=0",
  "svelte:screen;a=2;p=modal;g=1;s=fade;b=1",
  "svelte:screen;a=2;p=formSheet;g=1;s=none;b=1",
  "svelte:screen;a=2;p=formSheet;g=1;s=default;b=1;gr=1;dm=0;bd=1",
  "svelte:screen;a=2;p=sheet;g=1;s=default;b=1",
  "svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=auto,0.75,1,0.1;di=1;gr=0;dm=0;bd=1;ss=l;sx=1;nc=102030ff;ns=d",
  "svelte:screen;a=2;p=push;g=1;s=default;b=1;ss=d",
  "svelte:header",
  "svelte:header;t=A%3BB%3DC%2C%20100%25;st=sub;bt=Back;l=1;tl=1;bk=1;hs=1;tc=ffffffff;bg=00000080;sl=3",
  "svelte:header;l=1;sl=15",
  "svelte:header-left",
  "svelte:header-center",
  "svelte:header-right",
  "svelte:header-search",
  "svelte:header-search;ph=Search%E2%80%A6;v=a%20b;ec=4",
  "svelte:tabs",
  "svelte:tabs;sel=2;sc=5;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff;lb=1",
  "svelte:tab",
  "svelte:tab;k=in%2Fbox;t=Inbox;ic=asset%3A%2Fa%20b.png;is=https%3A%2F%2Fx%2Fy.png%3Fa%3D1%26b%3D2;bd=99%2B;ds=1",
  "svelte:tab;k=me;t=Me;iv=1;bd=",
  "svelte:tab-icon",
  "svelte:bogus",
  "view-1",
  "",
];

// Inputs an encoder never produces; native readers must still agree with the reference decoder on them.
const hostile = [
  "svelte:screen",
  "svelte:screen;a=;g=x;p=weird;s=weird;b=2",
  "svelte:screen;a=2x;g= 3;b=-1;p=sheet;dt=;di=7",
  "svelte:screen;p=sheet;dt=0.5,,1;di=-2",
  "svelte:screen;p=sheet;dt=1e0,auto,%61uto,0.2,0.3,0.4;di=9;gr=2;dm=3;bd=4",
  "svelte:screen;p=formSheet;dt=0.2;di=4;gr=1",
  "svelte:screen;ss=x;nc=102030FF;ns=l",
  "svelte:screen;nc=12345678",
  "svelte:screen;sx=1;a=1;a=2",
  "svelte:screen;=1;p=modal;novalue;g",
  "svelte:header;l=true;tl=1;bk=01;hs=1;t=;st=%E2%9C%93;sl=x",
  "svelte:header;tc=zzzzzzzz;bg=0000000;sl= 9 ",
  "svelte:header-search;ph=;v=;ec=-3",
  "svelte:tabs;sel=-1;sc=x;lb=0;uc=00000000",
  "svelte:tab;bd=0;iv=;ds=2x;k=%E2%82%AC",
  "svelte:tab;bd=%20",
];

test("the C++ decoder reads every golden nativeID into the records the reference decoder produces", async () => {
  expectSameRecords(golden, await run("records", golden));
});

test("the C++ decoder agrees with the reference decoder on malformed, partial and repeated keys", async () => {
  expectSameRecords(hostile, await run("records", hostile));
});

test("the C++ decoder agrees with the reference decoder on every nativeID the encoders build from a grid of attributes", async () => {
  const colors = [undefined, "#fff", "rgba(1, 2, 3, 0.5)", "transparent", "papayawhip"];
  const ids: string[] = [];
  const add = (name: string, attributes: Record<string, unknown>) => ids.push(String(navigationProps(name, attributes).nativeID));
  for (const stackPresentation of ["push", "modal", "transparentModal", "sheet", "formSheet", "bogus"]) {
    for (const sheetDetents of [undefined, [1], [0.3, "auto"], ["auto"], [0.25, 0.5, 0.75, 1, 0.1], [2, "x"]]) {
      for (const sheetInitialDetent of [undefined, 0.3, "auto", 1]) {
        for (const flags of [{}, { gestureEnabled: false, activityState: 1 }, { sheetGrabber: false, sheetDismissible: false, sheetBackdrop: "none" }, { sheetGrabber: true, nativeBackButtonDismissalEnabled: false, stackAnimation: "fade" }]) {
          add("native-screen", { stackPresentation, sheetDetents, sheetInitialDetent, ...flags });
        }
      }
    }
  }
  for (const statusBarStyle of [undefined, "light", "dark"]) {
    for (const navigationBarColor of colors) add("native-screen", { statusBarStyle, statusBarHidden: statusBarStyle === "dark", navigationBarColor, navigationBarStyle: statusBarStyle });
  }
  for (const title of [undefined, "Inbox", "A;B=C, 100%", "عنوان ✓"]) {
    for (const flags of [{}, { large: true, translucent: true }, { back: true, hideShadow: true, slots: 7 }, { slots: 15, backTitle: "Back", subtitle: "3 unread" }]) {
      for (const tint of colors) add("native-header", { title, tint, background: tint, ...flags });
    }
  }
  for (const name of ["native-header-left", "native-header-center", "native-header-right"]) add(name, {});
  for (const placeholder of [undefined, "Search…", "100%"]) for (const value of [undefined, "", "a b"]) for (const eventCount of [0, 3]) add("native-header-search", { placeholder, value, eventCount });
  for (const selectedIndex of [0, 2]) for (const selectCount of [0, 4]) for (const tint of colors) add("native-tabs", { selectedIndex, selectCount, tint, inactiveTint: tint, background: tint, labels: selectedIndex ? "never" : "always" });
  for (const badge of [undefined, true, 0, 7, 120, "new", ""]) for (const iconView of [false, true]) add("native-tab", { tabKey: "in/box", title: "Inbox ✓", icon: iconView ? undefined : "https://x/y.png?a=1&b=2", selectedIcon: "file:///a b.png", iconView, badge, disabled: badge === 7 });
  add("native-tab-icon", {});
  add("native-stack", {});
  expect(ids.length).toBeGreaterThan(700);
  expectSameRecords(ids, await run("records", ids));
});

test("the stack planner pushes a new top, pops a top that left, and applies other changes without animation", async () => {
  const cases: [string, { step: string; staged: number[] }][] = [
    ["1|1", { step: "none", staged: [] }],
    ["1,2|1,2", { step: "none", staged: [] }],
    ["1,2|", { step: "none", staged: [] }],
    ["|1,2", { step: "replace", staged: [1, 2] }],
    ["1,2|1,2,3", { step: "push", staged: [1, 2] }],
    ["1|1,2,3", { step: "push", staged: [1, 2] }],
    ["1,2,3|1,2", { step: "pop", staged: [1, 2, 3] }],
    ["1,2,3|1", { step: "pop", staged: [1, 3] }],
    ["1,2|1,3", { step: "pop", staged: [1, 3, 2] }],
    ["1,2|3,4", { step: "pop", staged: [3, 4, 2] }],
    ["1,2,3|1,2,4,5", { step: "pop", staged: [1, 2, 4, 5, 3] }],
    ["1,2,3|1,3", { step: "replace", staged: [1, 3] }],
    ["1,2|2,1", { step: "replace", staged: [2, 1] }],
    ["1,2,3|3,1,2", { step: "replace", staged: [3, 1, 2] }],
  ];
  const out = await run("plan", cases.map(([input]) => input));
  for (const [index, [input, expected]] of cases.entries()) expect(JSON.parse(out[index]), input).toEqual(expected);
});

test("a sheet detent is a fraction of the space below the top inset, the content height for auto, never above what UIKit allows", async () => {
  const cases: [string, number][] = [
    // available, maximum: both 800 (UIKit allows the whole container)
    ["0.5 800 800 0", 400], ["1 800 800 0", 800], ["0.25 800 800 0", 200], ["0 800 800 500", 0], ["2 800 800 0", 800],
    ["-1 800 800 300", 300], ["-1 800 800 900", 800], ["-1 800 800 -5", 0], ["0.5 0 0 0", 0], ["0.5 -20 -20 0", 0],
    // iOS 26 floating sheet on an iPhone SE 3: 647 below the top inset, 610 the largest detent UIKit resolves
    ["0.5 640 610 0", 320], ["1 640 610 0", 610], ["0.75 800 610 0", 600], ["-1 640 610 900", 610], ["-1 640 610 300", 300], ["0.5 640 0 0", 0],
  ];
  const out = await run("detent", cases.map(([input]) => input));
  for (const [index, [input, expected]] of cases.entries()) expect(Number(out[index]), input).toBe(expected);
});
