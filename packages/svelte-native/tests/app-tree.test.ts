import { test, expect, jest } from "bun:test";
import { build, transform, type Loader, type Plugin } from "esbuild";
import { readFile, mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { parseNativeID } from "../src/fabric/navigation.ts";
import { routeFiles, syncNative } from "../src/build.ts";
import { stubCoreSource, stubSource } from "../src/metro.ts";
import { buildTree, resolve as resolveHref, type PageRoute, type RouteNode } from "../src/route-tree.ts";
import { enforceSession, type GuardedAccount } from "../../../apps/platform/src/lib/native/session-guard.ts";

/**
 * The platform app's own route tree: the files under apps/platform/src/routes, built by the generator's reader, linked to the
 * test components of the fixtures (a tabs bar, a stack, a page that registers its router). It pins the shape the app was
 * migrated to and drives the navigation the product screens do. The pages themselves need Expo and the account, so they are
 * not mounted here.
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
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { get OS() { return globalThis.__navigationOS ?? 'android'; }, Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "const handlers = (globalThis.__backHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; } };",
  "react-native/Libraries/Linking/Linking": "const handlers = (globalThis.__linkHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; }, getInitialURL: () => { globalThis.__initialURLReads = (globalThis.__initialURLReads ?? 0) + 1; return Promise.resolve(globalThis.__initialURL ?? null); } };",
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

const appRoutes = resolve(import.meta.dirname, "../../../apps/platform/src/routes");
const appFiles = () => routeFiles(appRoutes, { lab: true });
/** The product's route files (`APP_VARIANT=production`): discovery leaves the lab out. */
const productFiles = () => routeFiles(appRoutes, { lab: false });
const outline = (route: PageRoute | RouteNode, depth = 0): string[] => {
  const pad = "  ".repeat(depth);
  if (route.kind === "page") return [`${pad}page ${route.path}${route.presentation === "push" ? "" : ` (${route.presentation})`}`];
  if (route.kind === "stack") return [`${pad}stack ${route.path}`, ...route.routes.flatMap((child) => outline(child, depth + 1))];
  return [`${pad}tabs ${route.path} [${route.panes.map((pane) => pane.key).join(", ")}]`, ...route.panes.flatMap((pane) => [`${pad}  pane ${pane.key}`, ...outline(pane.stack, depth + 2)])];
};

test("the app's tree: the root stack's pages and presentations, the workspace as a tabs node with a home pane and a settings pane, the account modal at the root", async () => {
  const tree = buildTree(await appFiles());
  expect(tree.shellFile).toBe("+layout.mobile.svelte"); // the app shell wraps the root navigator
  // The lab (/__dev) is a development surface of its own, pinned by the QA matrix; the product is the rest.
  const product = tree.routes.filter((route) => !route.path.startsWith("/__dev"));
  expect(product.flatMap((route) => outline(route))).toEqual([
    "page /auth/login",
    "page /onboarding/profile",
    "page /workspaces/create",
    "page /account (modal)",
    "page /workspaces",
    "tabs /[slug] [home, settings]",
    "  pane home",
    "    stack /[slug]/home",
    "      page /[slug]/home",
    "  pane settings",
    "    stack /[slug]/settings",
    "      page /[slug]/settings/[section]",
    "      page /[slug]/settings",
  ]);
  const workspace = tree.routes.find((route) => route.kind === "tabs" && route.path === "/[slug]");
  expect(workspace?.kind === "tabs" && workspace.layoutFile).toBe("(workspace)/[slug]/+layout.mobile.svelte");
  expect(outline(tree).filter((line) => line.trim().startsWith("tabs")).map((line) => line.trim())).toEqual(["tabs /__dev/tree [home, inbox]", "tabs /[slug] [home, settings]"]);
  // Only the account is a modal, and it is a page of the root stack (one indent): it covers the workspace's tab bar.
  expect(outline(tree).filter((line) => /\((modal|transparentModal|formSheet)\)/.test(line))).toEqual(["  page /account (modal)"]);
  expect(outline(tree).filter((line) => line.includes("(sheet)")).map((line) => line.trim())).toEqual(["page /__dev/tree/inbox/compose (sheet)"]); // the lab's sheet, in the lab's pane
  // The old settings modal is gone: no page of the app's tree is the web's settings/[[section]].
  expect(tree.routes.some((route) => route.kind === "page" && route.path.includes("[[section]]"))).toBe(false);
  // A root-level path never lands in the workspace: /workspaces and /account are pages of the root stack.
  expect(resolveHref(tree, "/workspaces")?.chain.map((step) => step.node.id)).toEqual([""]);
  expect(resolveHref(tree, "/account")?.chain.map((step) => step.node.id)).toEqual([""]);
  expect(resolveHref(tree, "/acme")?.page.path).toBe("/[slug]/home");
  expect(resolveHref(tree, "/acme/settings")?.chain.map((step) => `${step.node.id || "root"}${step.select ? `:${step.select}` : ""}`)).toEqual(["root", "(workspace)/[slug]:settings", "(workspace)/[slug]/settings"]);
  expect(resolveHref(tree, "/acme/settings/devices")?.params).toEqual({ slug: "acme", section: "devices" });
});

const workspaceTabs = [{ key: "home", title: "Home" }, { key: "settings", title: "Settings" }];
const mountApp = async (surface: number, initial: string) => mountTree(surface, { initial, files: await appFiles(), tabs: workspaceTabs });

// What each shown header says of its back arrow, by title (the stub pages title themselves with their path).
const backFlags = (nodes: FakeNode[]) => Object.fromEntries(ofKind(nodes, "header").map((node) => {
  const pairs = parseNativeID(String(node.props.nativeID))?.pairs ?? {};
  return [decodeURIComponent(String(pairs.t)), pairs.bk === "1"];
}));
const arrows = (router: TreeRouter) => router.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);

test("login, the workspaces, a workspace's home pane, Workspace settings selects the settings tab, the account is a modal over the tabs", async () => {
  withInsets(24);
  try {
    const { router, settled, hardwareBack, tree } = await mountApp(120, "/auth/login");
    expect(pathsOf(router)).toEqual(["/auth/login"]);
    router.goto("/workspaces", { reset: true }); // what the session guard does for a signed-in user
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces"]);

    // The list opens a workspace: reset is a new root, so the tabs screen is the root's only entry (and its base).
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

    // "Manage workspace" is goto(`/${slug}/settings`) from the home pane: it selects the settings tab, nothing is pushed on the root.
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

    // The account is a root page presented as a modal over the tabs, from either pane.
    paneRouter("/acme/settings").goto("/account");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme", "/account"]);
    expect(router.entries[1].presentation).toBe("modal");
    expect(router.current.url.pathname).toBe("/account");
    expect(ofKind(tree(), "screen").map((screen) => parseNativeID(String(screen.props.nativeID))?.pairs.p).filter((value) => value === "modal")).toHaveLength(1);
    expect(treeGlobals.__treeTabsRouter?.selected).toBe("settings"); // the tabs are still there under the modal
    expect(backFlags(tree())["/account"]).toBe(false); // a modal gets no arrow: its page's Close button is the way out

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

test("Workspace settings from Home, twice, and with a section open, leaves the settings pane at its base", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountApp(127, "/acme/home");
    paneRouter("/acme/home").goto("/acme/settings"); // the Manage workspace button
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

    // Opened from the list with a reset (what the list and the creation of a workspace do): nothing is left below the workspace.
    const opened = await mountApp(122, "/workspaces");
    opened.router.goto("/acme/settings", { reset: true });
    await opened.settled();
    expect(pathsOf(opened.router)).toEqual(["/acme"]);
    expect(selectedIndex(122)).toBe("1");
    expect(opened.hardwareBack()).toBe(false);
    expect(selectedIndex(122)).toBe("1");

    // Pushed over the list (a link while the list is shown): the key pops the workspace, still without switching tabs on the way.
    const below = await mountApp(123, "/workspaces");
    below.router.goto("/acme/settings");
    await below.settled();
    expect(pathsOf(below.router)).toEqual(["/workspaces", "/acme"]);
    expect(selectedIndex(123)).toBe("1");
    below.router.goto("/acme/home");
    await below.settled();
    expect(selectedIndex(123)).toBe("0"); // navigating selects; only that does
    below.router.goto("/acme/settings");
    await below.settled();
    expect(below.hardwareBack()).toBe(true);
    await below.settled();
    expect(pathsOf(below.router)).toEqual(["/workspaces"]);
  } finally { reset(); }
});

const signedIn = (patch: Partial<GuardedAccount> = {}): GuardedAccount => ({ user: { id: "u1" }, needsProfile: false, workspaces: [{ slug: "acme" }], ...patch });
const guard = (router: TreeRouter, account: GuardedAccount, lab = false) => enforceSession(account, router as unknown as Parameters<typeof enforceSession>[1], lab);

test("the session guard on the app's tree: login, onboarding and workspaces by the shown path, the lab only in lab builds", async () => {
  withInsets(24);
  try {
    // Signed out: everything but the login goes to it, from a workspace and from a modal over one.
    const out = await mountApp(124, "/acme/home");
    expect(out.router.current.url.pathname).toBe("/acme/home");
    guard(out.router, signedIn({ user: null }));
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/auth/login"]);
    guard(out.router, signedIn({ user: null })); // nothing to do on the login
    expect(pathsOf(out.router)).toEqual(["/auth/login"]);

    // A user without a profile is held on the onboarding, and may open the account modal from there.
    guard(out.router, signedIn({ needsProfile: true }));
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/onboarding/profile"]);
    out.router.goto("/account");
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/onboarding/profile", "/account"]);
    guard(out.router, signedIn({ needsProfile: true }));
    expect(pathsOf(out.router)).toEqual(["/onboarding/profile", "/account"]);

    // A profile that is done leaves the onboarding and the login for the workspaces.
    out.router.back();
    await out.settled();
    guard(out.router, signedIn());
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/workspaces"]);
    out.router.goto("/auth/login");
    await out.settled();
    guard(out.router, signedIn());
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/workspaces"]);

    // The lab is a lab build's: elsewhere a signed-in user goes to the workspaces, nobody to the login.
    out.router.goto("/__dev/tree/inbox");
    await out.settled();
    expect(out.router.current.url.pathname).toBe("/__dev/tree/inbox");
    guard(out.router, signedIn(), true);
    expect(out.router.current.url.pathname).toBe("/__dev/tree/inbox");
    guard(out.router, signedIn(), false);
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/workspaces"]);
    out.router.goto("/__dev");
    await out.settled();
    guard(out.router, signedIn({ user: null }), false);
    await out.settled();
    expect(pathsOf(out.router)).toEqual(["/auth/login"]);
  } finally { reset(); }
});

test("the session guard sends the user to the workspaces when their workspace is no longer theirs; the account modal above it stays", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountApp(125, "/workspaces");
    router.goto("/acme", { reset: true });
    await settled();
    expect(pathsOf(router)).toEqual(["/acme"]);
    expect(router.entries[0].params.slug).toBe("acme"); // the workspace is the root's base
    guard(router, signedIn());
    expect(pathsOf(router)).toEqual(["/acme"]); // still theirs: nothing happens
    guard(router, signedIn({ workspaces: [{ slug: "other" }] }));
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces"]);

    // The account modal that deleted the workspace stays up: the list replaces the workspace under it.
    router.goto("/acme", { reset: true });
    router.goto("/account");
    await settled();
    expect(pathsOf(router)).toEqual(["/acme", "/account"]);
    const modal = router.entries[1];
    guard(router, signedIn({ workspaces: [] }));
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/account"]);
    expect(router.entries[1]).toBe(modal);
    expect(router.current.url.pathname).toBe("/account");
    router.back(); // the modal's Close
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces"]);

    // A workspace pushed over the list (a link) is dealt with when it is the shown one.
    router.goto("/acme");
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    guard(router, signedIn());
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    guard(router, signedIn({ workspaces: [] }));
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces"]);
  } finally { reset(); }
});

test("replaceBase on the root router replaces the first screen with a root page and keeps the screens above it", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountApp(126, "/workspaces");
    router.goto("/acme", { reset: true });
    router.goto("/account");
    await settled();
    const [tabs, modal] = router.entries;
    router.replaceBase("/workspaces"); // the workspace under the modal goes, the modal stays
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/account"]);
    expect(router.entries[0]).not.toBe(tabs);
    expect(router.entries[1]).toBe(modal);
    expect(arrows(router)).toEqual([false, true]);
    expect(() => router.replaceBase("/acme")).toThrow(); // the workspace is a navigator's screen, not a page of the root stack
  } finally { reset(); }
});

const labPaths = (route: PageRoute | RouteNode): string[] => [
  route.path, ...(route.kind === "page" ? [] : route.kind === "stack" ? route.routes.flatMap(labPaths) : route.panes.flatMap((pane) => labPaths(pane.stack))),
];

test("the product's tree is the app's tree without the lab: no /__dev route, the same screens otherwise", async () => {
  const files = await productFiles();
  expect(files.filter((file) => file.path.includes("__dev"))).toEqual([]);
  const product = buildTree(files);
  expect(labPaths(product).filter((path) => path.includes("__dev"))).toEqual([]);
  // The lab's tree is the product's plus the /__dev routes.
  const full = buildTree(await appFiles());
  expect(labPaths(full).filter((path) => path.includes("__dev")).length).toBeGreaterThan(8);
  expect(full.routes.filter((route) => !route.path.startsWith("/__dev")).flatMap((route) => outline(route))).toEqual(product.routes.flatMap((route) => outline(route)));
  expect(product.shellFile).toBe(full.shellFile);
  expect(outline(product).filter((line) => line.trim().startsWith("tabs")).map((line) => line.trim())).toEqual(["tabs /[slug] [home, settings]"]);
  // The lab's own pages are not found; /__dev alone reads as a workspace slug (a single segment names a workspace), which the session guard sends back.
  for (const href of ["/__dev/screen", "/__dev/screens", "/__dev/tree/inbox", "/__dev/foreign", "/__dev/smoke", "/__dev/gestures"]) expect([href, resolveHref(product, href)]).toEqual([href, null]);
  expect(resolveHref(product, "/__dev")?.params).toEqual({ slug: "__dev" });
  expect(resolveHref(full, "/__dev")?.page.path).toBe("/__dev");
});

test("in the product a deep link to the lab ends where an unknown workspace does: the workspaces for a user, the login for nobody", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  try {
    const mountProduct = async (surface: number, initial: string) => mountTree(surface, { initial, files: await productFiles(), tabs: workspaceTabs });
    // A link while the app runs (`rasheed://__dev`): the lab's pages are not in the tree, so the screens of the lab are ignored,
    const running = await mountProduct(140, "/workspaces");
    for (const link of ["rasheed://__dev/screens", "rasheed://__dev/tree/inbox", "rasheed://__dev/smoke", "rasheed-svelte://__dev/foreign"]) expect([link, running.router.openURL(link)]).toEqual([link, false]);
    expect(pathsOf(running.router)).toEqual(["/workspaces"]);
    // and the bare /__dev is a workspace that is not the user's, which the guard (a lab branch for a build without a lab) turns into the list.
    expect(running.router.openURL("rasheed://__dev")).toBe(true);
    await running.settled();
    expect(pathsOf(running.router)).toEqual(["/workspaces", "/__dev"]);
    guard(running.router, signedIn(), false);
    await running.settled();
    expect(pathsOf(running.router)).toEqual(["/workspaces"]);

    // The link the app was launched with (the QA matrix opens the lab this way): the same end for a signed-in user, the login for nobody.
    launch.__initialURL = "rasheed://__dev";
    const user = await mountProduct(141, "/auth/login");
    await user.settled();
    expect(pathsOf(user.router)).toEqual(["/__dev"]); // opened with reset: the base of the root stack
    expect(user.router.current.url.pathname).toBe("/__dev/home");
    guard(user.router, signedIn(), false);
    await user.settled();
    expect(pathsOf(user.router)).toEqual(["/workspaces"]);
    const nobody = await mountProduct(142, "/auth/login");
    await nobody.settled();
    expect(pathsOf(nobody.router)).toEqual(["/__dev"]);
    guard(nobody.router, signedIn({ user: null }), false);
    await nobody.settled();
    expect(pathsOf(nobody.router)).toEqual(["/auth/login"]);

    // A lab link of a build that has the lab opens the lab (the contrast).
    launch.__initialURL = "rasheed-svelte://__dev/screens";
    const lab = await mountTree(143, { initial: "/auth/login", files: await appFiles(), tabs: workspaceTabs });
    await lab.settled();
    expect(pathsOf(lab.router)).toEqual(["/__dev/screens"]);
    guard(lab.router, signedIn(), true);
    expect(pathsOf(lab.router)).toEqual(["/__dev/screens"]);
  } finally { delete launch.__initialURL; reset(); }
});

// The shared app with the lab off.
//
// The product's Metro resolves everything in the lab's directories to a stub that throws when it is used, and the shared code (the root layout,
// the session, three screens) may call the lab only behind `nativeLabEnabled`. This mounts the platform app's real root layout, session and
// pages the way the product runs them: the route table the Metro integration generates for the variant, the lab's directories replaced by the
// real stub (the file `stubSource` writes, over `stubCoreSource`: a Proxy that throws on any property read and on a call), the account and the
// Expo modules faked. A lab call that is not behind the flag then fails the test instead of a phone.
//
// The stub throws on a READ of a binding as much as on a call, because Metro's transform reads a named import where it is used
// (`_probe.lateFault`, a property read on the stub), while esbuild copies the exports of a CommonJS module into a namespace object when it
// is imported, and the stub has none to copy (`ownKeys` is empty): `lateFault === "mount"` was `undefined === "mount"` here, and a read of a
// lab binding that was not behind the flag passed this test and crashed the product's root layout. So each import of a stubbed directory
// goes through a module that names the bindings the importer imports from it (`ownKeys`), and esbuild's copy then reads them through the
// stub's `get` when they are used, which throws.
const platformRoot = resolve(import.meta.dirname, "../../../apps/platform");
const packageRoot = resolve(import.meta.dirname, "..");
const labDirectories = [`${resolve(platformRoot, "src/lib/native/dev")}/`, `${resolve(platformRoot, "src/routes/__dev")}/`];

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

async function platformApp(variant: string, applicationId: string | null): Promise<{ plugins: Plugin[]; loader: Record<string, Loader>; define: Record<string, string>; clean: () => Promise<void> }> {
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-platform-app-"));
  // A project whose `src` is the platform app's, so the generated table requires the real pages.
  await symlink(resolve(platformRoot, "src"), resolve(directory, "src"));
  await syncNative(directory, { variant });
  const table = resolve(directory, ".svelte-native", `routes.${variant}.ts`);
  await mkdir(resolve(directory, "stubs"), { recursive: true });
  await writeFile(resolve(directory, "stubs/_core.js"), stubCoreSource);
  // One stub per stubbed directory, as `withSvelteNative` writes them: its name is the directory relative to the project, and the stub reads
  // `./_core.js` next to it.
  const stubFiles = new Map<string, string>();
  for (const lab of labDirectories) {
    const name = `${relative(platformRoot, lab)}/`.replaceAll("\\", "/");
    const file = resolve(directory, "stubs", `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`);
    await writeFile(file, stubSource(name, variant));
    stubFiles.set(lab, file);
  }
  const expo: Record<string, string> = {
    "expo-font": "export const loadAsync = async () => {};",
    "expo-secure-store": "const store = new Map(); export const getItem = (key) => store.get(key) ?? null; export const setItem = (key, value) => { store.set(key, value); }; export const deleteItemAsync = async (key) => { store.delete(key); };",
    "expo-localization": "export const getLocales = () => [{ languageCode: 'en' }];",
    "expo-application": `export const applicationId = ${JSON.stringify(applicationId)}; export const nativeApplicationVersion = '1';`,
    "expo-status-bar": "export const setStatusBarStyle = () => {};",
    "expo-crypto": "export const randomUUID = () => 'uuid';",
    "expo-file-system": "export class File { constructor(...parts) { this.uri = parts.join('/'); } } export class Directory { constructor(...parts) { this.uri = parts.join('/'); } } export const Paths = { cache: 'cache', document: 'document' };",
    "expo/fetch": "export const fetch = (...args) => globalThis.fetch(...args);",
    "expo-image-picker": "export const launchImageLibraryAsync = async () => ({ canceled: true, assets: null });",
    "react-native/Libraries/Utilities/Appearance": "export const getColorScheme = () => 'light'; export const addChangeListener = () => ({ remove() {} });",
  };
  const plugin: Plugin = {
    name: "platform-app",
    setup(builder) {
      const resolving = { platformApp: true };
      // Everything of the app's that imports `svelte` gets the package's (the renderer's), as Metro does.
      builder.onResolve({ filter: /^svelte(\/|$)/ }, async (args) => (args.pluginData?.platformApp || args.importer.startsWith(packageRoot) ? undefined : builder.resolve(args.path, { resolveDir: packageRoot, kind: args.kind, pluginData: resolving })));
      builder.onResolve({ filter: /^@rasheed\/svelte-native\/routes$/ }, () => ({ path: table }));
      builder.onResolve({ filter: new RegExp(`^(${Object.keys(expo).join("|")})$`) }, (args) => ({ path: args.path, namespace: "platform-expo" }));
      builder.onLoad({ filter: /.*/, namespace: "platform-expo" }, (args) => ({ contents: expo[args.path], loader: "js" }));
      // The stub of the product, byte for byte, behind a Proxy that lists the bindings this importer names, so that esbuild's namespace copy
      // reads each one through the stub's `get` (which throws) where it is used, as Metro's `_stub.name` does. Everything else is the stub's:
      // a read of any other property, a call and a construction throw, `has` and `getOwnPropertyDescriptor` answer nothing.
      builder.onLoad({ filter: /.*/, namespace: "lab-stub" }, (args) => {
        const { stub, names } = args.pluginData as { stub: string; names: string[] };
        return { contents: `const stub = require(${JSON.stringify(stub)});\nmodule.exports = new Proxy(stub, { ownKeys: () => ${JSON.stringify(names)} });\n`, resolveDir: directory, loader: "js" };
      });
      builder.onResolve({ filter: /^[.#]/ }, async (args) => {
        if (args.pluginData?.platformApp) return undefined;
        const found = await builder.resolve(args.path, { resolveDir: args.resolveDir, importer: args.importer, kind: args.kind, namespace: args.namespace, pluginData: resolving });
        if (found.errors.length > 0) return undefined;
        const lab = labDirectories.find((candidate) => found.path.startsWith(candidate));
        if (lab !== undefined) {
          const names = importedNames(await readFile(args.importer, "utf8"), args.path, args.importer);
          return { path: `${args.importer} > ${args.path}`, namespace: "lab-stub", pluginData: { stub: stubFiles.get(lab), names } };
        }
        if (found.path === resolve(platformRoot, "src/lib/native/session.svelte.ts")) return { path: resolve(import.meta.dirname, "lab-off-session.svelte.ts") };
        return undefined;
      });
    },
  };
  return { plugins: [plugin], loader: { ".ttf": "empty" }, define: { __DEV__: "false" }, clean: () => rm(directory, { recursive: true, force: true }) };
}

const labOff = globalThis as { __labOffRouter?: TreeRouter; __labOffUser?: null; fetch: typeof fetch };
async function mountPlatform(surface: number, options: { variant: string; applicationId: string | null; initial: string; signedIn?: boolean }) {
  const app = await platformApp(options.variant, options.applicationId);
  const realFetch = labOff.fetch;
  labOff.fetch = (async () => new Response(JSON.stringify({ uri: "wss://example.test", databaseName: "rasheed" }))) as typeof fetch;
  if (options.signedIn === false) labOff.__labOffUser = null; else delete labOff.__labOffUser;
  const errors: string[] = [];
  const logged = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    const mounted = await mountTree(surface, { initial: options.initial }, "lab-off-fixture.svelte", app);
    await mounted.settled();
    await mounted.settled();
    return { ...mounted, errors, router: labOff.__labOffRouter as TreeRouter, close: () => { console.error = logged; labOff.fetch = realFetch; delete labOff.__labOffUser; return app.clean(); } };
  } catch (error) {
    console.error = logged;
    labOff.fetch = realFetch;
    delete labOff.__labOffUser;
    await app.clean();
    throw error;
  }
}
/** What went wrong in an app that should be fine: a stub that threw, a call to a lab export that is not there, the shell's failure page. */
const trouble = (texts: string[], errors: string[]) => [...texts, ...errors].filter((line) => /not in this app|is not a function|is not a constructor|went wrong|\[native startup\]/i.test(line));

test("the shared app with the lab off: the root layout, the session and the screens that offer the lab run without calling it", async () => {
  withInsets(24);
  const launch = globalThis as { __initialURL?: string };
  const checks: [number, string, string, boolean | undefined, string[]][] = [
    [150, "/workspaces", "io.rasheed.app", true, ["Sign out"]],
    [151, "/acme/home", "io.rasheed.app", true, ["Sign out"]],
    [152, "/auth/login", "io.rasheed.app", false, ["Continue with email"]],
  ];
  try {
    for (const [surface, initial, applicationId, signedIn, expected] of checks) {
      const app = await mountPlatform(surface, { variant: "production", applicationId, initial, signedIn });
      try {
        const shown = app.texts();
        expect([initial, trouble(shown, app.errors)]).toEqual([initial, []]);
        for (const text of expected) expect([initial, text, shown.some((line) => line.includes(text))]).toEqual([initial, text, true]);
        expect(shown.filter((line) => /development lab/i.test(line))).toEqual([]);
        expect(app.router.current.url.pathname.startsWith("/__dev")).toBe(false);
      } finally { await app.close(); reset(); }
    }
    // The launch link of the lab reaches a product with no lab as it reaches any workspace that is not the user's: the list, and no call into the lab.
    launch.__initialURL = "rasheed://__dev";
    const linked = await mountPlatform(153, { variant: "production", applicationId: "io.rasheed.app", initial: "/auth/login" });
    try {
      for (let turn = 0; turn < 4; turn++) await linked.settled();
      expect(trouble(linked.texts(), linked.errors)).toEqual([]);
      expect(pathsOf(linked.router)).toEqual(["/workspaces"]);
    } finally { await linked.close(); reset(); }
  } finally { delete launch.__initialURL; reset(); }
});

test("the same harness sees a lab call that is not behind the flag: with the flag on and the lab stubbed, the call fails the app", async () => {
  withInsets(24);
  // The QA app's table (it has the lab) but the product's stubs: every lab call is a call into a stub, which is what an unguarded call in the product is.
  try {
    await expect(mountPlatform(154, { variant: "qa", applicationId: "io.rasheed.svelteqa", initial: "/workspaces" })).rejects.toThrow(/installErrorCounter|not in this app/);
  } finally { reset(); }
  // And a bundle that has the lab in a product shell: the shell refuses it, says so, and calls nothing.
  const refused = await mountPlatform(155, { variant: "qa", applicationId: "io.rasheed.app", initial: "/workspaces" });
  try {
    expect(trouble(refused.texts(), refused.errors.filter((line) => !line.includes("[Svelte lab]")))).toEqual([]);
    expect(refused.errors.filter((line) => line.includes("[Svelte lab]"))).toEqual(["[Svelte lab] this qa bundle carries the development lab, which the io.rasheed.app app does not run (publish with APP_VARIANT=production): the lab is off"]);
    expect(refused.texts().some((line) => line.includes("Sign out"))).toBe(true);
    expect(refused.texts().filter((line) => /development lab/i.test(line))).toEqual([]);
  } finally { await refused.close(); reset(); }
  // A QA dev client (the QA app id) with a product-variant Metro: the bundle has no lab, so none of it runs although the id would allow it.
  const mismatched = await mountPlatform(156, { variant: "production", applicationId: "io.rasheed.svelteqa", initial: "/workspaces" });
  try {
    expect(trouble(mismatched.texts(), mismatched.errors)).toEqual([]);
    expect(mismatched.texts().some((line) => line.includes("Sign out"))).toBe(true);
  } finally { await mismatched.close(); reset(); }
});

test("the product's lab stub fails an unguarded read of a binding, a call and a component, and nothing that stays behind the flag", async () => {
  withInsets(24);
  // Each is one way the shared code can use the lab's directories without the flag; the product's Metro answers every one with the stub's error.
  const unguarded = ["read", "call", "component"];
  try {
    for (const [index, mode] of unguarded.entries()) {
      const app = await platformApp("production", "io.rasheed.app");
      try { await expect(mountTree(160 + index, { mode }, "lab-stub-probe.svelte", app)).rejects.toThrow("src/lib/native/dev/ is not in this app (APP_VARIANT=production)"); }
      finally { await app.clean(); reset(); }
    }
    const app = await platformApp("production", "io.rasheed.app");
    try {
      const behind = await mountTree(163, { mode: "off" }, "lab-stub-probe.svelte", app);
      expect(behind.texts()).toEqual(["behind the flag"]);
    } finally { await app.clean(); reset(); }
  } finally { reset(); }
});

test("which bindings an importer reads from a module, for the stub that has to throw on them", () => {
  const from = "#lib/native/dev/update-probe.ts";
  const read = (source: string) => importedNames(source, from);
  expect(read(`import { logUpdateReport, lateFault as fault, type Shape, lateFaultMessage } from "${from}";`)).toEqual(["logUpdateReport", "lateFault", "lateFaultMessage"]);
  expect(read(`import {\n  a, // why\n  /* b */ c,\n} from '${from}'\nimport { z } from "./other.ts"`)).toEqual(["a", "c"]);
  expect(read(`import type { Shape } from "${from}"; import Thing from "${from}"; import * as all from "${from}"; import "${from}";`)).toEqual([]);
  expect(read(`import Thing, { b } from "${from}"; export { c } from "${from}";`)).toEqual(["b", "c"]);
  expect(read(`const later = import("${from}");`)).toEqual([]);
  expect(read(`import { a } from "${from}.other";`)).toEqual([]);
  expect(() => read(`import { a b } from "${from}";`)).toThrow("cannot read the binding");
});
