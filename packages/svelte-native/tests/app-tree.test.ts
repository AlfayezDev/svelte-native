import { test, expect, jest } from "bun:test";
import { build, transform, type Loader, type Plugin } from "esbuild";
import { readFile, mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { svgLibraryStubs } from "./svg-library-stubs.ts";
import { parseNativeID } from "../src/fabric/navigation.ts";
import { routeFiles, syncNative } from "../src/build.ts";
import { stubCoreSource, stubSource } from "../src/metro.ts";
import { buildTree, resolve as resolveHref, type PageRoute, type RouteNode } from "../src/route-tree.ts";
import { enforceGate, type Visitor } from "./fixtures/stand-in-app/src/lib/gate.ts";

/**
 * The route tree of the stand-in app (`tests/fixtures/stand-in-app`, an app of this package's own): the files under its `src/routes`, built by
 * the generator's reader, linked to the test components of the fixtures (a tabs bar, a stack, a page that registers its router). The app has
 * the shape the router was built for: a root stack with pages, a modal and a tabs navigator (a project, with a home pane and a settings pane),
 * behind a gate that keeps the root navigator on a screen the visitor may see, and a development lab under `/__dev`. The tests pin that shape
 * and drive the navigation an app does through it. The app's own pages and shell are mounted by the second half of the file.
 */
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
  ...svgLibraryStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { get OS() { return globalThis.__navigationOS ?? 'android'; }, Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "const handlers = (globalThis.__backHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; } };",
  "react-native/Libraries/Linking/Linking": "const handlers = (globalThis.__linkHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; }, getInitialURL: () => { globalThis.__initialURLReads = (globalThis.__initialURLReads ?? 0) + 1; if (globalThis.__initialURLMode === 'reject') return Promise.reject(new Error('the link service is down')); if (globalThis.__initialURLMode === 'hang') return new Promise(() => {}); return Promise.resolve(globalThis.__initialURL ?? null); } };",
  "react-native/Libraries/AppState/AppState": "const handlers = (globalThis.__appStateHandlers ??= []); export default { get currentState() { return globalThis.__appState ?? 'active'; }, addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; } };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = (name) => name === 'SvelteEngine' && globalThis.__navigationInsets ? { install: () => false, getInsets: () => globalThis.__navigationInsets, addListener: () => ({ remove() {} }) } : null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

type LoadOptions = { plugins?: Plugin[]; loader?: Record<string, Loader>; define?: Record<string, string> };
async function load(fixture = "navigation-fixture.svelte", options: LoadOptions = {}) {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './${fixture}';
        import { startSurface, flush, fabricStats } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, flush, fabricStats, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false, loader: options.loader, define: options.define,
    plugins: [...(options.plugins ?? []), {
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
const ofKind = (nodes: FakeNode[], kind: string): FakeNode[] => nodes.flatMap((node) => [...(parseNativeID(String(node.props.nativeID ?? ""))?.kind === kind ? [node] : []), ...ofKind(node.children, kind)]);
const environment = globalThis as { __navigationInsets?: unknown; __navigationOS?: string };
const withInsets = (top: number, bottom = 34) => { environment.__navigationInsets = { top, right: 0, bottom, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 } }; };
const reset = () => { delete environment.__navigationInsets; delete environment.__navigationOS; jest.useRealTimers(); };
const texts = (root: number) => find(roots[root] ?? [], "RCTRawText").map((node) => String(node.props.text));
const turns = async (m: { tick: () => Promise<void> }) => { for (let turn = 0; turn < 8; turn++) await settle(m); };
const handlersOf = (key: "__backHandlers" | "__linkHandlers") => (globalThis as unknown as Record<string, ((...args: never[]) => unknown)[]>)[key];
type TreeRouter = {
  scope: string | undefined; active: () => boolean; entries: { url: URL; presentation: string; params: Record<string, string> }[]; current: { url: URL };
  selected: string | undefined; goto: (href: string, options?: { replaceState?: boolean; reset?: boolean; presentation?: string }) => void; back: () => boolean;
  replaceBase: (href: string) => void; openURL: (href: string) => boolean; screens: { leaving: boolean; canGoBack: boolean }[];
  node: { kind: string; panes?: { key: string; stack: object }[] }; modules: (node: object) => unknown;
};
type TreeApp = { root?: () => TreeRouter; show: (shown: boolean) => void };
const treeGlobals = globalThis as { __treeRoots?: Record<string, TreeRouter>; __treeRouters?: Record<string, TreeRouter>; __treeOptions?: Record<string, object>; __treeTabs?: object[]; __treeSelections?: string[]; __treePanes?: unknown; __treeTabsRouter?: TreeRouter; __treeLayouts?: { path?: string; params?: object }[] };
const pathsOf = (router: TreeRouter) => router.entries.map((entry) => `${entry.url.pathname}${entry.url.search}`);
const selectedIndex = (surface: number) => parseNativeID(String(ofKind(roots[surface], "tabs")[0].props.nativeID))?.pairs.sel;
const paneRouter = (path: string): TreeRouter => { const router = treeGlobals.__treeRouters?.[path]; if (!router) throw new Error(`no page rendered at ${path}`); return router; };
async function mountTree(surface: number, props: Record<string, unknown> = {}, fixture = "tree-fixture.svelte", options: LoadOptions = {}) {
  const m = await load(fixture, options);
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
  return { m, app, router: app.root?.() as TreeRouter, hardwareBack, settled, texts: () => texts(surface), tree: () => roots[surface] };
}

const appRoutes = resolve(import.meta.dirname, "fixtures/stand-in-app/src/routes");
const appFiles = () => routeFiles(appRoutes, { lab: true });
/** The production variant's route files (`APP_VARIANT=production`): discovery leaves the lab out. */
const productionFiles = () => routeFiles(appRoutes, { lab: false });
const outline = (route: PageRoute | RouteNode, depth = 0): string[] => {
  const pad = "  ".repeat(depth);
  if (route.kind === "page") return [`${pad}page ${route.path}${route.presentation === "push" ? "" : ` (${route.presentation})`}`];
  if (route.kind === "stack") return [`${pad}stack ${route.path}`, ...route.routes.flatMap((child) => outline(child, depth + 1))];
  return [`${pad}tabs ${route.path} [${route.panes.map((pane) => pane.key).join(", ")}]`, ...route.panes.flatMap((pane) => [`${pad}  pane ${pane.key}`, ...outline(pane.stack, depth + 2)])];
};

test("the stand-in app's tree: the root stack's pages and presentations, a project as a tabs node with a home pane and a settings pane, the preferences modal at the root", async () => {
  const tree = buildTree(await appFiles());
  expect(tree.shellFile).toBe("+layout.mobile.svelte"); // the app shell wraps the root navigator
  // The lab (/__dev) is a development surface of its own; the app is the rest.
  const app = tree.routes.filter((route) => !route.path.startsWith("/__dev"));
  expect(app.flatMap((route) => outline(route))).toEqual([
    "page /projects/new",
    "page /preferences (modal)",
    "page /sign-in",
    "page /projects",
    "page /setup",
    "tabs /[slug] [home, settings]",
    "  pane home",
    "    stack /[slug]/home",
    "      page /[slug]/home",
    "  pane settings",
    "    stack /[slug]/settings",
    "      page /[slug]/settings/[section]",
    "      page /[slug]/settings",
  ]);
  const project = tree.routes.find((route) => route.kind === "tabs" && route.path === "/[slug]");
  expect(project?.kind === "tabs" && project.layoutFile).toBe("(project)/[slug]/+layout.mobile.svelte");
  expect(outline(tree).filter((line) => line.trim().startsWith("tabs")).map((line) => line.trim())).toEqual(["tabs /__dev/tree [home, inbox]", "tabs /[slug] [home, settings]"]);
  // Only the preferences are a modal, and it is a page of the root stack (one indent): it covers the project's tab bar.
  expect(outline(tree).filter((line) => /\((modal|transparentModal|formSheet)\)/.test(line))).toEqual(["  page /preferences (modal)"]);
  expect(outline(tree).filter((line) => line.includes("(sheet)")).map((line) => line.trim())).toEqual(["page /__dev/tree/inbox/compose (sheet)"]); // the lab's sheet, in the lab's pane
  // A root-level path never lands in the project: /projects and /preferences are pages of the root stack.
  expect(resolveHref(tree, "/projects")?.chain.map((step) => step.node.id)).toEqual([""]);
  expect(resolveHref(tree, "/preferences")?.chain.map((step) => step.node.id)).toEqual([""]);
  expect(resolveHref(tree, "/acme")?.page.path).toBe("/[slug]/home");
  expect(resolveHref(tree, "/acme/settings")?.chain.map((step) => `${step.node.id || "root"}${step.select ? `:${step.select}` : ""}`)).toEqual(["root", "(project)/[slug]:settings", "(project)/[slug]/settings"]);
  expect(resolveHref(tree, "/acme/settings/devices")?.params).toEqual({ slug: "acme", section: "devices" });
});

const projectTabs = [{ key: "home", title: "Home" }, { key: "settings", title: "Settings" }];
const mountApp = async (surface: number, initial: string) => mountTree(surface, { initial, files: await appFiles(), tabs: projectTabs });

// What each shown header says of its back arrow, by title (the stub pages title themselves with their path).
const backFlags = (nodes: FakeNode[]) => Object.fromEntries(ofKind(nodes, "header").map((node) => {
  const pairs = parseNativeID(String(node.props.nativeID))?.pairs ?? {};
  return [decodeURIComponent(String(pairs.t)), pairs.bk === "1"];
}));
const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);

test("sign-in, the projects, a project's home pane, project settings selects the settings tab, the preferences are a modal over the tabs", async () => {
  withInsets(24);
  try {
    const { router, settled, hardwareBack, tree } = await mountApp(120, "/sign-in");
    expect(pathsOf(router)).toEqual(["/sign-in"]);
    router.goto("/projects", { reset: true }); // what the gate does for a signed-in visitor
    await settled();
    expect(pathsOf(router)).toEqual(["/projects"]);

    // The list opens a project: reset is a new root, so the tabs screen is the root's only entry (and its base).
    router.goto("/acme", { reset: true });
    await settled();
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(router.entries[0].params).toEqual({ slug: "acme" });
    expect(router.current.url.pathname).toBe("/acme/home"); // the deepest shown entry: the home pane's base
    expect(selectedIndex(120)).toBe("0");
    expect(paneRouter("/acme/home").scope).toBe("home");
    expect(treeGlobals.__treePanes).toEqual([{ key: "home" }, { key: "settings" }]);
    expect(ofKind(tree(), "tab").map((pane) => String(parseNativeID(String(pane.props.nativeID))?.pairs.k))).toEqual(["home", "settings"]);
    expect(arrows(router)).toEqual([false]); // no back arrow on the tabs screen,
    expect(backFlags(tree())).toMatchObject({ "/acme/home": false }); // nor on the home pane's base
    expect(hardwareBack()).toBe(false); // and the back key leaves the app

    // "Manage project" is goto(`/${slug}/settings`) from the home pane: it selects the settings tab, nothing is pushed on the root.
    paneRouter("/acme/home").goto("/acme/settings");
    await settled();
    expect(selectedIndex(120)).toBe("1");
    expect(treeGlobals.__treeTabsRouter?.selected).toBe("settings");
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(router.current.url.pathname).toBe("/acme/settings");
    expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings"]);

    // A section is a page pushed within the settings pane; the tab bar stays, and the section has the back arrow.
    paneRouter("/acme/settings").goto("/acme/settings/devices");
    await settled();
    expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings", "/acme/settings/devices"]);
    expect(paneRouter("/acme/settings/devices").entries[1].params).toEqual({ slug: "acme", section: "devices" });
    expect(router.current.url.pathname).toBe("/acme/settings/devices");
    expect(selectedIndex(120)).toBe("1");
    expect(arrows(paneRouter("/acme/settings"))).toEqual([false, true]);
    expect(backFlags(tree())).toMatchObject({ "/acme/settings": false, "/acme/settings/devices": true });

    // The preferences are a root page presented as a modal over the tabs, from either pane.
    paneRouter("/acme/settings").goto("/preferences");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme", "/preferences"]);
    expect(router.entries[1].presentation).toBe("modal");
    expect(router.current.url.pathname).toBe("/preferences");
    expect(ofKind(tree(), "screen").map((screen) => parseNativeID(String(screen.props.nativeID))?.pairs.p).filter((value) => value === "modal")).toHaveLength(1);
    expect(treeGlobals.__treeTabsRouter?.selected).toBe("settings"); // the tabs are still there under the modal
    expect(backFlags(tree())["/preferences"]).toBe(false); // a modal gets no arrow: its page's Close button is the way out

    // Back closes the modal first, then pops the section; the selected tab never changes.
    expect(hardwareBack()).toBe(true);
    await settled();
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(router.current.url.pathname).toBe("/acme/settings/devices");
    expect(hardwareBack()).toBe(true);
    await settled();
    expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings"]);
    expect(selectedIndex(120)).toBe("1");
    expect(router.current.url.pathname).toBe("/acme/settings");
    expect(hardwareBack()).toBe(false); // the settings pane's base: back does not switch to the home tab, and nothing is below the tabs
    await settled();
    expect(selectedIndex(120)).toBe("1");
  } finally { reset(); }
});

test("project settings from Home, twice, and with a section open, leaves the settings pane at its base", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountApp(127, "/acme/home");
    paneRouter("/acme/home").goto("/acme/settings"); // the Manage project button
    await settled();
    expect(selectedIndex(127)).toBe("1");
    paneRouter("/acme/settings").goto("/acme/settings/profile");
    await settled();
    expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings", "/acme/settings/profile"]);
    paneRouter("/acme/settings").goto("/acme/settings/profile"); // the section's own row again: nothing
    paneRouter("/acme/home").goto("/acme/settings"); // back on Home, the button again: the tab is selected and the open section is popped
    await settled();
    expect(selectedIndex(127)).toBe("1");
    expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings"]);
    paneRouter("/acme/home").goto("/acme/settings");
    await settled();
    expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings"]);
    expect(pathsOf(router)).toEqual(["/acme"]);
  } finally { reset(); }
});

test("back at the base of the settings pane does not switch to the home tab, whether the tabs were opened by a link, by the list's reset, or over the list", async () => {
  withInsets(24);
  try {
    const alone = await mountApp(121, "/acme/settings");
    expect(pathsOf(alone.router)).toEqual(["/acme"]);
    expect(alone.router.entries[0].params).toEqual({ slug: "acme" }); // opened by a link: the tabs screen is the base of the root stack
    expect(selectedIndex(121)).toBe("1");
    expect(alone.hardwareBack()).toBe(false);
    await alone.settled();
    expect(selectedIndex(121)).toBe("1");
    expect(paneRouter("/acme/settings").back()).toBe(false);
    expect(alone.router.back()).toBe(false);
    expect(selectedIndex(121)).toBe("1");
    expect(alone.router.current.url.pathname).toBe("/acme/settings");

    // Opened from the list with a reset (what the list and the creation of a project do): nothing is left below the project.
    const opened = await mountApp(122, "/projects");
    opened.router.goto("/acme/settings", { reset: true });
    await opened.settled();
    expect(pathsOf(opened.router)).toEqual(["/acme"]);
    expect(selectedIndex(122)).toBe("1");
    expect(opened.hardwareBack()).toBe(false);
    expect(selectedIndex(122)).toBe("1");

    // Pushed over the list (a link while the list is shown): the key pops the project, still without switching tabs on the way.
    const below = await mountApp(123, "/projects");
    below.router.goto("/acme/settings");
    await below.settled();
    expect(pathsOf(below.router)).toEqual(["/projects", "/acme"]);
    expect(selectedIndex(123)).toBe("1");
    below.router.goto("/acme/home");
    await below.settled();
    expect(selectedIndex(123)).toBe("0"); // navigating selects; only that does
    below.router.goto("/acme/settings");
    await below.settled();
    expect(below.hardwareBack()).toBe(true);
    await below.settled();
    expect(pathsOf(below.router)).toEqual(["/projects"]);
  } finally { reset(); }
});

const entered = (patch: Partial<Visitor> = {}): Visitor => ({ user: { id: "u1" }, needsSetup: false, projects: [{ slug: "acme" }], ...patch });
const gate = (router: TreeRouter, visitor: Visitor, lab = false) => enforceGate(visitor, router as unknown as Parameters<typeof enforceGate>[1], lab);

test("the gate on the app's tree: sign-in, setup and projects by the shown path, the lab only in lab builds", async () => {
  withInsets(24);
  try {
    // Signed out: everything but the sign-in goes to it, from a project and from a modal over one.
    const out = await mountApp(124, "/acme/home");
    expect(out.router.current.url.pathname).toBe("/acme/home");
    gate(out.router, entered({ user: null }));
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/sign-in"]);
    gate(out.router, entered({ user: null })); // nothing to do on the sign-in
    expect(pathsOf(out.router)).toEqual(["/sign-in"]);

    // A visitor who has not finished the setup is held on it, and may open the preferences modal from there.
    gate(out.router, entered({ needsSetup: true }));
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/setup"]);
    out.router.goto("/preferences");
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/setup", "/preferences"]);
    gate(out.router, entered({ needsSetup: true }));
    expect(pathsOf(out.router)).toEqual(["/setup", "/preferences"]);

    // A setup that is done leaves the setup and the sign-in for the projects.
    out.router.back();
    await out.settled();
    gate(out.router, entered());
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/projects"]);
    out.router.goto("/sign-in");
    await out.settled();
    gate(out.router, entered());
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/projects"]);

    // The lab is a lab build's: elsewhere a signed-in visitor goes to the projects, nobody to the sign-in.
    out.router.goto("/__dev/tree/inbox");
    await out.settled();
    expect(out.router.current.url.pathname).toBe("/__dev/tree/inbox");
    gate(out.router, entered(), true);
    expect(out.router.current.url.pathname).toBe("/__dev/tree/inbox");
    gate(out.router, entered(), false);
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/projects"]);
    out.router.goto("/__dev");
    await out.settled();
    gate(out.router, entered({ user: null }), false);
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/sign-in"]);
  } finally { reset(); }
});

test("the gate sends the visitor to the projects when their project is no longer theirs; the preferences modal above it stays", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountApp(125, "/projects");
    router.goto("/acme", { reset: true });
    await settled();
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(router.entries[0].params.slug).toBe("acme"); // the project is the root's base
    gate(router, entered());
    expect(pathsOf(router)).toEqual(["/acme"]); // still theirs: nothing happens
    gate(router, entered({ projects: [{ slug: "other" }] }));
    await settled();
    expect(pathsOf(router)).toEqual(["/projects"]);

    // The preferences modal that removed the project stays up: the list replaces the project under it.
    router.goto("/acme", { reset: true });
    router.goto("/preferences");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme", "/preferences"]);
    const modal = router.entries[1];
    gate(router, entered({ projects: [] }));
    await settled();
    expect(pathsOf(router)).toEqual(["/projects", "/preferences"]);
    expect(router.entries[1]).toBe(modal);
    expect(router.current.url.pathname).toBe("/preferences");
    router.back(); // the modal's Close
    await settled();
    expect(pathsOf(router)).toEqual(["/projects"]);

    // A project pushed over the list (a link) is dealt with when it is the shown one.
    router.goto("/acme");
    await settled();
    expect(pathsOf(router)).toEqual(["/projects", "/acme"]);
    gate(router, entered());
    expect(pathsOf(router)).toEqual(["/projects", "/acme"]);
    gate(router, entered({ projects: [] }));
    await settled();
    expect(pathsOf(router)).toEqual(["/projects"]);
  } finally { reset(); }
});

test("replaceBase on the root router replaces the first screen with a root page and keeps the screens above it", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountApp(126, "/projects");
    router.goto("/acme", { reset: true });
    router.goto("/preferences");
    await settled();
    const [tabs, modal] = router.entries;
    router.replaceBase("/projects"); // the project under the modal goes, the modal stays
    await settled();
    expect(pathsOf(router)).toEqual(["/projects", "/preferences"]);
    expect(router.entries[0]).not.toBe(tabs);
    expect(router.entries[1]).toBe(modal);
    expect(arrows(router)).toEqual([false, true]);
    expect(() => router.replaceBase("/acme")).toThrow(); // the project is a navigator's screen, not a page of the root stack
  } finally { reset(); }
});

const labPaths = (route: PageRoute | RouteNode): string[] => [
  route.path, ...(route.kind === "page" ? [] : route.kind === "stack" ? route.routes.flatMap(labPaths) : route.panes.flatMap((pane) => labPaths(pane.stack))),
];

test("the production variant's tree is the app's tree without the lab: no /__dev route, the same screens otherwise", async () => {
  const files = await productionFiles();
  expect(files.filter((file) => file.path.includes("__dev"))).toEqual([]);
  const production = buildTree(files);
  expect(labPaths(production).filter((path) => path.includes("__dev"))).toEqual([]);
  // The lab's tree is the production tree plus the /__dev routes.
  const full = buildTree(await appFiles());
  expect(labPaths(full).filter((path) => path.includes("__dev")).length).toBeGreaterThan(8);
  expect(full.routes.filter((route) => !route.path.startsWith("/__dev")).flatMap((route) => outline(route))).toEqual(production.routes.flatMap((route) => outline(route)));
  expect(production.shellFile).toBe(full.shellFile);
  expect(outline(production).filter((line) => line.trim().startsWith("tabs")).map((line) => line.trim())).toEqual(["tabs /[slug] [home, settings]"]);
  // The lab's own pages are not found; /__dev alone reads as a project slug (a single segment names a project), which the gate sends back.
  for (const href of ["/__dev/screen", "/__dev/screens", "/__dev/tree/inbox", "/__dev/foreign", "/__dev/smoke", "/__dev/gestures"]) expect([href, resolveHref(production, href)]).toEqual([href, null]);
  expect(resolveHref(production, "/__dev")?.params).toEqual({ slug: "__dev" });
  expect(resolveHref(full, "/__dev")?.page.path).toBe("/__dev");
});

test("in the production variant a deep link to the lab ends where an unknown project does: the projects for a visitor, the sign-in for nobody", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  try {
    const mountProduction = async (surface: number, initial: string) => mountTree(surface, { initial, files: await productionFiles(), tabs: projectTabs });
    // A link while the app runs (`standin://__dev`): the lab's pages are not in the tree, so the screens of the lab are ignored,
    const running = await mountProduction(140, "/projects");
    for (const link of ["standin://__dev/screens", "standin://__dev/tree/inbox", "standin://__dev/smoke", "standin-lab://__dev/foreign"]) expect([link, running.router.openURL(link)]).toEqual([link, false]);
    expect(pathsOf(running.router)).toEqual(["/projects"]);
    // and the bare /__dev is a project that is not the visitor's, which the gate (a lab branch for a build without a lab) turns into the list.
    expect(running.router.openURL("standin://__dev")).toBe(true);
    await running.settled();
    expect(pathsOf(running.router)).toEqual(["/projects", "/__dev"]);
    gate(running.router, entered(), false);
    await running.settled();
    expect(pathsOf(running.router)).toEqual(["/projects"]);

    // The link the app was launched with (a QA run opens the lab this way): the same end for a signed-in visitor, the sign-in for nobody.
    launch.__initialURL = "standin://__dev";
    const visitor = await mountProduction(141, "/sign-in");
    await visitor.settled();
    expect(pathsOf(visitor.router)).toEqual(["/__dev"]); // opened with reset: the base of the root stack
    expect(visitor.router.current.url.pathname).toBe("/__dev/home");
    gate(visitor.router, entered(), false);
    await visitor.settled();
    expect(pathsOf(visitor.router)).toEqual(["/projects"]);
    const nobody = await mountProduction(142, "/sign-in");
    await nobody.settled();
    expect(pathsOf(nobody.router)).toEqual(["/__dev"]);
    gate(nobody.router, entered({ user: null }), false);
    await nobody.settled();
    expect(pathsOf(nobody.router)).toEqual(["/sign-in"]);

    // A lab link of a build that has the lab opens the lab (the contrast).
    launch.__initialURL = "standin-lab://__dev/screens";
    const lab = await mountTree(143, { initial: "/sign-in", files: await appFiles(), tabs: projectTabs });
    await lab.settled();
    expect(pathsOf(lab.router)).toEqual(["/__dev/screens"]);
    gate(lab.router, entered(), true);
    expect(pathsOf(lab.router)).toEqual(["/__dev/screens"]);
  } finally { delete launch.__initialURL; reset(); }
});

// The stand-in app with and without its lab.
//
// A store build's Metro resolves everything in the lab's directories to a stub that throws when it is used, and the shared code (the root
// layout, the session, the sign-in page) may call the lab only behind `labEnabled`. This mounts the app's real root layout, session and
// pages the way a build runs them: the route table the Metro integration generates for the variant, the lab's directories replaced by the real
// stub (the file `stubSource` writes, over `stubCoreSource`: a Proxy that throws on any property read and on a call), the application id the
// host reports faked. A lab call that is not behind the flag then fails the test instead of a phone.
//
// The stub throws on a READ of a binding as much as on a call, because Metro's transform reads a named import where it is used
// (`_probe.lateFault`, a property read on the stub), while esbuild copies the exports of a CommonJS module into a namespace object when it
// is imported, and the stub has none to copy (`ownKeys` is empty): `lateFault === "mount"` was `undefined === "mount"` here, and a read of a
// lab binding that was not behind the flag passed this test and crashed a root layout. So each import of a stubbed directory
// goes through a module that names the bindings the importer imports from it (`ownKeys`), and esbuild's copy then reads them through the
// stub's `get` when they are used, which throws.
const appRoot = resolve(import.meta.dirname, "fixtures/stand-in-app");
const labDirectories = [`${resolve(appRoot, "src/lib/lab")}/`, `${resolve(appRoot, "src/routes/__dev")}/`];
/** The application ids the host can report (`expo-application`): the store build never runs the lab, the lab build may. */
const storeApplication = "com.example.app";
const labApplication = "com.example.lab";

/**
 * The names `importer` imports from `specifier` as bindings (`import { a, b as c } from`, `export { a } from`): the ones a bundler reads on the
 * module where they are used. A default import, a namespace import and a type-only import read no named binding. Reads the importer's source,
 * so a statement it cannot read is an error and not a binding the test would never check.
 */
function importedNames(source: string, specifier: string, importer = "the importer"): string[] {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = new Set<string>();
  const statement = new RegExp(`\\b(?:import|export)\\s+(type\\s+)?([^;'"]*?)\\bfrom\\s*(["'])${escaped}\\3`, "g");
  let found = 0;
  for (const match of source.matchAll(statement)) {
    found++;
    if (match[1] !== undefined) continue;
    const braces = /\{([^}]*)\}/.exec(match[2] ?? "");
    for (const entry of (braces?.[1] ?? "").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").split(",")) {
      const name = entry.trim().split(/\s+as\s+/)[0]?.trim() ?? "";
      if (name === "" || /^type\s/.test(name)) continue;
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`cannot read the binding ${JSON.stringify(name)} that ${importer} imports from ${specifier}`);
      names.add(name);
    }
  }
  // A mention that is no import statement we read (a dynamic import, a side-effect import) reads no named binding, as Metro's interop does.
  if (found === 0 && new RegExp(`\\bfrom\\s*["']${escaped}["']`).test(source)) throw new Error(`cannot read how ${importer} imports ${specifier}`);
  return [...names];
}

/**
 * The build of the stand-in app for `variant` as a set of esbuild options for `load`. With `lab` the lab is the real one (a lab build); without
 * it the lab's directories are the stubs a store build has, whatever the variant's route table says.
 */
async function standInApp(variant: string, applicationId: string, options: { lab?: boolean } = {}): Promise<{ plugins: Plugin[]; clean: () => Promise<void> }> {
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-stand-in-app-"));
  // A project whose `src` is the app's, so the generated table requires the real pages.
  await symlink(resolve(appRoot, "src"), resolve(directory, "src"));
  await syncNative(directory, { variant });
  const table = resolve(directory, ".svelte-native", `routes.${variant}.ts`);
  await mkdir(resolve(directory, "stubs"), { recursive: true });
  await writeFile(resolve(directory, "stubs/_core.js"), stubCoreSource);
  // One stub per stubbed directory, as `withSvelteNative` writes them: its name is the directory relative to the project, and the stub reads
  // `./_core.js` next to it.
  const stubFiles = new Map<string, string>();
  for (const lab of labDirectories) {
    const name = `${relative(appRoot, lab)}/`.replaceAll("\\", "/");
    const file = resolve(directory, "stubs", `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`);
    await writeFile(file, stubSource(name, variant));
    stubFiles.set(lab, file);
  }
  const host: Record<string, string> = {
    "expo-application": `export const applicationId = ${JSON.stringify(applicationId)};`,
  };
  const plugin: Plugin = {
    name: "stand-in-app",
    setup(builder) {
      builder.onResolve({ filter: /^@alfayez\/svelte-native$/ }, () => ({ path: resolve(import.meta.dirname, "../src/index.ts") }));
      builder.onResolve({ filter: /^@alfayez\/svelte-native\/routes$/ }, () => ({ path: table }));
      builder.onResolve({ filter: new RegExp(`^(${Object.keys(host).join("|")})$`) }, (args) => ({ path: args.path, namespace: "stand-in-host" }));
      builder.onLoad({ filter: /.*/, namespace: "stand-in-host" }, (args) => ({ contents: host[args.path], loader: "js" }));
      // The stub of a store build, byte for byte, behind a Proxy that lists the bindings this importer names, so that esbuild's namespace copy
      // reads each one through the stub's `get` (which throws) where it is used, as Metro's `_stub.name` does. Everything else is the stub's:
      // a read of any other property, a call and a construction throw, `has` and `getOwnPropertyDescriptor` answer nothing.
      builder.onLoad({ filter: /.*/, namespace: "lab-stub" }, (args) => {
        const { stub, names } = args.pluginData as { stub: string; names: string[] };
        return { contents: `const stub = require(${JSON.stringify(stub)});\nmodule.exports = new Proxy(stub, { ownKeys: () => ${JSON.stringify(names)} });\n`, resolveDir: directory, loader: "js" };
      });
      builder.onResolve({ filter: /^[.#]/ }, async (args) => {
        if (args.pluginData?.standIn || options.lab) return undefined;
        const found = await builder.resolve(args.path, { resolveDir: args.resolveDir, importer: args.importer, kind: args.kind, namespace: args.namespace, pluginData: { standIn: true } });
        if (found.errors.length > 0) return undefined;
        const lab = labDirectories.find((candidate) => found.path.startsWith(candidate));
        if (lab === undefined) return undefined;
        const names = importedNames(await readFile(args.importer, "utf8"), args.path, args.importer);
        return { path: `${args.importer} > ${args.path}`, namespace: "lab-stub", pluginData: { stub: stubFiles.get(lab), names } };
      });
    },
  };
  return { plugins: [plugin], clean: () => rm(directory, { recursive: true, force: true }) };
}

const standIn = globalThis as { __standInRouter?: TreeRouter; __standInSignedOut?: boolean; __standInSessions?: number; __standInStart?: () => Promise<void> };
type StandInOptions = { variant: string; applicationId: string; initial: string; signedOut?: boolean; lab?: boolean; start?: () => Promise<void>; navigation?: string };
/**
 * Mounts the stand-in app's root layout on `Root` with the generated table of `variant`. `start` is what the session waits for before it opens
 * (the backend of a real app); `starts()` counts the times the app asked, `sessions()` the times a session was opened. What the app logged is
 * collected in `errors` and `warnings`.
 */
async function mountStandIn(surface: number, options: StandInOptions) {
  const app = await standInApp(options.variant, options.applicationId, { lab: options.lab });
  let starts = 0;
  standIn.__standInStart = () => { starts++; return (options.start ?? (async () => {}))(); };
  if (options.signedOut) standIn.__standInSignedOut = true;
  standIn.__standInSessions = 0;
  const errors: string[] = [];
  const warnings: string[] = [];
  const logged = { error: console.error, warn: console.warn };
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  const restore = () => {
    console.error = logged.error;
    console.warn = logged.warn;
    delete standIn.__standInStart;
    delete standIn.__standInSignedOut;
    delete standIn.__standInSessions;
    delete standIn.__standInRouter;
  };
  try {
    const mounted = await mountTree(surface, { initial: options.initial, navigation: options.navigation }, "stand-in-fixture.svelte", app);
    await mounted.settled();
    await mounted.settled();
    return { ...mounted, errors, warnings, starts: () => starts, sessions: () => standIn.__standInSessions ?? 0, router: standIn.__standInRouter as TreeRouter, close: () => { restore(); return app.clean(); } };
  } catch (error) {
    restore();
    await app.clean();
    throw error;
  }
}
/** What went wrong in an app that should be fine: a stub that threw, a call to a lab export that is not there, the shell's failure page. */
const trouble = (texts: string[], errors: string[]) => [...texts, ...errors].filter((line) => /not in this app|is not a function|is not a constructor|went wrong/i.test(line));
const neverAnswers = () => new Promise<void>(() => {});
const sendLink = (url: string) => { for (const handler of handlersOf("__linkHandlers")) (handler as (event: { url: string }) => void)({ url }); };
const labStart = (surface: number, options: Partial<StandInOptions> = {}) => mountStandIn(surface, { variant: "qa", applicationId: labApplication, initial: "/sign-in", lab: true, ...options });

test("the app with the lab off: the root layout, the session and the screens that offer the lab run without calling it", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  const checks: [number, string, boolean, string][] = [
    [150, "/projects", false, "Your projects"],
    [151, "/acme/home", false, "Project home"],
    [152, "/sign-in", true, "Sign in"],
  ];
  try {
    for (const [surface, initial, signedOut, expected] of checks) {
      const app = await mountStandIn(surface, { variant: "production", applicationId: storeApplication, initial, signedOut });
      try {
        const shown = app.texts();
        expect([initial, trouble(shown, app.errors)]).toEqual([initial, []]);
        expect([initial, shown]).toEqual([initial, [expected]]);
        expect(app.errors).toEqual([]);
        expect(app.router.current.url.pathname.startsWith("/__dev")).toBe(false);
      } finally { await app.close(); reset(); }
    }
    // The launch link of the lab reaches a build with no lab as it reaches any project that is not the visitor's: the list, and no call into the lab.
    launch.__initialURL = "standin://__dev";
    const linked = await mountStandIn(153, { variant: "production", applicationId: storeApplication, initial: "/sign-in" });
    try {
      for (let turn = 0; turn < 4; turn++) await linked.settled();
      expect(trouble(linked.texts(), linked.errors)).toEqual([]);
      expect(pathsOf(linked.router)).toEqual(["/projects"]);
    } finally { await linked.close(); reset(); }
  } finally { delete launch.__initialURL; reset(); }
});

test("the same harness sees a lab call that is not behind the flag: with the flag on and the lab stubbed, the call fails the app", async () => {
  withInsets(24);
  // The lab build's table (it has the lab) but the store build's stubs: every lab call is a call into a stub, which is what an unguarded call in a store build is.
  try {
    await expect(mountStandIn(154, { variant: "qa", applicationId: labApplication, initial: "/projects" })).rejects.toThrow(/installErrorCounter|not in this app/);
  } finally { reset(); }
  // And a bundle that has the lab in the store app: the shell refuses it, says so, and calls nothing.
  const refused = await mountStandIn(155, { variant: "qa", applicationId: storeApplication, initial: "/projects" });
  try {
    expect(trouble(refused.texts(), refused.errors.filter((line) => !line.includes("[stand-in lab]")))).toEqual([]);
    expect(refused.errors.filter((line) => line.includes("[stand-in lab]"))).toEqual(["[stand-in lab] this bundle carries the development lab, which the store app does not run: the lab is off"]);
    expect(refused.texts()).toEqual(["Your projects"]);
  } finally { await refused.close(); reset(); }
  // A lab build's application id with a store-variant Metro: the bundle has no lab, so none of it runs although the id would allow it.
  const mismatched = await mountStandIn(156, { variant: "production", applicationId: labApplication, initial: "/projects" });
  try {
    expect(trouble(mismatched.texts(), mismatched.errors)).toEqual([]);
    expect(mismatched.texts()).toEqual(["Your projects"]);
  } finally { await mismatched.close(); reset(); }
});

test("a launch by a lab link renders the lab at once, without the session, whatever the session's start does", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  const backends: [string, () => Promise<void>][] = [
    ["not answering", neverAnswers],
    ["failing", async () => { throw new TypeError("Network request failed"); }],
    ["up", async () => {}],
  ];
  try {
    launch.__initialURL = "standin:///__dev";
    for (const [index, [backend, start]] of backends.entries()) {
      const app = await labStart(170 + index, { start });
      try {
        // The lab's first screen is the only one rendered: the sign-in (the router's first screen) needs the session and never is, and none was started.
        expect([backend, app.texts()]).toEqual([backend, ["Lab home"]]);
        expect([backend, pathsOf(app.router)]).toEqual([backend, ["/__dev"]]);
        expect([backend, app.starts()]).toEqual([backend, 0]);
        expect([backend, app.sessions()]).toEqual([backend, 0]);
        expect([backend, app.errors, app.warnings]).toEqual([backend, [], []]);
        expect([backend, (globalThis as { __initialURLReads?: number }).__initialURLReads]).toEqual([backend, 1]); // the host is asked for the link once, by the lab start and the <Router> together
        expect([backend, app.router.screens.map((screen) => screen.canGoBack)]).toEqual([backend, [false]]); // the launch link is the base of the stack
        expect(app.hardwareBack()).toBe(false);
      } finally { await app.close(); reset(); }
    }
  } finally { delete launch.__initialURL; reset(); }
});

test("without a lab link the lab app starts as any app does: the session first", async () => {
  withInsets(24);
  const hung = await labStart(173, { start: neverAnswers });
  try {
    expect(hung.starts()).toBe(1);
    expect(hung.texts()).toEqual([]); // the spinner
    expect(hung.sessions()).toBe(0);
  } finally { await hung.close(); reset(); }
  // A start that fails shows its message in place of the spinner, and no session was opened.
  const failed = await labStart(172, { start: async () => { throw new Error("The backend is down."); } });
  try {
    expect(failed.starts()).toBe(1);
    expect(failed.texts()).toEqual(["The backend is down."]);
    expect(failed.sessions()).toBe(0);
  } finally { await failed.close(); reset(); }
  // A link to an app screen is no lab launch either: the session is opened and the router is where the link says.
  const launch = globalThis as { __initialURL?: string };
  launch.__initialURL = "standin:///projects";
  try {
    const linked = await labStart(174);
    try {
      for (let turn = 0; turn < 4; turn++) await linked.settled();
      expect(linked.starts()).toBe(1);
      expect(linked.texts()).toContain("Your projects"); // (the sign-in the gate left is still going out, with the clock stopped)
      expect(pathsOf(linked.router)).toEqual(["/projects"]);
    } finally { await linked.close(); reset(); }
  } finally { delete launch.__initialURL; }
});

test("a restart that restored the lab's screens starts the lab on its own although no link came with it; one that restored the sign-in under it does not", async () => {
  withInsets(24);
  const saved = (...hrefs: string[]) => JSON.stringify({ stack: { entries: hrefs.map((href) => ({ href, presentation: "push" })) } });
  const restored = await labStart(178, { start: neverAnswers, navigation: saved("/__dev") });
  try {
    expect(restored.texts()).toEqual(["Lab home"]);
    expect(pathsOf(restored.router)).toEqual(["/__dev"]);
    expect(restored.starts()).toBe(0);
    expect(restored.sessions()).toBe(0);
    expect(restored.errors).toEqual([]);
  } finally { await restored.close(); reset(); }
  // The visitor went from the sign-in to the lab: the sign-in is on the stack under it, and needs the session, so the app starts it.
  const below = await labStart(179, { start: neverAnswers, navigation: saved("/sign-in", "/__dev") });
  try {
    expect(below.starts()).toBe(1);
    expect(below.sessions()).toBe(0);
    expect(below.texts()).toEqual([]);
  } finally { await below.close(); reset(); }
});

test("a lab start by a deep link ends where the same link opened on the running lab ends: the same screen, a base with no back arrow, nothing leaving", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  const ends = (app: { router: TreeRouter }) => ({ paths: pathsOf(app.router), arrows: app.router.screens.map((screen) => screen.canGoBack), leaving: app.router.screens.map((screen) => screen.leaving) });
  const links: [string, string][] = [["standin-lab:///__dev/screens?mode=sheet", "/__dev/screens?mode=sheet"], ["standin-lab://__dev/screen", "/__dev/screen"]];
  try {
    for (const [index, [link, path]] of links.entries()) {
      launch.__initialURL = link;
      const cold = await labStart(184 + index * 2);
      const coldEnds = ends(cold);
      await cold.close();
      launch.__initialURL = "standin-lab:///__dev";
      const warm = await labStart(185 + index * 2);
      sendLink(link);
      await warm.settled();
      const warmEnds = ends(warm);
      await warm.close();
      expect([link, coldEnds]).toEqual([link, { paths: [path], arrows: [false], leaving: [false] }]); // the launch link is the base of the stack
      // The warm link is a plain goto: it stacks on the lab. The screen on top is the cold start's.
      expect([link, warmEnds.paths]).toEqual([link, ["/__dev", path]]);
    }
  } finally { delete launch.__initialURL; reset(); }
});

test("a link to an app screen opened into a lab start starts the session and shows that screen; the lab never waited for it", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  launch.__initialURL = "standin-lab:///__dev";
  const app = await labStart(182);
  const turns = async () => { for (let turn = 0; turn < 3; turn++) await app.settled(); };
  try {
    expect(app.texts()).toEqual(["Lab home"]);
    expect(app.starts()).toBe(0);
    sendLink("standin:///projects");
    await turns();
    expect(app.starts()).toBe(1);
    expect(app.sessions()).toBe(1);
    expect(app.texts()).toEqual(["Lab home", "Your projects"]); // the lab's screen stays mounted under the pushed one
    expect(app.errors).toEqual([]);
    expect(trouble(app.texts(), app.errors)).toEqual([]);
    expect(pathsOf(app.router)).toEqual(["/__dev", "/projects"]); // a later link is a plain goto: the screen stacks on the lab
    // The router listens for links again (its <Router> mounted anew inside the session): a lab link opens the lab's screen on top.
    expect(handlersOf("__linkHandlers")).toHaveLength(1);
    sendLink("standin-lab:///__dev/screens");
    await turns();
    expect(pathsOf(app.router)).toEqual(["/__dev", "/projects", "/__dev/screens"]);
    expect(app.starts()).toBe(1);
  } finally { await app.close(); delete launch.__initialURL; reset(); }
});

test("a lab start that goes on to an app screen waits for the session with the spinner, and the lab alone never starts one", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  launch.__initialURL = "standin-lab:///__dev";
  const app = await labStart(183, { start: neverAnswers });
  const turns = async () => { for (let turn = 0; turn < 3; turn++) await app.settled(); };
  try {
    expect(app.texts()).toEqual(["Lab home"]);
    app.router.goto("/__dev/screens");
    await turns();
    expect(app.starts()).toBe(0); // the lab's own screens ask for nothing
    app.router.goto("/projects");
    await turns();
    expect(app.starts()).toBe(1);
    expect(app.texts()).toEqual([]); // the spinner: the screen needs the session, which is not there yet
    expect(app.sessions()).toBe(0);
  } finally { await app.close(); delete launch.__initialURL; reset(); }
});

test("the lab stub fails an unguarded read of a binding, a call and a component, and nothing that stays behind the flag", async () => {
  withInsets(24);
  // Each is one way the shared code can use the lab's directories without the flag; a store build's Metro answers every one with the stub's error.
  const unguarded = ["read", "call", "component"];
  try {
    for (const [index, mode] of unguarded.entries()) {
      const app = await standInApp("production", storeApplication);
      try { await expect(mountTree(160 + index, { mode }, "lab-stub-probe.svelte", app)).rejects.toThrow("src/lib/lab/ is not in this app (APP_VARIANT=production)"); }
      finally { await app.clean(); reset(); }
    }
    const app = await standInApp("production", storeApplication);
    try {
      const behind = await mountTree(163, { mode: "off" }, "lab-stub-probe.svelte", app);
      expect(behind.texts()).toEqual(["behind the flag"]);
    } finally { await app.clean(); reset(); }
  } finally { reset(); }
});

test("which bindings an importer reads from a module, for the stub that has to throw on them", () => {
  const from = "#lib/lab/faults.ts";
  const read = (source: string) => importedNames(source, from);
  expect(read(`import { installErrorCounter, lateFault as fault, type Shape, lateFaultMessage } from "${from}";`)).toEqual(["installErrorCounter", "lateFault", "lateFaultMessage"]);
  expect(read(`import {\n  a, // why\n  /* b */ c,\n} from '${from}'\nimport { z } from "./other.ts"`)).toEqual(["a", "c"]);
  expect(read(`import type { Shape } from "${from}"; import Thing from "${from}"; import * as all from "${from}"; import "${from}";`)).toEqual([]);
  expect(read(`import Thing, { b } from "${from}"; export { c } from "${from}";`)).toEqual(["b", "c"]);
  expect(read(`const later = import("${from}");`)).toEqual([]);
  expect(read(`import { a } from "${from}.other";`)).toEqual([]);
  expect(() => read(`import { a b } from "${from}";`)).toThrow("cannot read the binding");
});
