import { expect, test } from "bun:test";
import { routeFiles } from "../../src/build.ts";
import { fabric, find, loadFork } from "../support/fork-harness.ts";
import { standInRoutes } from "./support/world.ts";

/**
 * `router.prepare(href)` then `commit()` against `goto(href)`, on the tree of the stand-in app (`tree-fixture.svelte`: tabs, nested stacks, params, layouts, a modal and a sheet): the
 * same screens, texts, router state of every navigator, layout calls and page lifecycle calls, whether the finger lifts at once (the commit comes with the screen just ready), a task
 * later, or after 20 ms. Where a navigation reaches a page whose modules have not loaded (the base page of a tab pane that was never selected, which the pane renders when it is first
 * selected) the router loads them before it renders the screen: a fork cannot wait for a module, and one that arrives later renders outside it, with its effects running at once.
 */
type R = {
  entries: { url: URL; key: number }[];
  screens: { leaving: boolean; canGoBack: boolean; entry: { key: number; url: URL } }[];
  selected?: string;
  goto(href: string, navigation?: object): void;
  prepare(href: string, navigation?: object): { ready: Promise<boolean>; commit(): void; discard(): void };
};
const g = globalThis as Record<string, unknown>;
const files = routeFiles(standInRoutes, { lab: true });
const tabs = [{ key: "home", title: "Home" }, { key: "settings", title: "Settings" }];
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const settle = async (m: { tick(): Promise<void> }) => { for (let turn = 0; turn < 6; turn++) { await m.tick(); await sleep(0); } };
const dump = (router: R) => ({
  paths: router.entries.map((entry) => `${entry.url.pathname}${entry.url.search}`),
  selected: router.selected,
  screens: router.screens.map((screen) => `${screen.entry.url.pathname}${screen.leaving ? "!" : ""}${screen.canGoBack ? "<" : ""}`),
});

type Mounted = Awaited<ReturnType<typeof mount>>;
let surface = 400;
async function mount(initial: string) {
  const tag = surface++;
  const m = await loadFork("navigation/fixtures/tree-fixture.svelte");
  g.__treeRouters = {};
  g.__treeRoots = {};
  g.__treeTabs = tabs;
  delete g.__treeLayouts;
  const log: string[] = [];
  const app = m.startSurface(tag, m.Fixture, { initial, files: await files, tabs }) as unknown as { root(): R };
  await settle(m);
  log.length = 0;
  g.__treeLog = log;
  return { m, tag, root: app.root(), log, pane: (path: string): R => {
    const router = (g.__treeRouters as Record<string, R>)[path];
    if (!router) throw new Error(`no page at ${path}; there are ${Object.keys(g.__treeRouters as object).join(", ")}`);
    return router;
  } };
}

type Case = { name: string; start: string; from: string | ((x: Mounted) => R); href: string; navigation?: object };
const cases: Case[] = [
  { name: "select a tab", start: "/acme", from: "/acme/home", href: "/acme/settings" },
  { name: "push in an unvisited pane, with params", start: "/acme", from: "/acme/home", href: "/acme/settings/devices" },
  { name: "a modal over the tabs", start: "/acme", from: "/acme/home", href: "/preferences" },
  { name: "from a root page into the tabs, a navigator that is pushed", start: "/projects", from: (x) => x.root, href: "/acme" },
  { name: "from a root page into an unvisited pane (a deep link)", start: "/projects", from: (x) => x.root, href: "/acme/settings/devices" },
  { name: "the lab's tabs: a sheet of the inbox, a stack navigator with a layout", start: "/__dev/tree/home", from: (x) => x.root, href: "/__dev/tree/inbox/compose" },
  { name: "the lab's tabs: a page with params", start: "/__dev/tree/home", from: (x) => x.root, href: "/__dev/tree/home/detail/7" },
];

async function snapshot(c: Case, how: "goto" | "prepare", gap: number) {
  const x = await mount(c.start);
  const router = typeof c.from === "string" ? x.pane(c.from) : c.from(x);
  let ready: boolean | undefined;
  if (how === "goto") router.goto(c.href, c.navigation);
  else {
    const prepared = router.prepare(c.href, c.navigation);
    ready = await prepared.ready;
    if (gap >= 0) await sleep(gap);
    prepared.commit();
  }
  await settle(x.m);
  await sleep(30);
  await settle(x.m);
  const panes = Object.fromEntries(Object.entries(g.__treeRouters as Record<string, R>).map(([path, other]) => [path, dump(other)]));
  return {
    ready,
    root: dump(x.root),
    panes,
    texts: find(fabric.roots[x.tag] ?? [], "RCTRawText").map((node) => String(node.props.text)),
    layouts: JSON.stringify((g.__treeLayouts as unknown[] | undefined) ?? []),
    log: [...x.log].sort(),
  };
}

for (const c of cases) {
  test(`prepare + commit gives what goto gives: ${c.name}`, async () => {
    const direct = await snapshot(c, "goto", -1);
    for (const gap of [-1, 0, 20]) {
      const prepared = await snapshot(c, "prepare", gap);
      const label = `${gap} ms`;
      expect(prepared.ready, `ready, ${label}`).toBe(true);
      expect(prepared.root, `root router, ${label}`).toEqual(direct.root);
      expect(prepared.panes, `routers of the screens, ${label}`).toEqual(direct.panes);
      expect(prepared.texts, `texts, ${label}`).toEqual(direct.texts);
      expect(prepared.layouts, `layout calls, ${label}`).toBe(direct.layouts);
      // Every page ran its script once, its effects once, and nothing was torn down: the same calls whether the screen was prepared or not.
      expect(prepared.log, `page lifecycle, ${label}`).toEqual(direct.log);
    }
  }, 60_000);
}
