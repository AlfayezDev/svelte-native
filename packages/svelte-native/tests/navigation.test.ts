import { test, expect, jest } from "bun:test";
import { build, transform } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { EXIT_TIMEOUT_MS, badgeText, colorToWire, decodeList, decodeRecords, decodeValue, headerHeight, mergeScreenOptions, navigationProps, normalizeDetents, parseNativeID, sheetStyle } from "../src/fabric/navigation.ts";
import { LOWERED_TAGS, lowerPrimitives } from "../src/lower.ts";

type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
const calls: string[] = [];
let roots: Record<number, FakeNode[]> = {};
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown) { calls.push(`create ${name}`); return { tag, name, props: { ...props }, children: [], sealed: false, target }; },
  cloneNodeWithNewChildren(node: FakeNode) { calls.push(`cloneChildren ${node.name}`); return { ...node, children: [], sealed: false }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneProps ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneBoth ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
  appendChild(parent: FakeNode, child: FakeNode) {
    if (parent.sealed) throw new Error(`appendChild on sealed ${parent.name}`);
    if (parent.name === "RCTScrollView" && parent.children.length >= 1) throw new Error("ScrollView can host only one direct child");
    parent.children.push(child);
  },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) {
    calls.push("completeRoot");
    const seal = (n: FakeNode) => { n.sealed = true; n.children.forEach(seal); };
    set.children.forEach(seal);
    roots[root] = set.children;
  },
  measure(node: FakeNode, callback: (...args: number[]) => void) { calls.push(`measure ${node.tag}`); callback(1, 2, 3, 4, 5, 6); },
  measureInWindow(node: FakeNode, callback: (...args: number[]) => void) { calls.push(`measureInWindow ${node.tag}`); callback(5, 6, 3, 4); },
  dispatchCommand(node: FakeNode, name: string, args: unknown[]) { calls.push(`dispatchCommand ${node.tag} ${name} ${JSON.stringify(args)}`); },
  registerEventHandler(handler: unknown) { (fake as { handler?: unknown }).handler = handler; },
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { get OS() { return globalThis.__navigationOS ?? 'android'; }, Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "const handlers = (globalThis.__backHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; } };",
  "react-native/Libraries/Linking/Linking": "const handlers = (globalThis.__linkHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; }, getInitialURL: () => Promise.resolve(null) };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = (name) => name === 'SvelteEngine' && globalThis.__navigationInsets ? { install: () => false, getInsets: () => globalThis.__navigationInsets, addListener: () => ({ remove() {} }) } : null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

async function load(fixture = "navigation-fixture.svelte") {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './${fixture}';
        import { startSurface, flush, fabricStats } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, flush, fabricStats, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "fabric-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: resolve(import.meta.dirname, "view-configs-stub.ts") }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code,
          loader: "js",
        }));
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
          const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
          return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
        });
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-navigation-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}
const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((n) => [...(n.name === name ? [n] : []), ...find(n.children, name)]);
const settle = async (m: { tick: () => Promise<void> }) => { await m.tick(); await Promise.resolve(); await Promise.resolve(); };
const emit = (target: unknown, type: string, event: object) => (fake as unknown as { handler: (t: unknown, type: string, e: object) => void }).handler(target, type, event);
type App = { push: (key: number) => void; pop: () => void; dismissedLog: () => number[] };

test("native-stack and native-screen mount as RCTView nodes the engine recognises by nativeID, with absolute screen styles", async () => {
  const m = await load();
  calls.length = 0; roots = {};
  const app = m.startSurface(21, m.Fixture, {}) as App;
  const stack = roots[21][0];
  expect(stack.name).toBe("RCTView");
  expect(stack.props.nativeID).toBe("svelte:stack");
  expect(stack.props.style).toEqual([{ flex: 1 }, { flex: 1 }]);
  expect(stack.children).toHaveLength(1);
  const [first] = stack.children;
  expect(first.name).toBe("RCTView");
  expect(first.props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(first.props.style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, { backgroundColor: "white" }]);

  app.push(2);
  app.push(3);
  await settle(m);
  const screens = roots[21][0].children;
  expect(screens.map((screen) => screen.props.nativeID)).toEqual([
    "svelte:screen;a=2;p=push;g=1;s=default;b=1",
    "svelte:screen;a=2;p=push;g=0;s=default;b=1",
    "svelte:screen;a=2;p=modal;g=1;s=default;b=1",
  ]);
  expect(find(roots[21], "RCTView").filter((node) => node.props.nativeID === "svelte:stack")).toHaveLength(1);

  app.pop();
  await settle(m);
  expect(roots[21][0].children).toHaveLength(2);
});

test("topDismissed on a screen reaches its onDismissed handler", async () => {
  const m = await load();
  calls.length = 0; roots = {};
  const app = m.startSurface(22, m.Fixture, {}) as App;
  app.push(2);
  await settle(m);
  const [first, second] = roots[22][0].children;
  expect(first.props.onDismissed).toBe(true);
  emit(second.target, "topDismissed", { dismissCount: 1 });
  emit(first.target, "topDismissed", {});
  expect(app.dismissedLog()).toEqual([2, 1]);
});

// Screen API contract: the pure encoders (SPEC.md "Screen API contract (header, sheet, tabs)").
const screenId = (attributes: Record<string, unknown>) => navigationProps("native-screen", attributes).nativeID;
const noop = () => {};

test("the screen nativeID keeps its grammar and gains the sheet, status bar and navigation bar keys", () => {
  expect(screenId({})).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(screenId({ stackPresentation: "bogus", stackAnimation: "bogus" })).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(screenId({ stackPresentation: "modal", activityState: 1, gestureEnabled: false, stackAnimation: "fade", nativeBackButtonDismissalEnabled: false })).toBe("svelte:screen;a=1;p=modal;g=0;s=fade;b=0");
  expect(screenId({ stackPresentation: "transparentModal", stackAnimation: "slide_from_bottom" })).toBe("svelte:screen;a=2;p=transparentModal;g=1;s=slide_from_bottom;b=1");
  expect(screenId({ stackPresentation: "formSheet", sheetDetents: [0.3], sheetInitialDetent: 0.3 })).toBe("svelte:screen;a=2;p=formSheet;g=1;s=default;b=1");
  expect(screenId({ stackPresentation: "formSheet", sheetGrabber: true, sheetDismissible: false, sheetBackdrop: "none" })).toBe("svelte:screen;a=2;p=formSheet;g=1;s=default;b=1;gr=1;dm=0;bd=1");
  expect(screenId({ stackPresentation: "modal", sheetDetents: [0.3], sheetDismissible: false })).toBe("svelte:screen;a=2;p=modal;g=1;s=default;b=1");
  expect(screenId({ stackPresentation: "sheet" })).toBe("svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=0.5,1");
  expect(screenId({ stackPresentation: "sheet", sheetDetents: ["auto", 0.75, 0.75, 2, "x", 1, 0.1], sheetInitialDetent: 0.75, sheetGrabber: false, sheetDismissible: false, sheetBackdrop: "none" }))
    .toBe("svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=auto,0.75,1,0.1;di=1;gr=0;dm=0;bd=1");
  expect(screenId({ stackPresentation: "sheet", sheetInitialDetent: 0.9 })).toBe("svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=0.5,1");
  expect(screenId({ statusBarStyle: "auto", navigationBarStyle: "auto" })).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(screenId({ statusBarStyle: "light", statusBarHidden: true, navigationBarColor: "#102030", navigationBarStyle: "dark" })).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1;ss=l;sx=1;nc=102030ff;ns=d");
  expect(screenId({ statusBarStyle: "dark", statusBarHidden: false, navigationBarColor: "papayawhip" })).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1;ss=d");
});

test("screen styles: absolute fill, bottom-anchored sheets sized from the detents, form sheets below the top inset", () => {
  expect(navigationProps("native-screen", {}).style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, undefined]);
  expect(navigationProps("native-screen", { stackPresentation: "formSheet", topInset: 59, style: { backgroundColor: "white" } }).style).toEqual([{ position: "absolute", top: 59, left: 0, right: 0, bottom: 0 }, { backgroundColor: "white" }]);
  expect(navigationProps("native-screen", { stackPresentation: "formSheet" }).style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, undefined]);
  expect(sheetStyle([0.5, 1], 700)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: 700, height: 700 });
  expect(sheetStyle([0.4], 700)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: 700, height: 280 });
  expect(sheetStyle([0.5], undefined)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "100%", height: "50%" });
  expect(sheetStyle(["auto"], 700)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: 700 });
  expect(sheetStyle(["auto", 0.6], 700)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: 700, minHeight: 420 });
  expect(sheetStyle(["auto", 0.6], undefined)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "100%", minHeight: "60%" });
  expect(navigationProps("native-screen", { stackPresentation: "sheet", sheetDetents: [0.5], availableHeight: 776 }).style).toEqual([sheetStyle([0.5], 776), undefined]);
});

test("encoders consume their own attributes and pass handlers, refs and accessibility props through", () => {
  const props = navigationProps("native-screen", { stackPresentation: "sheet", sheetDetents: [1], statusBarStyle: "light", onDismissed: noop, onDetentChange: noop, testID: "screen", accessibilityLabel: "Filters" });
  expect(props.onDismissed).toBe(noop);
  expect(props.onDetentChange).toBe(noop);
  expect(props.testID).toBe("screen");
  expect(props.accessibilityLabel).toBe("Filters");
  for (const key of ["stackPresentation", "sheetDetents", "statusBarStyle"]) expect(key in props).toBe(false);
  const header = navigationProps("native-header", { title: "A", onMetrics: noop, ref: noop });
  expect(header.onMetrics).toBe(noop);
  expect(header.ref).toBe(noop);
  expect("title" in header).toBe(false);
});

test("the header nativeID carries text percent-encoded, flags only when set, colors as rrggbbaa", () => {
  expect(navigationProps("native-header", {}).nativeID).toBe("svelte:header");
  const header = navigationProps("native-header", {
    title: "A;B=C, 100%", subtitle: "sub", backTitle: "Back", large: true, translucent: true, back: true, hideShadow: true,
    tint: "#fff", background: "rgba(0, 0, 0, 0.5)", slots: 3, headerHeight: 108, headerInset: 24,
  });
  expect(header.nativeID).toBe("svelte:header;t=A%3BB%3DC%2C%20100%25;st=sub;bt=Back;l=1;tl=1;bk=1;hs=1;tc=ffffffff;bg=00000080;sl=3");
  expect(header.style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 1, height: 108, paddingTop: 24, paddingStart: 48, flexDirection: "row", alignItems: "center" }, undefined]);
  expect(navigationProps("native-header", { title: "", subtitle: undefined, tint: "papayawhip", slots: 0, large: false }).nativeID).toBe("svelte:header");
  expect(navigationProps("native-header", { headerHeight: 80, headerInset: 24, style: { opacity: 0.5 } }).style).toEqual([{ height: 80, paddingTop: 24, paddingStart: 0, flexDirection: "row", alignItems: "center" }, { opacity: 0.5 }]);
  expect(navigationProps("native-header", { translucent: true, headerHeight: 80 }).style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 1, height: 80, paddingTop: 0, paddingStart: 0, flexDirection: "row", alignItems: "center" }, undefined]);
});

test("header slots are row containers; the center slot fills the gap, the search slot hosts the results below the header", () => {
  const row = { flexDirection: "row", alignItems: "center" };
  expect(navigationProps("native-header-left", {}).nativeID).toBe("svelte:header-left");
  expect(navigationProps("native-header-right", {}).nativeID).toBe("svelte:header-right");
  expect(navigationProps("native-header-left", {}).style).toEqual([row, undefined]);
  expect(navigationProps("native-header-right", {}).style).toEqual([row, undefined]);
  expect(navigationProps("native-header-center", {}).nativeID).toBe("svelte:header-center");
  expect(navigationProps("native-header-center", {}).style).toEqual([{ ...row, flex: 1, justifyContent: "center" }, undefined]);
  expect(navigationProps("native-header-center", { align: "start" }).style).toEqual([{ ...row, flex: 1, justifyContent: "flex-start" }, undefined]);
  expect(navigationProps("native-header-search", {}).nativeID).toBe("svelte:header-search");
  expect(navigationProps("native-header-search", {}).style).toEqual([{ position: "absolute", top: "100%", left: 0, right: 0, bottom: 0 }, undefined]);
  const search = navigationProps("native-header-search", { placeholder: "Search…", value: "a b", eventCount: 4, surfaceHeight: 800, headerHeight: 80, onChange: noop });
  expect(search.nativeID).toBe("svelte:header-search;ph=Search%E2%80%A6;v=a%20b;ec=4");
  expect(search.style).toEqual([{ position: "absolute", top: "100%", left: 0, right: 0, height: 720 }, undefined]);
  expect(search.onChange).toBe(noop);
  expect(navigationProps("native-header-search", { value: "", eventCount: 0 }).nativeID).toBe("svelte:header-search");
});

test("tabs, tab and tab icon encode the selection, the bar colors, the items and their badges", () => {
  expect(navigationProps("native-tabs", {}).nativeID).toBe("svelte:tabs;sel=0");
  const tabs = navigationProps("native-tabs", { selectedIndex: 2, selectCount: 5, tint: "#0a84ff", inactiveTint: "#8e8e93", background: "#fff", labels: "never", barHeight: 98, onSelect: noop });
  expect(tabs.nativeID).toBe("svelte:tabs;sel=2;sc=5;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff;lb=1");
  expect(tabs.style).toEqual([{ flex: 1 }, undefined]);
  expect(tabs.onSelect).toBe(noop);
  expect("barHeight" in tabs).toBe(false);
  expect(navigationProps("native-tabs", { selectedIndex: 1, labels: "always" }).nativeID).toBe("svelte:tabs;sel=1");

  const tab = navigationProps("native-tab", { tabKey: "in/box", title: "Inbox", icon: "asset:/a b.png", selectedIcon: "https://x/y.png?a=1&b=2", iconView: false, badge: 120, disabled: true, barHeight: 98, testID: "t" });
  expect(tab.nativeID).toBe("svelte:tab;k=in%2Fbox;t=Inbox;ic=asset%3A%2Fa%20b.png;is=https%3A%2F%2Fx%2Fy.png%3Fa%3D1%26b%3D2;bd=99%2B;ds=1");
  expect(tab.style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, bottom: 98 }, undefined]);
  expect(tab.testID).toBe("t");
  expect(navigationProps("native-tab", { tabKey: "me", title: "Me", iconView: true, badge: true }).nativeID).toBe("svelte:tab;k=me;t=Me;iv=1;bd=");
  expect(navigationProps("native-tab", { tabKey: "me", title: "Me", badge: 0 }).nativeID).toBe("svelte:tab;k=me;t=Me");
  expect(navigationProps("native-tab", {}).style).toEqual([{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }, undefined]);
  const icon = navigationProps("native-tab-icon", {});
  expect(icon.nativeID).toBe("svelte:tab-icon");
  expect(icon.style).toEqual([{ position: "absolute", top: 0, left: 0, width: 24, height: 24, alignItems: "center", justifyContent: "center" }, undefined]);
});

test("colors reach the wire as rrggbbaa; forms the contract does not carry are dropped", () => {
  const wire: [unknown, string | undefined][] = [
    ["#fff", "ffffffff"], ["#0a8", "00aa88ff"], ["#0a8c", "00aa88cc"], ["#102030", "102030ff"], ["#10203040", "10203040"], [" #ABCDEF ", "abcdefff"],
    ["rgb(255, 0, 10)", "ff000aff"], ["rgba(0,0,0,0.5)", "00000080"], ["RGBA(1, 2, 3, 1)", "010203ff"], ["rgb(300, 0, 0)", "ff0000ff"], ["transparent", "00000000"],
    [0xff112233, "112233ff"], [-1, "ffffffff"], [0x00000000, "00000000"],
    ["red", undefined], ["#12", undefined], ["#12345", undefined], ["rgb(1, 2)", undefined], ["hsl(0, 0%, 0%)", undefined], [1.5, undefined], [undefined, undefined], [{ semantic: "label" }, undefined],
  ];
  for (const [input, expected] of wire) expect(colorToWire(input)).toBe(expected);
});

test("tab badges: dot, numbers capped at 99+, text", () => {
  expect([true, 3, 99, 100, 2.9, 0, -1, Number.NaN, "new", "", false, undefined].map(badgeText)).toEqual(["", "3", "99", "99+", "2", undefined, undefined, undefined, "new", undefined, undefined, undefined]);
});

test("sheet detents: valid entries only, given order, at most four, a default when none is valid", () => {
  expect(normalizeDetents(undefined)).toEqual([0.5, 1]);
  expect(normalizeDetents([])).toEqual([0.5, 1]);
  expect(normalizeDetents([0, -1, 1.5, "full", null])).toEqual([0.5, 1]);
  expect(normalizeDetents([0.3, "auto", 1, 0.9, 0.8, 0.7, 0.3])).toEqual([0.3, "auto", 1, 0.9]);
  expect(normalizeDetents(["auto", "auto"])).toEqual(["auto"]);
});

test("header height is the status bar inset plus the bar, plus the large title area", () => {
  expect(headerHeight("android", 24, false)).toBe(80);
  expect(headerHeight("android", 24, true)).toBe(136);
  expect(headerHeight("ios", 59, false)).toBe(103);
  expect(headerHeight("ios", 59, true)).toBe(155);
});

test("nativeID parsing keeps values encoded until read; lists split before decoding", () => {
  expect(parseNativeID("svelte:header;t=a%3Bb;bd=;l=1")).toEqual({ kind: "header", pairs: { t: "a%3Bb", bd: "", l: "1" } });
  expect(parseNativeID("svelte:stack")).toEqual({ kind: "stack", pairs: {} });
  expect(parseNativeID("other:thing")).toBeNull();
  expect(decodeValue("a%3Bb%3Dc")).toBe("a;b=c");
  expect(decodeList("a%2Cb,c")).toEqual(["a,b", "c"]);
  expect(decodeList("")).toEqual([]);
});

test("reference decoder: the prop records every nativeID stands for (golden vectors for the native decoders)", () => {
  expect(decodeRecords("svelte:stack")).toEqual({ kind: 10, records: [] });
  expect(decodeRecords("svelte:screen;a=2;p=push;g=1;s=default;b=1")).toEqual({ kind: 11, records: [{ id: 110, values: [2, 0, 1, 0, 1] }] });
  expect(decodeRecords("svelte:screen;a=1;p=transparentModal;g=0;s=slide_from_bottom;b=0")).toEqual({ kind: 11, records: [{ id: 110, values: [1, 2, 0, 4, 0] }] });
  expect(decodeRecords("svelte:screen;a=2;p=formSheet;g=1;s=none;b=1")?.records).toEqual([{ id: 110, values: [2, 4, 1, 1, 1] }, { id: 122, values: [1, 1, 0, 0, 1, 0] }]);
  expect(decodeRecords("svelte:screen;a=2;p=formSheet;g=1;s=default;b=1;gr=1;dm=0;bd=1")?.records[1]).toEqual({ id: 122, values: [1, 1, 0, 1, 0, 1] });
  expect(decodeRecords("svelte:screen;a=2;p=sheet;g=1;s=default;b=1")?.records).toEqual([{ id: 110, values: [2, 3, 1, 0, 1] }, { id: 122, values: [2, 0.5, 1, 0, 1, 1, 0] }]);
  expect(decodeRecords("svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=auto,0.75,1,0.1;di=1;gr=0;dm=0;bd=1;ss=l;sx=1;nc=102030ff;ns=d")).toEqual({
    kind: 11,
    records: [
      { id: 110, values: [2, 3, 1, 0, 1] },
      { id: 122, values: [4, -1, 0.75, 1, 0.1, 1, 0, 0, 1] },
      { id: 125, values: [1, 1, 1, 0xff102030, 2] },
    ],
  });
  expect(decodeRecords("svelte:screen;a=2;p=push;g=1;s=default;b=1;ss=d")?.records[1]).toEqual({ id: 125, values: [2, 0, 0, 0, 0] });

  expect(decodeRecords("svelte:header")).toEqual({ kind: 12, records: [{ id: 120, values: [0, -1, -1, -1, 0, 0, 0, 0] }, { id: 121, values: [0] }] });
  expect(decodeRecords("svelte:header;t=A%3BB%3DC%2C%20100%25;st=sub;bt=Back;l=1;tl=1;bk=1;hs=1;tc=ffffffff;bg=00000080;sl=3")?.records).toEqual([
    { id: 120, values: [15, "A;B=C, 100%", "sub", "Back", 1, 0xffffffff, 1, 0x80000000] },
    { id: 121, values: [3] },
  ]);
  expect(decodeRecords("svelte:header;l=1;sl=15")?.records).toEqual([{ id: 120, values: [1, -1, -1, -1, 0, 0, 0, 0] }, { id: 121, values: [15] }]);
  expect(decodeRecords("svelte:header-left")).toEqual({ kind: 13, records: [{ id: 126, values: [0] }] });
  expect(decodeRecords("svelte:header-center")?.records).toEqual([{ id: 126, values: [1] }]);
  expect(decodeRecords("svelte:header-right")?.records).toEqual([{ id: 126, values: [2] }]);
  expect(decodeRecords("svelte:header-search")?.records).toEqual([{ id: 126, values: [3] }, { id: 127, values: [-1, -1, 0] }]);
  expect(decodeRecords("svelte:header-search;ph=Search%E2%80%A6;v=a%20b;ec=4")?.records).toEqual([{ id: 126, values: [3] }, { id: 127, values: ["Search…", "a b", 4] }]);

  expect(decodeRecords("svelte:tabs")).toEqual({ kind: 14, records: [{ id: 123, values: [0, 0, 0, 0, 0, 0, 0, 0, 0] }] });
  expect(decodeRecords("svelte:tabs;sel=2;sc=5;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff;lb=1")?.records).toEqual([{ id: 123, values: [2, 5, 1, 0xff0a84ff, 1, 0xff8e8e93, 1, 0xffffffff, 1] }]);
  expect(decodeRecords("svelte:tab")).toEqual({ kind: 15, records: [{ id: 124, values: [-1, -1, -1, -1, 0, 0, -1, 0] }] });
  expect(decodeRecords("svelte:tab;k=in%2Fbox;t=Inbox;ic=asset%3A%2Fa%20b.png;is=https%3A%2F%2Fx%2Fy.png%3Fa%3D1%26b%3D2;bd=99%2B;ds=1")?.records)
    .toEqual([{ id: 124, values: ["in/box", "Inbox", "asset:/a b.png", "https://x/y.png?a=1&b=2", 0, 2, "99+", 1] }]);
  expect(decodeRecords("svelte:tab;k=me;t=Me;iv=1;bd=")?.records).toEqual([{ id: 124, values: ["me", "Me", -1, -1, 1, 1, "", 0] }]);
  expect(decodeRecords("svelte:tab-icon")).toEqual({ kind: 16, records: [] });

  expect(decodeRecords("svelte:bogus")).toBeNull();
  expect(decodeRecords("view-1")).toBeNull();
});

test("every encoder output decodes: the records of a nativeID built by navigationProps agree with its attributes", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["native-screen", { stackPresentation: "sheet", sheetDetents: [0.4, "auto"], sheetInitialDetent: "auto", navigationBarColor: "rgb(1, 2, 3)" }],
    ["native-header", { title: "T", large: true, slots: 5 }],
    ["native-header-search", { placeholder: "p", eventCount: 2 }],
    ["native-tabs", { selectedIndex: 1, tint: "#123456" }],
    ["native-tab", { tabKey: "k", title: "t", badge: 7 }],
  ];
  for (const [name, attributes] of cases) {
    const decoded = decodeRecords(String(navigationProps(name, attributes).nativeID));
    expect(decoded?.records.length).toBeGreaterThan(0);
  }
  expect(decodeRecords(String(navigationProps("native-screen", cases[0][1]).nativeID))?.records[1]).toEqual({ id: 122, values: [2, 0.4, -1, 1, 1, 1, 0] });
  expect(decodeRecords(String(navigationProps("native-screen", cases[0][1]).nativeID))?.records[2]).toEqual({ id: 125, values: [0, 0, 1, 0xff010203, 0] });
});

test("merging screen options: the inner value wins, objects merge, handlers chain, undefined never overrides", () => {
  const order: string[] = [];
  const merged = mergeScreenOptions(
    { title: "A", subtitle: "base", header: { large: true, hideBack: true }, sheet: { grabber: false }, onDismiss: () => order.push("outer"), onAppear: () => order.push("appear"), canGoBack: true },
    { title: "B", subtitle: undefined, header: { large: undefined, tint: "#fff" }, onDismiss: () => order.push("inner"), onDisappear: () => order.push("disappear") },
  );
  expect(merged.title).toBe("B");
  expect(merged.subtitle).toBe("base");
  expect(merged.header).toEqual({ large: true, hideBack: true, tint: "#fff" });
  expect(merged.sheet).toEqual({ grabber: false });
  expect(merged.canGoBack).toBe(true);
  merged.onDismiss?.();
  merged.onAppear?.();
  merged.onDisappear?.();
  expect(order).toEqual(["outer", "inner", "appear", "disappear"]);
  expect(mergeScreenOptions({ title: "A" }, {})).toEqual({ title: "A" });
});

test("Screen and Tabs stay components: they take snippets, so the lowering preprocessor must not rewrite them", () => {
  expect(Object.hasOwn(LOWERED_TAGS, "Screen")).toBe(false);
  expect(Object.hasOwn(LOWERED_TAGS, "Tabs")).toBe(false);
  const source = `<script>\n  import { Screen, Tabs, View } from "@rasheed/svelte-native";\n</script>\n<Screen title="x">{#snippet headerRight()}<View />{/snippet}</Screen>\n<Tabs items={items} selected={s} content={pane} />`;
  const lowered = lowerPrimitives(source, { filename: "x.svelte", warn: noop });
  expect(lowered).toContain('<Screen title="x">');
  expect(lowered).toContain("<native-view ></native-view>");
  expect(lowered).toContain("<Tabs items={items}");
});

// Screen and Tabs through the Fabric host: the tags reach the engine as RCTView nodes carrying the encoded nativeID.
const ofKind = (nodes: FakeNode[], kind: string): FakeNode[] => nodes.flatMap((node) => [...(parseNativeID(String(node.props.nativeID ?? ""))?.kind === kind ? [node] : []), ...ofKind(node.children, kind)]);
const ofTestID = (nodes: FakeNode[], testID: string): FakeNode[] => nodes.flatMap((node) => [...(node.props.testID === testID ? [node] : []), ...ofTestID(node.children, testID)]);
const environment = globalThis as { __navigationInsets?: unknown; __navigationOS?: string };
const withInsets = (top: number, bottom = 34) => { environment.__navigationInsets = { top, right: 0, bottom, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 } }; };
const reset = () => { delete environment.__navigationInsets; delete environment.__navigationOS; };
type ScreenApp = { set: (patch: object) => void; show: (patch: object) => void; nest: (value: object | null) => void; events: () => string[] };
type TabsApp = { select: (key: string) => void; setItems: (items: object[]) => void; setLazy: (value: boolean) => void; selection: () => string; events: () => string[]; handle: (key: string) => { key: string; selected: boolean } };
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...(Array.isArray(style) ? style : [style]).filter(Boolean));

async function mountScreen(surface: number) {
  const m = await load("screen-fixture.svelte");
  calls.length = 0; roots = {};
  const app = m.startSurface(surface, m.Fixture, {}) as ScreenApp;
  await settle(m);
  const screen = () => ofKind(roots[surface], "screen")[0];
  const header = () => ofKind(roots[surface], "header")[0];
  return { m, app, screen, header, flush: () => settle(m), tree: () => roots[surface] };
}

test("a Screen renders its native-screen, an opt-in header sized from the insets store, and a content view", async () => {
  withInsets(24);
  try {
    const { app, screen, header, flush } = await mountScreen(41);
    expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
    expect(screen().children.map((child) => child.props.nativeID ?? "content")).toEqual(["svelte:header;t=Inbox", "content"]);
    expect(flat(header().props.style)).toEqual({ height: 80, paddingTop: 24, paddingStart: 0, flexDirection: "row", alignItems: "center" });
    expect(screen().children[1].props.style).toEqual({ flex: 1 });
    expect(ofTestID(roots[41], "page")).toHaveLength(1);

    app.set({ title: undefined });
    await flush();
    expect(ofKind(roots[41], "header")).toHaveLength(0);
    expect(screen().children).toHaveLength(1);

    app.set({ header: { large: true, translucent: true, background: "#102030", tint: "#fff", hideShadow: true, backTitle: "Home" } });
    await flush();
    expect(header().props.nativeID).toBe("svelte:header;bt=Home;l=1;tl=1;hs=1;tc=ffffffff;bg=102030ff");
    expect(flat(header().props.style)).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0, height: 136, paddingTop: 24 });

    app.set({ header: { hidden: true }, title: "Hidden" });
    await flush();
    expect(ofKind(roots[41], "header")).toHaveLength(0);
  } finally { reset(); }
});

test("the header height estimate follows the platform and the native metrics correct it", async () => {
  withInsets(59);
  environment.__navigationOS = "ios";
  try {
    const { header, flush } = await mountScreen(42);
    expect(flat(header().props.style)).toMatchObject({ height: 103, paddingTop: 59 });
    expect(ofKind(roots[42], "header-center")).toHaveLength(0);
    emit(header().target, "topMetrics", { height: 110, inset: 62 });
    await flush();
    expect(flat(header().props.style)).toMatchObject({ height: 110, paddingTop: 62 });
    expect(ofTestID(roots[42], "header-110-62")).toHaveLength(1);
  } finally { reset(); }
});

test("measured metrics apply to the large state they were measured in only", async () => {
  withInsets(24);
  try {
    const { app, header, flush } = await mountScreen(43);
    emit(header().target, "topMetrics", { height: 90, inset: 30 });
    await flush();
    expect(flat(header().props.style)).toMatchObject({ height: 90, paddingTop: 30 });
    app.set({ header: { large: true } });
    await flush();
    expect(flat(header().props.style)).toMatchObject({ height: 136, paddingTop: 24 });
    emit(header().target, "topMetrics", { height: 146, inset: 30 });
    await flush();
    expect(flat(header().props.style)).toMatchObject({ height: 146, paddingTop: 30 });
    expect(ofTestID(roots[43], "header-146-30")).toHaveLength(1);
  } finally { reset(); }
});

test("the back button is reserved only for a pushed screen that has a screen below and no left slot", async () => {
  withInsets(0);
  try {
    const { app, header, flush } = await mountScreen(44);
    expect(header().props.nativeID).toBe("svelte:header;t=Inbox");
    app.set({ canGoBack: true });
    await flush();
    expect(header().props.nativeID).toBe("svelte:header;t=Inbox;bk=1");
    expect(flat(header().props.style).paddingStart).toBe(48);
    app.set({ header: { hideBack: true } });
    await flush();
    expect(header().props.nativeID).toBe("svelte:header;t=Inbox");
    app.set({ header: { backTitle: "Inbox" } });
    app.show({ left: true });
    await flush();
    expect(header().props.nativeID).toBe("svelte:header;t=Inbox;bt=Inbox;sl=1");
    app.show({ left: false });
    app.set({ presentation: "modal" });
    await flush();
    expect(header().props.nativeID).toBe("svelte:header;t=Inbox;bt=Inbox");
  } finally { reset(); }
});

test("header slots mount in reading order with their presence mask, and the center slot aligns by platform", async () => {
  withInsets(24);
  try {
    const { app, header, flush } = await mountScreen(45);
    app.show({ left: true, center: true, right: true, results: true });
    app.set({ search: { placeholder: "Search" } });
    await flush();
    expect(header().props.nativeID).toBe("svelte:header;t=Inbox;sl=15");
    expect(header().children.map((child) => parseNativeID(String(child.props.nativeID))?.kind)).toEqual(["header-left", "header-center", "header-right", "header-search"]);
    expect(header().children.map((child) => child.children[0].props.testID)).toEqual(["left", "center", "right", "results"]);
    expect(flat(header().children[1].props.style).justifyContent).toBe("flex-start");
    expect(flat(header().children[3].props.style)).toMatchObject({ position: "absolute", top: "100%", height: 720 });
    app.show({ center: false, results: false });
    await flush();
    expect(header().props.nativeID).toBe("svelte:header;t=Inbox;sl=13");
    expect(header().children).toHaveLength(3);
    expect(header().children[2].children).toHaveLength(0);
  } finally { reset(); }
  withInsets(24);
  environment.__navigationOS = "ios";
  try {
    const { app, header, flush } = await mountScreen(46);
    app.show({ center: true });
    await flush();
    expect(flat(header().children[0].props.style).justifyContent).toBe("center");
  } finally { reset(); }
});

test("search: native text events reach the handlers unwrapped and the acknowledged count travels back", async () => {
  withInsets(24);
  try {
    const { app, header, flush } = await mountScreen(47);
    const texts: string[] = [];
    const log: string[] = [];
    app.set({ search: { placeholder: "Search", value: "ab", onChangeText: (text: string) => texts.push(text), onSubmit: (text: string) => log.push(`submit ${text}`), onCancel: () => log.push("cancel") } });
    await flush();
    const search = () => ofKind(roots[47], "header-search")[0];
    expect(search().props.nativeID).toBe("svelte:header-search;ph=Search;v=ab");
    expect(header().props.nativeID).toBe("svelte:header;t=Inbox;sl=8");
    emit(search().target, "topChange", { text: "abc", eventCount: 3 });
    await flush();
    expect(texts).toEqual(["abc"]);
    expect(search().props.nativeID).toBe("svelte:header-search;ph=Search;v=ab;ec=3");
    emit(search().target, "topSubmitEditing", { text: "abc" });
    emit(search().target, "topCancel", {});
    expect(log).toEqual(["submit abc", "cancel"]);
    app.set({ search: { placeholder: "Search", value: "abc" } });
    await flush();
    expect(search().props.nativeID).toBe("svelte:header-search;ph=Search;v=abc;ec=3");
  } finally { reset(); }
});

test("presentation, sheet and system bar options reach the screen nativeID and style", async () => {
  withInsets(24);
  try {
    const { app, screen, flush } = await mountScreen(48);
    app.set({ presentation: "sheet", sheet: { detents: [0.4, 1], initialDetent: 1, grabber: false } });
    await flush();
    expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=sheet;g=1;s=default;b=1;dt=0.4,1;di=1;gr=0");
    expect(flat(screen().props.style)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: 776, height: 776 });
    app.set({ presentation: "formSheet" });
    await flush();
    expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=formSheet;g=1;s=default;b=1");
    expect(flat(screen().props.style)).toEqual({ position: "absolute", top: 24, left: 0, right: 0, bottom: 0 });
    app.set({ presentation: "transparentModal", animation: "fade", gestureEnabled: false, nativeBackButtonDismissalEnabled: false, activityState: 1, statusBar: { style: "light", hidden: true }, navigationBar: { color: "#000", style: "light" } });
    await flush();
    expect(screen().props.nativeID).toBe("svelte:screen;a=1;p=transparentModal;g=0;s=fade;b=0;ss=l;sx=1;nc=000000ff;ns=l");
  } finally { reset(); }
});

test("screen events reach the handlers: appear, disappear, dismissed and detent changes carry their payloads", async () => {
  withInsets(24);
  try {
    const { app, screen, flush } = await mountScreen(49);
    expect(screen().props.onAppear).toBe(true);
    expect(screen().props.onDisappear).toBe(true);
    expect(screen().props.onDismissed).toBe(true);
    expect(screen().props.onDetentChange).toBe(true);
    emit(screen().target, "topAppear", {});
    emit(screen().target, "topDetentChange", { index: 1, fraction: 0.5 });
    emit(screen().target, "topDisappear", {});
    emit(screen().target, "topDismissed", { dismissCount: 1 });
    expect(app.events()).toEqual(["appear", "detent 1 0.5", "disappear", "dismiss"]);
    await flush();
  } finally { reset(); }
});

test("a Screen inside a Screen hands its options to the outer one and renders only its content", async () => {
  withInsets(24);
  try {
    const { app, screen, header, flush, tree } = await mountScreen(50);
    app.nest({ title: "Page", header: { large: true }, statusBar: { style: "dark" } });
    await flush();
    expect(ofKind(tree(), "screen")).toHaveLength(1);
    expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1;ss=d");
    expect(header().props.nativeID).toBe("svelte:header;t=Page;l=1");
    expect(ofKind(tree(), "header")).toHaveLength(1);
    expect(ofTestID(tree(), "page")).toHaveLength(1);
    expect(ofTestID(tree(), "header-136-24")).toHaveLength(1);
    emit(screen().target, "topDismissed", { dismissCount: 1 });
    expect(app.events()).toEqual(["dismiss", "inner dismiss"]);
    app.nest(null);
    await flush();
    expect(header().props.nativeID).toBe("svelte:header;t=Inbox");
    expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  } finally { reset(); }
});

async function mountTabs(surface: number) {
  const m = await load("tabs-fixture.svelte");
  calls.length = 0; roots = {};
  const app = m.startSurface(surface, m.Fixture, {}) as TabsApp;
  await settle(m);
  const tabs = () => ofKind(roots[surface], "tabs")[0];
  const panes = () => ofKind(roots[surface], "tab");
  return { m, app, tabs, panes, flush: () => settle(m), tree: () => roots[surface] };
}

test("Tabs render one pane per item with the selection, icons and badges; panes mount lazily and keep their own screens", async () => {
  withInsets(24);
  try {
    const { tabs, panes, tree } = await mountTabs(51);
    expect(tabs().props.nativeID).toBe("svelte:tabs;sel=0;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff");
    expect(tabs().props.onSelect).toBe(true);
    expect(panes().map((pane) => pane.props.nativeID)).toEqual([
      "svelte:tab;k=home;t=Home;ic=asset%3A%2Fhome.png;is=asset%3A%2Fhome-fill.png",
      "svelte:tab;k=inbox;t=Inbox;bd=99%2B",
      "svelte:tab;k=me;t=Me;iv=1;bd=;ds=1",
    ]);
    expect(panes().map((pane) => flat(pane.props.style).bottom)).toEqual([98, 98, 98]);
    expect(panes()[1].props.accessibilityLabel).toBe("Inbox, new messages");
    expect(panes()[1].props.testID).toBe("tab-inbox");
    expect(ofKind(panes()[2].children, "tab-icon")).toHaveLength(1);
    expect(ofTestID(tree(), "glyph-false")).toHaveLength(1);
    // Only the selected pane mounted; its screen is a real native-screen, not merged into the one that holds the tabs.
    expect(ofTestID(tree(), "pane-home")).toHaveLength(1);
    expect(ofTestID(tree(), "pane-inbox")).toHaveLength(0);
    expect(ofKind(tree(), "screen")).toHaveLength(2);
    expect(ofKind(tree(), "header").map((node) => node.props.nativeID)).toEqual(["svelte:header;t=Root", "svelte:header;t=Pane%20home"]);
  } finally { reset(); }
});

test("selecting a tab mounts its pane and keeps the others; handles report which tab is selected", async () => {
  withInsets(24);
  try {
    const { app, tabs, flush, tree } = await mountTabs(52);
    expect(app.handle("home").selected).toBe(true);
    app.select("inbox");
    await flush();
    expect(tabs().props.nativeID).toBe("svelte:tabs;sel=1;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff");
    expect(ofTestID(tree(), "pane-home")).toHaveLength(1);
    expect(ofTestID(tree(), "pane-inbox")).toHaveLength(1);
    expect(ofKind(tree(), "screen")).toHaveLength(3);
    expect(app.handle("home").selected).toBe(false);
    expect(app.handle("inbox").selected).toBe(true);
    expect(ofTestID(tree(), "glyph-false")).toHaveLength(1);
    app.setLazy(false);
    await flush();
    expect(ofTestID(tree(), "pane-me")).toHaveLength(1);
  } finally { reset(); }
});

test("a tab press reports the key and the select count re-asserts the selection when the owner ignores it", async () => {
  withInsets(24);
  try {
    const { app, tabs, flush } = await mountTabs(53);
    emit(tabs().target, "topSelect", { key: "inbox", index: 1 });
    await flush();
    expect(app.events()).toEqual(["inbox"]);
    expect(app.selection()).toBe("home");
    expect(tabs().props.nativeID).toBe("svelte:tabs;sel=0;sc=1;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff");
    app.select("inbox");
    emit(tabs().target, "topSelect", { key: "me", index: 2 });
    await flush();
    expect(tabs().props.nativeID).toBe("svelte:tabs;sel=1;sc=2;tc=0a84ffff;uc=8e8e93ff;bg=ffffffff");
  } finally { reset(); }
});

test("tab bar metrics from the native side set the panes' bottom edge; the estimate uses the platform bar and the bottom inset", async () => {
  withInsets(24, 20);
  try {
    const { tabs, panes, flush } = await mountTabs(54);
    expect(panes().map((pane) => flat(pane.props.style).bottom)).toEqual([84, 84, 84]);
    emit(tabs().target, "topMetrics", { height: 100, inset: 34 });
    await flush();
    expect(panes().map((pane) => flat(pane.props.style).bottom)).toEqual([100, 100, 100]);
  } finally { reset(); }
  withInsets(24, 34);
  environment.__navigationOS = "ios";
  try {
    const { panes } = await mountTabs(55);
    expect(panes().map((pane) => flat(pane.props.style).bottom)).toEqual([83, 83, 83]);
  } finally { reset(); }
});

const texts = (root: number) => find(roots[root] ?? [], "RCTRawText").map((node) => String(node.props.text));
const turns = async (m: { tick: () => Promise<void> }) => { for (let turn = 0; turn < 8; turn++) await settle(m); };
type RouterApp = {
  loadLog: () => string[];
  release: (id: string) => void;
  fail: (id: string, message: string) => void;
  goto: (href: string, options?: { replaceState?: boolean; reset?: boolean }) => void;
  back: () => boolean;
  stack: () => string[];
  modulesOf: (id: string) => string;
};

test("the router loads the first screen's route when it is created and every other route on its first navigation", async () => {
  const m = await load("router-fixture.svelte");
  calls.length = 0; roots = {};
  const app = m.startSurface(41, m.Fixture, {}) as RouterApp;
  expect(app.loadLog()).toEqual(["home"]);
  expect(app.modulesOf("home")).toBe("loading");
  expect(app.modulesOf("section")).toBe("loading");
  app.release("home");
  await turns(m);
  expect(app.modulesOf("home")).toBe("ready");
  expect(texts(41)).toEqual(["page /"]);

  app.goto("/a");
  app.goto("/b/7");
  expect(app.loadLog()).toEqual(["home", "section", "item"]); // the loader runs inside goto, before the screen mounts
  app.release("section");
  app.release("item");
  await turns(m);
  expect(texts(41)).toEqual(["page /", "page /a", "page /b/7:7"]);

  expect(app.back()).toBe(true);
  app.goto("/a/", { replaceState: true });
  app.goto("/b/7", { reset: true });
  await turns(m);
  expect(app.loadLog()).toEqual(["home", "section", "item"]); // each route loads once
  expect(app.stack()).toEqual(["/b/7"]);
  // The left screens stay mounted (activityState 0) until the stack reports their exit.
  for (const screen of roots[41][0].children) if (activityOf(screen) === "0") emit(screen.target, "topExited", {});
  await turns(m);
  expect(texts(41)).toEqual(["page /b/7:7"]);
});

test("a screen is empty until its route loads, shows the loading snippet when given one, and keeps its presentation", async () => {
  const bare = await load("router-fixture.svelte");
  calls.length = 0; roots = {};
  const plain = bare.startSurface(42, bare.Fixture, {}) as RouterApp;
  const screen = () => roots[42][0].children[0];
  expect(screen().props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(screen().children).toHaveLength(1); // the outer Screen's content view, still empty
  expect(screen().children[0].children).toHaveLength(0);
  plain.release("home");
  await turns(bare);
  expect(texts(42)).toEqual(["page /"]);

  const m = await load("router-fixture.svelte");
  calls.length = 0; roots = {};
  const app = m.startSurface(43, m.Fixture, { withLoading: true, initial: "/b/9" }) as RouterApp;
  expect(texts(43)).toEqual(["loading item"]);
  expect(roots[43][0].children[0].props.nativeID).toBe("svelte:screen;a=2;p=modal;g=1;s=default;b=1"); // modal before the modules arrive
  app.release("item");
  await turns(m);
  expect(texts(43)).toEqual(["page /b/9:9"]);
  expect(app.loadLog()).toEqual(["item"]);
});

test("layouts render around the page once the route's modules are in, outermost first", async () => {
  const m = await load("router-fixture.svelte");
  calls.length = 0; roots = {};
  const app = m.startSurface(44, m.Fixture, { initial: "/a" }) as RouterApp;
  expect(find(roots[44], "RCTView").filter((node) => node.props.testID === "layout")).toHaveLength(0);
  app.release("section");
  await turns(m);
  const [layout] = find(roots[44], "RCTView").filter((node) => node.props.testID === "layout");
  expect(layout).toBeDefined();
  expect(find([layout], "RCTRawText").map((node) => node.props.text)).toEqual(["page /a"]);
});

test("a route that fails to load throws where it renders and loads again on its next navigation", async () => {
  const m = await load("router-fixture.svelte");
  calls.length = 0; roots = {};
  const app = m.startSurface(45, m.Fixture, {}) as RouterApp;
  app.release("home");
  app.goto("/a");
  app.fail("section", "chunk missing");
  await turns(m);
  expect(app.modulesOf("section")).toBe("failed: chunk missing");
  expect(texts(45)).toEqual(["failed: chunk missing"]); // the nearest boundary draws what the screen threw
  expect(app.modulesOf("home")).toBe("ready");
  app.back();
  app.goto("/a");
  expect(app.loadLog()).toEqual(["home", "section", "section"]);
  expect(app.modulesOf("section")).toBe("loading"); // the failure is cleared while the new load runs
  app.release("section");
  await turns(m);
  expect(app.modulesOf("section")).toBe("ready");
});

// The router renders the contract's outer Screen per entry and names its stacks.
type ScreensApp = {
  goto: (href: string, options?: { replaceState?: boolean; reset?: boolean; presentation?: string }) => void;
  back: () => boolean;
  screens: () => string[];
  exited: (index: number) => void;
  stack: () => string[];
  scope: () => string | undefined;
};
const header = (screen: FakeNode) => screen.children.find((child) => String(child.props.nativeID).startsWith("svelte:header"));

test("the router renders a Screen per entry: presentation from the route or the navigation, the back button below the first, the page's header merged in", async () => {
  const m = await load("router-screens-fixture.svelte");
  calls.length = 0; roots = {};
  const app = m.startSurface(51, m.Fixture, {}) as ScreensApp;
  await turns(m);
  const screens = () => roots[51][0].children;
  expect(screens()).toHaveLength(1);
  expect(screens()[0].props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
  expect(header(screens()[0])?.props.nativeID).toBe("svelte:header;t=Page%20%2F"); // the page's own <Screen title> reached the router's screen, no back button on the first screen

  app.goto("/a");
  app.goto("/b/3");
  app.goto("/a?x=1", { presentation: "sheet" });
  await turns(m);
  expect(app.stack()).toEqual(["/:push", "/a:push", "/b/3:modal", "/a:sheet"]);
  expect(screens().map((screen) => String(screen.props.nativeID).split(";").slice(0, 3).join(";"))).toEqual([
    "svelte:screen;a=2;p=push", "svelte:screen;a=2;p=push", "svelte:screen;a=2;p=modal", "svelte:screen;a=2;p=sheet",
  ]);
  expect(String(screens()[3].props.nativeID)).toContain(";dt=0.5,1");
  // The arrow is for a pushed screen with a screen below: not the first, not a modal, not a sheet; the page's `large` merged as well.
  expect(header(screens()[1])?.props.nativeID).toBe("svelte:header;t=Page%20%2Fa;l=1;bk=1");
  expect(header(screens()[2])?.props.nativeID).toBe("svelte:header;t=Page%20%2Fb%2F3");
  expect(header(screens()[3])?.props.nativeID).toBe("svelte:header;t=Page%20%2Fa;l=1");

  // The user dismissing the modal drops it and the sheet above it.
  emit(screens()[2].target, "topDismissed", { dismissCount: 1 });
  await turns(m);
  expect(app.stack()).toEqual(["/:push", "/a:push"]);
  expect(screens()).toHaveLength(2);
});

// A popped screen stays in the native stack, inactive, until the stack reports its exit (SPEC.md "Screen exit"): the unmount of its page then leaves the transition.
const activityOf = (screen: FakeNode) => String(screen.props.nativeID).match(/;a=(\d)/)?.[1];

test("on iOS a popped screen stays mounted with activityState 0 until the stack sends topExited; the stack the router works on drops it at once", async () => {
  environment.__navigationOS = "ios";
  jest.useFakeTimers(); // the exit timeout of what the test leaves leaving never fires
  try {
    const m = await load("router-screens-fixture.svelte");
    calls.length = 0; roots = {};
    const app = m.startSurface(56, m.Fixture, {}) as ScreensApp;
    await turns(m);
    app.goto("/a");
    app.goto("/b/3");
    await turns(m);
    const screens = () => roots[56][0].children;
    expect(screens().map(activityOf)).toEqual(["2", "2", "2"]);
    expect(app.back()).toBe(true);
    await turns(m);
    expect(app.stack()).toEqual(["/:push", "/a:push"]); // `entries`, `current` and `back` see the live stack
    expect(app.screens()).toEqual(["/:root:live", "/a:back:live", "/b/3:back:leaving"]);
    expect(screens()).toHaveLength(3);
    expect(screens().map(activityOf)).toEqual(["2", "2", "0"]);
    expect(find([screens()[2]], "RCTRawText").map((node) => node.props.text)).toEqual(["page /b/3:3"]); // its page is still there
    expect(app.back()).toBe(true);
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live", "/a:back:leaving", "/b/3:back:leaving"]);
    app.exited(2);
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live", "/a:back:leaving"]);
    expect(screens()).toHaveLength(2);
    emit(screens()[1].target, "topExited", {});
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live"]);
    expect(screens()).toHaveLength(1);
  } finally { jest.useRealTimers(); reset(); }
});

test("a screen pushed while another leaves goes below it; a replacement, a reset and a base replacement retire what they remove; a user dismissal drops at once", async () => {
  environment.__navigationOS = "ios";
  jest.useFakeTimers(); // the exit timeout of what the test leaves leaving never fires
  try {
    const m = await load("router-screens-fixture.svelte");
    calls.length = 0; roots = {};
    const app = m.startSurface(57, m.Fixture, {}) as ScreensApp;
    await turns(m);
    app.goto("/a");
    app.goto("/b/3");
    await turns(m);
    app.back();
    app.goto("/a?x=1");
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live", "/a:back:live", "/a:back:live", "/b/3:back:leaving"]);
    app.goto("/b/4", { replaceState: true });
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live", "/a:back:live", "/b/4:back:live", "/a:back:leaving", "/b/3:back:leaving"]); // the new screen goes under the ones that leave
    app.goto("/a", { reset: true });
    await turns(m);
    expect(app.stack()).toEqual(["/a:push"]);
    expect(app.screens().filter((entry) => entry.endsWith("leaving"))).toHaveLength(5);
    const screens = () => roots[57][0].children;
    expect(screens().filter((screen) => activityOf(screen) === "0")).toHaveLength(5);

    // The user's own dismissal has happened natively by the time JavaScript hears of it: nothing to wait for.
    const second = await load("router-screens-fixture.svelte");
    calls.length = 0; roots = {};
    const plain = second.startSurface(58, second.Fixture, {}) as ScreensApp;
    await turns(second);
    plain.goto("/a");
    plain.goto("/b/3");
    await turns(second);
    emit(roots[58][0].children[1].target, "topDismissed", { dismissCount: 1 });
    await turns(second);
    expect(plain.screens()).toEqual(["/:root:live"]);
    expect(roots[58][0].children).toHaveLength(1);
  } finally { jest.useRealTimers(); reset(); }
});

test("a popped screen that never reports its exit is removed after EXIT_TIMEOUT_MS, with a warning", async () => {
  environment.__navigationOS = "ios";
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  jest.useFakeTimers();
  try {
    const m = await load("router-screens-fixture.svelte");
    calls.length = 0; roots = {};
    const app = m.startSurface(59, m.Fixture, {}) as ScreensApp;
    await turns(m);
    app.goto("/a");
    app.back();
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live", "/a:back:leaving"]);
    jest.advanceTimersByTime(EXIT_TIMEOUT_MS - 1);
    expect(app.screens()).toHaveLength(2);
    jest.advanceTimersByTime(2);
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live"]);
    expect(roots[59][0].children).toHaveLength(1);
    expect(warnings).toHaveLength(1);
  } finally { jest.useRealTimers(); console.warn = warn; reset(); }
});

test("on Android a popped screen stays mounted with activityState 0 until the stack sends topExited", async () => {
  jest.useFakeTimers(); // the exit timeout never fires here
  try {
    const m = await load("router-screens-fixture.svelte");
    calls.length = 0; roots = {};
    const app = m.startSurface(60, m.Fixture, {}) as ScreensApp;
    await turns(m);
    app.goto("/a");
    await turns(m);
    const screens = () => roots[60][0].children;
    expect(app.back()).toBe(true);
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live", "/a:back:leaving"]);
    expect(screens().map(activityOf)).toEqual(["2", "0"]);
    emit(screens()[1].target, "topExited", {});
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live"]);
    expect(screens()).toHaveLength(1);
    expect(screens().map(activityOf)).toEqual(["2"]);
  } finally { jest.useRealTimers(); reset(); }
});

type NestedApp = ScreensApp & { dummy?: never };
type Nested = {
  router: { entries: unknown[]; goto: (href: string) => void; scope?: string; active: () => boolean; back: () => boolean };
  outer: { scope?: string };
  found: { nearest: unknown; root: unknown; self: unknown };
  missing: string;
  setActive: (value: boolean) => void;
};
const handlersOf = (key: "__backHandlers" | "__linkHandlers") => (globalThis as unknown as Record<string, ((...args: never[]) => unknown)[]>)[key];

test("routers are named: the outermost is root, a nested one takes its scope, and useRouter finds either from below", async () => {
  const m = await load("router-screens-fixture.svelte");
  calls.length = 0; roots = {};
  const app = m.startSurface(52, m.Fixture, { nested: true }) as NestedApp;
  await turns(m);
  const nested = (globalThis as unknown as { __nested: Nested }).__nested;
  expect((app as unknown as ScreensApp).scope()).toBe("root");
  expect(nested.outer.scope).toBe("root");
  expect(nested.router.scope).toBe("tab-a");
  expect(nested.found.nearest).toBe(nested.router);
  expect(nested.found.self).toBe(nested.router);
  expect(nested.found.root).toBe(nested.outer);
  expect(nested.missing).toContain("nope");
  // The nested router's own screens are real screens inside the root's first screen, not merged into it.
  expect(find(roots[52], "RCTView").filter((node) => String(node.props.nativeID).startsWith("svelte:stack"))).toHaveLength(2);
});

test("a named router carries route params and the query like the root router does", async () => {
  const m = await load("router-screens-fixture.svelte");
  calls.length = 0; roots = {};
  m.startSurface(54, m.Fixture, { nested: true });
  await turns(m);
  const nested = (globalThis as unknown as { __nested: Nested }).__nested;
  nested.router.goto("/t/n/7?x=1");
  const entry = nested.router.entries.at(-1) as { params: Record<string, string>; url: URL; presentation: string };
  expect(entry.params).toEqual({ id: "7" });
  expect(entry.url.search).toBe("?x=1");
  expect(entry.presentation).toBe("push");
  await turns(m);
  expect(texts(54)).toContain("page /t/n/7:7");
});

test("the back key belongs to a router only while it is active, and links only to the outermost one", async () => {
  const m = await load("router-screens-fixture.svelte");
  handlersOf("__backHandlers").length = 0;
  handlersOf("__linkHandlers").length = 0;
  calls.length = 0; roots = {};
  const app = m.startSurface(53, m.Fixture, { nested: true }) as ScreensApp;
  await turns(m);
  const nested = (globalThis as unknown as { __nested: Nested }).__nested;
  // React Native asks the handlers newest first and stops at the first `true`.
  const back = () => [...handlersOf("__backHandlers")].reverse().some((handler) => (handler as () => boolean)());
  const link = (url: string) => { for (const handler of handlersOf("__linkHandlers")) (handler as (event: { url: string }) => void)({ url }); };
  expect(handlersOf("__backHandlers")).toHaveLength(2);

  expect(back()).toBe(false); // one entry in each stack: nobody takes it, the app may leave
  nested.router.goto("/t/b");
  expect(nested.router.entries).toHaveLength(2);
  nested.setActive(false);
  await turns(m);
  expect(back()).toBe(false); // the tab is not selected: its stack keeps its screens
  expect(nested.router.entries).toHaveLength(2);
  // A link is the app's: the root opens it, a nested router never does, active or not (a tab whose routes match the URL
  // would otherwise push the same screen again).
  link("rasheed://a");
  expect(app.stack()).toEqual(["/:push", "/a:push"]);
  expect(nested.router.entries).toHaveLength(2);
  nested.setActive(true);
  await turns(m);
  link("rasheed://t/a");
  expect(nested.router.entries).toHaveLength(2);
  expect(app.stack()).toEqual(["/:push", "/a:push"]);
  nested.router.goto("/t/a?again");
  expect(nested.router.entries).toHaveLength(3);
  expect(back()).toBe(true);
  expect(back()).toBe(true);
  expect(nested.router.entries).toHaveLength(1);
  expect(back()).toBe(true); // the tab is at its root: the key falls through to the root stack, which pops the screen the link opened
  expect(app.stack()).toEqual(["/:push"]);
  expect(back()).toBe(false);
});

// The route tree: navigators as routes, tabs with a stack per pane (SPEC.md "Route tree: layouts as navigators").
type TreeRouter = {
  scope: string | undefined; active: () => boolean; entries: { url: URL; presentation: string; params: Record<string, string> }[]; current: { url: URL };
  selected: string | undefined; goto: (href: string, options?: { replaceState?: boolean; reset?: boolean; presentation?: string }) => void; back: () => boolean;
  replaceBase: (href: string) => void; openURL: (href: string) => boolean; screens: { leaving: boolean }[];
};
type TreeApp = { root: () => TreeRouter };
const treeGlobals = globalThis as { __treeRouters?: Record<string, TreeRouter>; __treeOptions?: Record<string, object>; __treeTabs?: object[]; __treeSelections?: string[]; __treePanes?: unknown };
const pathsOf = (router: TreeRouter) => router.entries.map((entry) => `${entry.url.pathname}${entry.url.search}`);
const selectedIndex = (surface: number) => parseNativeID(String(ofKind(roots[surface], "tabs")[0].props.nativeID))?.pairs.sel;
const paneRouter = (path: string): TreeRouter => { const router = treeGlobals.__treeRouters?.[path]; if (!router) throw new Error(`no page rendered at ${path}`); return router; };

async function mountTree(surface: number, props: Record<string, unknown> = {}) {
  const m = await load("tree-fixture.svelte");
  calls.length = 0; roots = {};
  treeGlobals.__treeRouters = {}; delete treeGlobals.__treeOptions; delete treeGlobals.__treeTabs; delete treeGlobals.__treeSelections;
  handlersOf("__backHandlers").length = 0;
  const app = m.startSurface(surface, m.Fixture, props) as TreeApp;
  await turns(m);
  // React Native asks the handlers newest first and stops at the first `true`.
  const hardwareBack = () => [...handlersOf("__backHandlers")].reverse().some((handler) => (handler as () => boolean)());
  const settled = () => turns(m);
  return { m, router: app.root(), hardwareBack, settled, texts: () => texts(surface), tree: () => roots[surface] };
}
const tabScreens = (tree: FakeNode[]) => ofKind(tree, "tab").map((pane) => ofKind(pane.children, "screen"));

test("a deep link into the tabs puts the tabs screen on the root stack, selects the pane and stacks its route there; only the selected pane mounts", async () => {
  withInsets(24);
  try {
    const { router, texts: shown, tree } = await mountTree(81, { initial: "/acme/inbox/compose" });
    expect(router.scope).toBe("root");
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(router.entries[0].params).toEqual({ slug: "acme" });
    expect(router.selected).toBeUndefined(); // the root is a stack; the tabs router is the layout's
    expect(selectedIndex(81)).toBe("1");
    expect(paneRouter("/acme/inbox/compose").scope).toBe("inbox");
    expect(paneRouter("/acme/inbox").scope).toBe("inbox");
    expect(router.current.url.pathname).toBe("/acme/inbox/compose"); // the deepest shown entry
    expect(shown()).toEqual(["page /acme/inbox", "page /acme/inbox/compose"]); // the home pane has not mounted
    expect(ofKind(tree(), "tab").map((pane) => String(pane.props.nativeID).split(";").slice(1, 3).join(";"))).toEqual(["k=home;t=Home", "k=inbox;t=Inbox"]);
    const [home, inbox] = tabScreens(tree());
    expect(home).toHaveLength(0);
    expect(inbox.map((screen) => String(screen.props.nativeID).split(";").slice(0, 3).join(";"))).toEqual(["svelte:screen;a=2;p=push", "svelte:screen;a=2;p=sheet"]);
    expect(treeGlobals.__treePanes).toEqual([{ key: "home" }, { key: "inbox" }]);
  } finally { reset(); }
});

test("a push within the shown pane touches only that pane's stack; a route of another pane selects the tab and stacks there", async () => {
  withInsets(24);
  try {
    const { router, settled, texts: shown } = await mountTree(82, { initial: "/acme/home" });
    expect(selectedIndex(82)).toBe("0");
    router.goto("/acme/home/thread/42");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/42"]);
    expect(paneRouter("/acme/home/thread/42").entries[1].params).toEqual({ slug: "acme", id: "42" });
    expect(selectedIndex(82)).toBe("0");

    router.goto("/acme/inbox");
    await settled();
    expect(selectedIndex(82)).toBe("1");
    expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox"]); // the pane starts on its index page; the route is that page
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/42"]); // the other pane keeps its stack
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(shown()).toEqual(["page /acme/home", "page /acme/home/thread/42", "page /acme/inbox"]);

    router.goto("/acme/inbox/compose", { presentation: "modal" });
    await settled();
    expect(paneRouter("/acme/inbox").entries.map((entry) => entry.presentation)).toEqual(["push", "modal"]);
    // The tabs screen is the root's; `useRouter()` on a page in a pane is the pane's; both reach the same tree.
    paneRouter("/acme/home").goto("/acme/home/thread/43");
    await settled();
    expect(selectedIndex(82)).toBe("0");
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/42", "/acme/home/thread/43"]);
  } finally { reset(); }
});

test("a modal over the tabs is popped by a navigation to a tab route; the route that is already shown does nothing", async () => {
  withInsets(24);
  try {
    const { router, settled, tree } = await mountTree(83, { initial: "/acme/home" });
    router.goto("/account");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme", "/account"]);
    expect(router.entries[1].presentation).toBe("modal");
    expect(router.current.url.pathname).toBe("/account");
    expect(paneRouter("/acme/home").active()).toBe(false); // covered
    expect(router.active()).toBe(true);

    router.goto("/acme/home"); // shown below the modal: the modal goes, nothing is pushed
    await settled();
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
    const rootScreens = () => ofKind(tree(), "stack")[0].children;
    expect(rootScreens().map(activityOf)).toEqual(["2", "0"]); // the modal stays mounted, leaving, until the native stack reports its exit
    emit(rootScreens()[1].target, "topExited", {});
    await settled();
    expect(rootScreens()).toHaveLength(1);

    router.goto("/account");
    router.goto("/acme/inbox");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(selectedIndex(83)).toBe("1");
    expect(paneRouter("/acme/home").active()).toBe(false); // its tab is not selected
    expect(paneRouter("/acme/inbox").active()).toBe(true);
  } finally { reset(); }
});

test("back at a pane's base neither pops the pane nor switches tabs: the stack above it pops, and the root at one entry leaves the app", async () => {
  withInsets(24);
  try {
    const { router, settled, hardwareBack } = await mountTree(84, { initial: "/acme/inbox/compose" });
    router.goto("/acme/home/thread/1"); // also visits the home pane
    await settled();
    router.goto("/acme/inbox");
    await settled();
    const inbox = paneRouter("/acme/inbox/compose");
    expect(pathsOf(inbox)).toEqual(["/acme/inbox", "/acme/inbox/compose", "/acme/inbox"]);

    expect(inbox.back()).toBe(true);
    expect(pathsOf(inbox)).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
    expect(hardwareBack()).toBe(true);
    expect(pathsOf(inbox)).toEqual(["/acme/inbox"]);
    expect(hardwareBack()).toBe(false); // at the base, one screen on the root: the key falls through to the app
    expect(inbox.back()).toBe(false);
    expect(selectedIndex(84)).toBe("1");
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/1"]); // not asked: its tab is not selected

    // A screen on the root stack above the tabs: its pop is the pane's base pop.
    router.goto("/workspaces");
    await settled();
    expect(inbox.active()).toBe(false);
    expect(hardwareBack()).toBe(true);
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(inbox.back()).toBe(false);
    // Programmatically, a pane at its base hands the pop to the stack above it.
    router.goto("/account");
    await settled();
    expect(inbox.back()).toBe(true);
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(selectedIndex(84)).toBe("1");
  } finally { reset(); }
});

test("a modal over the tabs takes the back key before the pane below it, whatever the pane's depth", async () => {
  withInsets(24);
  try {
    const { router, settled, hardwareBack } = await mountTree(85, { initial: "/acme/home" });
    router.goto("/acme/home/thread/9");
    router.goto("/account");
    await settled();
    expect(hardwareBack()).toBe(true);
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/9"]);
    expect(hardwareBack()).toBe(true);
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
  } finally { reset(); }
});

test("two screens of one tabs navigator keep a state each: another workspace's tabs start on their first pane with their own stacks", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountTree(86, { initial: "/acme/inbox" });
    router.goto("/acme/inbox/compose");
    router.goto("/other/home");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme", "/other"]);
    expect(router.entries.map((entry) => entry.params.slug)).toEqual(["acme", "other"]);
    expect(router.current.url.pathname).toBe("/other/home");
    expect(pathsOf(paneRouter("/other/home"))).toEqual(["/other/home"]);
    expect(pathsOf(paneRouter("/acme/inbox/compose"))).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
    expect(router.back()).toBe(true);
    expect(router.current.url.pathname).toBe("/acme/inbox/compose");
  } finally { reset(); }
});

test("links open through the root and select the pane; a link no route matches is ignored; replaceBase swaps the root's first screen", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountTree(87, { initial: "/workspaces" });
    expect(router.openURL("rasheed://acme/inbox/compose")).toBe(true);
    expect(router.openURL("https://example.com/acme/home")).toBe(true);
    expect(router.openURL("rasheed://acme/nowhere/at/all")).toBe(false);
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
    expect(selectedIndex(87)).toBe("0");
    router.replaceBase("/account");
    await settled();
    expect(pathsOf(router)).toEqual(["/account", "/acme"]);
    expect(() => router.replaceBase("/acme/home")).toThrow("not a page of this navigator");
    expect(() => router.goto("/nowhere/at/all")).toThrow("No native screen for /nowhere/at/all");
  } finally { reset(); }
});

test("a navigator layout's <Stack> lays its defaults under each screen's own options: the page wins, objects merge key by key", async () => {
  withInsets(24);
  try {
    treeGlobals.__treeOptions = { "/acme/inbox": { header: { tint: "#abcdef" }, animation: "fade" } };
    const m = await load("tree-fixture.svelte");
    calls.length = 0; roots = {};
    treeGlobals.__treeRouters = {};
    treeGlobals.__treeOptions = { "/acme/inbox": { header: { tint: "#abcdef" }, animation: "fade" } };
    const app = m.startSurface(88, m.Fixture, { initial: "/acme/inbox/compose" }) as TreeApp;
    await turns(m);
    const [, inbox] = tabScreens(roots[88]);
    const [base, compose] = inbox.map((screen) => parseNativeID(String(screen.props.nativeID))?.pairs);
    expect(base.s).toBe("fade"); // the page's own animation
    expect(compose.s).toBe("slide_from_right"); // the layout's default
    const headers = ofKind(inbox, "header").map((node) => parseNativeID(String(node.props.nativeID))?.pairs);
    expect(headers[0]).toMatchObject({ t: "%2Facme%2Finbox", l: "1", tc: "abcdefff" }); // large from the layout, tint from the page
    expect(headers[1]).toMatchObject({ t: "%2Facme%2Finbox%2Fcompose", l: "1", tc: "123456ff" });
    // The home pane has no <Stack>: its screens take the router's defaults.
    app.root().goto("/acme/home");
    await turns(m);
    const [home] = tabScreens(roots[88]);
    expect(parseNativeID(String(home[0].props.nativeID))?.pairs.s).toBe("default");
    expect(ofKind(home, "header").map((node) => parseNativeID(String(node.props.nativeID))?.pairs.l)).toEqual([undefined]);
  } finally { reset(); }
});

test("a route's modules load when its navigation or its screen asks first; a pane's layout waits for its pane, and the <Stack>'s loading snippet shows until a page arrives", async () => {
  withInsets(24);
  try {
    const logLoads: string[] = [];
    const hold: Record<string, (() => void)[]> = {};
    const release = (path: string) => hold[path]?.shift()?.();
    const tabsLayout = "(workspace)/[slug]/(tabs)/+layout.mobile.svelte";
    const inboxLayout = "(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte";
    const inboxPage = "(workspace)/[slug]/(tabs)/inbox/+mobile.svelte";
    const compose = "(workspace)/[slug]/(tabs)/inbox/compose/+mobile.svelte";
    const { router, settled, texts: shown, tree } = await mountTree(89, { initial: "/acme/inbox/compose", logLoads, hold });
    expect(logLoads).toEqual([tabsLayout]); // creating the router loads nothing; the first screen's own modules load as it renders
    expect(ofKind(tree(), "tab")).toHaveLength(0);
    release(tabsLayout);
    await settled();
    expect(ofKind(tree(), "tab")).toHaveLength(2);
    expect(logLoads).toEqual([tabsLayout, inboxLayout]); // the pane's layout loads with the pane
    expect(shown()).toEqual([]);
    release(inboxLayout);
    await settled();
    expect(logLoads).toEqual([tabsLayout, inboxLayout, inboxPage, compose]);
    expect(shown()).toEqual(["loading /acme/inbox", "loading /acme/inbox/compose"]); // the layout's <Stack loading>
    release(compose);
    await settled();
    expect(shown()).toEqual(["loading /acme/inbox", "page /acme/inbox/compose"]);
    release(inboxPage);
    await settled();
    expect(shown()).toEqual(["page /acme/inbox", "page /acme/inbox/compose"]);
    router.goto("/acme/home/thread/5"); // a navigation loads what it pushes at once
    expect(logLoads.at(-1)).toBe("(workspace)/[slug]/(tabs)/home/thread/[id]/+mobile.svelte");
  } finally { reset(); }
});

test("tabs in a layout take the order of its items, a layout without <Tabs> gets a bar of the pane keys, and a mismatch between items and panes is said once", async () => {
  withInsets(24);
  const errors: string[] = [];
  const logged = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  try {
    treeGlobals.__treeTabs = [{ key: "inbox", title: "Inbox" }, { key: "ghost", title: "Ghost" }];
    const m = await load("tree-fixture.svelte");
    calls.length = 0; roots = {};
    treeGlobals.__treeRouters = {};
    treeGlobals.__treeTabs = [{ key: "inbox", title: "Inbox" }, { key: "ghost", title: "Ghost" }];
    const app = m.startSurface(90, m.Fixture, { initial: "/acme/inbox" }) as TreeApp;
    await turns(m);
    expect(ofKind(roots[90], "tab").map((pane) => parseNativeID(String(pane.props.nativeID))?.pairs.k)).toEqual(["inbox", "home"]); // the items' order, then the pane without an item
    expect(selectedIndex(90)).toBe("0");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("items without a pane");
    expect(errors[0]).toContain("ghost");
    expect(errors[1]).toContain("panes without an item");
    expect(errors[1]).toContain("home");
    app.root().goto("/acme/home");
    await turns(m);
    expect(selectedIndex(90)).toBe("1");
    expect(errors).toHaveLength(2); // not again

    errors.length = 0;
    delete treeGlobals.__treeTabs;
    const bare = await load("tree-fixture.svelte");
    calls.length = 0; roots = {};
    bare.startSurface(91, bare.Fixture, { initial: "/acme/home", bareTabs: true });
    await turns(bare);
    expect(ofKind(roots[91], "tab").map((pane) => parseNativeID(String(pane.props.nativeID))?.pairs.t)).toEqual(["home", "inbox"]);
    expect(errors).toEqual([]);
  } finally { console.error = logged; delete (globalThis as { __DEV__?: boolean }).__DEV__; reset(); }
});

test("a press on the tab bar selects the pane at once through the router's tabs node, and the layout's onSelect still reports", async () => {
  withInsets(24);
  try {
    const { router, settled, tree } = await mountTree(92, { initial: "/acme/home" });
    const tabs = () => ofKind(tree(), "tabs")[0];
    emit(tabs().target, "topSelect", { key: "inbox", index: 1 });
    await settled();
    expect(selectedIndex(92)).toBe("1");
    expect(treeGlobals.__treeSelections).toEqual(["inbox"]);
    expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox"]); // the pane mounted lazily on selection
    // The owner can override it by navigating.
    router.goto("/acme/home");
    await settled();
    expect(selectedIndex(92)).toBe("0");
    expect(paneRouter("/acme/home").active()).toBe(true);
    expect(paneRouter("/acme/inbox").active()).toBe(false);
  } finally { reset(); }
});
