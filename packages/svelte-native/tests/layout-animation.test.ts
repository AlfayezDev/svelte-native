import { test, expect } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";

type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
const calls: string[] = [];
const configsAtCommit: number[] = [];
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
    configsAtCommit.push((globalThis as unknown as { __anim?: { layoutConfigs?: unknown[] } }).__anim?.layoutConfigs?.length ?? 0);
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
import type { AnimLog } from "./reanimated-stubs.ts";
const log = () => (globalThis as unknown as { __anim: AnimLog }).__anim;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-modules-core": "export const requireOptionalNativeModule = () => null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

async function load() {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './layout-animation-fixture.svelte';
        import { startSurface, flush, fabricStats } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, flush, fabricStats, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "animation-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-layout-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}
const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((n) => [...(n.name === name ? [n] : []), ...find(n.children, name)]);
const byId = (root: number, id: string) => find(roots[root] ?? [], "RCTView").find((n) => n.props.testID === id) as FakeNode;
type App = { showEntering: () => void; swapLayout: () => void; dropExiting: () => void };
const fresh = async () => { delete (globalThis as { __anim?: unknown }).__anim; roots = {}; configsAtCommit.length = 0; return load(); };
const configs = () => log().layoutConfigs ?? [];

test("entering is registered under a nativeID before the commit that inserts the node, and never reaches the payload", async () => {
  const m = await fresh();
  m.startSurface(41, m.Fixture, {});
  const plain = byId(41, "entering");
  expect(plain).toBeDefined();
  const entering = configs().filter((c) => c.type === 1);
  expect(entering).toHaveLength(1);
  expect(entering[0].config).toEqual({ build: "entering" });
  expect(configs().indexOf(entering[0])).toBeLessThan(configsAtCommit[0] as number);
  expect(plain.props.nativeID).toBe(String(entering[0].viewTag));
  for (const key of ["entering", "exiting", "layout"]) expect(key in plain.props).toBe(false);
  // not a tag: Reanimated moves nativeID-keyed configs to the tag when it sees the inserted view
  expect(entering[0].viewTag).not.toBe(plain.tag);
});

test("exiting and layout are registered by tag after the mounting commit", async () => {
  const m = await fresh();
  m.startSurface(42, m.Fixture, {});
  const node = byId(42, "entering");
  const rest = configs().filter((c) => c.type !== 1);
  expect(rest.map((c) => [c.viewTag, c.type, c.config])).toEqual([
    [node.tag, 2, { fade: "out" }],
    [node.tag, 3, { move: "a" }],
  ]);
  expect(configsAtCommit[0]).toBe(1); // only ENTERING existed at the first completeRoot
});

test("layout and exiting re-register when the prop changes or goes away; unchanged props do not", async () => {
  const m = await fresh();
  const app = m.startSurface(43, m.Fixture, {}) as App;
  const before = configs().length;
  await m.tick();
  expect(configs()).toHaveLength(before);
  app.swapLayout();
  await m.tick();
  const node = byId(43, "entering");
  expect(configs().slice(before).map((c) => [c.viewTag, c.type, c.config])).toEqual([[node.tag, 3, { move: "b" }]]);
  app.dropExiting();
  await m.tick();
  expect(configs().slice(before + 1).map((c) => [c.viewTag, c.type, c.config])).toEqual([[node.tag, 2, undefined]]);
  expect("exiting" in byId(43, "entering").props).toBe(false);
});

test("entering appearing after the first mount is ignored, as in AnimatedComponent", async () => {
  const m = await fresh();
  const app = m.startSurface(44, m.Fixture, {}) as App;
  const before = configs().filter((c) => c.type === 1).length;
  app.showEntering();
  await m.tick();
  expect(configs().filter((c) => c.type === 1)).toHaveLength(before + 1); // the second node's own mount, not the first node's update
  expect(byId(44, "late").props.nativeID).toBeDefined();
});
