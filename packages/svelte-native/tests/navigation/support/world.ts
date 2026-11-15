import { afterEach, jest } from "bun:test";
import { resolve } from "node:path";
import { parseNativeID } from "../../../src/fabric/navigation.ts";
import { fakeHost } from "../../support/fake-host.ts";
import { type FakeNode, flatten, settle } from "../../support/host.ts";
import { type RouterBundleOptions, loadRouterApp } from "../../support/router.ts";

/**
 * What the navigation tests share: the fake host with the router's React Native stand-ins (`support/router.ts`), the fixtures of this directory, and the helpers that read a
 * committed tree (the nodes of a kind, a test id, the texts) and drive the router (insets, settling, the stand-ins' hardware back key). The route-tree tests mount
 * `fixtures/tree-fixture.svelte` through `mountTree`, which also hands back what the pages and layouts of `tests/support/tree-app.ts` recorded on `globalThis.__tree*`.
 */
export type { FakeNode };
export { settle };

const fixtures = resolve(import.meta.dirname, "../fixtures");

export const find = (nodes: FakeNode[], name: string): FakeNode[] => flatten(nodes).filter((node) => node.name === name);
export const ofKind = (nodes: FakeNode[], kind: string): FakeNode[] => flatten(nodes).filter((node) => parseNativeID(String(node.props.nativeID ?? ""))?.kind === kind);
export const ofTestID = (nodes: FakeNode[], testID: string): FakeNode[] => flatten(nodes).filter((node) => node.props.testID === testID);
/** A few turns of the microtask queue: what a navigation needs before its screens are committed. */
export const turns = async (m: { tick: () => Promise<void> }): Promise<void> => { for (let turn = 0; turn < 8; turn++) await settle(m); };
/** What the engine's `getInsets` answers; the bundle sees an engine only after this. */
export const withInsets = (top: number, bottom = 34): void => {
  (globalThis as { __navigationInsets?: unknown }).__navigationInsets = { top, right: 0, bottom, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 } };
};
/** `Platform.OS` of the bundles evaluated from now on. */
export const onPlatform = (os: "ios" | "android"): void => { (globalThis as { __navigationOS?: string }).__navigationOS = os; };
/** The activity state a screen's nativeID carries: 2 shown, 0 inactive and leaving. */
export const activityOf = (screen: FakeNode): string | undefined => String(screen.props.nativeID).match(/;a=(\d)/)?.[1];
/** The merged style of a node: a style array, flattened. */
export const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...(Array.isArray(style) ? style : [style]).filter(Boolean));
/** The route files of the stand-in app (`tests/support/fixtures/stand-in-app`). */
export const standInRoutes: string = resolve(import.meta.dirname, "../../support/fixtures/stand-in-app/src/routes");
export const handlersOf = (key: "__backHandlers" | "__linkHandlers") => (globalThis as unknown as Record<string, ((...args: never[]) => unknown)[]>)[key];

export type TreeRouter = {
  scope: string | undefined; active: () => boolean; entries: { url: URL; presentation: string; params: Record<string, string> }[]; current: { url: URL };
  selected: string | undefined; goto: (href: string, options?: { replaceState?: boolean; reset?: boolean; presentation?: string }) => void; back: () => boolean;
  replaceBase: (href: string) => void; openURL: (href: string) => boolean; screens: { leaving: boolean; canGoBack: boolean }[];
  node: { kind: string; panes?: { key: string; stack: object }[] }; modules: (node: object) => unknown;
};
export type TreeApp = { root?: () => TreeRouter; show: (shown: boolean) => void };
export const treeGlobals = globalThis as { __treeRoots?: Record<string, TreeRouter>; __treeRouters?: Record<string, TreeRouter>; __treeOptions?: Record<string, object>; __treeTabs?: object[]; __treeSelections?: string[]; __treePanes?: unknown; __treeTabsRouter?: TreeRouter; __treeLayouts?: { path?: string; params?: object }[] };
export const pathsOf = (router: TreeRouter): string[] => router.entries.map((entry) => `${entry.url.pathname}${entry.url.search}`);
export const paneRouter = (path: string): TreeRouter => { const router = treeGlobals.__treeRouters?.[path]; if (!router) throw new Error(`no page rendered at ${path}`); return router; };
export const tabScreens = (tree: FakeNode[]): FakeNode[][] => ofKind(tree, "tab").map((pane) => ofKind(pane.children, "screen"));

/** The fake host for a navigation test file, and the loaders and tree helpers that go with it. Call it at the top level of the file. */
export function navigationWorld() {
  const host = fakeHost();
  // A popped screen's exit timer must not fire into the test that runs after this one.
  afterEach(() => { jest.useRealTimers(); });

  /** A fixture of `tests/navigation/fixtures` by name, or one at an absolute path, mounted through the host. */
  const load = (fixture = "navigation-fixture.svelte", options?: RouterBundleOptions) => loadRouterApp(fixture.startsWith("/") ? fixture : resolve(fixtures, fixture), options);
  const texts = (root: number): string[] => find(host.roots[root] ?? [], "RCTRawText").map((node) => String(node.props.text));
  const selectedIndex = (surface: number) => parseNativeID(String(ofKind(host.roots[surface], "tabs")[0].props.nativeID))?.pairs.sel;

  async function mountTree(surface: number, props: Record<string, unknown> = {}, fixture = "tree-fixture.svelte", options?: RouterBundleOptions) {
    const m = await load(fixture, options);
    jest.useFakeTimers(); // a popped screen's exit timer must not fire into whichever test runs after this one
    host.reset();
    treeGlobals.__treeRouters = {}; treeGlobals.__treeRoots = {};
    delete treeGlobals.__treeOptions; delete treeGlobals.__treeTabs; delete treeGlobals.__treeSelections; delete treeGlobals.__treeLayouts;
    delete (globalThis as { __initialURLReads?: number }).__initialURLReads;
    handlersOf("__backHandlers").length = 0;
    handlersOf("__linkHandlers").length = 0;
    const app = m.startSurface(surface, m.Fixture, props) as unknown as TreeApp;
    await turns(m);
    // React Native asks the handlers newest first and stops at the first `true`.
    const hardwareBack = () => [...handlersOf("__backHandlers")].reverse().some((handler) => (handler as () => boolean)());
    return { m, app, router: app.root?.() as TreeRouter, hardwareBack, settled: () => turns(m), texts: () => texts(surface), tree: () => host.roots[surface] };
  }

  return { host, load, texts, selectedIndex, mountTree };
}
