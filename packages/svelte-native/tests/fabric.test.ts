import { test, expect } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { loadReference, reactNativeConverters } from "./rn-reference.ts";
import type { PayloadTap } from "./payload-tap.ts";

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
const tap: PayloadTap = { reference: await loadReference("android"), checks: [] };
(globalThis as { __payloadTap?: PayloadTap }).__payloadTap = tap;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
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
      contents: `import Fixture from './fabric-fixture.svelte';
        import { startSurface, flush, fabricStats } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, flush, fabricStats, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    plugins: [...reactNativeConverters("android"), {
      name: "fabric-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /\/view-configs\.ts$/ }, (args) => (args.importer.endsWith("/fabric/host.ts") ? { path: resolve(import.meta.dirname, "payload-tap.ts") } : undefined));
        builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-fabric-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}
const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((n) => [...(n.name === name ? [n] : []), ...find(n.children, name)]);
const settle = async (m: { tick: () => Promise<void> }) => { await m.tick(); await Promise.resolve(); await Promise.resolve(); };

test("the Fabric host mounts, updates and clears a scroll list with one content child", async () => {
  const m = await load();
  calls.length = 0; roots = {};
  const app = m.startSurface(11, m.Fixture, {}) as { fill: (n: number) => void; clear: () => void; rename: (s: string) => void; pad: (n: number) => void };
  expect(calls.at(-1)).toBe("completeRoot");
  let scroll = find(roots[11], "RCTScrollView");
  expect(scroll).toHaveLength(1);
  expect(scroll[0].children).toHaveLength(1);
  expect(scroll[0].children[0].name).toBe("RCTView");
  expect(find(roots[11], "RCTRawText")[0].props.text).toBe("before");

  calls.length = 0;
  app.fill(300);
  await settle(m);
  expect(calls.at(-1)).toBe("completeRoot");
  scroll = find(roots[11], "RCTScrollView");
  expect(scroll[0].children).toHaveLength(1);
  expect(scroll[0].children[0].children).toHaveLength(300);
  expect(find(roots[11], "RCTRawText")).toHaveLength(301);
  expect(find(roots[11], "RCTRawText").at(-1)?.props.text).toBe("Row 300");
  expect(m.fabricStats().lastCreated).toBe(900);
  expect(m.fabricStats().animationLoaded).toBe(false); // nothing animated: Reanimated never loaded

  calls.length = 0;
  app.rename("after");
  await settle(m);
  expect(find(roots[11], "RCTRawText")[0].props.text).toBe("after");
  expect(calls.filter((c) => c.startsWith("create"))).toHaveLength(0);
  expect(scroll[0].children[0].children).toHaveLength(300);

  // The content container's own style changes with the rows as they were: the container is cloned with its children kept.
  calls.length = 0;
  app.pad(16);
  await settle(m);
  scroll = find(roots[11], "RCTScrollView");
  expect((scroll[0].children[0].props as { padding?: number }).padding).toBe(16);
  expect(scroll[0].children[0].children).toHaveLength(300);
  expect(calls.filter((c) => c.startsWith("create"))).toHaveLength(0);
  expect(calls).toContain("cloneProps RCTView");
  expect(calls).toContain("cloneChildren RCTScrollView");

  calls.length = 0;
  app.clear();
  await settle(m);
  scroll = find(roots[11], "RCTScrollView");
  expect(scroll[0].children).toHaveLength(1);
  expect(scroll[0].children[0].children).toHaveLength(0);

  app.fill(5);
  await settle(m);
  scroll = find(roots[11], "RCTScrollView");
  expect(scroll[0].children).toHaveLength(1);
  expect(scroll[0].children[0].children).toHaveLength(5);
});

test("a node's `declares` is made once for its view name, not again on every rebuild", async () => {
  const m = await load();
  calls.length = 0; roots = {};
  const app = m.startSurface(15, m.Fixture, {}) as { rename: (s: string) => void; fill: (n: number) => void };
  const declares = () => {
    const text = find(roots[15], "RCTText")[0];
    return (text?.target as { hostState?: { declares?: (key: string) => boolean } } | undefined)?.hostState?.declares;
  };
  const first = declares();
  expect(typeof first).toBe("function");
  expect(first?.("notAProp")).toBe(false);
  // The text is rebuilt with its new string: its view name has not changed, so its `declares` is the one it had.
  app.rename("again");
  await settle(m);
  expect(find(roots[15], "RCTRawText")[0].props.text).toBe("again");
  expect(declares()).toBe(first);
  app.fill(3);
  await settle(m);
  expect(declares()).toBe(first);
});

type Handle = { tag: number; measure: (cb: (...a: number[]) => void) => void; measureInWindow: (cb: (...a: number[]) => void) => void; dispatchCommand: (name: string, args?: unknown[]) => void };
type DirectApp = { fillDirect: (n: number) => void; layoutLog: () => unknown[][]; handleOf: () => Handle | null };
const emit = (target: unknown, type: string, event: object) => (fake as unknown as { handler: (t: unknown, type: string, e: object) => void }).handler(target, type, event);

test("native elements take React Native props as direct attributes and merge them over nativeProps", async () => {
  const m = await load();
  calls.length = 0; roots = {};
  const app = m.startSurface(12, m.Fixture, {}) as DirectApp;
  const container = find(roots[12], "RCTView").find((n) => n.props.testID === "direct");
  expect(container?.props).toEqual({ pointerEvents: "box-none", testID: "direct" });

  // Svelte stringifies a `style` attribute on every element, so the host drops it; `nativeStyle` is the attribute that carries a style object.
  expect(find(roots[12], "RCTView").find((n) => n.props.testID === "styled")?.props).toEqual({ testID: "styled" });
  app.fillDirect(3);
  await settle(m);
  const rows = find(roots[12], "RCTView").filter((n) => n.props.onLayout === true);
  expect(rows).toHaveLength(3);
  expect(rows.map((n) => n.props.padding)).toEqual([4, 5, 6]);
  expect(rows[0].props.accessible).toBe(true);
  for (const key of ["class", "id", "data-row", "children", "nativeProps", "nativeStyle", "ref"]) expect(key in rows[0].props).toBe(false);
  expect("style" in rows[0].props).toBe(false); // styles are flattened into the payload; the stringified `style="color: red"` never reaches it
  expect(find(roots[12], "RCTText").filter((n) => n.props.fontSize === 12)).toHaveLength(3);

  expect(app.layoutLog()).toEqual([]);
  emit(rows[1].target, "topLayout", { layout: { height: 42 } });
  emit(rows[2].target, "topLayout", { layout: { height: 7 } });
  expect(app.layoutLog()).toEqual([[1, 42], [2, 7]]);
  emit(rows[0].target, "topScroll", {}); // no handler, and no throw
  expect(app.layoutLog()).toHaveLength(2);
});

test("a ref attribute receives a handle that measures and dispatches commands through the binding", async () => {
  const m = await load();
  calls.length = 0; roots = {};
  const app = m.startSurface(13, m.Fixture, {}) as DirectApp;
  const handle = app.handleOf();
  expect(handle).not.toBeNull();
  const container = find(roots[13], "RCTView").find((n) => n.props.testID === "direct");
  expect(handle?.tag).toBe(container?.tag);
  let measured: number[] = [];
  handle?.measure((...a) => { measured = a; });
  expect(measured).toEqual([1, 2, 3, 4, 5, 6]);
  handle?.measureInWindow((...a) => { measured = a; });
  expect(measured).toEqual([5, 6, 3, 4]);
  handle?.dispatchCommand("focus", [1]);
  expect(calls).toContain(`dispatchCommand ${container?.tag} focus [1]`);
});

test("every payload the host builds for these fixture trees is identical to React Native's, key order included", () => {
  expect(tap.checks.length).toBeGreaterThan(600);
  expect(new Set(tap.checks.map((check) => check.kind))).toEqual(new Set(["create", "diff"]));
  expect(new Set(tap.checks.map((check) => check.view))).toEqual(new Set(["RCTView", "RCTText", "RCTScrollView"]));
  expect(tap.checks.filter((check) => check.mine !== check.reactNative)).toEqual([]);
});
