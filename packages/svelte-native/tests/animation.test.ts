import { test, expect } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
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
import type { AnimLog } from "./reanimated-stubs.ts";
const log = () => (globalThis as unknown as { __anim: AnimLog }).__anim;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-modules-core": "export const requireOptionalNativeModule = (name) => (name === 'SvelteEngine' ? (globalThis.__testEngine ?? null) : null);",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

async function load(fixture = "animation-fixture.svelte") {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './${fixture}';
        import { startSurface, flush, fabricStats } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, flush, fabricStats, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    plugins: [...reactNativeConverters("android"), {
      name: "animation-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /\/view-configs\.ts$/ }, (args) => (args.importer.endsWith("/fabric/host.ts") ? { path: resolve(import.meta.dirname, "payload-tap.ts") } : undefined));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-anim-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}
const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((n) => [...(n.name === name ? [n] : []), ...find(n.children, name)]);
const byId = (root: number, id: string) => find(roots[root] ?? [], "RCTView").find((n) => n.props.testID === id) as FakeNode;
const settle = async (m: { tick: () => Promise<void> }) => { await m.tick(); await Promise.resolve(); await Promise.resolve(); };
type App = { hide: () => void; show: () => void; pad: (n: number) => void; dropCss: () => void; useInline: () => void; two: () => void; useProps: () => void };
const animationKeys = ["animationName", "animationDuration", "transitionProperty", "transitionDuration", "animatedStyle", "animatedProps"];
const fresh = async (fixture?: string) => { delete (globalThis as { __anim?: unknown }).__anim; roots = {}; return load(fixture); };

test("animatedStyle: initial values in the first payload, one descriptor and one mapper, re-pointed after a clone, stopped on removal", async () => {
  const m = await fresh();
  const app = m.startSurface(31, m.Fixture, {}) as App;
  const anim = byId(31, "anim");
  expect(m.fabricStats().animationLoaded).toBe(true); // the first animated node loaded the layer
  expect(anim.props).toEqual({ testID: "anim", padding: 1, opacity: 0.5, transform: [{ scale: 2 }] });
  expect("animatedStyle" in anim.props).toBe(false);
  expect(byId(31, "plain").props).toEqual({ testID: "plain", padding: 1 });

  const A = log();
  expect(A.descriptors).toHaveLength(1);
  expect(A.descriptors[0].adds).toHaveLength(1);
  expect(A.descriptors[0].adds[0].tag).toBe(anim.tag);
  expect(A.descriptors[0].adds[0].shadowNodeWrapper).toBe(anim);
  expect(A.mappers).toHaveLength(1);
  expect(A.mappers[0].stopped).toBe(false);

  // the mapper worklet is the ported styleUpdater: it diffs against the initial values and writes to the descriptors
  A.mappers[0].worklet();
  expect(A.updates).toHaveLength(1);
  expect(A.updates[0].values).toEqual({ opacity: 0.5, transform: [{ scale: 2 }] });
  expect((A.updates[0].descriptors as { id: number }).id).toBe(1);

  app.pad(2);
  await settle(m);
  const cloned = byId(31, "anim");
  expect(cloned).not.toBe(anim);
  expect(A.mappers).toHaveLength(1); // same updater: no restart
  expect(A.descriptors[0].adds).toHaveLength(2);
  expect(A.descriptors[0].adds[1].shadowNodeWrapper).toBe(cloned);
  expect(A.descriptors[0].adds[1].tag).toBe(anim.tag);

  app.two(); // a different set of updaters restarts the one mapper
  await settle(m);
  expect(A.mappers).toHaveLength(2);
  expect(A.mappers[0].stopped).toBe(true);
  expect(A.mappers[1].stopped).toBe(false);

  app.hide();
  await settle(m);
  expect(A.mappers[1].stopped).toBe(true);
  expect(A.descriptors[0].removes).toEqual([anim.tag]);
  const removed = A.descriptors[0].adds.at(-1)?.shadowNodeWrapper;
  expect(A.removable).toContain(removed);
  expect(A.removable.filter((entry) => entry === removed)).toHaveLength(1);
  // A mapper batch collected before the node left is flushed into Reanimated's registry one frame later, after the mark was
  // handled: the node is marked once more so that the next mount removes that late entry too.
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(A.removable.filter((entry) => entry === removed)).toHaveLength(2);

  app.show(); // a node that comes back attaches afresh
  await settle(m);
  expect(A.descriptors).toHaveLength(2);
  expect(A.mappers).toHaveLength(3);
});

test("animatedProps: first-run values in the node's props, a descriptor set and a mapper of its own that write as animated props, stopped with the node", async () => {
  const m = await fresh();
  const app = m.startSurface(34, m.Fixture, {}) as App;
  app.useProps();
  await settle(m);
  const node = byId(34, "props");
  // The style worklet's values go in the style, the props worklet's in the props: both are in the first commit, neither key reaches the native payload.
  expect(node.props).toEqual({ testID: "props", padding: 1, opacity: 0.5, transform: [{ scale: 2 }], accessibilityLabel: "count 3" });
  expect("animatedProps" in node.props).toBe(false);

  const A = log();
  const own = A.descriptors.filter((entry) => entry.adds.some((add) => add.tag === node.tag));
  expect(own).toHaveLength(2); // one set for the style updater, one for the props updater
  expect(A.mappers.filter((entry) => !entry.stopped)).toHaveLength(3); // "anim"'s and the two of this node

  // Each mapper writes to its own set (a forced run: the values did not change since the first one); only the props mapper says the values are animated props, which Reanimated hands on unbuilt.
  A.updates.length = 0;
  for (const mapper of A.mappers.slice(1)) mapper.worklet(true);
  expect(A.updates).toHaveLength(2);
  const byFlag = (animatedProps: boolean) => A.updates.find((update) => update.animatedProps === animatedProps);
  expect(byFlag(true)?.values).toEqual({ accessibilityLabel: "count 3" });
  expect(byFlag(false)?.values).toEqual({ opacity: 0.5, transform: [{ scale: 2 }] });
  expect(own.map((entry) => entry.id)).toContain((byFlag(true)?.descriptors as { id: number } | undefined)?.id);
  expect((byFlag(true)?.descriptors as { id: number } | undefined)?.id).not.toBe((byFlag(false)?.descriptors as { id: number } | undefined)?.id);

  // A clone of the node points both sets at the new shadow node; the mappers stay.
  app.pad(2);
  await settle(m);
  const cloned = byId(34, "props");
  expect(cloned).not.toBe(node);
  for (const entry of own) expect(entry.adds.at(-1)?.shadowNodeWrapper).toBe(cloned);
  expect(A.mappers.filter((entry) => !entry.stopped)).toHaveLength(3);

  app.hide();
  await settle(m);
  expect(A.mappers.filter((entry) => !entry.stopped)).toHaveLength(0);
  for (const entry of own) expect(entry.removes).toEqual([node.tag]);
});

test("Reanimated CSS keys go to a CSSManager built from the node, and never reach the native payload", async () => {
  const m = await fresh();
  const app = m.startSurface(32, m.Fixture, {}) as App;
  const node = byId(32, "css");
  for (const key of animationKeys) expect(key in node.props).toBe(false);
  expect(node.props).toEqual({ testID: "css", padding: 1 });
  const A = log();
  expect(A.css).toHaveLength(1);
  expect(A.css[0].viewTag).toBe(node.tag);
  expect(A.css[0].reactViewName).toBe("RCTView");
  expect(A.css[0].shadowNodeWrapper).toBe(node);
  expect(A.css[0].updates).toHaveLength(1);
  expect(A.css[0].updates[0]).toMatchObject({ padding: 1, animationDuration: "1s", transitionProperty: "padding", transitionDuration: "200ms" });
  expect(A.css[0].updates[0].animationName).toEqual({ from: { opacity: 0 }, to: { opacity: 1 } });

  app.pad(4);
  await settle(m);
  expect(A.css).toHaveLength(1);
  expect(A.css[0].updates).toHaveLength(2);
  expect(A.css[0].updates[1]).toMatchObject({ padding: 4 });
  expect(A.css[0].cleaned).toBe(false);

  app.dropCss();
  await settle(m);
  expect(byId(32, "css")).toBeUndefined();
  expect(A.css[0].cleaned).toBe(true);
});

test("SharedValues in style: first payload carries their values, Reanimated's inline-prop manager is attached and detached", async () => {
  const m = await fresh();
  const app = m.startSurface(33, m.Fixture, {}) as App;
  app.useInline();
  await settle(m);
  const node = byId(33, "inline");
  expect(node.props).toEqual({ testID: "inline", opacity: 0.25, padding: 3 });
  const A = log();
  const attached = (A.inline as { info?: { viewTag: number }; keys?: string[] }[]).filter((entry) => entry.keys);
  expect(attached).toHaveLength(1);
  expect(attached[0].info?.viewTag).toBe(node.tag);
  expect(attached[0].keys).toEqual(["opacity"]);
  app.hide();
  await settle(m);
  expect(A.inline).toContain("detached");
});

test("every payload the host builds for these fixture trees is identical to React Native's, key order included", () => {
  expect(tap.checks.length).toBeGreaterThan(5);
  expect(new Set(tap.checks.map((check) => check.kind))).toEqual(new Set(["create", "diff"]));
  expect(tap.checks.filter((check) => check.mine !== check.reactNative)).toEqual([]);
});

test("a commit that attaches eight animated nodes for the first time tells the engine; fewer, and the nodes that only refresh, do not", async () => {
  const told: string[] = [];
  (globalThis as { __testEngine?: unknown }).__testEngine = { install: () => true, reanimatedLoaded: () => {}, animatedBatch: () => told.push("batch") };
  try {
    const m = await fresh("animation-many-fixture.svelte");
    const app = m.startSurface(36, m.Fixture, {}) as { keep: (n: number) => void };
    expect(find(roots[36] ?? [], "RCTView")).toHaveLength(20);
    expect(log().mappers).toHaveLength(20);
    expect(told).toEqual(["batch"]); // twenty new nodes in one commit

    app.keep(19); // a commit that leaves: nothing new
    await settle(m);
    app.keep(0);
    await settle(m);
    app.keep(7); // seven new nodes: below the bulk
    await settle(m);
    expect(told).toEqual(["batch"]);
    app.keep(0);
    await settle(m);
    app.keep(8); // eight: the bulk
    await settle(m);
    expect(told).toEqual(["batch", "batch"]);
  } finally {
    delete (globalThis as { __testEngine?: unknown }).__testEngine;
  }
});
