import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import type { NativeNode } from "../src/renderer.ts";
import { fabric, find, loadFork, type ForkModule } from "./fork-harness.ts";

/**
 * Svelte 5's `fork()` (experimental, async mode) against this library's custom renderer and Fabric host: what a fork builds off screen, what the host can see of it, what a commit
 * and a discard do, and the router's `prepare` built on it. The harness (`fork-harness.ts`) compiles every component with `experimental.async`, which the library's own
 * options leave off (`compile-options.ts`, `svelte-async-mode.test.ts`).
 */
/** `SVELTE_NATIVE_TEST_ASYNC` (`async-mode-setup.ts`) compiles every component with async mode, so a control that needs it off cannot run. */
const asyncRun = process.env.SVELTE_NATIVE_TEST_ASYNC !== undefined && process.env.SVELTE_NATIVE_TEST_ASYNC !== "frames";
const settle = async (m: ForkModule) => { m.flushSync(); await Promise.resolve(); await Promise.resolve(); };
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

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

test("(e) a 300-row screen: most of its Svelte-side mount happens inside the fork, and Fabric is not asked for anything until the commit", async () => {
  const log: string[] = [];
  const scope = globalThis as { __forkLog?: string[]; __forkRows?: number; __svelteFabricProfile?: boolean; __svelteFlushLog?: { ms: number; created: number }[] };
  scope.__forkLog = log;
  scope.__forkRows = 300;
  scope.__svelteFabricProfile = true;
  const m = await loadFork("fork-router-fixture.svelte", { realConfigs: true });
  const inFork: number[] = [];
  const atCommit: number[] = [];
  const direct: number[] = [];
  let createdBeforeCommit = 0;
  let createdAtCommit = 0;
  for (let trial = 0; trial < 11; trial++) {
    for (const mode of ["direct", "fork"] as const) {
      const app = m.startSurface(200 + trial * 2 + (mode === "fork" ? 1 : 0), m.Fixture, {}) as unknown as { router: Router };
      await settle(m);
      const heavy = app.router.node.routes.find((route) => route.id === "heavy");
      app.router.load(heavy as never);
      await sleep(0);
      await settle(m);
      fabric.calls.length = 0;
      scope.__svelteFlushLog = [];
      const hostMs = () => (scope.__svelteFlushLog ?? []).reduce((sum, entry) => sum + entry.ms, 0);
      if (mode === "direct") {
        const start = performance.now();
        app.router.goto("/heavy");
        await settle(m);
        direct.push(performance.now() - start - hostMs());
        continue;
      }
      const start = performance.now();
      const fork = m.fork(() => app.router.goto("/heavy"));
      inFork.push(performance.now() - start);
      await settle(m);
      createdBeforeCommit = fabric.calls.filter((call) => call.startsWith("create")).length;
      const committing = performance.now();
      const pending = fork.commit();
      await pending;
      await settle(m);
      atCommit.push(performance.now() - committing - hostMs());
      createdAtCommit = fabric.calls.filter((call) => call.startsWith("create")).length;
    }
  }
  expect(createdBeforeCommit).toBe(0);
  expect(createdAtCommit).toBeGreaterThanOrEqual(900);
  // The Svelte-side work is moved, not removed: about the same in all (direct vs fork + commit), and the commit is the smaller part.
  expect(median(inFork)).toBeGreaterThan(median(atCommit));
  expect(median(inFork) + median(atCommit)).toBeLessThan(median(direct) * 2);
});

// (d) The router.

type Route = { id: string };
type Router = {
  node: { routes: Route[] };
  entries: { url: URL }[];
  goto(href: string, navigation?: object): void;
  load(route: never): void;
  prepare(href: string, navigation?: object): { ready: Promise<boolean>; commit(): void; discard(): void };
};
type RouterApp = { router: Router; release(id: string): void; fail(id: string): void; loadLog(): string[] };

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

test("router.prepare: a newer prepare discards the one before it, and the tree has one prepared screen at a time", async () => {
  const { m, app, log, paths } = await mountRouter();
  const first = app.router.prepare("/b");
  expect(await first.ready).toBe(true);
  const second = app.router.prepare("/c");
  expect(await second.ready).toBe(true);
  first.commit(); // discarded by the second: nothing
  expect(paths()).toEqual(["/"]);
  second.commit();
  await settle(m);
  expect(paths()).toEqual(["/", "/c"]);
  expect(log.filter((entry) => entry.endsWith(":effect"))).toEqual(["page/c:effect"]);
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
