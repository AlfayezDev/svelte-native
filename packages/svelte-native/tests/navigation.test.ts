import { test, expect, jest } from "bun:test";
import { build, transform } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { EXIT_TIMEOUT_MS, NAV_KINDS, TOOLBAR_BAR, TOOLBAR_METRICS, badgeText, colorToWire, decodeList, decodeRecords, decodeValue, headerHeight, mergeScreenOptions, navigationProps, navigationTags, normalizeDetents, parseNativeID, sheetStyle, toolbarHeight } from "../src/fabric/navigation.ts";
import { LOWERED_TAGS, lowerPrimitives } from "../src/lower.ts";
import { routeFiles } from "../src/build.ts";

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
  "react-native/Libraries/Linking/Linking": "const handlers = (globalThis.__linkHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; }, getInitialURL: () => { globalThis.__initialURLReads = (globalThis.__initialURLReads ?? 0) + 1; if (globalThis.__initialURLMode === 'throw') throw new Error('the link service threw at once'); if (globalThis.__initialURLMode === 'reject') return Promise.reject(new Error('the link service is down')); if (globalThis.__initialURLMode === 'hang') return new Promise(() => {}); if (globalThis.__initialURLMode === 'late') return new Promise((resolve) => { globalThis.__resolveInitialURL = resolve; }); return Promise.resolve(globalThis.__initialURL ?? null); } };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
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
        export { openLaunchURL } from '../src/router.svelte.ts';
        export { startSurface, flush, fabricStats, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "fabric-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: resolve(import.meta.dirname, "view-configs-stub.ts") }));
        builder.onResolve({ filter: /^@alfayez\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
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

test("the toolbar nativeID carries flags only when set, colors as rrggbbaa, the slot mask; it is a row in flow, or absolute at the bottom when translucent", () => {
  expect(navigationProps("native-toolbar", {}).nativeID).toBe("svelte:toolbar");
  const bar = navigationProps("native-toolbar", {
    hidden: true, translucent: true, tint: "#fff", background: "rgba(0, 0, 0, 0.5)", slots: 1, toolbarHeight: 90, toolbarInset: 34, onPress: noop, onMetrics: noop, testID: "bar",
  });
  expect(bar.nativeID).toBe("svelte:toolbar;hd=1;tl=1;tc=ffffffff;bg=00000080;sl=1");
  expect(bar.style).toEqual([{ position: "absolute", left: 0, right: 0, bottom: 0, height: 90, paddingBottom: 34, paddingHorizontal: 4, flexDirection: "row", alignItems: "center" }, undefined]);
  expect(bar.onPress).toBe(noop);
  expect(bar.onMetrics).toBe(noop);
  expect(bar.testID).toBe("bar");
  for (const key of ["hidden", "translucent", "tint", "background", "slots", "toolbarHeight", "toolbarInset", "toolbarPlatform"]) expect(key in bar).toBe(false);
  const flow = navigationProps("native-toolbar", { toolbarHeight: 56, toolbarInset: 0, style: { opacity: 0.5 } });
  expect(flow.nativeID).toBe("svelte:toolbar");
  expect(flow.style).toEqual([{ height: 56, paddingBottom: 0, paddingHorizontal: 4, flexDirection: "row", alignItems: "center" }, { opacity: 0.5 }]);
  // The band's horizontal padding is the platform's edge: 4 dp on Android, 16 pt on iOS.
  const ios = navigationProps("native-toolbar", { toolbarHeight: 78, toolbarInset: 34, toolbarPlatform: "ios" });
  expect(ios.style).toEqual([{ height: 78, paddingBottom: 34, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" }, undefined]);
  expect("toolbarPlatform" in ios).toBe(false);
  expect(navigationProps("native-toolbar", { hidden: false, translucent: false, tint: "papayawhip", slots: 0 }).nativeID).toBe("svelte:toolbar");
  expect(navigationProps("native-toolbar", { slots: 1 }).nativeID).toBe("svelte:toolbar;sl=1");
});

test("toolbar items encode their key, title, icon, badge and flags; a spacer carries nothing else; the center is its own kind", () => {
  const row = { flexDirection: "row", alignItems: "center", justifyContent: "center" };
  expect(navigationProps("native-toolbar-item", {}).nativeID).toBe("svelte:toolbar-item");
  // An item has a fixed width, whatever its content: Yoga and the native side place it by the same number, so a flex: 1 center gets the span the items leave.
  expect(navigationProps("native-toolbar-item", {}).style).toEqual([{ width: 48, marginHorizontal: 0, ...row }, undefined]);
  expect(navigationProps("native-toolbar-item", { toolbarPlatform: "android" }).style).toEqual([{ width: 48, marginHorizontal: 0, ...row }, undefined]);
  // On iOS an item is UIKit's 44 pt button with 4 pt each side: it occupies 52.
  expect(navigationProps("native-toolbar-item", { toolbarPlatform: "ios" }).style).toEqual([{ width: 44, marginHorizontal: 4, ...row }, undefined]);
  // The item is the only press: its JavaScript node takes touches as a box and its children (a snippet icon) take none; a spacer, the band and the center are left alone.
  expect(navigationProps("native-toolbar-item", {}).pointerEvents).toBe("box-only");
  expect(navigationProps("native-toolbar-item", { toolbarPlatform: "ios", iconView: true, itemKey: "s" }).pointerEvents).toBe("box-only");
  expect(navigationProps("native-toolbar-item", { pointerEvents: "auto" }).pointerEvents).toBe("box-only");
  expect("pointerEvents" in navigationProps("native-toolbar-item", { spacer: true })).toBe(false);
  expect("pointerEvents" in navigationProps("native-toolbar-center", {})).toBe(false);
  expect("pointerEvents" in navigationProps("native-toolbar", {})).toBe(false);
  const full = navigationProps("native-toolbar-item", { itemKey: "in/box", title: "A;B=C, 100%", icon: "asset:/a b.png", iconView: false, badge: 120, disabled: true, accessibilityLabel: "Open", testID: "item" });
  expect(full.nativeID).toBe("svelte:toolbar-item;k=in%2Fbox;t=A%3BB%3DC%2C%20100%25;ic=asset%3A%2Fa%20b.png;bd=99%2B;ds=1");
  expect(full.accessibilityLabel).toBe("Open");
  expect(full.testID).toBe("item");
  for (const key of ["itemKey", "title", "icon", "iconView", "badge", "disabled", "toolbarPlatform", "centered"]) expect(key in full).toBe(false);
  expect(navigationProps("native-toolbar-item", { itemKey: "flag", title: "Flag", badge: true }).nativeID).toBe("svelte:toolbar-item;k=flag;t=Flag;bd=");
  expect(navigationProps("native-toolbar-item", { itemKey: "n", title: "N", badge: "new" }).nativeID).toBe("svelte:toolbar-item;k=n;t=N;bd=new");
  expect(navigationProps("native-toolbar-item", { itemKey: "n", title: "N", badge: 0 }).nativeID).toBe("svelte:toolbar-item;k=n;t=N");
  expect(navigationProps("native-toolbar-item", { itemKey: "s", title: "S", iconView: true }).nativeID).toBe("svelte:toolbar-item;k=s;t=S;iv=1");
  const spacer = navigationProps("native-toolbar-item", { itemKey: "gap", title: "x", icon: "asset:/x.png", badge: true, disabled: true, spacer: true });
  expect(spacer.nativeID).toBe("svelte:toolbar-item;sp=1");
  expect(spacer.style).toEqual([{ flexGrow: 1 }, undefined]);
  // Beside a center slot a spacer does not grow: the center takes all the free width, as the native sides place it. A spacer has no width, so the platform does not matter.
  const beside = navigationProps("native-toolbar-item", { spacer: true, centered: true, toolbarPlatform: "ios" });
  expect(beside.style).toEqual([{ flexGrow: 0 }, undefined]);
  expect(navigationProps("native-toolbar-item", { spacer: true, centered: false, toolbarPlatform: "ios" }).style).toEqual([{ flexGrow: 1 }, undefined]);
  for (const key of ["spacer", "centered", "toolbarPlatform"]) expect(key in beside).toBe(false);
  const center = navigationProps("native-toolbar-center", {});
  expect(center.nativeID).toBe("svelte:toolbar-center");
  expect(center.style).toEqual([{ flex: 1, ...row }, undefined]);
});

test("toolbar tags are navigation tags with their engine kinds; the bar is 56 dp on Android and 44 pt on iOS, plus the bottom inset", () => {
  for (const tag of ["native-toolbar", "native-toolbar-item", "native-toolbar-center"]) expect(navigationTags.has(tag)).toBe(true);
  expect([NAV_KINDS.toolbar, NAV_KINDS["toolbar-item"], NAV_KINDS["toolbar-center"]]).toEqual([17, 18, 13]);
  expect(TOOLBAR_BAR).toEqual({ android: 56, ios: 44 });
  expect(toolbarHeight("android", 34)).toBe(90);
  expect(toolbarHeight("ios", 34)).toBe(78);
  expect(toolbarHeight("ios", 0)).toBe(44);
});

test("the toolbar row has one geometry: Yoga's widths are the numbers the native sides place the items by", () => {
  expect(TOOLBAR_METRICS).toEqual({ android: { edge: 4, item: 48, gap: 0 }, ios: { edge: 16, item: 44, gap: 4 } });
  // What the center's `flex: 1` gets: the band's width less its two edges and every solid item with its margins. Android: 360 dp, three items; iOS: 390 pt, three items.
  const center = (platform: "android" | "ios", width: number, solid: number) => {
    const m = TOOLBAR_METRICS[platform];
    return width - 2 * m.edge - (m.item + 2 * m.gap) * solid;
  };
  expect(center("android", 360, 3)).toBe(208);
  expect(center("ios", 390, 3)).toBe(202);
  // The iOS numbers are the ones the UIKit side budgets: 32 for the edges, 52 for an item.
  expect(2 * TOOLBAR_METRICS.ios.edge).toBe(32);
  expect(TOOLBAR_METRICS.ios.item + 2 * TOOLBAR_METRICS.ios.gap).toBe(52);
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

  // Toolbar: record 128 (flags 1 hidden 2 translucent, tint, background, slot mask), record 129 per item, the center is slot 4 of record 126.
  expect(decodeRecords("svelte:toolbar")).toEqual({ kind: 17, records: [{ id: 128, values: [0, 0, 0, 0, 0, 0] }] });
  expect(decodeRecords("svelte:toolbar;hd=1;tl=1;tc=ffffffff;bg=00000080;sl=1")?.records).toEqual([{ id: 128, values: [3, 1, 0xffffffff, 1, 0x80000000, 1] }]);
  expect(decodeRecords("svelte:toolbar;tl=1;tc=0a84ffff")?.records).toEqual([{ id: 128, values: [2, 1, 0xff0a84ff, 0, 0, 0] }]);
  expect(decodeRecords("svelte:toolbar-item")).toEqual({ kind: 18, records: [{ id: 129, values: [-1, -1, -1, 0, 0, -1, 0, 0] }] });
  expect(decodeRecords("svelte:toolbar-item;k=in%2Fbox;t=A%3BB%3DC%2C%20100%25;ic=asset%3A%2Fa%20b.png;bd=99%2B;ds=1")?.records)
    .toEqual([{ id: 129, values: ["in/box", "A;B=C, 100%", "asset:/a b.png", 0, 2, "99+", 1, 0] }]);
  expect(decodeRecords("svelte:toolbar-item;k=flag;t=Flag;bd=")?.records).toEqual([{ id: 129, values: ["flag", "Flag", -1, 0, 1, "", 0, 0] }]);
  expect(decodeRecords("svelte:toolbar-item;k=n;t=N;bd=new")?.records).toEqual([{ id: 129, values: ["n", "N", -1, 0, 2, "new", 0, 0] }]);
  expect(decodeRecords("svelte:toolbar-item;k=s;t=S;iv=1")?.records).toEqual([{ id: 129, values: ["s", "S", -1, 1, 0, -1, 0, 0] }]);
  expect(decodeRecords("svelte:toolbar-item;sp=1")?.records).toEqual([{ id: 129, values: [-1, -1, -1, 0, 0, -1, 0, 1] }]);
  expect(decodeRecords("svelte:toolbar-center")).toEqual({ kind: 13, records: [{ id: 126, values: [4] }] });

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
    ["native-toolbar", { translucent: true, tint: "#123456", slots: 1 }],
    ["native-toolbar-item", { itemKey: "k", title: "t", badge: true, disabled: true }],
    ["native-toolbar-item", { spacer: true }],
    ["native-toolbar-center", {}],
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

test("merging screen options: the toolbar merges like the header, key by key, and the inner items replace the outer ones", () => {
  const outer = () => {};
  const inner = () => {};
  const merged = mergeScreenOptions(
    { toolbar: { translucent: true, tint: "#fff", items: [{ key: "a" }], onPress: outer } },
    { toolbar: { tint: "#000", translucent: undefined, items: [{ key: "b" }, { key: "gap", spacer: true }], onPress: inner } },
  );
  expect(merged.toolbar).toEqual({ translucent: true, tint: "#000", items: [{ key: "b" }, { key: "gap", spacer: true }], onPress: inner });
  expect(mergeScreenOptions({ toolbar: { tint: "#fff" } }, {}).toolbar).toEqual({ tint: "#fff" });
  expect(mergeScreenOptions({}, { toolbar: { hidden: true } }).toolbar).toEqual({ hidden: true });
});

test("Screen, Stack and Tabs stay components: they take snippets, so the lowering preprocessor must not rewrite them", () => {
  expect(Object.hasOwn(LOWERED_TAGS, "Screen")).toBe(false);
  expect(Object.hasOwn(LOWERED_TAGS, "Stack")).toBe(false);
  expect(Object.hasOwn(LOWERED_TAGS, "Tabs")).toBe(false);
  const source = `<script>\n  import { Screen, Stack, Tabs, View } from "@alfayez/svelte-native";\n</script>\n<Screen title="x">{#snippet headerRight()}<View />{/snippet}</Screen>\n<Stack header={{ large: true }}>{@render children()}</Stack>\n<Tabs items={items} selected={s} content={pane} />`;
  const lowered = lowerPrimitives(source, { filename: "x.svelte", warn: noop });
  expect(lowered).toContain('<Screen title="x">');
  expect(lowered).toContain("<native-view ></native-view>");
  expect(lowered).toContain("<Stack header={{ large: true }}>");
  expect(lowered).toContain("<Tabs items={items}");
});

// Screen and Tabs through the Fabric host: the tags reach the engine as RCTView nodes carrying the encoded nativeID.
const ofKind = (nodes: FakeNode[], kind: string): FakeNode[] => nodes.flatMap((node) => [...(parseNativeID(String(node.props.nativeID ?? ""))?.kind === kind ? [node] : []), ...ofKind(node.children, kind)]);
const ofTestID = (nodes: FakeNode[], testID: string): FakeNode[] => nodes.flatMap((node) => [...(node.props.testID === testID ? [node] : []), ...ofTestID(node.children, testID)]);
const environment = globalThis as { __navigationInsets?: unknown; __navigationOS?: string };
const withInsets = (top: number, bottom = 34) => { environment.__navigationInsets = { top, right: 0, bottom, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 } }; };
const reset = () => { delete environment.__navigationInsets; delete environment.__navigationOS; jest.useRealTimers(); };
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

test("a Screen inside a Modal is a screen of its own, in a stack of its own, and leaves the title of the screen around the Modal alone; a Modal in a tab pane pads its own bottom inset", async () => {
  withInsets(24);
  try {
    const m = await load("modal-screen-fixture.svelte");
    calls.length = 0; roots = {};
    const probes = globalThis as { __paneProbe?: Record<string, boolean> };
    probes.__paneProbe = {};
    const app = m.startSurface(40, m.Fixture, {}) as { setOpen: (value: boolean) => void };
    await settle(m);
    const titleOf = (header: FakeNode) => decodeURIComponent(String(parseNativeID(String(header.props.nativeID))?.pairs.t));
    const titles = () => ofKind(roots[40], "header").map(titleOf);
    expect(titles()).toEqual(["Outer", "Inner", "Pane modal"]); // the modals' titles are their own headers, not the outer screen's
    // iOS draws a screen's header only under a stack: a modal's screen gets a one-entry stack of its own, `native-stack > native-screen`.
    expect(ofKind(roots[40], "stack")).toHaveLength(3); // the outer one, and one in each modal
    for (const title of ["Outer", "Inner", "Pane modal"]) {
      const stack = ofKind(roots[40], "stack").find((candidate) => candidate.children.some((screen) => ofKind(screen.children, "header").map(titleOf).includes(title) && !ofKind(screen.children, "stack").some((below) => ofKind(below.children, "header").map(titleOf).includes(title))));
      expect(stack?.children.map((child) => parseNativeID(String(child.props.nativeID))?.kind)).toEqual(["screen"]);
    }
    expect(probes.__paneProbe).toEqual({ screen: false, pane: true, "modal-in-pane": false }); // a modal covers the tab bar: no pane around it
    app.setOpen(false);
    await settle(m);
    expect(titles()[0]).toBe("Outer");
  } finally { reset(); }
});

test("a Screen with no stack above it is a one-entry stack: native-stack > native-screen at the root, none for a nested Screen", async () => {
  withInsets(24);
  try {
    const m = await load("screen-root-fixture.svelte");
    calls.length = 0; roots = {};
    m.startSurface(42, m.Fixture, {});
    await settle(m);
    const [top] = roots[42];
    expect(parseNativeID(String(top.props.nativeID))?.kind).toBe("stack");
    expect(top.props.style).toEqual([{ flex: 1 }, { flex: 1 }]);
    expect(top.children.map((child) => parseNativeID(String(child.props.nativeID))?.kind)).toEqual(["screen"]);
    expect(top.children[0].props.nativeID).toBe("svelte:screen;a=2;p=push;g=1;s=default;b=1");
    expect(ofKind(roots[42], "stack")).toHaveLength(1);
    expect(ofKind(roots[42], "screen")).toHaveLength(1); // the nested Screen hands its options over
    expect(ofKind(roots[42], "header")).toHaveLength(1);
    expect(parseNativeID(String(ofKind(roots[42], "header")[0].props.nativeID))?.pairs).toMatchObject({ t: "Root", st: "Nested" });
  } finally { reset(); }
});

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

// The toolbar (SPEC.md "Toolbar"): the last child of the screen, one item node per item, then the optional center.
type ToolbarApp = { set: (patch: object) => void; setToolbar: (patch: object | undefined) => void; showCenter: (value: boolean) => void; nest: (value: object | null) => void; events: () => string[] };
const ids = (nodes: FakeNode[]) => nodes.map((node) => node.props.nativeID);
const itemIds = [
  "svelte:toolbar-item;k=reply;t=Reply;ic=asset%3A%2Freply.png",
  "svelte:toolbar-item;k=archive;t=Archive;iv=1;bd=99%2B",
  "svelte:toolbar-item;sp=1",
  "svelte:toolbar-item;k=flag;t=Flag;ic=asset%3A%2Fflag.png;bd=",
  "svelte:toolbar-item;k=delete;t=Delete;ds=1",
];

async function mountToolbar(surface: number) {
  const m = await load("toolbar-fixture.svelte");
  calls.length = 0; roots = {};
  const app = m.startSurface(surface, m.Fixture, {}) as ToolbarApp;
  await settle(m);
  const screen = () => ofKind(roots[surface], "screen")[0];
  const toolbar = () => ofKind(roots[surface], "toolbar")[0];
  return { m, app, screen, toolbar, items: () => ofKind(roots[surface], "toolbar-item"), flush: () => settle(m), tree: () => roots[surface] };
}

test("a Screen renders its toolbar as the last child, one item node per item in order, sized from the platform bar and the bottom inset", async () => {
  withInsets(24, 34);
  try {
    const { screen, toolbar, items, tree } = await mountToolbar(70);
    expect(screen().children.map((child) => child.props.nativeID ?? "content")).toEqual(["svelte:header;t=Thread", "content", "svelte:toolbar"]);
    expect(flat(toolbar().props.style)).toEqual({ height: 90, paddingBottom: 34, paddingHorizontal: 4, flexDirection: "row", alignItems: "center" });
    expect(ids(toolbar().children)).toEqual(itemIds);
    expect(ids(items())).toEqual(itemIds);
    expect(items()[0].props.accessibilityLabel).toBe("Reply to thread");
    expect(items()[0].props.testID).toBe("tb-reply");
    expect(flat(items()[2].props.style)).toEqual({ flexGrow: 1 });
    // An item is 48 dp wide in Yoga, as the engine places it.
    expect(flat(items()[0].props.style)).toMatchObject({ width: 48, marginHorizontal: 0 });
    expect(flat(items()[1].props.style)).toMatchObject({ width: 48, marginHorizontal: 0 });
    // The snippet icon's item takes the touch as a box: a Pressable inside the snippet is out of its reach.
    expect(items().map((item) => item.props.pointerEvents)).toEqual(["box-only", "box-only", undefined, "box-only", "box-only"]);
    // An asset icon is a uri on the node; a snippet icon is the node's child, drawn live with `pressed` false.
    expect(items()[0].children).toHaveLength(0);
    expect(ofTestID(items()[1].children, "glyph-false")).toHaveLength(1);
    expect(ofTestID(tree(), "glyph-false")).toHaveLength(1);
    expect(ofTestID(tree(), "toolbar-90-34")).toHaveLength(1);
    // The engine's `topPress` is a native event, not a responder handler: the toolbar is neither clickable nor an accessibility element.
    expect(toolbar().props.onPress).toBe(true);
    expect(toolbar().props.onClick).toBeUndefined();
    expect(toolbar().props.accessible).toBeUndefined();
  } finally { reset(); }
});

test("the toolbar follows its options: center content last, translucent overlay at the bottom, hidden or absent leaves no node", async () => {
  withInsets(24, 34);
  try {
    const { app, toolbar, items, flush, tree } = await mountToolbar(71);
    app.showCenter(true);
    await flush();
    expect(toolbar().props.nativeID).toBe("svelte:toolbar;sl=1");
    expect(toolbar().children.map((child) => parseNativeID(String(child.props.nativeID))?.kind)).toEqual(["toolbar-item", "toolbar-item", "toolbar-item", "toolbar-item", "toolbar-item", "toolbar-center"]);
    expect(toolbar().children[5].props.nativeID).toBe("svelte:toolbar-center");
    expect(ofTestID(toolbar().children[5].children, "composer")).toHaveLength(1);
    // With a center the spacer does not grow: the center's `flex: 1` is all the free width, as the native sides place it.
    expect(flat(items()[2].props.style)).toEqual({ flexGrow: 0 });

    app.setToolbar({ translucent: true, tint: "#fff", background: "#102030" });
    await flush();
    expect(flat(items()[2].props.style)).toEqual({ flexGrow: 0 });
    expect(toolbar().props.nativeID).toBe("svelte:toolbar;tl=1;tc=ffffffff;bg=102030ff;sl=1");
    expect(flat(toolbar().props.style)).toEqual({ position: "absolute", left: 0, right: 0, bottom: 0, height: 90, paddingBottom: 34, paddingHorizontal: 4, flexDirection: "row", alignItems: "center" });
    expect(ofTestID(tree(), "toolbar-90-34")).toHaveLength(1);

    app.setToolbar({ translucent: false, tint: undefined, background: undefined, items: [{ key: "only", title: "Only", disabled: true }] });
    await flush();
    expect(toolbar().props.nativeID).toBe("svelte:toolbar;sl=1");
    expect(ids(items())).toEqual(["svelte:toolbar-item;k=only;t=Only;ds=1"]);

    app.setToolbar({ hidden: true });
    await flush();
    expect(ofKind(tree(), "toolbar")).toHaveLength(0);
    expect(ofKind(tree(), "toolbar-item")).toHaveLength(0);
    expect(ofKind(tree(), "toolbar-center")).toHaveLength(0);
    expect(ofTestID(tree(), "toolbar-0-0")).toHaveLength(1);

    // `toolbarCenter` alone is enough, as a header snippet is for the header; without either there is no toolbar.
    app.setToolbar(undefined);
    await flush();
    expect(toolbar().props.nativeID).toBe("svelte:toolbar;sl=1");
    expect(toolbar().children).toHaveLength(1);
    app.showCenter(false);
    await flush();
    expect(ofKind(tree(), "toolbar")).toHaveLength(0);
  } finally { reset(); }
});

test("a press reaches toolbar.onPress with the key; an inner Screen's toolbar merges into the outer one and its handler wins", async () => {
  withInsets(24, 34);
  try {
    const { app, toolbar, flush, tree } = await mountToolbar(72);
    emit(toolbar().target, "topPress", { key: "archive", index: 1 });
    expect(app.events()).toEqual(["press archive"]);
    const inner: string[] = [];
    app.nest({ toolbar: { tint: "#0a84ff", onPress: (key: string) => inner.push(key) } });
    await flush();
    expect(ofKind(tree(), "screen")).toHaveLength(1);
    expect(ofKind(tree(), "toolbar")).toHaveLength(1);
    expect(toolbar().props.nativeID).toBe("svelte:toolbar;tc=0a84ffff");
    expect(ids(toolbar().children)).toEqual(itemIds);
    emit(toolbar().target, "topPress", { key: "reply", index: 0 });
    expect(inner).toEqual(["reply"]);
    expect(app.events()).toEqual(["press archive"]);
    expect(ofTestID(tree(), "toolbar-90-34")).toHaveLength(1);
  } finally { reset(); }
});

test("toolbar metrics from the native side correct the estimate, which uses the platform bar and the bottom inset", async () => {
  withInsets(59, 34);
  environment.__navigationOS = "ios";
  try {
    const { toolbar, items, flush, tree } = await mountToolbar(73);
    expect(flat(toolbar().props.style)).toMatchObject({ height: 78, paddingBottom: 34, paddingHorizontal: 16 });
    // An iOS item is UIKit's 44 pt button with 4 pt each side.
    expect(flat(items()[0].props.style)).toMatchObject({ width: 44, marginHorizontal: 4 });
    expect(ofTestID(tree(), "toolbar-78-34")).toHaveLength(1);
    emit(toolbar().target, "topMetrics", { height: 83, inset: 39 });
    await flush();
    expect(flat(toolbar().props.style)).toMatchObject({ height: 83, paddingBottom: 39 });
    expect(ofTestID(tree(), "toolbar-83-39")).toHaveLength(1);
  } finally { reset(); }
});

test("inside a tab pane the bar sits above the tab bar: it takes no bottom inset of its own", async () => {
  withInsets(24, 34);
  try {
    const m = await load("toolbar-tabs-fixture.svelte");
    calls.length = 0; roots = {};
    const app = m.startSurface(74, m.Fixture, {}) as { select: (key: string) => void };
    await settle(m);
    const panes = () => ofKind(roots[74], "tab");
    const bars = () => ofKind(roots[74], "toolbar");
    expect(bars()).toHaveLength(1);
    expect(ofKind(panes()[0].children, "toolbar")).toHaveLength(1);
    expect(flat(bars()[0].props.style)).toEqual({ height: 56, paddingBottom: 0, paddingHorizontal: 4, flexDirection: "row", alignItems: "center" });
    expect(ids(bars()[0].children)).toEqual(["svelte:toolbar-item;k=reply;t=Reply", "svelte:toolbar-item;sp=1", "svelte:toolbar-item;k=archive;t=Archive"]);
    expect(ofTestID(roots[74], "toolbar-56-0")).toHaveLength(1);
    // The pane's bottom edge is the tab bar's top; the screen that holds the tabs has no toolbar.
    expect(flat(panes()[0].props.style).bottom).toBe(98);
    app.select("inbox");
    await settle(m);
    expect(bars()).toHaveLength(2);
    expect(bars().map((bar) => flat(bar.props.style).paddingBottom)).toEqual([0, 0]);
  } finally { reset(); }
  withInsets(24, 34);
  environment.__navigationOS = "ios";
  try {
    const m = await load("toolbar-tabs-fixture.svelte");
    roots = {};
    m.startSurface(75, m.Fixture, {});
    await settle(m);
    expect(flat(ofKind(roots[75], "toolbar")[0].props.style)).toMatchObject({ height: 44, paddingBottom: 0, paddingHorizontal: 16 });
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

test("createRouter takes the route tree: the array of routes it took before fails by naming the contract", async () => {
  const m = await load("router-array-fixture.svelte");
  calls.length = 0; roots = {};
  delete (globalThis as { __routerError?: string }).__routerError;
  m.startSurface(46, m.Fixture, {});
  const message = (globalThis as { __routerError?: string }).__routerError ?? "";
  expect(message).toContain("createRouter takes the route tree");
  expect(message).toContain("kind: \"stack\"");
  expect(message).toContain(".svelte-native/routes.<variant>.ts");
  expect(message).not.toContain("iterable");
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
  } finally { reset(); }
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
    app.goto("/c");
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live", "/a:back:live", "/c:back:live", "/b/3:back:leaving"]);
    app.goto("/b/4", { replaceState: true });
    await turns(m);
    expect(app.screens()).toEqual(["/:root:live", "/a:back:live", "/b/4:back:live", "/c:back:leaving", "/b/3:back:leaving"]); // the new screen goes under the ones that leave
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
  } finally { reset(); }
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
  } finally { reset(); }
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
  expect(handlersOf("__backHandlers")).toHaveLength(1); // the root's alone: it asks the nested router first while it is active

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
  replaceBase: (href: string) => void; openURL: (href: string) => boolean; screens: { leaving: boolean; canGoBack: boolean }[];
  node: { kind: string; panes?: { key: string; stack: object }[] }; modules: (node: object) => unknown;
};
type TreeApp = { root: () => TreeRouter; show: (shown: boolean) => void };
const treeGlobals = globalThis as { __treeRoots?: Record<string, TreeRouter>; __treeRouters?: Record<string, TreeRouter>; __treeOptions?: Record<string, object>; __treeTabs?: object[]; __treeSelections?: string[]; __treePanes?: unknown; __treeTabsRouter?: TreeRouter; __treeLayouts?: { path?: string; params?: object }[] };
const pathsOf = (router: TreeRouter) => router.entries.map((entry) => `${entry.url.pathname}${entry.url.search}`);
const selectedIndex = (surface: number) => parseNativeID(String(ofKind(roots[surface], "tabs")[0].props.nativeID))?.pairs.sel;
const paneRouter = (path: string): TreeRouter => { const router = treeGlobals.__treeRouters?.[path]; if (!router) throw new Error(`no page rendered at ${path}`); return router; };

async function mountTree(surface: number, props: Record<string, unknown> = {}) {
  const m = await load("tree-fixture.svelte");
  jest.useFakeTimers(); // a popped screen's exit timer must not fire into whichever test runs after this one
  calls.length = 0; roots = {};
  treeGlobals.__treeRouters = {}; treeGlobals.__treeRoots = {}; delete treeGlobals.__treeOptions; delete treeGlobals.__treeTabs; delete treeGlobals.__treeSelections; delete treeGlobals.__treeLayouts;
  handlersOf("__backHandlers").length = 0;
  handlersOf("__linkHandlers").length = 0;
  delete (globalThis as { __initialURLReads?: number }).__initialURLReads;
  const app = m.startSurface(surface, m.Fixture, props) as TreeApp;
  await turns(m);
  // React Native asks the handlers newest first and stops at the first `true`.
  const hardwareBack = () => [...handlersOf("__backHandlers")].reverse().some((handler) => (handler as () => boolean)());
  const settled = () => turns(m);
  return { m, app, router: app.root(), hardwareBack, settled, texts: () => texts(surface), tree: () => roots[surface] };
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
    expect(treeGlobals.__treeRoots?.["/acme/inbox/compose"]).toBe(router); // useRouter("root") from inside a pane
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
    router.goto("/acme/inbox?again"); // another href of the pane's base page, so it stacks
    await settled();
    const inbox = paneRouter("/acme/inbox/compose");
    expect(pathsOf(inbox)).toEqual(["/acme/inbox", "/acme/inbox/compose", "/acme/inbox?again"]);

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

test("the root router alone owns the back key and the launch link, so a reset of the root <Router> still gives the key to the pane first", async () => {
  withInsets(24);
  try {
    const { app, router, settled, hardwareBack } = await mountTree(97, { initial: "/workspaces" });
    router.goto("/acme/home/thread/1");
    await settled();
    expect(handlersOf("__backHandlers")).toHaveLength(1); // the root's: the pane's and the tabs' routers register nothing
    expect(handlersOf("__linkHandlers")).toHaveLength(1);
    expect((globalThis as { __initialURLReads?: number }).__initialURLReads).toBe(1);

    // The session resets: the root <Router> unmounts and mounts again with every module warm, so the panes mount before the root's own effects run.
    app.show(false);
    await settled();
    expect(handlersOf("__backHandlers")).toHaveLength(0);
    app.show(true);
    await settled();
    expect(handlersOf("__backHandlers")).toHaveLength(1);
    expect(handlersOf("__linkHandlers")).toHaveLength(1);
    expect((globalThis as { __initialURLReads?: number }).__initialURLReads).toBe(1); // the launch link is not opened again by a remount
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home", "/acme/home/thread/1"]);

    expect(hardwareBack()).toBe(true); // the pane has depth: it pops, the root is untouched
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(hardwareBack()).toBe(true); // at its base the pane keeps its page and the root pops the tabs screen
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
    expect(pathsOf(router)).toEqual(["/workspaces"]);
    expect(hardwareBack()).toBe(false); // the root at one entry: the app may leave
  } finally { reset(); }
});

test("back() on a tabs router pops the selected pane first, then the stack above, and a pane that is not selected never pops its sibling", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountTree(98, { initial: "/workspaces" });
    router.goto("/acme/inbox"); // visits the inbox pane, which stays at its base
    await settled();
    router.goto("/acme/home/thread/1");
    await settled();
    const tabs = treeGlobals.__treeTabsRouter;
    const inbox = paneRouter("/acme/inbox");
    const home = paneRouter("/acme/home");
    if (!tabs) throw new Error("the tabs layout did not render");
    expect(tabs.selected).toBe("home");
    expect(pathsOf(tabs)).toEqual(["/acme/home", "/acme/home/thread/1"]); // entries are the selected pane's
    expect(tabs.current.url.pathname).toBe("/acme/home/thread/1");

    expect(tabs.back()).toBe(true); // the pane has depth: it pops, the root screen below the tabs stays
    expect(pathsOf(home)).toEqual(["/acme/home"]);
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    home.goto("/acme/home/thread/2");
    await settled();
    expect(inbox.back()).toBe(true); // at its base the unselected pane hands the pop to the root, not to the selected pane
    expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/2"]);
    expect(pathsOf(router)).toEqual(["/workspaces"]);
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
    expect(compose.s).toBe("default"); // a sheet is no push: the layout's animation is for its push screens
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

test("a <Stack>'s animation is the default of its push screens only: a modal, a sheet and a form sheet keep the platform's", async () => {
  withInsets(24);
  try {
    const { router, settled, tree } = await mountTree(106, { initial: "/acme/flow/start" });
    const flow = paneRouter("/acme/flow/start");
    flow.goto("/acme/flow/done");
    flow.goto("/acme/flow/start?modal", { presentation: "modal" }); // other hrefs than the stack holds: the same href pops to its entry
    flow.goto("/acme/flow/done?form", { presentation: "formSheet" });
    flow.goto("/acme/flow/start?transparent", { presentation: "transparentModal" });
    flow.goto("/acme/flow/done?sheet", { presentation: "sheet" });
    await settled();
    expect(pathsOf(router)).toEqual(["/acme/flow"]);
    const screens = ofKind(tree(), "screen").map((screen) => parseNativeID(String(screen.props.nativeID))?.pairs);
    expect(screens.map((pairs) => `${pairs?.p}:${pairs?.s}`)).toEqual([
      "push:default", // the root's own screen, the flow
      "push:slide_from_right", "push:slide_from_right", "modal:default", "formSheet:default", "transparentModal:default", "sheet:default",
    ]);
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

test("a pane's stack layout receives the params and url of the tabs screen that hosts it, like every other layout", async () => {
  withInsets(24);
  try {
    await mountTree(103, { initial: "/acme/inbox" });
    expect(treeGlobals.__treeLayouts).toEqual([{ path: "/acme", params: { slug: "acme" } }]);
  } finally { reset(); }
});

test("while a pane's layout loads the pane shows the placeholder of the router around it, and the layout's own loading snippet takes over once it is in", async () => {
  withInsets(24);
  try {
    const hold: Record<string, ((error?: Error) => void)[]> = {};
    const release = (path: string) => hold[path]?.shift()?.();
    const { settled, texts: shown } = await mountTree(104, { initial: "/acme/inbox", hold, outerLoading: true });
    expect(shown()).toEqual(["outer loading /acme"]); // the tabs screen's own modules
    release("(workspace)/[slug]/(tabs)/+layout.mobile.svelte");
    await settled();
    expect(shown()).toEqual(["outer loading /acme/inbox"]); // the pane's layout is pending: not a blank pane
    release("(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte");
    await settled();
    expect(shown()).toEqual(["loading /acme/inbox"]); // the layout's <Stack loading> while the page loads
    release("(workspace)/[slug]/(tabs)/inbox/+mobile.svelte");
    await settled();
    expect(shown()).toEqual(["page /acme/inbox"]);
  } finally { reset(); }
});

test("a pane's layout that failed to load throws where the pane renders and loads again on the next navigation into the pane", async () => {
  withInsets(24);
  try {
    const logLoads: string[] = [];
    const hold: Record<string, ((error?: Error) => void)[]> = {};
    const release = (path: string, error?: Error) => hold[path]?.shift()?.(error);
    const tabsLayout = "(workspace)/[slug]/(tabs)/+layout.mobile.svelte";
    const inboxLayout = "(workspace)/[slug]/(tabs)/inbox/+layout.mobile.svelte";
    const { router, settled, texts: shown } = await mountTree(105, { initial: "/acme/home", logLoads, hold, boundary: true });
    release(tabsLayout);
    await settled();
    release("(workspace)/[slug]/(tabs)/home/+mobile.svelte");
    await settled();
    const tabs = treeGlobals.__treeTabsRouter;
    const inbox = tabs?.node.panes?.find((pane) => pane.key === "inbox")?.stack;
    if (!tabs || !inbox) throw new Error("the tabs layout did not render");
    expect(shown()).toEqual(["page /acme/home"]);

    router.goto("/acme/inbox"); // a navigation into the pane loads its layout before the pane mounts
    expect(logLoads.filter((path) => path === inboxLayout)).toHaveLength(1);
    release(inboxLayout, new Error("chunk missing"));
    await settled();
    expect(() => tabs.modules(inbox)).toThrow("chunk missing");
    expect(shown()).toEqual(["failed: chunk missing"]); // thrown where the pane renders: the nearest boundary draws it

    router.goto("/acme/inbox/compose");
    expect(logLoads.filter((path) => path === inboxLayout)).toHaveLength(2); // retried by the next navigation into the pane
    expect(tabs.modules(inbox)).toBeUndefined(); // the failure is cleared while the new load runs
    release(inboxLayout);
    await settled();
    expect(tabs.modules(inbox)).toBeDefined();
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

test("the back key reaches the pane before the root: screens below the tabs on the root stack stay while the pane has screens to pop", async () => {
  withInsets(24);
  try {
    const { router, settled, hardwareBack } = await mountTree(93, { initial: "/workspaces" });
    router.goto("/acme/home/thread/1");
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(hardwareBack()).toBe(true);
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(hardwareBack()).toBe(true);
    expect(pathsOf(router)).toEqual(["/workspaces"]);
  } finally { reset(); }
});

test("a nested stack navigator is a screen of its parent: the stack inside it starts with the route, its first back pops the screen, and a new visit starts a new stack", async () => {
  withInsets(24);
  try {
    const { router, settled, hardwareBack, tree } = await mountTree(94, { initial: "/acme/home" });
    router.goto("/acme/flow/start");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme", "/acme/flow"]);
    const flow = paneRouter("/acme/flow/start");
    expect(flow.scope).toBe("(workspace)/[slug]/flow");
    expect(pathsOf(flow)).toEqual(["/acme/flow/start"]); // no base page: the stack starts with the route that opened it
    expect(router.current.url.pathname).toBe("/acme/flow/start");
    expect(ofTestID(tree(), "content-layout")).toHaveLength(4); // around the tabs screen, its home page, the flow screen and its page: a content layout wraps every screen below it

    flow.goto("/acme/flow/done");
    await settled();
    expect(pathsOf(flow)).toEqual(["/acme/flow/start", "/acme/flow/done"]);
    expect(pathsOf(router)).toEqual(["/acme", "/acme/flow"]);
    expect(hardwareBack()).toBe(true);
    expect(pathsOf(flow)).toEqual(["/acme/flow/start"]);
    expect(hardwareBack()).toBe(true); // one screen in the stack: the screen of the flow pops
    expect(pathsOf(router)).toEqual(["/acme"]);

    router.goto("/acme/flow/done");
    await settled();
    expect(pathsOf(paneRouter("/acme/flow/done"))).toEqual(["/acme/flow/done"]); // a new visit, a new stack
    expect(pathsOf(flow)).toEqual(["/acme/flow/start"]); // the old one went with its screen
  } finally { reset(); }
});

test("the first screen of a nested stack navigator can go back when its own screen has one below it; a pane's base and the root's first screen cannot", async () => {
  withInsets(24);
  try {
    const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
    const { router, settled } = await mountTree(101, { initial: "/acme/home" });
    expect(arrows(paneRouter("/acme/home"))).toEqual([false]); // a pane's base: its first back does not pop the pane
    router.goto("/acme/flow/start");
    await settled();
    const flow = paneRouter("/acme/flow/start");
    expect(arrows(router)).toEqual([false, true]);
    expect(arrows(flow)).toEqual([true]); // its first back pops the flow's screen from the root, where the tabs are below it
    flow.goto("/acme/flow/done");
    await settled();
    expect(arrows(flow)).toEqual([true, true]);
    flow.back();
    flow.back();
    await settled();
    expect(arrows(router)).toEqual([false]);
    router.goto("/acme/flow/inner/step");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme", "/acme/flow"]);
    expect(arrows(paneRouter("/acme/flow/inner/step"))).toEqual([true]); // the inner flow is the flow's first screen, and the flow can go back: so can the inner one, by popping the whole flow

    const first = await mountTree(102, { initial: "/acme/flow/start" }); // the flow is the root's first screen: nothing to go back to
    expect(pathsOf(first.router)).toEqual(["/acme/flow"]);
    expect(arrows(first.router)).toEqual([false]);
    expect(arrows(paneRouter("/acme/flow/start"))).toEqual([false]);
    paneRouter("/acme/flow/start").goto("/acme/flow/done");
    await first.settled();
    expect(arrows(paneRouter("/acme/flow/done"))).toEqual([false, true]);
  } finally { reset(); }
});

test("a pane's stack keeps the exit contract of its own: a popped screen stays until the stack reports its exit, or until the timeout, with the same warning", async () => {
  withInsets(24);
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  jest.useFakeTimers();
  try {
    const { router, settled, tree } = await mountTree(95, { initial: "/acme/home" });
    router.goto("/acme/home/thread/1");
    await settled();
    const home = paneRouter("/acme/home");
    expect(home.back()).toBe(true);
    await settled();
    const screens = () => tabScreens(tree())[0];
    expect(home.screens.map((screen) => screen.leaving)).toEqual([false, true]);
    expect(screens().map(activityOf)).toEqual(["2", "0"]);
    expect(ofKind(tree(), "stack")[0].children.map(activityOf)).toEqual(["2"]); // the root stack is not involved
    emit(screens()[1].target, "topExited", {});
    await settled();
    expect(home.screens).toHaveLength(1);
    expect(screens()).toHaveLength(1);

    home.goto("/acme/home/thread/2");
    await settled();
    home.back();
    await settled();
    expect(home.screens).toHaveLength(2);
    jest.advanceTimersByTime(EXIT_TIMEOUT_MS + 1);
    await settled();
    expect(home.screens).toHaveLength(1);
    expect(screens()).toHaveLength(1);
    expect(warnings).toHaveLength(1);
  } finally { jest.useRealTimers(); console.warn = warn; reset(); }
});

test("the tabs screen resolves to its first pane; replaceState replaces the pane's top, reset keeps the pane's index page and the tabs screen", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountTree(96, { initial: "/acme" });
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(selectedIndex(96)).toBe("0");
    expect(pathsOf(paneRouter("/acme/home"))).toEqual(["/acme/home"]);

    router.goto("/acme/home/thread/1");
    router.goto("/acme/home/thread/2", { replaceState: true });
    await settled();
    const home = paneRouter("/acme/home");
    expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/2"]);
    router.goto("/acme/home/thread/3");
    router.goto("/acme/home/thread/4", { reset: true });
    await settled();
    expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/4"]);
    expect(home.entries[0].key).toBeLessThan(home.entries[1].key);
    router.goto("/acme/home", { reset: true });
    await settled();
    expect(pathsOf(home)).toEqual(["/acme/home"]);
    expect(pathsOf(router)).toEqual(["/acme"]);
    router.goto("/workspaces", { reset: true }); // a root page: the root stack is the owner and keeps nothing else
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces"]);
  } finally { reset(); }
});

test("a goto to an href the owner stack already holds pops to that entry, from the same pane or another; replaceState and reset do not", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountTree(133, { initial: "/acme/home" });
    const home = paneRouter("/acme/home");
    router.goto("/acme/home/thread/1");
    router.goto("/acme/home/thread/2");
    router.goto("/acme/home/thread/3");
    await settled();
    expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/1", "/acme/home/thread/2", "/acme/home/thread/3"]);
    const second = home.entries[2];
    router.goto("/acme/home/thread/2");
    await settled();
    expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/1", "/acme/home/thread/2"]);
    expect(home.entries[2]).toBe(second); // the entry itself stays: nothing remounts
    router.goto("/acme/home/thread/2");
    expect(pathsOf(home)).toHaveLength(3); // the top: nothing

    router.goto("/acme/inbox"); // another pane: the tab is selected, then the stack there has its base
    router.goto("/acme/inbox/compose");
    await settled();
    expect(selectedIndex(133)).toBe("1");
    expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
    router.goto("/acme/home/thread/1"); // from the inbox pane back to a screen deep in the home stack
    await settled();
    expect(selectedIndex(133)).toBe("0");
    expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/1"]);
    router.goto("/acme/inbox"); // the inbox base: selected, and its sheet popped
    await settled();
    expect(selectedIndex(133)).toBe("1");
    expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox"]);

    router.goto("/acme/home/thread/1", { replaceState: true });
    await settled();
    expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/1"]); // the top: the replacement of an entry by its own href is nothing, as before
    router.goto("/acme/home", { replaceState: true });
    await settled();
    expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home"]); // replaceState keeps its meaning: the top is replaced
    router.goto("/acme/home", { reset: true });
    await settled();
    expect(pathsOf(home)).toEqual(["/acme/home"]);
  } finally { reset(); }
});

test("the launch link is the stack's base: no back arrow on /__dev; later links are plain gotos", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  try {
    const files = await routeFiles(resolve(import.meta.dirname, "fixtures/stand-in-app/src/routes"), { lab: true });
    const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
    const backOf = (surface: number) => Object.fromEntries(ofKind(roots[surface], "header").map((node) => {
      const pairs = parseNativeID(String(node.props.nativeID))?.pairs ?? {};
      return [decodeURIComponent(String(pairs.t)), pairs.bk === "1"];
    }));

    launch.__initialURL = "rasheed-svelte:///__dev";
    const lab = await mountTree(134, { initial: "/sign-in", files });
    await lab.settled();
    expect(pathsOf(lab.router)).toEqual(["/__dev"]); // a direct load has no history: the sign-in is not below it
    expect(arrows(lab.router)).toEqual([false]);
    expect(backOf(134)["/__dev"]).toBe(false); // so the lab's header has no arrow, and its declared controls have no Back
    expect(lab.hardwareBack()).toBe(false);
    // A link that arrives while the app runs opens like any goto: the screen stacks and has its arrow.
    for (const handler of handlersOf("__linkHandlers")) (handler as (event: { url: string }) => void)({ url: "rasheed-svelte:///__dev/screens" });
    await lab.settled();
    expect(pathsOf(lab.router)).toEqual(["/__dev", "/__dev/screens"]);
    expect(arrows(lab.router)).toEqual([false, true]);

    // A project opened by the launch link is the base too: the tabs are the root's only entry.
    launch.__initialURL = "https://example.test/acme/settings";
    const project = await mountTree(135, { initial: "/sign-in", files, tabs: [{ key: "home", title: "Home" }, { key: "settings", title: "Settings" }] });
    await project.settled();
    expect(pathsOf(project.router)).toEqual(["/acme"]);
    expect(selectedIndex(135)).toBe("1");
    expect(arrows(project.router)).toEqual([false]);
    expect(project.hardwareBack()).toBe(false);

    // A link no screen matches is ignored: the app stays on its first screen.
    launch.__initialURL = "rasheed-svelte:///a/b/c/d/e";
    const nothing = await mountTree(136, { initial: "/sign-in", files });
    await nothing.settled();
    expect(pathsOf(nothing.router)).toEqual(["/sign-in"]);
  } finally { delete launch.__initialURL; reset(); }
});

test("the launch link can be opened before the root <Router> mounts: the first screen is never rendered, nothing waits for its exit, and the mount does not open the link again", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number };
  try {
    launch.__initialURL = "https://example.test/workspaces";
    const { m, app, router, settled, texts: shown, hardwareBack } = await mountTree(190, { initial: "/acme/home", mounted: false });
    expect(shown()).toEqual([]);
    expect(pathsOf(router)).toEqual(["/acme"]); // the router's first screen, which a shell that decides by the link does not want rendered
    await m.openLaunchURL(router);
    expect(pathsOf(router)).toEqual(["/workspaces"]);
    expect(router.screens.map((screen) => screen.leaving)).toEqual([false]); // no native stack ever showed the first screen, so none reports its exit
    expect(launch.__initialURLReads).toBe(1);
    expect(await m.openLaunchURL(router)).toBe("https://example.test/workspaces"); // asked again: the same read, and the link is not opened a second time
    expect(launch.__initialURLReads).toBe(1);
    expect(handlersOf("__linkHandlers")).toHaveLength(0);

    app.show(true);
    await settled();
    expect(Object.keys(treeGlobals.__treeRouters ?? {})).toEqual(["/workspaces"]); // the first screen's page never ran
    expect(shown()).toContain("page /workspaces");
    expect(pathsOf(router)).toEqual(["/workspaces"]);
    expect(launch.__initialURLReads).toBe(1); // the <Router> found the link opened
    expect(handlersOf("__linkHandlers")).toHaveLength(1);
    expect(hardwareBack()).toBe(false); // the launch link is the base of the stack

    // From here the screens leave through the native stack as before: a replaced screen stays until its exit is reported.
    router.goto("/acme/home");
    await settled();
    expect(router.screens.map((screen) => screen.leaving)).toEqual([false, false]);
    router.goto("/workspaces", { reset: true });
    await settled();
    expect(router.screens.filter((screen) => screen.leaving)).toHaveLength(2);
  } finally { delete launch.__initialURL; reset(); }
});

/** Every native node's own props that a stack is built from, screens and headers of the tab panes, as the host would receive them. */
const paneNodes = (tree: FakeNode[]) => tabScreens(tree).map((screens) => screens.map((screen) => [String(screen.props.nativeID), ...ofKind(screen.children, "header").map((header) => String(header.props.nativeID))]));

test("a cold start by a link to a sheet under a pane's stack, opened ahead of the <Router> or by it, gives the stacks and native screens a warm link to it gives", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  // What the app shows once the link is open: the root stack, the pane's stack with the presentation and the back arrow of each screen, the selected tab, and every native screen and header.
  const observed = (surface: number, router: TreeRouter) => {
    const pane = paneRouter("/acme/inbox/compose");
    return {
      root: pathsOf(router),
      pane: pathsOf(pane),
      presentations: pane.entries.map((entry) => entry.presentation),
      screens: pane.screens.map((screen) => [screen.canGoBack, screen.leaving]),
      selected: selectedIndex(surface),
      nodes: paneNodes(roots[surface]),
    };
  };
  try {
    launch.__initialURL = "rasheed://acme/inbox/compose";
    const ahead = await mountTree(198, { initial: "/workspaces", mounted: false });
    expect(await ahead.m.openLaunchURL(ahead.router)).toBe("rasheed://acme/inbox/compose");
    ahead.app.show(true);
    await ahead.settled();
    const first = observed(198, ahead.router);
    const after = await mountTree(199, { initial: "/workspaces" });
    await after.settled(); // the <Router>'s own read of the link opens it
    const second = observed(199, after.router);
    // The warm link: the app is running on the inbox and is told of the same link.
    delete launch.__initialURL;
    const warm = await mountTree(200, { initial: "/acme/inbox" });
    expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox"]);
    expect(warm.router.openURL("rasheed://acme/inbox/compose")).toBe(true);
    await warm.settled();
    const third = observed(200, warm.router);
    expect(first.root).toEqual(["/acme"]);
    expect(first.pane).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
    expect(first.presentations).toEqual(["push", "sheet"]);
    expect(first.screens).toEqual([[false, false], [true, false]]);
    expect(first.selected).toBe("1");
    // A cold start, however the link is opened, is the warm link: the same stacks, the same presentations, the same screens for the native side.
    expect(first).toEqual(third);
    expect(second).toEqual(third);
  } finally { delete launch.__initialURL; reset(); }
});

test("the read of the launch link is bounded and a failed read is not remembered", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string };
  try {
    launch.__initialURL = "https://example.test/workspaces";
    const { m, app, router, settled } = await mountTree(191, { initial: "/acme/home", mounted: false });
    // The platform's read fails: the caller hears of it, and the next ask reads again instead of getting the same failure.
    launch.__initialURLMode = "reject";
    await expect(m.openLaunchURL(router)).rejects.toThrow("the link service is down");
    expect(pathsOf(router)).toEqual(["/acme"]);
    delete launch.__initialURLMode;
    await m.openLaunchURL(router);
    expect(launch.__initialURLReads).toBe(2);
    expect(pathsOf(router)).toEqual(["/workspaces"]);
    app.show(true);
    await settled();
    expect(launch.__initialURLReads).toBe(2); // read once for good now

    // A platform that never answers: the wait ends after three seconds and the app starts as if it had no link.
    const second = await mountTree(192, { initial: "/acme/home", mounted: false });
    launch.__initialURLMode = "hang";
    let settledAfter = "pending";
    void second.m.openLaunchURL(second.router).then(() => { settledAfter = "settled"; });
    await second.settled();
    jest.advanceTimersByTime(2_999);
    await second.settled();
    expect(settledAfter).toBe("pending");
    jest.advanceTimersByTime(1);
    await second.settled();
    expect(settledAfter).toBe("settled");
    expect(pathsOf(second.router)).toEqual(["/acme"]); // no link: the router stays on its first screen
  } finally { delete launch.__initialURL; delete launch.__initialURLMode; reset(); }
});

test("the launch link is read once, and a platform that answers after the three seconds is still heard: opened if nothing has navigated since, never twice", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string; __resolveInitialURL?: (url: string | null) => void };
  try {
    // The answer comes late and the stack is as the app left it: the link is the launch's, and it opens (reset: its screen is the base).
    launch.__initialURLMode = "late";
    const first = await mountTree(194, { initial: "/acme/home", mounted: false });
    const settledWith: (string | null)[] = [];
    void first.m.openLaunchURL(first.router).then((url) => { settledWith.push(url); });
    jest.advanceTimersByTime(3_000);
    await first.settled();
    expect(settledWith).toEqual([null]); // the app goes on without it
    expect(pathsOf(first.router)).toEqual(["/acme"]);
    launch.__resolveInitialURL?.("https://example.test/workspaces");
    await first.settled();
    expect(pathsOf(first.router)).toEqual(["/workspaces"]);
    expect(first.router.screens.map((screen) => screen.canGoBack)).toEqual([false]);
    first.app.show(true); // a <Router> mounting afterwards neither reads nor opens it again
    await first.settled();
    expect(launch.__initialURLReads).toBe(1);
    expect(pathsOf(first.router)).toEqual(["/workspaces"]);
    first.app.show(false);
    await first.settled();
    first.app.show(true);
    await first.settled();
    expect(launch.__initialURLReads).toBe(1);

    // The user went on while the platform was silent: the late answer is dropped.
    const second = await mountTree(195, { initial: "/acme/home", mounted: false });
    void second.m.openLaunchURL(second.router);
    jest.advanceTimersByTime(3_000);
    await second.settled();
    second.router.goto("/acme/inbox");
    await second.settled();
    const before = pathsOf(second.router);
    launch.__resolveInitialURL?.("https://example.test/workspaces");
    await second.settled();
    expect(pathsOf(second.router)).toEqual(before);
    second.app.show(true);
    await second.settled();
    expect(pathsOf(second.router)).toEqual(before); // and the <Router> that mounts does not open it either
  } finally { delete launch.__initialURLMode; delete launch.__resolveInitialURL; reset(); }
});

test("a link that is refused ahead of the <Router> is left for it, and a read that failed is not applied once the app has gone on", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string };
  try {
    launch.__initialURL = "https://example.test/workspaces";
    const refused = await mountTree(196, { initial: "/acme/home", mounted: false });
    expect(await refused.m.openLaunchURL(refused.router, (url: string) => !url.includes("workspaces"))).toBe("https://example.test/workspaces");
    expect(pathsOf(refused.router)).toEqual(["/acme"]); // not opened here
    refused.app.show(true);
    await refused.settled();
    expect(pathsOf(refused.router)).toEqual(["/workspaces"]); // the <Router>'s own call opens it
    expect(launch.__initialURLReads).toBe(1); // from the one read

    // The first read fails; the app goes on (a sign-out sends it to the login and remounts the <Router>); the read that then succeeds is the cold start's, long stale.
    const stale = await mountTree(197, { initial: "/acme/home", mounted: false });
    launch.__initialURLMode = "reject";
    await expect(stale.m.openLaunchURL(stale.router)).rejects.toThrow("the link service is down");
    stale.router.goto("/acme/inbox");
    await stale.settled();
    const before = pathsOf(stale.router);
    delete launch.__initialURLMode;
    expect(await stale.m.openLaunchURL(stale.router)).toBe("https://example.test/workspaces");
    await stale.settled();
    expect(pathsOf(stale.router)).toEqual(before);
    stale.app.show(true);
    await stale.settled();
    expect(pathsOf(stale.router)).toEqual(before);
  } finally { delete launch.__initialURL; delete launch.__initialURLMode; reset(); }
});

/** What the root router would leave for a restart or a hot remount right now (`hmrState().navigation`). */
const savedNavigation = () => (globalThis as { __svelteNativeHmrState?: { navigation?: () => { stack: object; launch?: string } } }).__svelteNativeHmrState?.navigation?.();

test("a launch link that is dropped is recorded as the one acted on, so a restart that gets the intent again does not replay it over the restored screens", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string; __resolveInitialURL?: (url: string | null) => void; __svelteNativeHmrState?: { restore?: unknown } };
  const link = "https://example.test/workspaces";
  try {
    // An answer that comes after the app navigated is dropped...
    delete launch.__svelteNativeHmrState;
    launch.__initialURLMode = "late";
    const first = await mountTree(198, { initial: "/acme/home", mounted: false });
    void first.m.openLaunchURL(first.router);
    jest.advanceTimersByTime(3_000);
    await first.settled();
    first.router.goto("/acme/inbox");
    await first.settled();
    launch.__resolveInitialURL?.(link);
    await first.settled();
    expect(pathsOf(first.router)).toEqual(["/acme"]);
    // ...but remembered as the launch's: it is in the state a restart gets.
    const saved = savedNavigation();
    expect(saved?.launch).toBe(link);
    // The process dies and Android delivers the same intent to the restored app: the restored screens stay.
    delete launch.__initialURLMode;
    launch.__initialURL = link;
    (launch.__svelteNativeHmrState as { restore?: unknown }).restore = saved;
    const restored = await mountTree(199, { initial: "/acme/home" });
    await restored.settled();
    expect(pathsOf(restored.router)).toEqual(["/acme"]);
    expect(launch.__initialURLReads).toBe(1);

    // A read that failed and was asked again after the app went on is dropped the same way.
    delete launch.__svelteNativeHmrState;
    launch.__initialURLMode = "reject";
    const stale = await mountTree(200, { initial: "/acme/home", mounted: false });
    await expect(stale.m.openLaunchURL(stale.router)).rejects.toThrow("the link service is down");
    stale.router.goto("/acme/inbox");
    await stale.settled();
    delete launch.__initialURLMode;
    await stale.m.openLaunchURL(stale.router);
    expect(pathsOf(stale.router)).toEqual(["/acme"]);
    expect(savedNavigation()?.launch).toBe(link);
  } finally { delete launch.__initialURL; delete launch.__initialURLMode; delete launch.__resolveInitialURL; delete launch.__svelteNativeHmrState; reset(); }
});

test("a late answer is judged as a timely one is: not after a failed read and a navigation, and by the caller's accept", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string; __resolveInitialURL?: (url: string | null) => void };
  const link = "https://example.test/workspaces";
  try {
    // The first read fails, the app goes on, the second read is silent for three seconds and then answers: the answer is the cold start's, long stale.
    launch.__initialURLMode = "reject";
    const stale = await mountTree(201, { initial: "/acme/home", mounted: false });
    await expect(stale.m.openLaunchURL(stale.router)).rejects.toThrow("the link service is down");
    stale.router.goto("/acme/inbox");
    await stale.settled();
    launch.__initialURLMode = "late";
    void stale.m.openLaunchURL(stale.router);
    jest.advanceTimersByTime(3_000);
    await stale.settled();
    launch.__resolveInitialURL?.(link); // nothing navigated since the wait ended, but the app had gone on before the read
    await stale.settled();
    expect(pathsOf(stale.router)).toEqual(["/acme"]);
    stale.app.show(true);
    await stale.settled();
    expect(pathsOf(stale.router)).toEqual(["/acme"]);

    // The caller refused the link for the moment: a late answer is not opened behind its back, and waits for the next call, the <Router>'s.
    launch.__initialURLMode = "late";
    const refused = await mountTree(202, { initial: "/acme/home", mounted: false });
    void refused.m.openLaunchURL(refused.router, (url: string) => !url.includes("workspaces"));
    jest.advanceTimersByTime(3_000);
    await refused.settled();
    launch.__resolveInitialURL?.(link);
    await refused.settled();
    expect(pathsOf(refused.router)).toEqual(["/acme"]);
    refused.app.show(true); // the <Router> mounts, asks, and finds the answer that was left for it
    await refused.settled();
    expect(pathsOf(refused.router)).toEqual(["/workspaces"]);
    expect(launch.__initialURLReads).toBe(1);

    // Left for the next call, but the app navigated before it came: dropped.
    launch.__initialURLMode = "late";
    const gone = await mountTree(203, { initial: "/acme/home", mounted: false });
    void gone.m.openLaunchURL(gone.router, (url: string) => !url.includes("workspaces"));
    jest.advanceTimersByTime(3_000);
    await gone.settled();
    launch.__resolveInitialURL?.(link);
    await gone.settled();
    gone.router.goto("/acme/inbox");
    await gone.settled();
    gone.app.show(true);
    await gone.settled();
    expect(pathsOf(gone.router)).toEqual(["/acme"]);
  } finally { delete launch.__initialURLMode; delete launch.__resolveInitialURL; reset(); }
});

test("a read that throws at once is forgotten like one that rejects, and leaves no timer behind", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string; __initialURLReads?: number; __initialURLMode?: string };
  const timers = () => (jest as unknown as { getTimerCount(): number }).getTimerCount();
  try {
    launch.__initialURL = "https://example.test/workspaces";
    const { m, app, router, settled } = await mountTree(204, { initial: "/acme/home", mounted: false });
    const before = timers();
    launch.__initialURLMode = "throw";
    await expect(m.openLaunchURL(router)).rejects.toThrow("the link service threw at once");
    expect(timers()).toBe(before); // the three seconds' wait was cleared, not left to fire
    await expect(m.openLaunchURL(router)).rejects.toThrow("the link service threw at once"); // asked again, not the same rejection from a cache
    expect(launch.__initialURLReads).toBe(2);
    delete launch.__initialURLMode;
    expect(await m.openLaunchURL(router)).toBe("https://example.test/workspaces");
    expect(pathsOf(router)).toEqual(["/workspaces"]);
    app.show(true);
    await settled();
    expect(launch.__initialURLReads).toBe(3);
    expect(pathsOf(router)).toEqual(["/workspaces"]);
  } finally { delete launch.__initialURL; delete launch.__initialURLMode; reset(); }
});

test("a root <Router> that unmounts takes the screens still leaving with it, and a navigation while it is away drops what it replaces at once", async () => {
  withInsets(24);
  try {
    const { app, router, settled } = await mountTree(193, { initial: "/workspaces" });
    router.goto("/acme/home");
    await settled();
    router.goto("/workspaces", { reset: true });
    await settled();
    expect(router.screens.filter((screen) => screen.leaving).length).toBeGreaterThan(0); // the native stack has not reported their exit
    app.show(false);
    await settled();
    expect(router.screens.filter((screen) => screen.leaving)).toHaveLength(0);
    router.goto("/acme/home", { reset: true }); // nothing is on screen to take /workspaces away
    expect(router.screens.map((screen) => screen.leaving)).toEqual([false]);
    app.show(true);
    await settled();
    expect(pathsOf(router)).toEqual(["/acme"]);
  } finally { reset(); }
});

test("a Screen in a router entry does not get a stack of its own: one stack per router, the pages' screens are its screens", async () => {
  withInsets(24);
  try {
    const { router, settled, tree } = await mountTree(132, { initial: "/acme/home" });
    router.goto("/acme/home/thread/1");
    router.goto("/acme/inbox");
    await settled();
    const stacks = ofKind(tree(), "stack");
    expect(stacks).toHaveLength(3); // the root's, the home pane's and the inbox pane's
    for (const stack of stacks) expect(stack.children.every((child) => parseNativeID(String(child.props.nativeID))?.kind === "screen")).toBe(true);
    expect(ofKind(tree(), "screen")).toHaveLength(ofKind(tree(), "header").length + 1); // a header per page, and the root's screen for the tabs
  } finally { reset(); }
});

test("reset is a new root for the whole chain: the root keeps only the tabs screen, the instance it had, with its panes mounted; nothing below or above survives and no arrow shows at the base", async () => {
  withInsets(24);
  try {
    const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
    const { router, settled, hardwareBack } = await mountTree(130, { initial: "/workspaces" });
    router.goto("/acme"); // the workspace over the list, as a link or a plain push leaves it
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    const tabs = router.entries[1];
    const home = paneRouter("/acme/home");
    const base = home.entries[0];

    calls.length = 0;
    router.goto("/acme", { reset: true }); // what the workspace list does to open a workspace
    await settled();
    expect(pathsOf(router)).toEqual(["/acme"]); // the list is gone
    expect(router.entries[0]).toBe(tabs); // the same tabs screen: nothing is created, nothing remounts
    expect(home.entries[0]).toBe(base);
    expect(paneRouter("/acme/home")).toBe(home);
    expect(calls.filter((call) => call.startsWith("create"))).toEqual([]);
    expect(arrows(router)).toEqual([false]); // the tabs screen is the root's only entry
    expect(arrows(home)).toEqual([false]); // a pane's base has no arrow either
    expect(hardwareBack()).toBe(false); // Android's back key leaves the app from the home pane's base
    expect(selectedIndex(130)).toBe("0");

    // A pane's stack, then a modal over the tabs; a reset from the modal to the other pane drops the modal and the stacks it names.
    router.goto("/acme/home/thread/1");
    router.goto("/account");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme", "/account"]);
    expect(arrows(router)).toEqual([false, true]);
    router.goto("/acme/inbox/compose", { reset: true });
    await settled();
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(router.entries[0]).toBe(tabs);
    expect(selectedIndex(130)).toBe("1");
    expect(pathsOf(paneRouter("/acme/inbox"))).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
    expect(arrows(paneRouter("/acme/inbox"))).toEqual([false, true]); // the sheet's header can go back, the base cannot
    expect(pathsOf(home)).toEqual(["/acme/home", "/acme/home/thread/1"]); // a pane the chain does not name is left alone
    expect(arrows(router)).toEqual([false]);

    // A root page resets the root to itself: the workspace goes.
    router.goto("/workspaces", { reset: true });
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces"]);
    expect(hardwareBack()).toBe(false);
  } finally { reset(); }
});

test("a reset that keeps a nested stack navigator's screen moves it to the root's base: its first screen no longer goes back", async () => {
  withInsets(24);
  try {
    const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
    const { router, settled } = await mountTree(131, { initial: "/workspaces" });
    router.goto("/acme/flow/start");
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme/flow"]);
    const flow = paneRouter("/acme/flow/start");
    const screen = router.entries[1];
    expect(arrows(flow)).toEqual([true]); // its first back pops the flow from the root, where the list is below it
    flow.goto("/acme/flow/done");
    await settled();
    flow.goto("/acme/flow/start", { reset: true });
    await settled();
    expect(pathsOf(router)).toEqual(["/acme/flow"]); // the list below it is gone, the flow is the root's base
    expect(router.entries[0]).toBe(screen);
    expect(pathsOf(flow)).toEqual(["/acme/flow/start"]);
    expect(paneRouter("/acme/flow/start")).toBe(flow);
    expect(arrows(router)).toEqual([false]);
    expect(arrows(flow)).toEqual([false]); // nothing below the flow to go back to
    flow.goto("/acme/flow/done");
    await settled();
    expect(arrows(flow)).toEqual([false, true]);
  } finally { reset(); }
});
