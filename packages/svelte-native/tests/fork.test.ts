import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import type { NativeNode } from "../src/renderer.ts";
import { Pressability, type PressEvent, type ResponderHandlers } from "../src/fabric/pressability.ts";
import { asyncRun } from "./async-run.ts";
import { fabric, find, loadFork, type ForkModule } from "./fork-harness.ts";

/**
 * Svelte 5's `fork()` (experimental, async mode) against this library's custom renderer and Fabric host: what a fork builds off screen, what the host can see of it, what a commit
 * and a discard do, and the router's `prepare` built on it. The harness (`fork-harness.ts`) turns Svelte's async mode on, which the library leaves off unless the app asks for it
 * (`compile-options.ts`, `async-option.test.ts`, `svelte-async-mode.test.ts`). `prepare-tree.test.ts` runs `prepare` over the stand-in app's tree.
 */
const settle = async (m: ForkModule) => { m.flushSync(); await Promise.resolve(); await Promise.resolve(); };
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** A tree as one string: kind, name, props (functions by name) and text, so two trees compare by what they show. */
function shape(node: NativeNode, depth = 0): string {
  const { props, children, text } = node.getSnapshot();
  const own = Object.entries(props).map(([key, value]) => `${key}=${typeof value === "function" ? "fn" : JSON.stringify(value)}`).join(" ");
  return [`${" ".repeat(depth)}${node.kind}:${node.name} ${own} ${node.kind === "text" ? JSON.stringify(text) : ""}`.trimEnd(), ...children.map((child) => shape(child, depth + 1))].join("\n");
}
const top = (node: NativeNode): NativeNode => { let at = node; while (at.parent) at = at.parent; return at; };
const reachable = (root: NativeNode, node: NativeNode): boolean => top(node) === root;
/** Whether every object is gone after a garbage collection (a few tries: the engine may need more than one). */
async function collected(refs: WeakRef<object>[], tries = 20): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    Bun.gc(true);
    await sleep(5);
    if (refs.every((ref) => ref.deref() === undefined)) return true;
  }
  return false;
}

/** Every element the renderer creates from now on goes into `created`: the compiled components use the renderer module itself (`$renderer`), so it is the one to wrap. */
function recordElements(m: ForkModule, created: NativeNode[]): void {
  const renderer = m.renderer as unknown as { createElement(name: string): NativeNode };
  const create = renderer.createElement;
  renderer.createElement = (name) => { const node = create(name); created.push(node); return node; };
}

type Panel = { set(value: boolean): void; get(): boolean; bump(): void; countOf(): number };

/** The fixture mounted straight on a node tree, with a renderer that records every element it creates. */
async function mountPanel(rows = 3) {
  const m = await loadFork("fork-fixture.svelte");
  const created: NativeNode[] = [];
  recordElements(m, created);
  const root = new m.NativeNode("fragment");
  const log: string[] = [];
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: { log, rows } }) as unknown as Panel;
  await m.tick();
  const mounted = created.length;
  log.length = 0;
  return { m, root, log, app, created, mounted, nodesSince: () => created.length - mounted };
}

/** The same fixture as a Fabric surface, with the fake `nativeFabricUIManager` of the harness. */
async function surfacePanel(tag: number, rows = 3) {
  const m = await loadFork("fork-fixture.svelte");
  const log: string[] = [];
  fabric.calls.length = 0;
  const app = m.startSurface(tag, m.Fixture, { log, rows }) as unknown as Panel;
  await settle(m);
  log.length = 0;
  fabric.calls.length = 0;
  const creates = () => fabric.calls.filter((call) => call.startsWith("create")).length;
  const view = (id: string) => find(fabric.roots[tag] ?? [], "RCTView").filter((node) => node.props.testID === id);
  return { m, log, app, creates, view };
}

// (a) What a fork builds, and what can see it.

test("(a) inside a fork the {#if} branch is rendered and its nodes created, but they hang from a fragment of their own, not from the root", async () => {
  const { m, root, log, app, created, nodesSince } = await mountPanel();
  const before = shape(root);
  const fork = m.fork(() => app.set(true));
  // The component ran (its script, its template, its `{#each}`), the nodes exist...
  expect(log).toEqual(["panel:init"]);
  expect(nodesSince()).toBeGreaterThanOrEqual(1 + 1 + 3 * 2); // the panel, its count text, and a view and a text per row
  const panel = created.find((node) => node.peekProps().testID === "panel");
  expect(panel).toBeDefined();
  // ...but nothing is attached: the tree is as it was, the state is as it was, and the panel's top is a fragment that is not the root.
  expect(shape(root)).toBe(before);
  expect(app.get()).toBe(false);
  expect(reachable(root, panel as NativeNode)).toBe(false);
  expect(top(panel as NativeNode).kind).toBe("fragment");
  expect(top(panel as NativeNode)).not.toBe(root);
  fork.discard();
});

test("(a) a visible text bound to state the fork changes keeps its old value until the commit", async () => {
  const { m, root, app } = await mountPanel();
  const text = () => shape(root).match(/always \d+/)?.[0];
  const fork = m.fork(() => { app.set(true); app.bump(); });
  expect(app.countOf()).toBe(0);
  expect(text()).toBe("always 0");
  await fork.commit();
  expect(app.countOf()).toBe(1);
  expect(text()).toBe("always 1");
});

test("(a) the Fabric host does not hear of a pending fork's nodes, and a flush for something else does not build them", async () => {
  const { m, log, app, creates, view } = await surfacePanel(31, 3);
  const fork = m.fork(() => app.set(true));
  await settle(m);
  // Not a single binding call: no node of the fork invalidated the host (a node under a parent the host has not built is not reported), so no flush was even scheduled.
  expect(fabric.calls).toEqual([]);
  // An unrelated visible change makes the host flush, from the root down: the fork's nodes are not under it.
  app.bump();
  await settle(m);
  expect(fabric.calls).toContain("completeRoot");
  expect(creates()).toBe(0);
  expect(view("panel")).toHaveLength(0);
  expect(log).toEqual(["panel:init", "root:effect(show=false,count=1)"]);
  // The commit attaches them, and the host builds them in that flush: every node of the screen is created then, none before.
  await fork.commit();
  await settle(m);
  expect(view("panel")).toHaveLength(1);
  expect(creates()).toBeGreaterThanOrEqual(1 + 1 + 3 * 2);
});

// (b) Commit.

test("(b) after commit the tree is exactly what a direct change gives, and every effect ran once, in the same order", async () => {
  const direct = await mountPanel();
  direct.app.set(true);
  await direct.m.tick();
  const forked = await mountPanel();
  const fork = forked.m.fork(() => forked.app.set(true));
  const pending = fork.commit();
  // The commit is synchronous: the tree and the effects are done when `commit()` returns, only its promise comes later.
  expect(shape(forked.root)).toBe(shape(direct.root));
  expect(forked.log).toEqual(direct.log);
  await pending;
  await forked.m.tick();
  expect(shape(forked.root)).toBe(shape(direct.root));
  expect(forked.log).toEqual(["panel:init", "panel:effect(0)", "panel:mount", "root:effect(show=true,count=0)"]);
  expect(forked.log).toEqual(direct.log);
  // The committed screen is live: later changes reach it.
  forked.app.bump();
  await forked.m.tick();
  expect(shape(forked.root)).toContain('"count 1"');
  expect(forked.log.filter((entry) => entry === "panel:effect(0)")).toHaveLength(1);
  expect(forked.log.slice(4)).toEqual(expect.arrayContaining(["panel:cleanup", "panel:effect(1)"]));
  expect(forked.log.indexOf("panel:cleanup")).toBeLessThan(forked.log.indexOf("panel:effect(1)"));
});

test("(b) a ref on a prepared node is called once, by the host's flush after the commit", async () => {
  const { m, log, app } = await surfacePanel(32);
  const fork = m.fork(() => app.set(true));
  await settle(m);
  expect(log).toEqual(["panel:init"]);
  await fork.commit();
  await settle(m);
  expect(log.filter((entry) => entry.startsWith("panel:ref"))).toEqual(["panel:ref"]);
});

test("(b) state written outside the fork while it is pending is in the screen at the commit, and the fork's own value wins where both wrote", async () => {
  const { m, root, log, app } = await mountPanel();
  const fork = m.fork(() => app.set(true));
  app.bump();
  app.set(false);
  await settle(m);
  expect(app.get()).toBe(false);
  expect(log).toEqual(["panel:init", "root:effect(show=false,count=1)"]);
  expect(shape(root)).toContain("always 1");
  await fork.commit();
  expect(app.get()).toBe(true);
  expect(shape(root)).toContain('"count 1"');
  expect(log.filter((entry) => entry.startsWith("panel:effect"))).toEqual(["panel:effect(1)"]);
});

test("(b) two forks both commit, in the order the caller says, and the later one's state is the one left", async () => {
  const { m, root, log, app } = await mountPanel();
  const first = m.fork(() => app.set(true));
  const second = m.fork(() => { app.set(true); app.bump(); });
  await first.commit();
  expect(app.countOf()).toBe(0);
  await second.commit();
  expect(app.countOf()).toBe(1);
  expect(shape(root)).toContain('"count 1"');
  expect(log.filter((entry) => entry === "panel:init")).toHaveLength(1);
});

// (c) Discard.

test("(c) a discarded fork leaves the tree and the state as they were, its effects never ran, and its nodes are collected", async () => {
  const { m, root, log, app, created, mounted } = await mountPanel();
  const before = shape(root);
  // The fork's handle goes out of scope with the function, as it does when a caller drops it after `discard()`.
  const refs = (() => {
    const fork = m.fork(() => app.set(true));
    const nodes = created.slice(mounted).map((node) => new WeakRef(node));
    fork.discard();
    return nodes;
  })();
  expect(refs.length).toBeGreaterThan(5);
  await settle(m);
  expect(shape(root)).toBe(before);
  expect(app.get()).toBe(false);
  // No effect, no mount, and no teardown either: `onDestroy` and a cleanup belong to an effect that never ran. Whatever a component's script acquires outside an effect, a discard does not release.
  expect(log).toEqual(["panel:init"]);
  // A template of the custom renderer keeps the nodes of its last instance (`from_tree` in Svelte's template.js: `node` is a closure variable), so the discarded screen is
  // released when the next one is made from the same templates, here by a fork that is committed (whose nodes are kept: the control that makes the check able to fail).
  created.length = mounted;
  const control = m.fork(() => app.set(true));
  const kept = created.slice(mounted).map((node) => new WeakRef(node));
  await control.commit();
  created.length = mounted;
  expect(await collected(refs)).toBe(true);
  expect(await collected(kept, 3)).toBe(false);
});

test("(c) a discarded fork's nodes never reach Fabric: no create, no flush, and a later change of the same state builds a fresh screen", async () => {
  const { m, log, app, creates, view } = await surfacePanel(33);
  const fork = m.fork(() => app.set(true));
  fork.discard();
  await settle(m);
  expect(fabric.calls).toEqual([]);
  app.bump();
  await settle(m);
  expect(creates()).toBe(0);
  app.set(true);
  await settle(m);
  expect(view("panel")).toHaveLength(1);
  expect(log.filter((entry) => entry === "panel:init")).toHaveLength(2);
  expect(log.filter((entry) => entry === "panel:effect(1)")).toHaveLength(1);
});

test("(c) committing a fork that was discarded fails with Svelte's fork_discarded, and discarding twice is harmless", async () => {
  const { m, app } = await mountPanel();
  const fork = m.fork(() => app.set(true));
  fork.discard();
  fork.discard();
  await expect(fork.commit()).rejects.toThrow(/fork_discarded/);
  expect(app.get()).toBe(false);
});

// What a fork may not do, and what it needs.

test("a fork needs a quiet moment: a state change that is still pending makes it throw fork_timing, and flushSync first makes room", async () => {
  const { m, app } = await mountPanel();
  app.bump();
  expect(() => m.fork(() => app.set(true))).toThrow(/fork_timing/);
  m.flushSync();
  const fork = m.fork(() => app.set(true));
  fork.discard();
});

test.skipIf(asyncRun)("without async mode there is no fork: it throws experimental_async_required, the flag is off, and the bundle is the same otherwise", async () => {
  const m = await loadFork("fork-fixture.svelte", { async: false });
  expect(m.asyncFlag()).toBe(false);
  expect(() => m.fork(() => {})).toThrow(/experimental_async_required/);
  expect((await loadFork("fork-fixture.svelte")).asyncFlag()).toBe(true);
});

test.skipIf(asyncRun)("for components that do not await, async mode changes the compiled output by one import line, and the library's components are such", () => {
  const root = resolve(import.meta.dirname, "..");
  const files = ["tests/fork-fixture.svelte", "tests/fork-panel.svelte", "src/Router.svelte", "src/RouteView.svelte", "src/components/Screen.svelte", "src/components/View.svelte", "src/components/Text.svelte", "src/components/ScrollView.svelte", "src/components/List.svelte"];
  for (const file of files) {
    const path = resolve(root, file);
    const options = componentOptions(path);
    const source = readFileSync(path, "utf8");
    const plain = compile(source, options).js.code;
    const asynchronous = compile(source, { ...options, experimental: { ...options.experimental, async: true } }).js.code;
    expect(asynchronous.replace("import 'svelte/internal/flags/async';\n", ""), file).toBe(plain);
    expect(asynchronous, file).toContain("import 'svelte/internal/flags/async';");
  }
});

test.skipIf(asyncRun)("components compiled with experimental.async fork as the ones that only import the flag do", async () => {
  const m = await loadFork("fork-fixture.svelte", { compiled: true });
  const root = new m.NativeNode("fragment");
  const log: string[] = [];
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: { log, rows: 3 } }) as unknown as Panel;
  await m.tick();
  log.length = 0;
  const fork = m.fork(() => app.set(true));
  expect(log).toEqual(["panel:init"]);
  await fork.commit();
  expect(log).toEqual(["panel:init", "panel:effect(0)", "panel:mount", "root:effect(show=true,count=0)"]);
});

test.skipIf(asyncRun)("async mode is one switch for the bundle: components compiled with it over components compiled without work, and one compiled with it turns it on for the rest", async () => {
  // The app's fixture and its page are compiled with the option (`withSvelteNative(config, { async: true })` compiles every file with it), the library's Router, Screen and the rest are not, and
  // the entry imports no flag module: the one import the compiled components carry turns the mode on, and `prepare` works across both kinds.
  const log: string[] = [];
  const scope = globalThis as { __forkLog?: string[]; __forkHold?: string[] };
  scope.__forkLog = log;
  scope.__forkHold = undefined;
  const m = await loadFork("fork-router-fixture.svelte", { async: false, compiled: (path) => /tests\/fork-(router-fixture|route-page)\.svelte$/.test(path) });
  expect(m.asyncFlag()).toBe(true);
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: {} }) as unknown as RouterApp;
  await settle(m);
  log.length = 0;
  const prepared = app.router.prepare("/b");
  expect(await prepared.ready).toBe(true);
  expect(log).toEqual(["page/b:init"]);
  prepared.commit();
  expect(app.router.entries.map((entry) => entry.url.pathname)).toEqual(["/", "/b"]);
  expect(log).toEqual(["page/b:init", "page/b:effect", "page/b:mount"]);
  // The other way round: a module of the library compiled with the option is enough to turn the mode on for an app that compiled none of its own.
  const library = await loadFork("fork-router-fixture.svelte", { async: false, compiled: (path) => path.endsWith("src/Router.svelte") });
  expect(library.asyncFlag()).toBe(true);
  expect((await loadFork("fork-router-fixture.svelte", { async: false })).asyncFlag()).toBe(false);
});

// (e) Cost.

test("(e) a 300-row screen: its nodes are all created inside the fork, the commit creates next to none, and Fabric is not asked for a node until the commit", async () => {
  // Counted, not timed (a millisecond comparison flakes under load): the Svelte-side work of mounting the screen is the creation of its nodes and the running of its components, and the
  // fork does it all; the commit attaches what the fork made and runs the effects. What Fabric builds, `create` per node, is the host's flush after the commit.
  const scope = globalThis as { __forkLog?: string[]; __forkRows?: number };
  scope.__forkLog = [];
  scope.__forkRows = 300;
  const m = await loadFork("fork-router-fixture.svelte", { realConfigs: true });
  const created: NativeNode[] = [];
  recordElements(m, created);
  const app = m.startSurface(200, m.Fixture, {}) as unknown as { router: Router };
  await settle(m);
  app.router.load(app.router.node.routes.find((route) => route.id === "heavy") as never);
  await sleep(0);
  await settle(m);
  const created0 = created.length;
  fabric.calls.length = 0;
  const fork = m.fork(() => app.router.goto("/heavy"));
  const inFork = created.length - created0;
  await settle(m);
  const fabricBeforeCommit = fabric.calls.filter((call) => call.startsWith("create")).length;
  const pending = fork.commit();
  await pending;
  await settle(m);
  const atCommit = created.length - created0 - inFork;
  const fabricAtCommit = fabric.calls.filter((call) => call.startsWith("create")).length;
  expect(inFork).toBeGreaterThanOrEqual(600);
  expect(atCommit).toBeLessThan(inFork / 10);
  expect(fabricBeforeCommit).toBe(0);
  expect(fabricAtCommit).toBeGreaterThanOrEqual(900);
  // The same navigation made directly, as the control: the nodes are created at the change, in the one flush, where the fork has already made them.
  const direct = await loadFork("fork-router-fixture.svelte", { realConfigs: true });
  const directCreated: NativeNode[] = [];
  recordElements(direct, directCreated);
  const other = direct.startSurface(201, direct.Fixture, {}) as unknown as { router: Router };
  await settle(direct);
  other.router.load(other.router.node.routes.find((route) => route.id === "heavy") as never);
  await sleep(0);
  await settle(direct);
  const before = directCreated.length;
  other.router.goto("/heavy");
  await settle(direct);
  expect(directCreated.length - before).toBe(inFork + atCommit);
});

// (d) The router.

type Route = { id: string };
type Router = {
  node: { routes: Route[] };
  entries: { url: URL }[];
  screens: { entry: { key: number; url: URL }; leaving: boolean }[];
  goto(href: string, navigation?: object): void;
  back(): boolean;
  exited(key: number): void;
  load(route: never): void;
  prepare(href: string, navigation?: object): { ready: Promise<boolean>; commit(): void; discard(): void };
};
type RouterApp = {
  router: Router; release(id: string): void; fail(id: string): void; loadLog(): string[];
  prepareFromEffect(href: string): void; effectState(): { runs: number; prepared?: ReturnType<Router["prepare"]> };
};

async function mountRouter(options: { hold?: string[]; async?: boolean } = {}) {
  const log: string[] = [];
  const scope = globalThis as { __forkLog?: string[]; __forkHold?: string[] };
  scope.__forkLog = log;
  scope.__forkHold = options.hold;
  const m = await loadFork("fork-router-fixture.svelte", { async: options.async ?? true });
  const created: NativeNode[] = [];
  recordElements(m, created);
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: {} }) as unknown as RouterApp;
  await settle(m);
  log.length = 0;
  const mounted = created.length;
  const paths = () => app.router.entries.map((entry) => entry.url.pathname);
  const count = (match: (node: NativeNode) => boolean) => { let found = 0; const visit = (node: NativeNode) => { if (match(node)) found++; node.getSnapshot().children.forEach(visit); }; visit(root); return found; };
  const screens = () => count((node) => node.name === "native-screen");
  const pageTexts = () => { const texts: string[] = []; const visit = (node: NativeNode) => { if (node.kind === "text" && /^page \//.test(node.textValue)) texts.push(node.textValue); node.getSnapshot().children.forEach(visit); }; visit(root); return texts; };
  return { m, root, app, log, paths, screens, pageTexts, created, mounted, route: (id: string) => app.router.node.routes.find((route) => route.id === id) as Route };
}

test("(d) fork(() => router.goto('/b')) with the route's modules loaded renders the page off screen, and the commit puts it on", async () => {
  const { m, app, log, paths, screens, pageTexts, route } = await mountRouter();
  app.router.load(route("b") as never);
  await settle(m);
  const fork = m.fork(() => app.router.goto("/b"));
  expect(log).toEqual(["page/b:init"]);
  expect(paths()).toEqual(["/"]);
  await settle(m);
  expect(log).toEqual(["page/b:init"]);
  expect(screens()).toBe(1);
  expect(pageTexts()).toEqual(["page /"]);
  const pending = fork.commit();
  expect(paths()).toEqual(["/", "/b"]);
  expect(screens()).toBe(2);
  expect(pageTexts()).toEqual(["page /", "page /b"]);
  expect(log).toEqual(["page/b:init", "page/b:effect", "page/b:mount"]);
  await pending;
});

test("(d) when the route's modules are still loading at the fork, the page renders when they arrive, outside the fork, and its effects run before the commit", async () => {
  const { m, app, log, paths } = await mountRouter({ hold: ["b"] });
  const fork = m.fork(() => app.router.goto("/b"));
  expect(log).toEqual([]);
  app.release("b");
  await settle(m);
  await sleep(0);
  // The pitfall `prepare` avoids by loading first: the page exists, and runs, though the navigation is not committed.
  expect(log).toEqual(["page/b:init", "page/b:effect", "page/b:mount"]);
  expect(paths()).toEqual(["/"]);
  await fork.commit();
  expect(paths()).toEqual(["/", "/b"]);
  expect(log).toEqual(["page/b:init", "page/b:effect", "page/b:mount"]);
});

test("router.prepare loads the modules, renders the screen off screen, and commit() puts it on with its effects run once", async () => {
  const { m, app, log, paths, screens, pageTexts } = await mountRouter();
  const prepared = app.router.prepare("/b");
  expect(app.loadLog()).toEqual(["home", "b"]);
  expect(await prepared.ready).toBe(true);
  expect(log).toEqual(["page/b:init"]);
  expect(paths()).toEqual(["/"]);
  expect(screens()).toBe(1);
  prepared.commit();
  expect(paths()).toEqual(["/", "/b"]);
  expect(pageTexts()).toEqual(["page /", "page /b"]);
  await settle(m);
  expect(log).toEqual(["page/b:init", "page/b:effect", "page/b:mount"]);
  // One of each: a second call does nothing.
  prepared.commit();
  prepared.discard();
  expect(paths()).toEqual(["/", "/b"]);
  expect(app.loadLog()).toEqual(["home", "b"]);
});

test("router.prepare gives the same tree and the same effects as goto", async () => {
  const direct = await mountRouter();
  direct.app.router.goto("/b");
  await sleep(0);
  await settle(direct.m);
  const prepared = await mountRouter();
  const handle = prepared.app.router.prepare("/b");
  await handle.ready;
  handle.commit();
  await settle(prepared.m);
  expect(shape(prepared.root)).toBe(shape(direct.root));
  expect(prepared.log).toEqual(direct.log);
  expect(prepared.paths()).toEqual(direct.paths());
});

test("router.prepare then discard changes nothing: the stack, the tree and the effects stay as they were, and a later goto works", async () => {
  const { m, root, app, log, paths, screens } = await mountRouter();
  const before = shape(root);
  const prepared = app.router.prepare("/b");
  expect(await prepared.ready).toBe(true);
  prepared.discard();
  await sleep(0);
  await settle(m);
  expect(shape(root)).toBe(before);
  expect(paths()).toEqual(["/"]);
  expect(log).toEqual(["page/b:init"]);
  prepared.commit(); // after a discard: nothing
  expect(paths()).toEqual(["/"]);
  app.router.goto("/b");
  await sleep(0);
  await settle(m);
  expect(paths()).toEqual(["/", "/b"]);
  expect(screens()).toBe(2);
  expect(log).toEqual(["page/b:init", "page/b:init", "page/b:effect", "page/b:mount"]);
});

test("router.prepare: a commit before the screen is ready is a plain goto, and the prepared screen is never made", async () => {
  const { m, app, log, paths, pageTexts } = await mountRouter({ hold: ["b"] });
  const prepared = app.router.prepare("/b");
  prepared.commit();
  expect(paths()).toEqual(["/", "/b"]);
  app.release("b");
  expect(await prepared.ready).toBe(false);
  await settle(m);
  expect(pageTexts()).toEqual(["page /", "page /b"]);
  expect(log).toEqual(["page/b:init", "page/b:effect", "page/b:mount"]);
  expect(app.loadLog()).toEqual(["home", "b"]);
});

test("router.prepare: a navigation that happened since makes commit() a goto from the state as it is now", async () => {
  const { m, app, log, paths } = await mountRouter();
  const prepared = app.router.prepare("/b");
  expect(await prepared.ready).toBe(true);
  app.router.goto("/c");
  await sleep(0);
  await settle(m);
  expect(paths()).toEqual(["/", "/c"]);
  log.length = 0;
  prepared.commit();
  await settle(m);
  // The stack b would have been pushed onto is not the stack there is now: b goes on top of c.
  expect(paths()).toEqual(["/", "/c", "/b"]);
  expect(log.filter((entry) => entry === "page/b:init")).toHaveLength(1);
  expect(log.filter((entry) => entry === "page/b:effect")).toHaveLength(1);
});

test("router.prepare: a newer prepare takes the screen of the one before it, and that one's commit() is then a plain goto, as every commit is", async () => {
  const { m, app, log, paths } = await mountRouter();
  const first = app.router.prepare("/b");
  expect(await first.ready).toBe(true);
  const second = app.router.prepare("/c");
  expect(await second.ready).toBe(true);
  // The first one's screen is gone (the tree holds one prepared screen): its commit navigates from the stack as it is.
  first.commit();
  await settle(m);
  expect(paths()).toEqual(["/", "/b"]);
  expect(log.filter((entry) => entry === "page/b:effect")).toHaveLength(1);
  // The second one's stack was the one before the first navigation, so it is made again from this one.
  second.commit();
  await settle(m);
  expect(paths()).toEqual(["/", "/b", "/c"]);
  expect(log.filter((entry) => entry === "page/c:effect")).toHaveLength(1);
});

test("router.prepare: discard() takes effect a task later, and a commit() before then wins; after it, commit() does nothing", async () => {
  const { m, app, log, paths } = await mountRouter();
  // Discard, then commit in the same task (what `Pressable` does after a press of 130 ms or more: `onPressOut`, then `onPress`).
  const pressed = app.router.prepare("/b");
  expect(await pressed.ready).toBe(true);
  pressed.discard();
  pressed.commit();
  await sleep(0);
  await settle(m);
  expect(paths()).toEqual(["/", "/b"]);
  expect(log).toEqual(["page/b:init", "page/b:effect", "page/b:mount"]);
  // Commit, then discard: nothing more.
  pressed.discard();
  await sleep(0);
  expect(paths()).toEqual(["/", "/b"]);
  // A discard that was not followed by a commit takes effect once the task is over, and then commit() has nothing to do.
  log.length = 0;
  const dropped = app.router.prepare("/c");
  expect(await dropped.ready).toBe(true);
  dropped.discard();
  dropped.discard();
  expect(paths()).toEqual(["/", "/b"]);
  await sleep(0);
  dropped.commit();
  await settle(m);
  expect(paths()).toEqual(["/", "/b"]);
  expect(log).toEqual(["page/c:init"]);
});

test("router.prepare: discard() settles ready as false although a module never arrives", async () => {
  const { app, paths } = await mountRouter({ hold: ["b"] });
  const prepared = app.router.prepare("/b");
  prepared.discard();
  expect(await prepared.ready).toBe(false);
  expect(paths()).toEqual(["/"]);
  // And a commit that comes first settles it too.
  const committed = app.router.prepare("/b");
  committed.commit();
  expect(await committed.ready).toBe(false);
  expect(paths()).toEqual(["/", "/b"]);
});

test("router.prepare: a screen that leaves while the navigation is prepared is not brought back by its commit", async () => {
  // A popped screen stays in `screens`, leaving, until the native stack reports its exit (`exited`). Svelte applies a fork's value over a write made after the fork, so a commit
  // that used the fork would put the screen that left back and lose the one that was pushed: the router sees the write and makes the navigation from the stack as it is.
  const { m, app, paths, screens, pageTexts } = await mountRouter();
  app.router.goto("/b");
  await sleep(0);
  await settle(m);
  expect(app.router.back()).toBe(true);
  await settle(m);
  const leaving = app.router.screens.find((screen) => screen.leaving);
  expect(leaving?.entry.url.pathname).toBe("/b");
  const prepared = app.router.prepare("/c");
  expect(await prepared.ready).toBe(true);
  app.router.exited(leaving?.entry.key as number);
  await settle(m);
  expect(app.router.screens.map((screen) => screen.entry.url.pathname)).toEqual(["/"]);
  prepared.commit();
  await settle(m);
  expect(paths()).toEqual(["/", "/c"]);
  expect(app.router.screens.map((screen) => `${screen.entry.url.pathname}${screen.leaving ? "!" : ""}`)).toEqual(["/", "/c"]);
  expect(screens()).toBe(2);
  expect(pageTexts()).toEqual(["page /", "page /c"]);
});

test("router.prepare called from an effect reads the stacks untracked: the effect does not run again when they change", async () => {
  const { m, app, paths } = await mountRouter();
  app.prepareFromEffect("/b");
  await settle(m);
  expect(app.effectState().runs).toBe(1);
  expect(await app.effectState().prepared?.ready).toBe(true);
  // The stacks change (a navigation, and the one prepared is stale for it): an effect that tracked them would run `prepare` again.
  app.router.goto("/c");
  await sleep(0);
  await settle(m);
  expect(paths()).toEqual(["/", "/c"]);
  expect(app.effectState().runs).toBe(1);
  app.effectState().prepared?.discard();
});

/** A touch at `x` on a stand-in for the view the press is on (the measured region is 100 by 100). */
const touch = (x: number): PressEvent => ({ nativeEvent: { pageX: x, pageY: x, touches: [{ pageX: x, pageY: x }] }, persist() {}, stopPropagation() {}, preventDefault() {} });

test("router.prepare with the library's own Pressability: the documented pattern (prepare on press in, commit on press, discard on press out) navigates for every press length, and not for a finger that slides off", async () => {
  // `Pressability` reports the end of a press that lasted 130 ms or more as `onPressOut` and then `onPress` in one task, and delays `onPressOut` for a shorter one until 130 ms.
  const press = async (held: number, slide = false) => {
    const t = await mountRouter();
    let prepared: ReturnType<Router["prepare"]> | undefined;
    const pressability = new Pressability({
      onPressIn: () => { prepared = t.app.router.prepare("/b"); },
      onPress: () => prepared?.commit(),
      onPressOut: () => prepared?.discard(),
    }, (callback) => callback(0, 0, 100, 100, 0, 0));
    const handlers = pressability.getEventHandlers() as ResponderHandlers;
    handlers.onStartShouldSetResponder?.(touch(5));
    handlers.onResponderGrant?.(touch(5));
    await sleep(held);
    if (slide) handlers.onResponderMove?.(touch(500));
    handlers.onResponderRelease?.(touch(slide ? 500 : 5));
    await sleep(250);
    await settle(t.m);
    pressability.reset();
    return { paths: t.paths(), log: t.log };
  };
  for (const held of [20, 129, 131, 400]) {
    // Navigated, once, by the screen that was prepared: it ran its script once and its effects after the commit.
    expect(await press(held), `${held} ms`).toEqual({ paths: ["/", "/b"], log: ["page/b:init", "page/b:effect", "page/b:mount"] });
  }
  // The finger slid off the view before it lifted (the press is cancelled, `onPress` never comes): nothing navigated, and the prepared screen was released.
  expect(await press(150, true), "slid off").toEqual({ paths: ["/"], log: ["page/b:init"] });
});

test("router.prepare: a discarded screen is collected (once the templates are used again), and a committed one is not", async () => {
  const { m, app, created, mounted } = await mountRouter();
  const prepare = async (href: string, then: "discard" | "commit") => {
    const handle = app.router.prepare(href);
    expect(await handle.ready).toBe(true);
    const nodes = created.slice(mounted).map((node) => new WeakRef(node));
    handle[then]();
    return nodes;
  };
  const refs = await prepare("/b", "discard");
  expect(refs.length).toBeGreaterThan(2);
  await settle(m);
  created.length = mounted;
  // The next screen made from the same templates lets the discarded one go (see the panel test above).
  const kept = await prepare("/c", "commit");
  await settle(m);
  created.length = mounted;
  expect(await collected(refs)).toBe(true);
  expect(await collected(kept, 3)).toBe(false);
});

test("router.prepare: navigations that remove screens are not prepared, and commit() is the goto", async () => {
  const { m, app, paths, log } = await mountRouter();
  app.router.goto("/b");
  await sleep(0);
  await settle(m);
  log.length = 0;
  const replacing = app.router.prepare("/c", { replaceState: true });
  expect(await replacing.ready).toBe(false);
  expect(log).toEqual([]);
  replacing.commit();
  await settle(m);
  expect(paths()).toEqual(["/", "/c"]);
  const same = app.router.prepare("/c"); // the page it is on: nothing to do
  expect(await same.ready).toBe(false);
  same.commit();
  expect(paths()).toEqual(["/", "/c"]);
});

test("router.prepare: a route that fails to load is not prepared, nothing changes, and commit() is the goto, which loads again", async () => {
  const { m, app, paths } = await mountRouter({ hold: ["b"] });
  const prepared = app.router.prepare("/b");
  app.fail("b");
  expect(await prepared.ready).toBe(false);
  await settle(m);
  expect(paths()).toEqual(["/"]);
  prepared.commit();
  expect(paths()).toEqual(["/", "/b"]);
  expect(app.loadLog()).toEqual(["home", "b", "b"]);
});

test("router.prepare: an unknown href throws as goto does", async () => {
  const { app } = await mountRouter();
  expect(() => app.router.prepare("/nowhere")).toThrow("No native screen for /nowhere");
  expect(() => app.router.goto("/nowhere")).toThrow("No native screen for /nowhere");
});

test.skipIf(asyncRun)("router.prepare without async mode: ready is false, one warning, and commit() is the goto", async () => {
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const { m, app, paths, screens } = await mountRouter({ async: false });
    const prepared = app.router.prepare("/b");
    expect(await prepared.ready).toBe(false);
    expect(paths()).toEqual(["/"]);
    prepared.commit();
    await m.tick();
    expect(paths()).toEqual(["/", "/b"]);
    expect(screens()).toBe(2);
    const again = app.router.prepare("/c");
    expect(await again.ready).toBe(false);
    again.discard();
  } finally {
    console.warn = warn;
  }
  expect(warnings.filter((args) => String(args[0]).includes("async mode"))).toHaveLength(1);
});

test("router.prepare on the Fabric host: Fabric builds nothing until commit(), and the screen is built by the commit's flush", async () => {
  const log: string[] = [];
  (globalThis as { __forkLog?: string[]; __forkHold?: string[] }).__forkLog = log;
  (globalThis as { __forkHold?: string[] }).__forkHold = undefined;
  const m = await loadFork("fork-router-fixture.svelte");
  fabric.calls.length = 0;
  const app = m.startSurface(41, m.Fixture, {}) as unknown as RouterApp;
  await settle(m);
  fabric.calls.length = 0;
  const prepared = app.router.prepare("/b");
  expect(await prepared.ready).toBe(true);
  await settle(m);
  expect(fabric.calls).toEqual([]);
  prepared.commit();
  await settle(m);
  expect(fabric.calls.filter((call) => call.startsWith("create")).length).toBeGreaterThan(0);
  expect(find(fabric.roots[41] ?? [], "RCTRawText").map((node) => node.props.text)).toContain("page /b");
});
