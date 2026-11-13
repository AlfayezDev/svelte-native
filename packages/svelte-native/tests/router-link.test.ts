import { test, expect, jest, afterEach } from "bun:test";
import { build, transform } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";

/**
 * The root `<Router>` hands its router to the remote functions runtime while it is mounted (`connectHost`, through `linkRouter` of
 * `src/remote/router-link.ts`): the runtime follows a server `redirect()` through it and reads the screen URL from it. These mount a real
 * `<Router>` on a fake Fabric host and read the registration back the way the runtime does (`linkedRouter()`, `currentUrl()`).
 */
type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
let roots: Record<number, FakeNode[]> = {};
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown) { return { tag, name, props: { ...props }, children: [], sealed: false, target }; },
  cloneNodeWithNewChildren(node: FakeNode) { return { ...node, children: [], sealed: false }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
  appendChild(parent: FakeNode, child: FakeNode) {
    if (parent.sealed) throw new Error(`appendChild on sealed ${parent.name}`);
    parent.children.push(child);
  },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) {
    const seal = (n: FakeNode) => { n.sealed = true; n.children.forEach(seal); };
    set.children.forEach(seal);
    roots[root] = set.children;
  },
  measure(_node: FakeNode, callback: (...args: number[]) => void) { callback(1, 2, 3, 4, 5, 6); },
  measureInWindow(_node: FakeNode, callback: (...args: number[]) => void) { callback(5, 6, 3, 4); },
  dispatchCommand() {},
  registerEventHandler() {},
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "const handlers = (globalThis.__backHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; } };",
  "react-native/Libraries/Linking/Linking": "const handlers = (globalThis.__linkHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; }, getInitialURL: () => Promise.resolve(null) };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

async function load(fixture: string) {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './${fixture}';
        import { startSurface, stopSurface } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { linkedRouter } from '../src/remote/router-link.ts';
        export { currentUrl } from '../src/remote/link.ts';
        export { startSurface, stopSurface, tick, Fixture };`,
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
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-router-link-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}

type Router = { goto: (href: string) => void; current: { url: URL }; nested: boolean };
type Module = Awaited<ReturnType<typeof load>>;
const globals = globalThis as unknown as { __backHandlers: unknown[]; __linkHandlers: unknown[]; __linkRoots?: Record<string, Router> };
const settle = async (m: Module) => { for (let turn = 0; turn < 4; turn++) { await m.tick(); await Promise.resolve(); await Promise.resolve(); } };
const registered = (m: Module): Router | undefined => m.linkedRouter();
const hostListeners = () => ({ back: globals.__backHandlers.length, links: globals.__linkHandlers.length });

let surface = 300;
let started: { m: Module; tag: number } | undefined;
/** A fixture on its own surface, with no host listener left over from another test. */
async function mount(fixture: string) {
  const m = await load(fixture);
  jest.useFakeTimers(); // an exit timer of a screen a navigation leaves must not fire into another test
  roots = {};
  globals.__backHandlers.length = 0;
  globals.__linkHandlers.length = 0;
  delete globals.__linkRoots;
  const tag = ++surface;
  const app = m.startSurface(tag, m.Fixture, {}) as Record<string, (...args: never[]) => unknown>;
  started = { m, tag };
  await settle(m);
  return { m, app, settle: () => settle(m) };
}
afterEach(() => {
  if (started) started.m.stopSurface(started.tag);
  started = undefined;
  jest.useRealTimers();
});

test("the root <Router> registers its router with the remote runtime while it is mounted, and unmounting it clears the registration", async () => {
  const { m, app, settle: turns } = await mount("router-link-fixture.svelte");
  const { root } = (app.routers as () => { root: Router })();
  // Nothing is mounted yet: the runtime has no router to follow a redirect through, and the screen URL is the origin's root.
  expect(registered(m)).toBeUndefined();
  expect(m.currentUrl().href).toBe("https://native.invalid/");
  expect(hostListeners()).toEqual({ back: 0, links: 0 });

  (app.showRoot as (value: boolean) => void)(true);
  await turns();
  expect(registered(m)).toBe(root);
  expect(m.currentUrl().pathname).toBe("/a"); // the top screen's path
  expect(hostListeners()).toEqual({ back: 1, links: 1 });

  // It follows the screen on top, and a redirect the runtime sends through it navigates the app.
  root.goto("/b");
  await turns();
  expect(m.currentUrl().pathname).toBe("/b");
  registered(m)?.goto("/");
  await turns();
  expect(m.currentUrl().pathname).toBe("/");
  expect(root.current.url.pathname).toBe("/");

  (app.showRoot as (value: boolean) => void)(false);
  await turns();
  expect(registered(m)).toBeUndefined();
  expect(m.currentUrl().href).toBe("https://native.invalid/"); // not the stale screen of an unmounted router
  expect(hostListeners()).toEqual({ back: 0, links: 0 });
});

test("a <Router> that gives way to another for the same router (an {#if} branch switch) leaves the router registered", async () => {
  const { m, app, settle: turns } = await mount("router-link-fixture.svelte");
  const { root } = (app.routers as () => { root: Router })();
  (app.showRoot as (value: boolean) => void)(true);
  await turns();
  root.goto("/b");
  await turns();
  expect(registered(m)).toBe(root);

  // The old <Router> unmounts and the new one mounts in the same flush; the old one's teardown must not take the new one's registration with it.
  (app.flip as () => void)();
  await turns();
  expect(registered(m)).toBe(root);
  expect(m.currentUrl().pathname).toBe("/b");
  expect(hostListeners()).toEqual({ back: 1, links: 1 }); // one set of host listeners, the new mount's

  (app.flip as () => void)();
  await turns();
  expect(registered(m)).toBe(root);

  // And the registration still ends with the last mount.
  (app.showRoot as (value: boolean) => void)(false);
  await turns();
  expect(registered(m)).toBeUndefined();

  // A <Router> mounted anew for the same router (the session resets by unmounting it) registers it again.
  (app.showRoot as (value: boolean) => void)(true);
  await turns();
  expect(registered(m)).toBe(root);
  expect(m.currentUrl().pathname).toBe("/b");
});

test("a nested router's <Router> registers nothing: not alone, and not in place of the root's", async () => {
  const { m, app, settle: turns } = await mount("router-link-fixture.svelte");
  const { root, inner } = (app.routers as () => { root: Router; inner: Router })();
  expect(root.nested).toBe(false);
  expect(inner.nested).toBe(true);

  // Alone (the root router is created, its <Router> is not mounted): there is nothing for the runtime to follow.
  (app.showInner as (value: boolean) => void)(true);
  await turns();
  expect(registered(m)).toBeUndefined();
  expect(m.currentUrl().href).toBe("https://native.invalid/");
  expect(hostListeners()).toEqual({ back: 0, links: 0 });

  // Beside the root's, mounted after it: the root stays the one registered, and the nested router's own screen is not the page's URL.
  (app.showRoot as (value: boolean) => void)(true);
  await turns();
  expect(registered(m)).toBe(root);
  (app.showInner as (value: boolean) => void)(false);
  await turns();
  (app.showInner as (value: boolean) => void)(true);
  await turns();
  expect(registered(m)).toBe(root);
  inner.goto("/b");
  await turns();
  expect(m.currentUrl().pathname).toBe("/a");

  // Unmounting it leaves the root's registration alone.
  (app.showInner as (value: boolean) => void)(false);
  await turns();
  expect(registered(m)).toBe(root);
  expect(hostListeners()).toEqual({ back: 1, links: 1 });
});

test("a <Router> that unmounts after another router has registered does not clear that one", async () => {
  const { m, app, settle: turns } = await mount("router-link-pair-fixture.svelte");
  const show = app.show as (which: "first" | "second", value: boolean) => void;
  show("first", true);
  await turns();
  const first = globals.__linkRoots?.first;
  expect(first).toBeDefined();
  expect(registered(m)).toBe(first);

  show("second", true);
  await turns();
  const second = globals.__linkRoots?.second;
  expect(second).toBeDefined();
  expect(second).not.toBe(first);
  expect(registered(m)).toBe(second); // the newest registration wins

  show("first", false);
  await turns();
  expect(registered(m)).toBe(second);

  show("second", false);
  await turns();
  expect(registered(m)).toBeUndefined();
});
