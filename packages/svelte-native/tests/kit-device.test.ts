import { afterEach, describe, expect, jest, test } from "bun:test";
import { build, transform } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { resolveRoute } from "../src/kit/route-id.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { directiveResponse, manifestResponse, noUpdateDirective } from "./updates-fixtures/eas.ts";

/**
 * SvelteKit's modules on the device (`src/kit`): bundled the way Metro would resolve them (the library's file for each import) and run against a fake Fabric host, with the
 * app shape of `tree-app.ts` (a root stack, a modal, a project's tabs with a stack in one pane). What a screen reads from `page`, what `goto` does from outside any component,
 * and what the rest of each module answers.
 */
type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
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
  completeRoot(_root: number, set: { children: FakeNode[] }) {
    const seal = (n: FakeNode) => { n.sealed = true; n.children.forEach(seal); };
    set.children.forEach(seal);
  },
  measure(_node: FakeNode, callback: (...args: number[]) => void) { callback(1, 2, 3, 4, 5, 6); },
  measureInWindow(_node: FakeNode, callback: (...args: number[]) => void) { callback(5, 6, 3, 4); },
  dispatchCommand() {},
  registerEventHandler() {},
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;

const world = globalThis as unknown as { __DEV__?: boolean; __kitConstants?: unknown; __kitOpened: string[]; __kitSeen: string[]; __kitReads: string[]; __kitUpdates: unknown; __backHandlers: unknown[]; __linkHandlers: unknown[]; __treeRouters?: unknown };
const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "const handlers = (globalThis.__backHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; } };",
  "react-native/Libraries/Linking/Linking": "const handlers = (globalThis.__linkHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; }, getInitialURL: () => Promise.resolve(null), openURL: (url) => { globalThis.__kitOpened.push(url); return Promise.resolve(); } };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-constants": "export default { get expoConfig() { return globalThis.__kitConstants ?? null; } };",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = (name) => (name === 'SvelteUpdates' ? globalThis.__kitUpdates ?? null : null);",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

async function load() {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './kit-fixture.svelte';
        import Reader from './kit-reader.svelte';
        import { startSurface, stopSurface } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export * as navigation from '../src/kit/navigation.ts';
        export * as state from '../src/kit/state.ts';
        export * as paths from '../src/kit/paths.ts';
        export * as env from '../src/kit/env.ts';
        export * as updates from '../src/updates/index.ts';
        export { startSurface, stopSurface, tick, Fixture, Reader };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "kit-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core|expo-constants)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: resolve(import.meta.dirname, "view-configs-stub.ts") }));
        builder.onResolve({ filter: /^@alfayez\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({ contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code, loader: "js" }));
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
          const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
          return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
        });
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-kit-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0]?.contents ?? "");
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m as Module;
}

type Entry = { url: URL; params: Record<string, string>; presentation: string };
type Router = { entries: Entry[]; current: Entry; back(): boolean; goto(href: string, options?: object): void };
type Module = {
  navigation: Record<string, (...args: never[]) => unknown> & { goto(url: string | URL, options?: object): Promise<void>; preloadCode(id: string): Promise<void> };
  state: { page: { url: URL; params: Record<string, string>; route: { id: string | null }; status: number; error: unknown; data: object; state: object; form: unknown; shallow: unknown }; navigating: Record<string, unknown>; updated: { current: boolean; check(): Promise<boolean> } };
  paths: { base: string; assets: string; asset(file: string): string; resolve(...args: unknown[]): string; match(url: string | URL): Promise<{ id: string; params: Record<string, string> } | null> };
  env: Record<string, unknown>;
  updates: { fetchUpdateAsync(): Promise<{ isNew: boolean }>; checkForUpdateAsync(): Promise<{ isAvailable: boolean }> };
  startSurface(tag: number, component: unknown, props: Record<string, unknown>): Record<string, () => Router>;
  stopSurface(tag: number): void;
  tick(): Promise<void>;
  Fixture: unknown;
  Reader: unknown;
};

const turn = async (m: Module) => { for (let step = 0; step < 8; step++) { await m.tick(); await Promise.resolve(); await Promise.resolve(); } };
let surface = 700;
const surfaces: { m: Module; tag: number }[] = [];
async function mountApp(m: Module, props: Record<string, unknown> = {}) {
  const tag = ++surface;
  const app = m.startSurface(tag, m.Fixture, props);
  surfaces.push({ m, tag });
  await turn(m);
  return { router: (app.root as () => Router)(), tag, settle: () => turn(m) };
}
function reset() {
  jest.useFakeTimers(); // the exit timer of a screen a navigation leaves must not fire into another test
  world.__kitOpened = [];
  world.__kitSeen = [];
  world.__kitReads = [];
  world.__kitUpdates = undefined;
  world.__kitConstants = undefined;
  world.__DEV__ = true;
  world.__backHandlers = [];
  world.__linkHandlers = [];
}
afterEach(() => {
  for (const { m, tag } of surfaces.splice(0)) m.stopSurface(tag);
  jest.useRealTimers();
});

/** The page the app's screens read, as one line. */
const where = (m: Module) => `${m.state.page.url.pathname} ${JSON.stringify(m.state.page.params)} ${m.state.page.route.id}`;
const pathsOf = (router: Router) => router.entries.map((entry) => entry.url.pathname);

describe("goto drives the app's root router from any code", () => {
  test("it selects the tab a route is in, pushes in a tab, opens a modal over the tabs and replaces a screen, and the page follows each", async () => {
    reset();
    const m = await load();
    const { router, settle } = await mountApp(m, { initial: "/workspaces" });
    const go = async (url: string | URL, options?: object) => { await m.navigation.goto(url, options); await settle(); };
    expect(where(m)).toBe("/workspaces {} /workspaces");

    // A route that is a project's tabs screen: its first pane's page.
    await go("/acme");
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(where(m)).toBe('/acme/home {"slug":"acme"} /(workspace)/[slug]/(tabs)/home');

    // Another tab is a selection: nothing is pushed on the root, and the page is the other pane's.
    await go("/acme/inbox");
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(where(m)).toBe('/acme/inbox {"slug":"acme"} /(workspace)/[slug]/(tabs)/inbox');

    // A page of a tab's stack: the tab is selected again, the page pushed, and its parameters come with it.
    await go("/acme/home/thread/7");
    expect(where(m)).toBe('/acme/home/thread/7 {"slug":"acme","id":"7"} /(workspace)/[slug]/(tabs)/home/thread/[id]');
    // A relative URL is read against the screen the user sees, as the browser reads it; a URL object is taken as it is.
    await go("9");
    expect(where(m)).toBe('/acme/home/thread/9 {"slug":"acme","id":"9"} /(workspace)/[slug]/(tabs)/home/thread/[id]');
    await go(new URL("/acme/home/thread/10?tab=1#top", m.state.page.url));
    expect(m.state.page.url.search + m.state.page.url.hash).toBe("?tab=1#top");

    // A modal covers the tabs, and it is the page now; back closes it and the page is the thread again.
    await go("/account");
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme", "/account"]);
    expect(router.entries[2].presentation).toBe("modal");
    expect(where(m)).toBe("/account {} /(account)/account");
    expect(router.back()).toBe(true);
    await settle();
    expect(where(m)).toBe('/acme/home/thread/10 {"slug":"acme","id":"10"} /(workspace)/[slug]/(tabs)/home/thread/[id]');

    // Back to the first screen: its own route, with the stacks it left.
    await go("/workspaces");
    expect(pathsOf(router)).toEqual(["/workspaces"]);
    expect(where(m)).toBe("/workspaces {} /workspaces");
  });

  test("`replace` (and `replaceState`, SvelteKit's deprecated name) replaces the top screen instead of pushing; `reset`, `refreshAll`, `invalidate`, `invalidateAll` and `persistState` are ignored", async () => {
    reset();
    const m = await load();
    const { router, settle } = await mountApp(m, { initial: "/workspaces" });
    await m.navigation.goto("/account");
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces", "/account"]);
    await m.navigation.goto("/workspaces", { replace: true });
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces", "/workspaces"]);
    await m.navigation.goto("/account", { replaceState: true });
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces", "/account"]);
    // `reset: true` is SvelteKit's scroll and focus reset, not the router's `reset` (which drops the history): the stack is kept.
    await m.navigation.goto("/workspaces", { reset: true, refreshAll: true, invalidate: ["x:y"], invalidateAll: true, persistState: true });
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces"]);
  });

  test("it rejects for what the device cannot do: no screen for the path, `shallow`, `state`, and an app that has no router (yet, or any more)", async () => {
    reset();
    const m = await load();
    await expect(m.navigation.goto("/workspaces")).rejects.toThrow("goto needs the app's router, which does not exist yet");
    const { router, settle, tag } = await mountApp(m, { initial: "/workspaces" });
    await expect(m.navigation.goto("/no/where/at/all")).rejects.toThrow("No native screen for /no/where/at/all");
    await expect(m.navigation.goto("/account", { shallow: true })).rejects.toThrow("`shallow` in the options of goto is not available on the device yet (svelte-native)");
    await expect(m.navigation.goto("/account", { state: { a: 1 } })).rejects.toThrow("`state` in the options of goto is not available on the device yet (svelte-native)");
    await settle();
    expect(pathsOf(router)).toEqual(["/workspaces"]); // none of them navigated
    m.stopSurface(tag);
    await expect(m.navigation.goto("/account")).rejects.toThrow("goto needs the app's router");
  });

  test("a URL of another site or a scheme of the system is opened by the system, as `<a href>` does, and the screen stays", async () => {
    reset();
    const m = await load();
    const { router, settle } = await mountApp(m, { initial: "/workspaces" });
    await m.navigation.goto("https://example.com/docs?a=1");
    await m.navigation.goto("mailto:someone@example.com");
    await m.navigation.goto(new URL("tel:+15550100"));
    await settle();
    expect(world.__kitOpened).toEqual(["https://example.com/docs?a=1", "mailto:someone@example.com", "tel:+15550100"]);
    expect(pathsOf(router)).toEqual(["/workspaces"]);
  });
});

describe("page follows the screen the user sees", () => {
  test("an effect reads it, and runs again for each screen: a tab switch, a push, a modal, a back; before the app has a router it is SvelteKit's page of nothing", async () => {
    reset();
    const m = await load();
    // Before any router: a page with no route, which is what a read before the app has started gets.
    expect(where(m)).toBe("/ {} null");
    expect(m.state.page).toMatchObject({ status: 200, error: null, form: null, shallow: null, data: {}, state: {} });
    const { settle } = await mountApp(m, { initial: "/workspaces" });
    for (const href of ["/acme", "/acme/inbox", "/acme/home/thread/7", "/account"]) { await m.navigation.goto(href); await settle(); }
    expect(world.__kitSeen).toEqual([
      "/workspaces {} /workspaces",
      '/acme/home {"slug":"acme"} /(workspace)/[slug]/(tabs)/home',
      '/acme/inbox {"slug":"acme"} /(workspace)/[slug]/(tabs)/inbox',
      '/acme/home/thread/7 {"slug":"acme","id":"7"} /(workspace)/[slug]/(tabs)/home/thread/[id]',
      "/account {} /(account)/account",
    ]);
  });

  test("a component that was mounted before the router existed follows it from the moment it does, and back to nothing when the app's component is gone", async () => {
    reset();
    const m = await load();
    const tag = ++surface;
    m.startSurface(tag, m.Reader, {});
    surfaces.push({ m, tag });
    await turn(m);
    expect(world.__kitReads).toEqual(["page / null", "updated false"]);
    const { tag: appTag, settle } = await mountApp(m, { initial: "/workspaces" });
    await settle();
    expect(world.__kitReads.at(-1)).toBe("page /workspaces /workspaces");
    await m.navigation.goto("/account");
    await settle();
    expect(world.__kitReads.at(-1)).toBe("page /account /(account)/account");
    m.stopSurface(appTag);
    await settle();
    expect(world.__kitReads.at(-1)).toBe("page / null");
  });

  test("page.route is one object for as long as a screen is on top, so a `$derived` of it does not run again; the shapes SvelteKit gives are neutral values", async () => {
    reset();
    const m = await load();
    await mountApp(m, { initial: "/workspaces" });
    const { page, navigating } = m.state;
    expect(page.route).toBe(page.route);
    expect(page.params).toBe(page.params);
    expect(page.url.origin).toBe("https://native.invalid");
    expect(page.data).toEqual({});
    expect(Object.isFrozen(page.data) && Object.isFrozen(page.state)).toBe(true);
    // The router applies a navigation in one step: there is nothing in flight, so `navigating` is SvelteKit's "no navigation".
    expect(navigating).toEqual({ from: null, to: null, type: null, willUnload: null, delta: null, complete: null });
  });
});

describe("the rest of $app/navigation", () => {
  test("it exports the names SvelteKit declares, and no others", () => {
    const declared = kitExports("$app/navigation");
    expect(declared).toContain("goto");
    expect(declared).toContain("beforeNavigate");
    return load().then((m) => expect(Object.keys(m.navigation).toSorted()).toEqual(declared));
  });

  test("what has nothing behind it on the device throws, naming the function and why; disableScrollHandling does nothing", async () => {
    reset();
    const m = await load();
    const stubs = ["beforeNavigate", "afterNavigate", "onNavigate", "snapshot", "invalidate", "invalidateAll", "refreshAll", "preloadData", "pushState", "replaceState"];
    for (const name of stubs) expect(() => (m.navigation[name] as () => void)(), name).toThrow(new RegExp(`^\`${name}\` is not available on the device yet \\(svelte-native\\): `));
    expect(() => (m.navigation.beforeNavigate as () => void)()).toThrow("the router has no hook to look at a navigation before it happens or to cancel it");
    expect(() => (m.navigation.preloadData as () => void)()).toThrow("`preloadCode(routeId)` loads its code");
    expect((m.navigation.disableScrollHandling as () => unknown)()).toBeUndefined();
  });

  test("preloadCode loads the code of the route with that id, once, and rejects for an id no route has", async () => {
    reset();
    const m = await load();
    const loads: string[] = [];
    await expect(m.navigation.preloadCode("/workspaces")).rejects.toThrow("preloadCode needs the app's router");
    const { settle } = await mountApp(m, { initial: "/workspaces", logLoads: loads });
    await settle();
    const before = loads.length;
    await m.navigation.preloadCode("/(workspace)/[slug]/(tabs)/home/thread/[id]");
    expect(loads.slice(before)).toEqual(["(workspace)/[slug]/(tabs)/home/thread/[id]/+mobile.svelte"]);
    await m.navigation.preloadCode("/(workspace)/[slug]/(tabs)/home/thread/[id]");
    expect(loads.slice(before)).toHaveLength(1); // loaded: not again
    // A navigator's screen has its layout as its code.
    await m.navigation.preloadCode("/(workspace)/[slug]/(tabs)");
    expect(loads.slice(before).at(-1)).toBe("(workspace)/[slug]/(tabs)/+layout.mobile.svelte");
    await expect(m.navigation.preloadCode("/nowhere")).rejects.toThrow("No route of the app has the id /nowhere");
    // The navigation that follows has nothing left to load for the page.
    const afterPreload = loads.length;
    await m.navigation.goto("/acme/home/thread/7");
    await settle();
    expect(loads.slice(afterPreload)).not.toContain("(workspace)/[slug]/(tabs)/home/thread/[id]/+mobile.svelte");
  });
});

describe("$app/env", () => {
  test("browser, dev, building, version and mobile: what the device is", async () => {
    reset();
    world.__kitConstants = { name: "App", version: "3.4.5" };
    let m = await load();
    expect(m.env).toEqual({ browser: false, dev: true, building: false, version: "3.4.5", mobile: true });
    // A release build is not `__DEV__`, and a build without the embedded config has no version.
    world.__DEV__ = false;
    world.__kitConstants = undefined;
    m = await load();
    expect(m.env).toEqual({ browser: false, dev: false, building: false, version: "", mobile: true });
  });

  test("it has the names SvelteKit declares (`browser`, `dev`, `building`, `version`) and the library's `mobile`", async () => {
    const declared = kitExports("$app/env");
    expect(declared).toEqual(["browser", "building", "dev", "version"]);
    expect(Object.keys((await load()).env).toSorted()).toEqual([...declared, "mobile"].toSorted());
  });
});

describe("$app/paths", () => {
  test("it has the names SvelteKit declares, and `base` and `assets`, empty, for code written for SvelteKit 2", async () => {
    const m = await load();
    expect(Object.keys(m.paths).toSorted()).toEqual([...kitExports("$app/paths"), "assets", "base"].toSorted());
    expect([m.paths.base, m.paths.assets]).toEqual(["", ""]);
  });

  test("resolve builds the path of a route id and of a pathname; asset is the path of a file with no base", async () => {
    const { paths } = await load();
    expect(paths.resolve("/")).toBe("/");
    expect(paths.resolve("/about")).toBe("/about");
    expect(paths.resolve("/blog/[slug]", { slug: "hello-world" })).toBe("/blog/hello-world");
    expect(paths.resolve("blog/hello")).toBe("/blog/hello");
    expect(paths.resolve("/blog/[slug]?page=2#top", { slug: "a" })).toBe("/blog/a?page=2#top");
    expect(paths.asset("potato.jpg")).toBe("/potato.jpg");
    expect(paths.asset("/potato.jpg")).toBe("/potato.jpg");
    expect(() => paths.resolve("/blog/[slug]")).toThrow("Missing params for dynamic route ID `/blog/[slug]`");
  });

  test("match finds the route of a path, with its parameters, through the root router", async () => {
    reset();
    const m = await load();
    await expect(m.paths.match("/workspaces")).rejects.toThrow("match needs the app's router");
    await mountApp(m, { initial: "/workspaces" });
    expect(await m.paths.match("/workspaces")).toEqual({ id: "/workspaces", params: {} });
    expect(await m.paths.match("acme/home/thread/7")).toEqual({ id: "/(workspace)/[slug]/(tabs)/home/thread/[id]", params: { slug: "acme", id: "7" } });
    expect(await m.paths.match(new URL("https://example.org/acme/settings/profile?x=1"))).toEqual({ id: "/(workspace)/[slug]/settings/[[section]]", params: { slug: "acme", section: "profile" } });
    expect(await m.paths.match("/nowhere/at/all")).toBeNull();
  });
});

describe("resolveRoute: SvelteKit's route ids with their parameters", () => {
  test("static, dynamic, optional and rest parameters, groups, escapes and a trailing slash", () => {
    expect(resolveRoute("/", {})).toBe("/");
    expect(resolveRoute("/blog/[slug]", { slug: "hello" })).toBe("/blog/hello");
    expect(resolveRoute("/[a]/[b]", { a: "x", b: "y" })).toBe("/x/y");
    expect(resolveRoute("/(app)/settings/(tabs)/[id]", { id: "7" })).toBe("/settings/7");
    // Optional: left out when missing or empty, a segment when given.
    expect(resolveRoute("/[[lang]]/about", {})).toBe("/about");
    expect(resolveRoute("/[[lang]]/about", { lang: "" })).toBe("/about");
    expect(resolveRoute("/[[lang]]/about", { lang: "ar" })).toBe("/ar/about");
    expect(resolveRoute("/[[lang]]", { lang: undefined })).toBe("/");
    // Rest: any number of segments, none when empty, and a rest parameter that is not given at all is missing.
    expect(resolveRoute("/docs/[...rest]", { rest: "a/b/c" })).toBe("/docs/a/b/c");
    expect(resolveRoute("/docs/[...rest]", { rest: "" })).toBe("/docs");
    expect(resolveRoute("/docs/[...rest]/edit", { rest: "a/b" })).toBe("/docs/a/b/edit");
    expect(() => resolveRoute("/docs/[...rest]", {})).toThrow("Missing parameter `rest` in route `/docs/[...rest]`");
    // A matcher names the parameter and checks nothing; a parameter shares a segment with text.
    expect(resolveRoute("/items/[id=integer]", { id: 5 })).toBe("/items/5");
    expect(resolveRoute("/files/[name].[ext]", { name: "a", ext: "png" })).toBe("/files/a.png");
    // Scalars: numbers, booleans and bigints are their text.
    expect(resolveRoute("/[a]/[b]/[c]", { a: 1, b: true, c: 10n })).toBe("/1/true/10");
    // Escapes: `[x+2f]` is a slash that is not a separator, `[u+0041]` a letter.
    expect(resolveRoute("/a[x+2f]b", {})).toBe("/a%2Fb");
    expect(resolveRoute("/[u+0041]bc", {})).toBe("/Abc");
    // A route id with a trailing slash keeps it, and a search or a hash after the id stays.
    expect(resolveRoute("/blog/[slug]/", { slug: "a" })).toBe("/blog/a/");
    expect(resolveRoute("/blog/[slug]?page=2#top", { slug: "a" })).toBe("/blog/a?page=2#top");
  });

  test("it refuses a missing parameter, one with a slash at either end, and one that is not a scalar", () => {
    expect(() => resolveRoute("/blog/[slug]", {})).toThrow("Missing parameter `slug` in route `/blog/[slug]`");
    expect(() => resolveRoute("/blog/[slug]", { slug: "" })).toThrow("Missing parameter `slug`");
    expect(() => resolveRoute("/blog/[slug]", { slug: "/a" })).toThrow("Parameter `slug` in route `/blog/[slug]` cannot start or end with a slash");
    expect(() => resolveRoute("/blog/[slug]", { slug: "a/" })).toThrow("cannot start or end with a slash");
    expect(() => resolveRoute("/blog/[slug]", { slug: {} as never })).toThrow("must be a string, number, boolean, or bigint");
  });
});

describe("updated is the library's over-the-air updates", () => {
  const native = (overrides: Record<string, unknown> = {}, response: () => Response = () => directiveResponse(noUpdateDirective)) => {
    const calls: string[] = [];
    const store = { embeddedCreatedAt: 0, updates: {}, failedIds: [], metadata: { serverDefinedHeaders: null, manifestFilters: null } };
    return {
      calls,
      module: {
        isEnabled: true, platform: "android", updateId: null, runtimeVersion: "0.1.0", updateUrl: "https://u.expo.dev/p", requestHeaders: { "expo-channel-name": "production" },
        checkOnLaunch: "NEVER", hasEmbeddedUpdate: true, isEmbeddedLaunch: true, createdAt: 0, localAssets: {}, clientId: "c",
        readStore: async () => JSON.stringify(store),
        request: async () => { calls.push("request"); const answer = response(); return { status: answer.status, headers: Object.fromEntries(answer.headers), body: await answer.text() }; },
        downloadAsset: async (download: { key: string; hash: string }) => { calls.push("download"); return { key: download.key, hash: download.hash }; },
        commitUpdate: async () => { calls.push("commit"); },
        saveMetadata: async () => {},
        rollBackToEmbedded: async () => {},
        markLaunched: async () => {},
        reload: async () => {},
        ...overrides,
      },
    };
  };

  test("with updates off, `current` is false and `check()` resolves false without asking a server (no native module, and a development build)", async () => {
    for (const module of [null, native({ isEnabled: false }).module]) {
      reset();
      world.__kitUpdates = module;
      const m = await load();
      expect(m.state.updated.current).toBe(false);
      expect(await m.state.updated.check()).toBe(false);
      expect(m.state.updated.current).toBe(false);
    }
  });

  test("a server with nothing new: check() is false; with an update: check() is true, `current` stays true, and an effect that read it runs again", async () => {
    reset();
    const none = native();
    world.__kitUpdates = none.module;
    let m = await load();
    expect(await m.state.updated.check()).toBe(false);
    expect(none.calls).toEqual(["request"]);

    reset();
    const found = native({}, () => manifestResponse());
    world.__kitUpdates = found.module;
    m = await load();
    const tag = ++surface;
    m.startSurface(tag, m.Reader, {});
    surfaces.push({ m, tag });
    await turn(m);
    expect(world.__kitReads.filter((line) => line.startsWith("updated"))).toEqual(["updated false"]);
    expect(await m.state.updated.check()).toBe(true);
    await turn(m);
    expect(world.__kitReads.filter((line) => line.startsWith("updated"))).toEqual(["updated false", "updated true"]);
    expect(m.state.updated.current).toBe(true);
    expect(await m.state.updated.check()).toBe(true); // known: no second request
    expect(found.calls).toEqual(["request"]);
  });

  test("an update the app fetched itself, or the launch check downloaded, is `current` too, with no check", async () => {
    reset();
    const found = native({}, () => manifestResponse());
    world.__kitUpdates = found.module;
    const m = await load();
    expect(m.state.updated.current).toBe(false);
    expect((await m.updates.fetchUpdateAsync()).isNew).toBe(true);
    expect(found.calls).toContain("commit");
    expect(m.state.updated.current).toBe(true);
  });

  test("a check that fails (the network is down) resolves false and warns, as SvelteKit's does not reject", async () => {
    reset();
    const failing = native({ request: async () => { throw new Error("offline"); } });
    world.__kitUpdates = failing.module;
    const m = await load();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await m.state.updated.check()).toBe(false);
      expect(warn.mock.calls[0]?.[0]).toBe("[Svelte updates] the check for an update failed");
    } finally {
      warn.mockRestore();
    }
  });
});

/** The names a `declare module` of SvelteKit's types exports as values (a function, a constant or a class), sorted: what the device's module has to have. */
function kitExports(module: string): string[] {
  const types = readFileSync(resolve(import.meta.dirname, "../../../node_modules/@sveltejs/kit/types/index.d.ts"), "utf8");
  const start = types.indexOf(`declare module '${module}' {`);
  const block = types.slice(start, types.indexOf("\n}\n", start));
  return [...block.matchAll(/^\texport (?:declare )?(?:function|const|class) (\w+)/gm)].map((match) => match[1] ?? "").toSorted();
}
