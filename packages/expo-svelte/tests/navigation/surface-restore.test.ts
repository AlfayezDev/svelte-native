import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { hmrState } from "../../src/hmr-state.ts";
import { appSurface } from "../support/app-surface.ts";

/**
 * What of the navigation an app keeps across a hot update, a recreated Android Activity, a dead process (Android's engine module and iOS's navigation module, with the launch link) and a
 * saved state that no longer fits: a named router's stack, a tree app's navigators and tab selection, the entry a state restores, and what the host is told about it. The surfaces
 * themselves (remount, the error screen, `init`) are in `renderer/surfaces.test.ts`.
 */
const { host, runnables, load: bundleApp, find, texts, forget, settle, stopSurface } = appSurface();
const load = (fixture = "hmr-tree-shell.svelte") => bundleApp(resolve(import.meta.dirname, "fixtures", fixture));

test("a named router's stack survives a remount too: the root takes the recorded stack, each scope takes its own when it is created", async () => {
  const m = await load("hmr-scope-fixture.svelte");
  forget();
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

type TreeRouter = { entries: { url: URL; presentation: string; route: { id: string } }[]; screens: { canGoBack: boolean; leaving: boolean }[]; goto(href: string, options?: { reset?: boolean }): void; selected: string | undefined };
const treeScope = globalThis as { __shellRouter?: TreeRouter; __treeRouters?: Record<string, TreeRouter> };
const hrefs = (router: TreeRouter | undefined) => router?.entries.map((entry) => entry.url.pathname);
const turns = async (m: { tick: () => Promise<void> }) => { for (let turn = 0; turn < 8; turn++) await settle(m); };
const nodesOf = (root: number, kind: string) => find(host.roots[root] ?? [], "RCTView").filter((node) => String(node.props.nativeID ?? "").startsWith(`svelte:${kind}`));

test("a tree app: the root layout is the shell around the root navigator, in the router's context, and the whole navigation state survives a remount", async () => {
  const m = await load("hmr-tree-shell.svelte");
  forget();
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
  const before = hmrState().navigation?.().stack;
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
  expect(hmrState().navigation?.().stack).toEqual(before);
  expect(texts(35)).toEqual(["page /acme/inbox", "page /acme/inbox/compose", "page /account"]); // the selected pane and its stack are back; the home pane waits for its tab
  expect(nodesOf(35, "tabs")[0].props.nativeID).toContain("sel=1");

  next?.goto("/acme/home/thread/7"); // the route the home pane is on: only the tab changes
  await turns(m);
  expect(hrefs(treeScope.__treeRouters?.["/acme/home/thread/7"] as TreeRouter | undefined)).toEqual(["/acme/home", "/acme/home/thread/7"]);
  expect(hrefs(treeScope.__treeRouters?.["/acme/inbox/compose"] as TreeRouter | undefined)).toEqual(["/acme/inbox", "/acme/inbox/compose"]);
});

test("a saved state of routes that no longer exist is dropped: the router starts from its initial screen", async () => {
  const m = await load("hmr-tree-shell.svelte");
  forget();
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/workspaces" });
  runnables.main({ rootTag: 36 });
  await turns(m);
  hmrState().navigation = () => ({ stack: { entries: [{ href: "/workspaces", presentation: "push" }, { href: "/gone/for/good", presentation: "push" }] } });
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/workspaces" });
  m.remountSurfaces();
  await turns(m);
  expect(hrefs(treeScope.__shellRouter)).toEqual(["/workspaces"]);
  hmrState().navigation = () => ({ stack: { entries: [{ href: "/acme", presentation: "push", tabs: { selected: "ghost", panes: { ghost: { entries: [{ href: "/acme/ghost", presentation: "push" }] } } } }] } });
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/workspaces" });
  m.remountSurfaces();
  await turns(m);
  expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme"]); // a pane that is gone is ignored, the screen that is still there is kept
  expect(nodesOf(36, "tabs")[0].props.nativeID).toContain("sel=0");
});

test("a restored entry is the route it was: a page the resolver chose over a navigator of the same path is not rebuilt as the navigator, and an id that is gone falls back to the href", async () => {
  const m = await load("hmr-tree-shell.svelte");
  forget();
  const tree = () => m.appTree({ files: m.collidingFiles });
  m.createFabricApp(m.Fixture, { tree: tree(), initial: "/x/flow" });
  runnables.main({ rootTag: 37 });
  await turns(m);
  expect(treeScope.__shellRouter?.entries.map((entry) => entry.route.id)).toEqual(["x/[id]"]); // `/x/flow` navigated to the page, not to the navigator whose own path it is
  expect(texts(37)).toEqual(["page /x/flow"]);
  expect(hmrState().navigation?.().stack.entries.map((entry) => entry.route)).toEqual(["x/[id]"]);

  m.createFabricApp(m.Fixture, { tree: tree(), initial: "/x/flow" });
  m.remountSurfaces();
  await turns(m);
  expect(treeScope.__shellRouter?.entries.map((entry) => entry.route.id)).toEqual(["x/[id]"]);
  expect(texts(37)).toEqual(["page /x/flow"]);

  // A route that was renamed (its id is gone) is found by its href.
  hmrState().navigation = () => ({ stack: { entries: [{ route: "x/[slug]", href: "/x/7", presentation: "push" }] } });
  m.createFabricApp(m.Fixture, { tree: tree(), initial: "/x/flow" });
  m.remountSurfaces();
  await turns(m);
  expect(treeScope.__shellRouter?.entries.map((entry) => entry.route.id)).toEqual(["x/[id]"]);
  expect(texts(37)).toEqual(["page /x/7"]);
});

test("a restored nested stack navigator keeps its first screen's way back: the screen below it on the stack above is restored with it", async () => {
  const m = await load("hmr-tree-shell.svelte");
  forget();
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/acme/home" });
  runnables.main({ rootTag: 38 });
  await turns(m);
  treeScope.__shellRouter?.goto("/acme/flow/start");
  await turns(m);
  const arrows = () => treeScope.__treeRouters?.["/acme/flow/start"]?.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
  expect(arrows()).toEqual([true]);
  treeScope.__treeRouters = {};
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/acme/home" });
  m.remountSurfaces();
  await turns(m);
  expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme", "/acme/flow"]);
  expect(arrows()).toEqual([true]);
});

// A recreated Android Activity (a font scale or locale change) stops its surface and starts another in the same JavaScript runtime; a
// process that was killed starts a new runtime, and the host passes what the router saved as `initialProps.navigation`.
const arrows = (router: TreeRouter | undefined) => router?.screens.filter((screen) => !screen.leaving).map((screen) => screen.canGoBack);
const environment = globalThis as { __initialURL?: string; __nativeModules?: Record<string, object> };
const freshRuntime = () => { delete (globalThis as { __expoSvelteHmrState?: unknown }).__expoSvelteHmrState; treeScope.__treeRouters = {}; };
/** The engine module as the Android host has it, as far as navigation goes: what the router saved, and whether the Activity is finishing. */
function engineModule() {
  const module = { saved: [] as string[], finishing: false };
  environment.__nativeModules = { SvelteEngine: { install: () => false, addListener: () => ({ remove() {} }), getInsets: () => null, saveNavigation: (json: string) => module.saved.push(json), finishing: () => module.finishing } };
  return module;
}
/** The product tree with a workspace open on the inbox, a modal on its stack and an account modal over the tabs. */
async function openApp(m: Awaited<ReturnType<typeof load>>, rootTag: number, initialProps?: Record<string, unknown>) {
  m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/acme/home" });
  runnables.main({ rootTag, initialProps });
  await turns(m);
}
async function wander(m: Awaited<ReturnType<typeof load>>) {
  const router = treeScope.__shellRouter;
  router?.goto("/acme/home/thread/7");
  router?.goto("/acme/inbox/compose", { presentation: "modal" } as never);
  await turns(m);
  router?.goto("/account");
  await turns(m);
}

test("recreation: the surface stops and a new one starts, and every navigator's stack and the tab selection come back", async () => {
  freshRuntime();
  const m = await load("hmr-tree-shell.svelte");
  forget();
  await openApp(m, 40);
  await wander(m);
  const router = treeScope.__shellRouter;
  const before = { hrefs: hrefs(router), arrows: arrows(router), saved: hmrState().navigation?.() };
  expect(before.hrefs).toEqual(["/acme", "/account"]);
  expect(before.arrows).toEqual([false, true]);

  stopSurface(40);
  expect(host.roots[40]).toEqual([]);
  expect(hmrState().restore).toEqual(before.saved); // taken on every stop, in release builds too

  treeScope.__treeRouters = {};
  runnables.main({ rootTag: 41 });
  await turns(m);
  const next = treeScope.__shellRouter;
  expect(next).not.toBe(router);
  expect(hrefs(next)).toEqual(before.hrefs);
  expect(next?.entries.map((entry) => entry.presentation)).toEqual(["push", "modal"]);
  expect(arrows(next)).toEqual(before.arrows);
  expect(hmrState().navigation?.()).toEqual(before.saved);
  expect(hmrState().restore).toBeUndefined();
  expect(texts(41)).toEqual(["page /acme/inbox", "page /acme/inbox/compose", "page /account"]);
  expect(nodesOf(41, "tabs")[0].props.nativeID).toContain("sel=1");
  next?.goto("/acme/home/thread/7");
  await turns(m);
  expect(hrefs(treeScope.__treeRouters?.["/acme/home/thread/7"] as TreeRouter | undefined)).toEqual(["/acme/home", "/acme/home/thread/7"]);
  expect(arrows(treeScope.__treeRouters?.["/acme/home/thread/7"] as TreeRouter | undefined)).toEqual([false, true]);
});

test("recreation: a new surface that starts before the old one has stopped takes the running router's state, and the old stop leaves nothing behind", async () => {
  freshRuntime();
  const m = await load("hmr-tree-shell.svelte");
  forget();
  await openApp(m, 42);
  await wander(m);
  const saved = hmrState().navigation?.();

  treeScope.__treeRouters = {};
  runnables.main({ rootTag: 43 });
  await turns(m);
  expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme", "/account"]);
  expect(hmrState().restore).toBeUndefined();
  stopSurface(42);
  expect(hmrState().restore).toBeUndefined(); // 43 is still running: nothing to hand on
  expect(hmrState().navigation?.()).toEqual(saved);
  expect(texts(43)).toEqual(["page /acme/inbox", "page /acme/inbox/compose", "page /account"]);
  expect(host.roots[42]).toEqual([]);
});

test("recreation: an app the user is leaving (Android's isFinishing) starts from its first screen next time", async () => {
  freshRuntime();
  const engine = engineModule();
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 44);
    await wander(m);
    engine.finishing = true;
    stopSurface(44);
    expect(hmrState().restore).toBeUndefined();
    treeScope.__treeRouters = {};
    runnables.main({ rootTag: 45 });
    await turns(m);
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme"]);
    expect(texts(45)).toEqual(["page /acme/home"]);
  } finally { delete environment.__nativeModules; }
});

test("process death: the router writes its state through the engine module after each change, and a new process adopts it from initialProps.navigation", async () => {
  freshRuntime();
  const engine = engineModule();
  let saved: string;
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 46);
    expect(engine.saved.map((json) => JSON.parse(json).stack.entries.map((entry: { href: string }) => entry.href))).toEqual([["/acme"]]);
    await wander(m);
    expect(engine.saved.length).toBe(3); // one write per batch of changes: the thread and the modal together, then the account modal
    expect(JSON.parse(engine.saved.at(-1) as string)).toEqual(hmrState().navigation?.());
    await turns(m);
    expect(engine.saved.length).toBe(3); // nothing changed: nothing is written
    saved = engine.saved.at(-1) as string;
  } finally { delete environment.__nativeModules; }

  // The process dies: a new runtime has no state of its own, and the host starts the surface with what it kept.
  freshRuntime();
  const m = await load("hmr-tree-shell.svelte");
  forget();
  await openApp(m, 47, { navigation: saved });
  expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme", "/account"]);
  expect(arrows(treeScope.__shellRouter)).toEqual([false, true]);
  expect(texts(47)).toEqual(["page /acme/inbox", "page /acme/inbox/compose", "page /account"]);
  expect(nodesOf(47, "tabs")[0].props.nativeID).toContain("sel=1");

  // A state that is no state, and one whose routes are gone, leave the app on its first screen.
  for (const navigation of ["not json", "{\"stack\":{}}", 7, JSON.stringify({ stack: { entries: [{ href: "/gone/for/good", presentation: "push" }] } })]) {
    freshRuntime();
    const again = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(again, 48, { navigation });
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme"]);
    expect(texts(48)).toEqual(["page /acme/home"]);
  }
});

/** iOS's navigation module (`native/svelte-core/ios/navigation`) as far as JavaScript sees it: `save` after every change, `restore` once with a record or null. */
function navigationModule(record: unknown = null, updates?: { updateId: string | null }) {
  const module = { saved: [] as string[], updates: [] as (string | null | undefined)[], restores: 0, forgotten: 0, told: [] as [string, string][] };
  environment.__nativeModules = { ...(updates ? { SvelteUpdates: updates } : {}), SvelteNavigation: { save: (json: string, update?: string | null) => { module.saved.push(json); module.updates.push(update); }, restore: () => { module.restores++; return module.restores === 1 ? record : null; }, restored: (outcome: string, reason: string) => { module.forgotten++; module.told.push([outcome, reason]); } } };
  return module;
}

test("iOS: the router writes its state through the navigation module, and a new process adopts the fresh record it hands over once", async () => {
  freshRuntime();
  const host = navigationModule();
  let saved: string;
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 60);
    expect(host.restores).toBe(1); // asked once, at the first surface: nothing was kept
    expect(host.forgotten).toBe(0); // and nothing to forget
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme"]);
    await wander(m);
    expect(host.saved.length).toBe(3); // the same writes as Android's: one per batch of changes
    saved = host.saved.at(-1) as string;
    expect(JSON.parse(saved)).toEqual(hmrState().navigation?.());
  } finally { delete environment.__nativeModules; }

  // The process was killed in the background; the host kept the state and the time the app went there.
  freshRuntime();
  const record = navigationModule({ json: saved, savedAt: Date.now() - 20 * 60_000, attempts: 1, systemKept: true });
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 61);
    expect(record.restores).toBe(1);
    expect(record.told).toEqual([["restored", "the router adopted the saved state"]]); // the router took the state and the surface started: the host clears what it kept
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme", "/account"]);
    expect(arrows(treeScope.__shellRouter)).toEqual([false, true]);
    expect(texts(61)).toEqual(["page /acme/inbox", "page /acme/inbox/compose", "page /account"]);
    expect(nodesOf(61, "tabs")[0].props.nativeID).toContain("sel=1");
    expect(hmrState().surfaces.get(61)).toEqual({ navigation: saved }); // what a development remount starts the surface with again
    // The restored router writes its state again (the host keeps it for the next background), and a remount does not ask the host a second time.
    expect(JSON.parse(record.saved.at(-1) as string)).toEqual(hmrState().navigation?.());
    m.remountSurfaces();
    await turns(m);
    expect([record.restores, record.forgotten]).toEqual([1, 1]);
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme", "/account"]);
  } finally { delete environment.__nativeModules; }
});

test("iOS: a record that is old, was ended by the user, was restored twice or is no state starts the app on its first screen, and an explicit initialProps.navigation is not overridden", async () => {
  freshRuntime();
  const first = navigationModule();
  let saved: string;
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 62);
    await wander(m);
    saved = first.saved.at(-1) as string;
  } finally { delete environment.__nativeModules; }

  const day = 24 * 60 * 60 * 1000;
  // One refusal for each field the host's record carries (`savedAt`, `systemKept`, `attempts`) and one the router makes: the rules themselves, a record from the future and a malformed one included, are unit tests.
  const refused: [string, unknown][] = [
    ["expired", { json: saved, savedAt: Date.now() - day - 60_000 }],
    ["the user ended the process", { json: saved, savedAt: Date.now(), attempts: 1, systemKept: false }],
    ["restored twice already", { json: saved, savedAt: Date.now(), attempts: 3, systemKept: true }],
    ["not a state", { json: "not json", savedAt: Date.now() }],
  ];
  for (const [name, record] of refused) {
    freshRuntime();
    const host = navigationModule(record);
    try {
      const m = await load("hmr-tree-shell.svelte");
      forget();
      await openApp(m, 63);
      expect([name, host.restores, host.forgotten]).toEqual([name, 1, 1]); // a record the app cannot use is of no use to the host either
      expect([name, host.told[0]?.[0]]).toEqual([name, "dropped"]);
      expect([name, hrefs(treeScope.__shellRouter)]).toEqual([name, ["/acme"]]);
      expect([name, texts(63)]).toEqual([name, ["page /acme/home"]]);
    } finally { delete environment.__nativeModules; }
  }

  // Props from the host (Android's path) are used as given, and the iOS module is not asked.
  freshRuntime();
  const host = navigationModule({ json: saved, savedAt: Date.now() });
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 64, { navigation: JSON.stringify({ stack: { entries: [{ href: "/workspaces", presentation: "push" }] } }) });
    expect([host.restores, host.forgotten]).toEqual([0, 0]);
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/workspaces"]);
  } finally { delete environment.__nativeModules; }

  // Android has the engine module: the navigation module is not asked for at all (a lookup of what is not there is on the way to its first commit).
  freshRuntime();
  const android = navigationModule({ json: saved, savedAt: Date.now() });
  (environment.__nativeModules as Record<string, object>).SvelteEngine = { install: () => false, addListener: () => ({ remove() {} }), getInsets: () => null, saveNavigation: () => undefined, finishing: () => false };
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 66);
    expect([android.restores, android.saved.length]).toEqual([0, 0]);
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme"]);
  } finally { delete environment.__nativeModules; }

  // A host that throws leaves the app on its first screen.
  freshRuntime();
  environment.__nativeModules = { SvelteNavigation: { save: () => undefined, restore: () => { throw new Error("the file is unreadable"); } } };
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 65);
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme"]);
  } finally { delete environment.__nativeModules; }
});

test("iOS: the router tells the host whether it adopted the state, and the host hears it once the surface has started", async () => {
  freshRuntime();
  const first = navigationModule();
  let saved: string;
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 70);
    await wander(m);
    saved = first.saved.at(-1) as string;
  } finally { delete environment.__nativeModules; }

  // A state whose routes are gone (an update shipped between the save and the restore) is read and refused by the router: the host is told so, not that it was restored.
  const gone = JSON.stringify({ stack: { entries: [{ href: "/gone/for/good", presentation: "push" }] } });
  freshRuntime();
  const refused = navigationModule({ json: gone, savedAt: Date.now(), attempts: 1, systemKept: true });
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 71);
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme"]);
    expect(refused.told).toHaveLength(1);
    expect(refused.told[0]?.[0]).toBe("dropped");
    expect(refused.told[0]?.[1]).toContain("the router rejected the saved state");
    expect(refused.told[0]?.[1]).toContain("route");
  } finally { delete environment.__nativeModules; }

  // The router adopting the state is what the host hears, once, also when the adoption came from a development remount.
  freshRuntime();
  const adopted = navigationModule({ json: saved, savedAt: Date.now(), attempts: 1, systemKept: true });
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 72);
    expect(adopted.told).toEqual([["restored", "the router adopted the saved state"]]);
    m.remountSurfaces();
    await turns(m);
    expect(adopted.told).toHaveLength(1);
  } finally { delete environment.__nativeModules; }
});

test("iOS: the OTA update id goes to the host with every state, and a state of another update is dropped as updated", async () => {
  freshRuntime();
  const first = navigationModule(null, { updateId: "AB12" });
  let saved: string;
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 73);
    await wander(m);
    saved = first.saved.at(-1) as string;
    expect(new Set(first.updates)).toEqual(new Set(["ab12"])); // lowercase, as `updateId` of the updates module is
  } finally { delete environment.__nativeModules; }
  freshRuntime();
  const embedded = navigationModule();
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    await openApp(m, 74);
    await wander(m);
    expect(new Set(embedded.updates)).toEqual(new Set([null])); // no updates module, or the embedded bundle: null
  } finally { delete environment.__nativeModules; }

  // The same update restores, another one (or the embedded bundle) does not.
  for (const [name, running, expected] of [["same", { updateId: "AB12" }, ["restored"]], ["newer", { updateId: "CD34" }, ["dropped"]], ["embedded", undefined, ["dropped"]]] as const) {
    freshRuntime();
    const host = navigationModule({ json: saved, savedAt: Date.now(), attempts: 1, systemKept: true, build: "41", runningBuild: "41", update: "ab12" }, running);
    try {
      const m = await load("hmr-tree-shell.svelte");
      forget();
      await openApp(m, 75);
      expect([name, host.told.map((entry) => entry[0])]).toEqual([name, expected]);
      expect([name, hrefs(treeScope.__shellRouter)]).toEqual([name, name === "same" ? ["/acme", "/account"] : ["/acme"]]);
    } finally { delete environment.__nativeModules; }
  }
});

test("the launch link: a state restored with the intent that opened it is not opened again, a different link wins", async () => {
  freshRuntime();
  const engine = engineModule();
  try {
    const m = await load("hmr-tree-shell.svelte");
    forget();
    environment.__initialURL = "https://app.test/acme/home/thread/7";
    m.createFabricApp(m.Fixture, { tree: m.appTree(), initial: "/workspaces" });
    runnables.main({ rootTag: 50 });
    await turns(m);
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme"]); // a launch link resets: its screen is the base
    expect(hmrState().navigation?.().launch).toBe("https://app.test/acme/home/thread/7");
    treeScope.__shellRouter?.goto("/acme/inbox/compose", { presentation: "modal" } as never);
    await turns(m);
    treeScope.__shellRouter?.goto("/account");
    await turns(m);

    // The Activity is recreated: the intent still carries the link, and it was opened already.
    stopSurface(50);
    treeScope.__treeRouters = {};
    runnables.main({ rootTag: 51 });
    await turns(m);
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/acme", "/account"]);
    expect(texts(51)).toEqual(["page /acme/inbox", "page /acme/inbox/compose", "page /account"]);
    const saved = engine.saved.at(-1) as string;
    expect(JSON.parse(saved).launch).toBe("https://app.test/acme/home/thread/7");

    // A new launch link arrives with the next start: it wins over the restored state.
    stopSurface(51);
    environment.__initialURL = "https://app.test/workspaces";
    runnables.main({ rootTag: 52 });
    await turns(m);
    expect(hrefs(treeScope.__shellRouter)).toEqual(["/workspaces"]);
    expect(hmrState().navigation?.().launch).toBe("https://app.test/workspaces");

    // The process died: the same applies to the state the host kept, which remembers the link it was opened with.
    for (const [link, expected] of [["https://app.test/acme/home/thread/7", ["/acme", "/account"]], ["https://app.test/workspaces", ["/workspaces"]]] as const) {
      freshRuntime();
      const again = await load("hmr-tree-shell.svelte");
      forget();
      environment.__initialURL = link;
      again.createFabricApp(again.Fixture, { tree: again.appTree(), initial: "/acme/home" });
      runnables.main({ rootTag: 53, initialProps: { navigation: saved } });
      await turns(again);
      expect(hrefs(treeScope.__shellRouter)).toEqual(expected);
    }
  } finally { delete environment.__nativeModules; delete environment.__initialURL; }
});
