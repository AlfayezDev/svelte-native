import { expect, test } from "bun:test";
import type { NativeNode } from "../../src/renderer.ts";
import { asyncRun } from "../support/async-run.ts";
import { fabric, loadFork } from "../support/fork-harness.ts";
import type { Router } from "../navigation/support/fork-router.ts";
import { collected, mountPanel, reachable, recordElements, restoreGlobalsAfterEach, settle, shape, sleep, surfacePanel, top } from "./support/fork.ts";

/**
 * Svelte 5's `fork()` (experimental, async mode) against this library's custom renderer and Fabric host: what a fork builds off screen, what the host can see of it, what a commit and a
 * discard do, and what it costs. The harness (`fork-harness.ts`) turns Svelte's async mode on, which the library leaves off unless the app asks for it (`compile-options.ts`); what the
 * option does to the compiled components is `compiler/async-mode-fork.test.ts`'s, and the router's `prepare` built on `fork()` is `navigation/prepare.test.ts`'s (`prepare-tree.test.ts` runs it
 * over the stand-in app's tree).
 */
restoreGlobalsAfterEach();

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

test("a fork flushes a state change that is pending first, and cannot be made inside an effect or another fork: fork_timing", async () => {
  const { m, app } = await mountPanel();
  // Svelte before 5.59 threw fork_timing for a change that was still pending, and flushSync first made room.
  app.bump();
  const fork = m.fork(() => app.set(true));
  fork.discard();
  expect(() => m.fork(() => { m.fork(() => app.set(true)); })).toThrow(/fork_timing/);
  expect(app.get()).toBe(false);
});

test.skipIf(asyncRun)("without async mode there is no fork: it throws experimental_async_required, the flag is off, and the bundle is the same otherwise", async () => {
  const m = await loadFork("renderer/fixtures/fork-fixture.svelte", { async: false });
  expect(m.asyncFlag()).toBe(false);
  expect(() => m.fork(() => {})).toThrow(/experimental_async_required/);
  expect((await loadFork("renderer/fixtures/fork-fixture.svelte")).asyncFlag()).toBe(true);
});

// (e) Cost.

test("(e) a 300-row screen: its nodes are all created inside the fork, the commit creates next to none, and Fabric is not asked for a node until the commit", async () => {
  // Counted, not timed (a millisecond comparison flakes under load): the Svelte-side work of mounting the screen is the creation of its nodes and the running of its components, and the
  // fork does it all; the commit attaches what the fork made and runs the effects. What Fabric builds, `create` per node, is the host's flush after the commit.
  const scope = globalThis as { __forkLog?: string[]; __forkRows?: number };
  scope.__forkLog = [];
  scope.__forkRows = 300;
  const m = await loadFork("navigation/fixtures/fork-router-fixture.svelte", { realConfigs: true });
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
  const direct = await loadFork("navigation/fixtures/fork-router-fixture.svelte", { realConfigs: true });
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
