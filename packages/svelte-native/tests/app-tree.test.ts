import { test, expect, jest } from "bun:test";
import { build, transform } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { parseNativeID } from "../src/fabric/navigation.ts";
import { routeFiles } from "../src/build.ts";
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
  "react-native/Libraries/Linking/Linking": "const handlers = (globalThis.__linkHandlers ??= []); export default { addEventListener: (name, handler) => { handlers.push(handler); return { remove() { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } }; }, getInitialURL: () => { globalThis.__initialURLReads = (globalThis.__initialURLReads ?? 0) + 1; return Promise.resolve(null); } };",
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
        export { startSurface, flush, fabricStats, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "fabric-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => ({ path: args.path, namespace: "stub" }));
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

const appRoutes = resolve(import.meta.dirname, "../../../apps/platform/src/routes");
const appFiles = () => routeFiles(appRoutes);
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

test("login, the workspaces, a workspace's home pane, Workspace settings selects the settings tab, the account is a modal over the tabs", async () => {
  withInsets(24);
  try {
    const { router, settled, hardwareBack, tree } = await mountApp(120, "/auth/login");
    expect(pathsOf(router)).toEqual(["/auth/login"]);
    router.goto("/workspaces", { reset: true }); // what the session guard does for a signed-in user
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces"]);

    // The picker opens a workspace: `reset` into the tabs resets the pane, not the root, so the picker stays below the workspace.
    router.goto("/acme", { reset: true });
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(router.entries[1].params).toEqual({ slug: "acme" });
    expect(router.current.url.pathname).toBe("/acme/home"); // the deepest shown entry: the home pane's base
    expect(selectedIndex(120)).toBe("0");
    expect(paneRouter("/acme/home").scope).toBe("home");
    expect(treeGlobals.__treePanes).toEqual([{ key: "home" }, { key: "settings" }]);
    expect(ofKind(tree(), "tab").map((pane) => String(parseNativeID(String(pane.props.nativeID))?.pairs.k))).toEqual(["home", "settings"]);

    // "Manage workspace" is goto(`/${slug}/settings`) from the home pane: it selects the settings tab, nothing is pushed on the root.
    paneRouter("/acme/home").goto("/acme/settings");
    await settled();
    expect(selectedIndex(120)).toBe("1");
    expect(treeGlobals.__treeTabsRouter?.selected).toBe("settings");
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(router.current.url.pathname).toBe("/acme/settings");
    expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings"]);

    // A section is a page pushed within the settings pane; the tab bar stays.
    paneRouter("/acme/settings").goto("/acme/settings/devices");
    await settled();
    expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings", "/acme/settings/devices"]);
    expect(paneRouter("/acme/settings/devices").entries[1].params).toEqual({ slug: "acme", section: "devices" });
    expect(router.current.url.pathname).toBe("/acme/settings/devices");
    expect(selectedIndex(120)).toBe("1");

    // The account is a root page presented as a modal over the tabs, from either pane.
    paneRouter("/acme/settings").goto("/account");
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme", "/account"]);
    expect(router.entries[2].presentation).toBe("modal");
    expect(router.current.url.pathname).toBe("/account");
    expect(ofKind(tree(), "screen").map((screen) => parseNativeID(String(screen.props.nativeID))?.pairs.p).filter((value) => value === "modal")).toHaveLength(1);
    expect(treeGlobals.__treeTabsRouter?.selected).toBe("settings"); // the tabs are still there under the modal

    // Back closes the modal first, then pops the section; the selected tab never changes.
    expect(hardwareBack()).toBe(true);
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    expect(router.current.url.pathname).toBe("/acme/settings/devices");
    expect(hardwareBack()).toBe(true);
    await settled();
    expect(pathsOf(paneRouter("/acme/settings"))).toEqual(["/acme/settings"]);
    expect(selectedIndex(120)).toBe("1");
    expect(router.current.url.pathname).toBe("/acme/settings");
  } finally { reset(); }
});

test("back at the base of the settings pane does not switch to the home tab: with the workspace alone on the stack the key leaves the app, with the picker below it pops the workspace", async () => {
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

    const below = await mountApp(122, "/workspaces");
    below.router.goto("/acme/settings");
    await below.settled();
    expect(pathsOf(below.router)).toEqual(["/workspaces", "/acme"]);
    expect(selectedIndex(122)).toBe("1");
    below.router.goto("/acme/home");
    await below.settled();
    expect(selectedIndex(122)).toBe("0"); // navigating selects; only that does
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
    const out = await mountApp(123, "/acme/home");
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

test("the session guard sends the user to the workspaces when the shown workspace is no longer theirs, and a workspace under a modal waits until it is shown again", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountApp(124, "/workspaces");
    router.goto("/acme", { reset: true });
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]);
    // The workspace's tabs are the root's last entry, not its first: the slug is read from there.
    expect(router.entries[0].params.slug).toBeUndefined();
    expect(router.entries.at(-1)?.params.slug).toBe("acme");
    guard(router, signedIn());
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme"]); // still theirs: nothing happens
    guard(router, signedIn({ workspaces: [{ slug: "other" }] }));
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces"]);

    // The account modal that deleted the workspace stays up; the guard acts when the workspace is shown again.
    router.goto("/acme", { reset: true });
    router.goto("/account");
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme", "/account"]);
    const deleted = signedIn({ workspaces: [] });
    guard(router, deleted);
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme", "/account"]);
    router.back(); // the modal's Close
    await settled();
    expect(router.current.url.pathname).toBe("/acme/home");
    guard(router, deleted);
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces"]);
  } finally { reset(); }
});

test("replaceBase on the root router replaces the first screen with a root page and keeps the screens above it", async () => {
  withInsets(24);
  try {
    const { router, settled } = await mountApp(125, "/workspaces");
    router.goto("/acme", { reset: true });
    router.goto("/account");
    await settled();
    const [first, tabs, modal] = router.entries;
    router.replaceBase("/workspaces");
    await settled();
    expect(pathsOf(router)).toEqual(["/workspaces", "/acme", "/account"]);
    expect(router.entries[0]).not.toBe(first); // a new entry for the same page
    expect(router.entries[1]).toBe(tabs);
    expect(router.entries[2]).toBe(modal);
    expect(() => router.replaceBase("/acme")).toThrow(); // the workspace is a navigator's screen, not a page of the root stack
  } finally { reset(); }
});
