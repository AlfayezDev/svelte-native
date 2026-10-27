import { test, expect } from "bun:test";
import { build, transformSync } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { hmrState } from "../src/hmr-state.ts";

type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[] };
let roots: Record<number, FakeNode[]> = {};
const commits: Array<{ root: number; tags: number[] }> = [];
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>) { return { tag, name, props: { ...props }, children: [] }; },
  cloneNodeWithNewChildren(node: FakeNode) { return { ...node, children: [] }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [...node.children] }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [] }; },
  appendChild(parent: FakeNode, child: FakeNode) { parent.children.push(child); },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) { roots[root] = set.children; commits.push({ root, tags: set.children.map((n) => n.tag) }); },
  registerEventHandler() {},
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;
(globalThis as { __DEV__?: boolean }).__DEV__ = true;
const runnables: Record<string, (parameters: { rootTag: number; initialProps?: Record<string, unknown> }) => void> = {};
(globalThis as { RN$AppRegistry?: unknown }).RN$AppRegistry = { registerRunnable(key: string, run: (typeof runnables)[string]) { runnables[key] = run; return key; } };

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => ({ ...next });",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: {}, directEventTypes: {} });",
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Linking/Linking": "export default { addEventListener: () => ({ remove() {} }), getInitialURL: () => Promise.resolve(null) };",
  "react-native/Libraries/Image/resolveAssetSource": "export default () => null;",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;",
};

async function load(fixture = "hmr-fixture.svelte") {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './${fixture}';
        import { createFabricApp, remountSurfaces, showError } from '../src/fabric/index.ts';
        import { appTree } from './tree-app.ts';
        import { tick } from 'svelte';
        export { createFabricApp, remountSurfaces, showError, tick, Fixture, appTree };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "hmr-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => ({
          contents: compileModule(transformSync(await readFile(path, "utf8"), { loader: "ts" }).code, { filename: path, generate: "client" }).js.code,
          loader: "js",
        }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-hmr-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}
const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((n) => [...(n.name === name ? [n] : []), ...find(n.children, name)]);
const texts = (root: number) => find(roots[root] ?? [], "RCTRawText").map((n) => String(n.props.text));
const settle = async (m: { tick: () => Promise<void> }) => { await m.tick(); await Promise.resolve(); await Promise.resolve(); };

test("remountSurfaces unmounts the old tree and mounts the fresh app on the same root tag with the router stack kept", async () => {
  delete (globalThis as { __svelteNativeHmrState?: unknown }).__svelteNativeHmrState; // each test loads its own module instances
  const m = await load();
  roots = {}; commits.length = 0;
  m.createFabricApp(m.Fixture, { label: "v1" });
  runnables.main({ rootTag: 31, initialProps: { extra: 1 } });
  expect(texts(31)).toEqual(["v1:/:1"]);

  // The surface's exports are not reachable through the runnable, so navigate through the router the fixture created.
  expect(hmrState().navigation?.()).toEqual({ entries: [{ href: "/", presentation: "push" }] });

  // A hot update re-runs the entry: same registration call, new component props.
  const first = commits.length;
  const oldTags = commits[first - 1].tags;
  m.createFabricApp(m.Fixture, { label: "v2" });
  m.remountSurfaces();
  await settle(m);
  const sequence = commits.slice(first).filter((c) => c.root === 31);
  expect(sequence[0].tags).toEqual([]);
  expect(sequence.at(-1)?.tags.length).toBe(1);
  expect(sequence.at(-1)?.tags[0]).not.toBe(oldTags[0]);
  expect(texts(31)).toEqual(["v2:/:1"]);
});

test("the navigation stack survives a remount", async () => {
  delete (globalThis as { __svelteNativeHmrState?: unknown }).__svelteNativeHmrState; // each test loads its own module instances
  const m = await load();
  roots = {}; commits.length = 0;
  m.createFabricApp(m.Fixture, { label: "v1" });
  runnables.main({ rootTag: 32 });
  const hot = hmrState();
  // Drive the router through the navigation hook the fixture registered: replace it with a two-screen stack, as after two `goto` calls.
  const saved = { entries: [{ href: "/a", presentation: "push" as const }, { href: "/b?x=1", presentation: "push" as const }] };
  hot.navigation = () => saved;
  (globalThis as { __routeLoads?: string[] }).__routeLoads = [];
  m.remountSurfaces();
  await settle(m);
  expect(texts(32)).toEqual(["v1:/b:2"]);
  expect((globalThis as { __routeLoads?: string[] }).__routeLoads).toEqual(["/a", "/b"]); // the adopted stack's routes load again when their screens render; the others wait for a navigation
  expect(hot.navigation()).toEqual(saved);
  expect(hot.restore).toBeUndefined();
});

test("an error thrown by the root during mount mounts the error screen, and Reload recovers", async () => {
  delete (globalThis as { __svelteNativeHmrState?: unknown }).__svelteNativeHmrState; // each test loads its own module instances
  const m = await load();
  roots = {}; commits.length = 0;
  const logged = console.error;
  console.error = () => {};
  try {
    m.createFabricApp(m.Fixture, { boom: true });
    runnables.main({ rootTag: 33 });
  } finally { console.error = logged; }
  expect(texts(33)).toContain("kaboom");
  expect(texts(33)).toContain("Reload");
  expect(texts(33)).toContain("Error");

  // The next successful evaluation of the entry plus a remount (what the Reload button schedules) replaces the error screen.
  m.createFabricApp(m.Fixture, { label: "fixed" });
  m.remountSurfaces();
  await settle(m);
  expect(texts(33)).toEqual(["fixed:/:1"]);
});

test("showError draws the screen over a running surface and reports whether it could", async () => {
  delete (globalThis as { __svelteNativeHmrState?: unknown }).__svelteNativeHmrState; // each test loads its own module instances
  const m = await load();
  roots = {}; commits.length = 0;
  m.createFabricApp(m.Fixture, { label: "v1" });
  runnables.main({ rootTag: 34 });
  const error = new Error("late failure");
  expect(m.showError(error)).toBe(true);
  expect(texts(34)).toContain("late failure");
  expect(m.showError(error, [])).toBe(false);
});

test("a named router's stack survives a remount too: the root takes the recorded stack, each scope takes its own when it is created", async () => {
  delete (globalThis as { __svelteNativeHmrState?: unknown }).__svelteNativeHmrState; // each test loads its own module instances
  const m = await load("hmr-scope-fixture.svelte");
  roots = {}; commits.length = 0;
  m.createFabricApp(m.Fixture, { label: "v1" });
  runnables.main({ rootTag: 34 });
  const scope = globalThis as { __rootRouter?: { goto(href: string): void }; __tabRouter?: { goto(href: string): void } };
  scope.__rootRouter?.goto("/a");
  scope.__tabRouter?.goto("/t/b");
  scope.__tabRouter?.goto("/t/c");
  await settle(m);
  expect(texts(34)).toEqual(["v1:2", "tab:/t/a,/t/b,/t/c"]);

  m.createFabricApp(m.Fixture, { label: "v2" });
  m.remountSurfaces();
  await settle(m);
  expect(texts(34)).toEqual(["v2:2", "tab:/t/a,/t/b,/t/c"]);
  // The new routers are the ones that now answer for their scopes.
  scope.__tabRouter?.goto("/t/a?again");
  await settle(m);
  expect(texts(34)).toEqual(["v2:2", "tab:/t/a,/t/b,/t/c,/t/a"]);
});

type TreeRouter = { entries: { url: URL; presentation: string }[]; goto(href: string, options?: { reset?: boolean }): void; selected: string | undefined };
const treeScope = globalThis as { __shellRouter?: TreeRouter; __treeRouters?: Record<string, TreeRouter> };
const hrefs = (router: TreeRouter | undefined) => router?.entries.map((entry) => entry.url.pathname);
const turns = async (m: { tick: () => Promise<void> }) => { for (let turn = 0; turn < 8; turn++) await settle(m); };
const nodesOf = (root: number, kind: string) => find(roots[root] ?? [], "RCTView").filter((node) => String(node.props.nativeID ?? "").startsWith(`svelte:${kind}`));

test("a tree app: the root layout is the shell around the root navigator, in the router's context, and the whole navigation state survives a remount", async () => {
  delete (globalThis as { __svelteNativeHmrState?: unknown }).__svelteNativeHmrState; // each test loads its own module instances
  const m = await load("hmr-tree-shell.svelte");
  roots = {}; commits.length = 0;
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/acme/home" });
  runnables.main({ rootTag: 35 });
  await turns(m);
  const router = treeScope.__shellRouter;
  expect(hrefs(router)).toEqual(["/acme"]);
  expect(texts(35)).toEqual(["page /acme/home"]);
  router?.goto("/acme/home/thread/7");
  router?.goto("/acme/inbox/compose", { presentation: "modal" } as never);
  await turns(m);
  router?.goto("/account");
  await turns(m);
  expect(hrefs(router)).toEqual(["/acme", "/account"]);
  const before = hmrState().navigation?.();
  expect(before?.entries.map((entry) => [entry.href, entry.presentation])).toEqual([["/acme", "push"], ["/account", "modal"]]);
  expect(before?.entries[0].tabs?.selected).toBe("inbox");
  expect(Object.keys(before?.entries[0].tabs?.panes ?? {})).toEqual(["home", "inbox"]);
  expect(before?.entries[0].tabs?.panes.home.entries.map((entry) => entry.href)).toEqual(["/acme/home", "/acme/home/thread/7"]);

  // A hot update re-runs the entry: the same registration with a freshly built tree, then a remount.
  treeScope.__treeRouters = {};
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/acme/home" });
  m.remountSurfaces();
  await turns(m);
  const next = treeScope.__shellRouter;
  expect(next).not.toBe(router);
  expect(hrefs(next)).toEqual(["/acme", "/account"]);
  expect(next?.entries.map((entry) => entry.presentation)).toEqual(["push", "modal"]);
  expect(hmrState().navigation?.()).toEqual(before);
  expect(texts(35)).toEqual(["page /acme/inbox", "page /acme/inbox/compose", "page /account"]); // the selected pane and its stack are back; the home pane waits for its tab
  expect(nodesOf(35, "tabs")[0].props.nativeID).toContain("sel=1");

  next?.goto("/acme/home/thread/7"); // the route the home pane is on: only the tab changes
  await turns(m);
  expect(hrefs(treeScope.__treeRouters?.["/acme/home/thread/7"] as TreeRouter | undefined)).toEqual(["/acme/home", "/acme/home/thread/7"]);
  expect(hrefs(treeScope.__treeRouters?.["/acme/inbox/compose"] as TreeRouter | undefined)).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
});

test("a saved state of routes that no longer exist is dropped: the router starts from its initial screen", async () => {
  delete (globalThis as { __svelteNativeHmrState?: unknown }).__svelteNativeHmrState; // each test loads its own module instances
  const m = await load("hmr-tree-shell.svelte");
  roots = {}; commits.length = 0;
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/workspaces" });
  runnables.main({ rootTag: 36 });
  await turns(m);
  hmrState().navigation = () => ({ entries: [{ href: "/workspaces", presentation: "push" }, { href: "/gone/for/good", presentation: "push" }] });
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/workspaces" });
  m.remountSurfaces();
  await turns(m);
  expect(hrefs(treeScope.__shellRouter)).toEqual(["/workspaces"]);
  hmrState().navigation = () => ({ entries: [{ href: "/acme", presentation: "push", tabs: { selected: "ghost", panes: { ghost: { entries: [{ href: "/acme/ghost", presentation: "push" }] } } } }] });
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/workspaces" });
  m.remountSurfaces();
  await turns(m);
  expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme"]); // a pane that is gone is ignored, the screen that is still there is kept
  expect(nodesOf(36, "tabs")[0].props.nativeID).toContain("sel=0");
});
