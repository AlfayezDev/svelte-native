import { test, expect } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { reactNativeConverters } from "./rn-reference.ts";

// What the host does around a flush that no payload shows: the work it skips for nodes it has not built, and who it sends through the
// animation layer once that is loaded.
type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; target?: unknown };
let roots: Record<number, FakeNode[]> = {};
const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((node) => [...(node.name === name ? [node] : []), ...find(node.children, name)]);
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown) { return { tag, name, props: { ...props }, children: [], target } as FakeNode; },
  cloneNodeWithNewChildren(node: FakeNode) { return { ...node, children: [] }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [...node.children] }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [] }; },
  appendChild(parent: FakeNode, child: FakeNode) { parent.children.push(child); },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) { roots[root] = set.children; },
  registerEventHandler() {},
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Image/resolveAssetSource": "export default () => null;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-modules-core": "export const requireOptionalNativeModule = () => null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

async function load() {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './fabric-fixture.svelte';
        import Shorthand from './host-hints-fixture.svelte';
        import renderer, { NativeNode } from '../src/renderer.ts';
        import { startSurface, fabricStats, mayAnimate, plainStyle } from '../src/fabric/host.ts';
        import { defineViewKind } from '../src/fabric/view-configs.ts';
        import { tick } from 'svelte';
        export { startSurface, fabricStats, mayAnimate, plainStyle, defineViewKind, tick, Fixture, Shorthand, renderer, NativeNode };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    plugins: [...reactNativeConverters("android"), {
      name: "host-hints",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-hints-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const loaded = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return loaded;
}
const settle = async (m: { tick: () => Promise<void> }) => { await m.tick(); await Promise.resolve(); await Promise.resolve(); };

test("a node the host has not built schedules nothing; a node that is attached does", async () => {
  const m = await load();
  const app = m.startSurface(11, m.Fixture, {}) as { fillDirect: (n: number) => void; fill: (n: number) => void };
  const flushes = () => m.fabricStats().flushes;
  const before = flushes();
  // A node Svelte is putting together (its element, its text, an attribute) is not the host's business until it is attached.
  const element = new m.NativeNode("element", "native-view");
  element.setProp("testID", "loose");
  element.setProp("nativeStyle", { padding: 1 });
  const text = new m.NativeNode("text", "", "hello");
  text.setText("again");
  const fragment = new m.NativeNode("fragment");
  m.renderer.insert(fragment, element, null);
  m.renderer.insert(element, text, null);
  await settle(m);
  expect(flushes()).toBe(before);
  // What reaches the surface does: the rows a fixture mounts are built from nodes that were all unbuilt a moment before.
  app.fill(5);
  await settle(m);
  expect(flushes()).toBe(before + 1);
  expect(m.fabricStats().lastCreated).toBe(15); // 5 rows of a view, a text and its string
});

test("mayAnimate: plain nodes stay out of the animation layer, the ones it needs go through", async () => {
  const m = await load();
  const shared = { value: 1, _isReanimatedSharedValue: true };
  expect(m.mayAnimate({ nativeStyle: { padding: 1 }, style: { padding: 10, backgroundColor: "#fff", borderRadius: 8 }, testID: "a" })).toBe(false);
  expect(m.mayAnimate({ style: [{ padding: 10 }, null, [{ margin: 2 }], false] })).toBe(false);
  expect(m.mayAnimate({})).toBe(false);
  expect(m.mayAnimate({ animatedStyle: () => ({}) })).toBe(true);
  expect(m.mayAnimate({ animatedProps: () => ({}) })).toBe(true);
  expect(m.mayAnimate({ entering: {} })).toBe(true);
  expect(m.mayAnimate({ exiting: {} })).toBe(true);
  expect(m.mayAnimate({ layout: {} })).toBe(true);
  expect(m.mayAnimate({ animationName: {} })).toBe(true);
  expect(m.mayAnimate({ transitionProperty: "opacity" })).toBe(true);
  expect(m.mayAnimate({ transition: "opacity 300ms" })).toBe(true); // Reanimated's shorthand
  expect(m.mayAnimate({ style: { animationDuration: "1s" } })).toBe(true);
  expect(m.mayAnimate({ style: [{ padding: 1 }, { transitionDuration: "1s" }] })).toBe(true);
  expect(m.mayAnimate({ style: { transition: "opacity 300ms" } })).toBe(true);
  expect(m.mayAnimate({ style: [{ padding: 1 }, { transition: "opacity 300ms" }] })).toBe(true);
  expect(m.mayAnimate({ style: { opacity: shared } })).toBe(true);
  expect(m.mayAnimate({ style: { transform: [{ translateX: shared }] } })).toBe(true);
  expect(m.mayAnimate({ style: [{ padding: 1 }, { opacity: shared }] })).toBe(true);
  expect(m.plainStyle(undefined)).toBe(true);
  expect(m.plainStyle("padding: 1")).toBe(true);
  expect(m.plainStyle({ animation: 1 })).toBe(true); // Reanimated has no `animation` shorthand (yet): `animationName` and the like are CSS keys, a bare `animation` is not
  expect(m.plainStyle({ transition: "opacity 300ms" })).toBe(false); // the `transition` shorthand is
});

test("a node whose only animation is the `transition` shorthand loads the animation layer", async () => {
  const m = await load();
  roots = {};
  const app = m.startSurface(21, m.Shorthand, {}) as { useShorthand: () => void };
  expect(m.fabricStats().animationLoaded).toBe(false); // a plain first screen boots without the layer
  app.useShorthand();
  await settle(m);
  expect(m.fabricStats().animationLoaded).toBe(true);
  const node = find(roots[21] ?? [], "RCTView").find((view) => view.props.testID === "shorthand");
  expect(node?.props).toEqual({ testID: "shorthand", padding: 2 }); // the shorthand is for the layer, not the native view
});

test("a node's `declares` follows its view config when the kind is defined anew", async () => {
  const m = await load();
  roots = {};
  const app = m.startSurface(22, m.Fixture, {}) as { rename: (s: string) => void };
  await settle(m);
  const state = (name: string) => (find(roots[22] ?? [], name)[0]?.target as { hostState?: { declares?: (key: string) => boolean } } | undefined)?.hostState;
  const before = state("RCTText")?.declares;
  const view = state("RCTView")?.declares;
  expect(before?.("customProp")).toBe(false);
  m.defineViewKind("RCTText", { plain: "customProp" });
  app.rename("again");
  await settle(m);
  const after = state("RCTText")?.declares;
  expect(after).not.toBe(before);
  expect(after?.("customProp")).toBe(true);
  expect(state("RCTView")?.declares).toBe(view); // a view name that was not defined anew keeps its function
});
