import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { hmrState } from "../../src/hmr-state.ts";
import { appSurface } from "../support/app-surface.ts";

/**
 * The life of an app's surfaces in the host (`fabric/index.ts`, `src/app-hooks.ts`): a hot update that mounts the fresh app on the same root tag with the router's stack kept, the error
 * screen when the root throws and `showError` over a running surface, and `src/hooks.mobile.ts`'s `init` (the surfaces wait for it, a failure is the error screen in development and fatal in a release
 * build, an edit made while it is in flight). What of the navigation survives a recreation or a dead process is in `navigation/surface-restore.test.ts`.
 */
const { runnables, commits, load: bundleApp, texts, forget, settle, stopSurface } = appSurface();
const load = (fixture = "hmr-fixture.svelte") => bundleApp(resolve(import.meta.dirname, "fixtures", fixture));

test("remountSurfaces unmounts the old tree and mounts the fresh app on the same root tag with the router stack kept", async () => {
  const m = await load();
  forget();
  m.createFabricApp(m.Fixture, { label: "v1" });
  runnables.main({ rootTag: 31, initialProps: { extra: 1 } });
  expect(texts(31)).toEqual(["v1:/:1"]);

  // The surface's exports are not reachable through the runnable, so navigate through the router the fixture created.
  expect(hmrState().navigation?.()).toEqual({ stack: { entries: [{ route: "/", href: "/", presentation: "push" }] } });

  // A hot update re-runs the entry: same registration call, new component props.
  const first = commits.length;
  const oldTags = commits[first - 1].tags;
  m.createFabricApp(m.Fixture, { label: "v2" });
  m.remountSurfaces();
  await settle(m);
  const sequence = commits.slice(first).filter((c) => c.root === 31);
  expect(sequence[0].tags).toEqual([]);
  expect(sequence.at(-1)?.tags.length).toBe(1);
  expect(sequence.at(-1)?.tags[0]).not.toBe(oldTags[0]);
  expect(texts(31)).toEqual(["v2:/:1"]);
});

test("the navigation stack survives a remount", async () => {
  const m = await load();
  forget();
  m.createFabricApp(m.Fixture, { label: "v1" });
  runnables.main({ rootTag: 32 });
  const hot = hmrState();
  // Drive the router through the navigation hook the fixture registered: replace it with a two-screen stack, as after two `goto` calls.
  const saved = { entries: [{ href: "/a", presentation: "push" as const }, { href: "/b?x=1", presentation: "push" as const }] };
  hot.navigation = () => ({ stack: saved });
  (globalThis as { __routeLoads?: string[] }).__routeLoads = [];
  m.remountSurfaces();
  await settle(m);
  expect(texts(32)).toEqual(["v1:/b:2"]);
  expect((globalThis as { __routeLoads?: string[] }).__routeLoads).toEqual(["/a", "/b"]); // the adopted stack's routes load again when their screens render; the others wait for a navigation
  // A snapshot without route ids restores by href; the next one records them.
  expect(hot.navigation()).toEqual({ stack: { entries: [{ route: "/a", href: "/a", presentation: "push" }, { route: "/b", href: "/b?x=1", presentation: "push" }] } });
  expect(hot.restore).toBeUndefined();
});

test("an error thrown by the root during mount mounts the error screen, and Reload recovers", async () => {
  const m = await load();
  forget();
  const logged = console.error;
  console.error = () => {};
  try {
    m.createFabricApp(m.Fixture, { boom: true });
    runnables.main({ rootTag: 33 });
  } finally { console.error = logged; }
  expect(texts(33)).toContain("kaboom");
  expect(texts(33)).toContain("Reload");
  expect(texts(33)).toContain("Error");

  // The next successful evaluation of the entry plus a remount (what the Reload button schedules) replaces the error screen.
  m.createFabricApp(m.Fixture, { label: "fixed" });
  m.remountSurfaces();
  await settle(m);
  expect(texts(33)).toEqual(["fixed:/:1"]);
});

test("showError draws the screen over a running surface and reports whether it could", async () => {
  const m = await load();
  forget();
  m.createFabricApp(m.Fixture, { label: "v1" });
  runnables.main({ rootTag: 34 });
  const error = new Error("late failure");
  expect(m.showError(error)).toBe(true);
  expect(texts(34)).toContain("late failure");
  expect(m.showError(error, [])).toBe(false);
});


/** A promise and the functions that settle it. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("src/hooks.mobile.ts", () => {
  test("init runs once when the hooks register, before any surface; a surface the host starts meanwhile waits for its promise", async () => {
      const m = await load();
    forget();
    const gate = deferred();
    let runs = 0;
    m.registerHooks({ init: () => { runs += 1; return gate.promise; } });
    expect(runs).toBe(1);
    m.createFabricApp(m.Fixture, { label: "after init" });
    runnables.main({ rootTag: 51 });
    await settle(m);
    expect(commits.filter((commit) => commit.root === 51)).toEqual([]); // nothing on the surface: the splash screen stays up
    // A hot update of the file while it is in flight keeps that one (its own init would run only if that one failed).
    m.registerHooks({ init: () => { runs += 1; } });
    gate.resolve();
    await settle(m);
    expect(texts(51)).toEqual(["after init:/:1"]);
    // Once it has run, a hot update of the file does not run it again, and a new surface starts at once.
    m.registerHooks({ init: () => { runs += 1; } });
    runnables.main({ rootTag: 52 });
    expect(texts(52)).toEqual(["after init:/:1"]);
    expect(runs).toBe(1);
  });

  test("an app without init, or with a synchronous one, starts its surfaces at once", async () => {
      const m = await load();
    forget();
    const order: string[] = [];
    m.registerHooks({ init: () => { order.push("init"); } });
    m.createFabricApp(m.Fixture, { label: "sync" });
    runnables.main({ rootTag: 53 });
    expect(texts(53)).toEqual(["sync:/:1"]);
    expect(order).toEqual(["init"]);
  });

  test("a surface the host stops while it waits for init never starts", async () => {
      const m = await load();
    forget();
    const gate = deferred();
    m.registerHooks({ init: () => gate.promise });
    m.createFabricApp(m.Fixture, { label: "x" });
    runnables.main({ rootTag: 54 });
    stopSurface(54);
    runnables.main({ rootTag: 55 });
    gate.resolve();
    await settle(m);
    expect(commits.filter((commit) => commit.root === 54)).toEqual([]);
    expect(texts(55)).toEqual(["x:/:1"]);
  });

  test("in development a failed init is the error screen, and the next evaluation of the file runs it again", async () => {
      const m = await load();
    forget();
    const logged = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      const gate = deferred();
      m.registerHooks({ init: () => gate.promise });
      m.createFabricApp(m.Fixture, { label: "x" });
      runnables.main({ rootTag: 56 });
      gate.reject(new Error("no DSN"));
      await settle(m);
      expect(texts(56)).toContain("no DSN");
      expect(texts(56)).toContain("Reload");
      expect(errors.map((args) => args[0])).toContain("src/hooks.mobile: init failed");
      // A remount alone does not run the app without its init.
      m.remountSurfaces();
      expect(texts(56)).toContain("no DSN");
      // A throw is a failure too.
      m.registerHooks({ init: () => { throw new Error("thrown at once"); } });
      m.remountSurfaces();
      expect(texts(56)).toContain("thrown at once");
      // The fix: the hot update registers the file again (init runs), and the entry's accept remounts.
      let runs = 0;
      m.registerHooks({ init: async () => { runs += 1; } });
      m.createFabricApp(m.Fixture, { label: "fixed" });
      m.remountSurfaces();
      await settle(m);
      expect(runs).toBe(1);
      expect(texts(56)).toEqual(["fixed:/:1"]);
    } finally { console.error = logged; }
  });

  test("the error screen's Reload runs a failed init again, and the screens wait for it", async () => {
      const m = await load();
    forget();
    const logged = console.error;
    console.error = () => {};
    try {
      let attempts = 0;
      const gates = [deferred(), deferred()];
      m.registerHooks({ init: () => gates[attempts++].promise });
      m.createFabricApp(m.Fixture, { label: "online" });
      runnables.main({ rootTag: 58 });
      gates[0].reject(new Error("offline"));
      await settle(m);
      expect(texts(58)).toContain("offline");
      // What Reload does: retry, then remount. The error screen stays until the second attempt settles.
      expect(m.retryInit()).toBe(true);
      expect(m.retryInit()).toBe(false); // one at a time
      m.remountSurfaces();
      expect(texts(58)).toContain("offline");
      gates[1].resolve();
      await settle(m);
      expect(attempts).toBe(2);
      expect(texts(58)).toEqual(["online:/:1"]);
      expect(m.retryInit()).toBe(false); // nothing failed
    } finally { console.error = logged; }
  });

  test("an edit made while init is in flight runs once that init has failed", async () => {
      const m = await load();
    forget();
    const logged = console.error;
    console.error = () => {};
    try {
      const slow = deferred();
      m.registerHooks({ init: () => slow.promise });
      m.createFabricApp(m.Fixture, { label: "x" });
      runnables.main({ rootTag: 59 });
      let fixed = 0;
      m.registerHooks({ init: () => { fixed += 1; } }); // the fix, saved while the first is still running
      m.createFabricApp(m.Fixture, { label: "fixed" });
      m.remountSurfaces();
      expect(fixed).toBe(0);
      slow.reject(new Error("bad key"));
      await settle(m);
      expect(fixed).toBe(1);
      expect(texts(59)).toEqual(["fixed:/:1"]);
    } finally { console.error = logged; }
  });

  test("a hot update that runs init for the first time (the file was just added) keeps the screens and their navigation until it settles", async () => {
      const m = await load();
    forget();
    m.registerHooks({});
    m.createFabricApp(m.Fixture, { label: "v1" });
    runnables.main({ rootTag: 60 });
    expect(texts(60)).toEqual(["v1:/:1"]);
    const state = hmrState() as { navigation?: () => unknown };
    const before = JSON.stringify(state.navigation?.());
    // The file appears: the generated module registers it (its init starts), the entry runs again and accepts the update.
    const gate = deferred();
    m.registerHooks({ init: () => gate.promise });
    m.createFabricApp(m.Fixture, { label: "v2" });
    m.remountSurfaces();
    expect(texts(60)).toEqual(["v1:/:1"]); // still the running app, not a blank surface
    gate.resolve();
    await settle(m);
    expect(texts(60)).toEqual(["v2:/:1"]);
    expect(JSON.stringify(state.navigation?.())).toBe(before);
  });

  test("a surface the host stops while it waits leaves nothing behind for the next remount", async () => {
      const m = await load();
    forget();
    const logged = console.error;
    console.error = () => {};
    try {
      const first = deferred();
      m.registerHooks({ init: () => first.promise });
      m.createFabricApp(m.Fixture, { label: "x" });
      runnables.main({ rootTag: 61 });
      first.reject(new Error("failed"));
      await settle(m);
      expect(texts(61)).toContain("failed"); // the error screen: the surface is a running one now
      const second = deferred();
      m.registerHooks({ init: () => second.promise });
      stopSurface(61); // the Activity goes while the fix's init runs
      second.resolve();
      await settle(m);
      expect(hmrState().surfaces.has(61)).toBe(false);
      const committed = commits.length;
      m.remountSurfaces();
      expect(commits.length).toBe(committed);
    } finally { console.error = logged; }
  });

  test("in a release build a failed init is a fatal error, and no surface starts", async () => {
      const m = await load();
    forget();
    const scope = globalThis as { __DEV__?: boolean; ErrorUtils?: unknown };
    const fatal: unknown[] = [];
    scope.__DEV__ = false;
    scope.ErrorUtils = { reportFatalError: (error: unknown) => { fatal.push(error); } };
    try {
      const gate = deferred();
      m.registerHooks({ init: () => gate.promise });
      m.createFabricApp(m.Fixture, { label: "x" });
      runnables.main({ rootTag: 57 });
      const error = new Error("init failed in release");
      gate.reject(error);
      await settle(m);
      expect(fatal).toEqual([error]);
      expect(commits.filter((commit) => commit.root === 57)).toEqual([]);
    } finally {
      scope.__DEV__ = true;
      delete scope.ErrorUtils;
    }
  });
});
