import { expect, test } from "bun:test";
import { Pressability, type PressEvent, type ResponderHandlers } from "../../src/fabric/pressability.ts";
import { asyncRun } from "../support/async-run.ts";
import { fabric, find, loadFork } from "../support/fork-harness.ts";
import { collected, restoreGlobalsAfterEach, settle, shape, sleep } from "../renderer/support/fork.ts";
import { type Router, type RouterApp, mountRouter } from "./support/fork-router.ts";

/**
 * `router.prepare` (experimental): the screen's modules load, the screen is rendered off screen in a Svelte `fork()`, and `commit()` puts it on. The fork underneath is `renderer/fork.test.ts`'s,
 * `prepare-tree.test.ts` runs `prepare` over the stand-in app's whole tree, and `prepare-lifecycle.test.ts` is its disposal. The fixture is `fixtures/fork-router-fixture.svelte`.
 */
restoreGlobalsAfterEach();

test("when the route's modules are still loading at the fork, the page renders when they arrive, outside the fork, and its effects run before the commit", async () => {
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
  expect(pageTexts()).toEqual(["page /"]);
  prepared.commit();
  // The commit is synchronous: the stack and the tree have the screen when it returns.
  expect(paths()).toEqual(["/", "/b"]);
  expect(screens()).toBe(2);
  expect(pageTexts()).toEqual(["page /", "page /b"]);
  await settle(m);
  expect(log).toEqual(["page/b:init", "page/b:effect", "page/b:mount"]);
  // One of each: a second call does nothing.
  prepared.commit();
  prepared.discard();
  expect(paths()).toEqual(["/", "/b"]);
  expect(app.loadLog()).toEqual(["home", "b"]);
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
  const m = await loadFork("navigation/fixtures/fork-router-fixture.svelte");
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

