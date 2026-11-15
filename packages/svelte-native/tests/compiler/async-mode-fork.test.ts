import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "svelte/compiler";
import { componentOptions } from "../../src/compile-options.ts";
import { asyncRun } from "../async-run.ts";
import { loadFork } from "../fork-harness.ts";
import type { RouterApp } from "../navigation/support/fork-router.ts";
import { type Panel, restoreGlobalsAfterEach, settle } from "../renderer/support/fork.ts";

/**
 * What Svelte's async mode (`withSvelteNative(config, { async: true })`, `compile-options.ts`) does to the library's components, checked where it matters, with `fork()`: for a component that
 * does not await it adds one import line and nothing else, a bundle with some components compiled with it forks like one with the flag module imported first, and the mode is one switch for the
 * bundle. (`async-option.test.ts` and `svelte-async-mode.test.ts` check what the Metro transformer compiles.)
 */
restoreGlobalsAfterEach();

test.skipIf(asyncRun)("for components that do not await, async mode changes the compiled output by one import line, and the library's components are such", () => {
  const root = resolve(import.meta.dirname, "../..");
  const files = ["tests/renderer/fixtures/fork-fixture.svelte", "tests/renderer/fixtures/fork-panel.svelte", "src/Router.svelte", "src/RouteView.svelte", "src/components/Screen.svelte", "src/components/View.svelte", "src/components/Text.svelte", "src/components/ScrollView.svelte", "src/components/List.svelte"];
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
  const m = await loadFork("renderer/fixtures/fork-fixture.svelte", { compiled: true });
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
  const m = await loadFork("navigation/fixtures/fork-router-fixture.svelte", { async: false, compiled: (path) => /tests\/navigation\/fixtures\/fork-(router-fixture|route-page)\.svelte$/.test(path) });
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
  const library = await loadFork("navigation/fixtures/fork-router-fixture.svelte", { async: false, compiled: (path) => path.endsWith("src/Router.svelte") });
  expect(library.asyncFlag()).toBe(true);
  expect((await loadFork("navigation/fixtures/fork-router-fixture.svelte", { async: false })).asyncFlag()).toBe(false);
});
