import { afterEach, beforeEach, jest } from "bun:test";
import { resolve } from "node:path";
import { src } from "../../support/bundle.ts";
import { fakeHost } from "../../support/fake-host.ts";
import { loadRouter } from "../../support/router.ts";

/**
 * SvelteKit's modules on the device (`src/kit`): bundled the way Metro would resolve them (the library's file for each import) and run against the fake Fabric host, with the app shape
 * of `tests/tree-app.ts` (a root stack, a modal, a project's tabs with a stack in one pane). What the bundle's React Native stand-ins answer is chosen through globals
 * (`support/router.ts`): `__kitConstants` is the app's Expo config, `__kitUpdates` the `SvelteUpdates` native module, and `__kitOpened` collects what `Linking.openURL` was asked for.
 */
export type Entry = { url: URL; params: Record<string, string>; presentation: string };
export type Router = { entries: Entry[]; current: Entry; back(): boolean; goto(href: string, options?: object): void };
export type Module = {
  navigation: Record<string, (...args: never[]) => unknown> & { goto(url: string | URL, options?: object): Promise<void>; preloadCode(id: string): Promise<void> };
  state: { page: { url: URL; params: Record<string, string>; route: { id: string | null }; status: number; error: unknown; data: object; state: object; form: unknown; shallow: unknown }; navigating: Record<string, unknown>; updated: { current: boolean; check(): Promise<boolean> } };
  paths: { base: string; assets: string; asset(file: string): string; resolve(...args: unknown[]): string; match(url: string | URL): Promise<{ id: string; params: Record<string, string> } | null> };
  env: Record<string, unknown>;
  updates: { fetchUpdateAsync(): Promise<{ isNew: boolean }>; checkForUpdateAsync(): Promise<{ isAvailable: boolean }> };
  rootRouter(): Router | undefined;
  startSurface(tag: number, component: unknown, props: Record<string, unknown>): Record<string, () => Router>;
  stopSurface(tag: number): void;
  tick(): Promise<void>;
  Fixture: unknown;
  Reader: unknown;
};
type World = { __treeLog?: string[]; __DEV__?: boolean; __kitConstants?: unknown; __kitOpened: string[]; __kitSeen: string[]; __kitReads: string[]; __kitUpdates: unknown };

const fixtures = resolve(import.meta.dirname, "../fixtures");
const entry = `import Fixture from ${JSON.stringify(resolve(fixtures, "kit-fixture.svelte"))};
  import Reader from ${JSON.stringify(resolve(fixtures, "kit-reader.svelte"))};
  import { startSurface, stopSurface } from ${JSON.stringify(src("fabric/host.ts"))};
  import { tick } from 'svelte';
  export * as navigation from ${JSON.stringify(src("kit/navigation.ts"))};
  export * as state from ${JSON.stringify(src("kit/state.ts"))};
  export * as paths from ${JSON.stringify(src("kit/paths.ts"))};
  export * as env from ${JSON.stringify(src("kit/env.ts"))};
  export * as updates from ${JSON.stringify(src("updates/index.ts"))};
  export { rootRouter } from ${JSON.stringify(src("router.svelte.ts"))};
  export { startSurface, stopSurface, tick, Fixture, Reader };`;

/** What a test's page reads, as one line. */
export const where = (m: Module): string => `${m.state.page.url.pathname} ${JSON.stringify(m.state.page.params)} ${m.state.page.route.id}`;
export const pathsOf = (router: Router): string[] => router.entries.map((entry) => entry.url.pathname);
export const turn = async (m: Module): Promise<void> => { for (let step = 0; step < 8; step++) { await m.tick(); await Promise.resolve(); await Promise.resolve(); } };

/** The fake host and the loaders of a kit test file, with the state the stand-ins read (`world`) empty at the start of each test. Call it at the top level of the file. */
export function kitWorld() {
  const host = fakeHost({ globals: { __DEV__: true } });
  const world = globalThis as unknown as World;
  const surfaces: { m: Module; tag: number }[] = [];
  let surface = 700;

  /** A world with no answers: what a test starts with, and what a test that sets up a second scenario goes back to. */
  function freshWorld() {
    jest.useFakeTimers(); // the exit timer of a screen a navigation leaves must not fire into another test
    world.__kitOpened = [];
    world.__kitSeen = [];
    world.__kitReads = [];
    world.__kitUpdates = undefined;
    world.__kitConstants = undefined;
    world.__DEV__ = true;
    (globalThis as { __backHandlers?: unknown[] }).__backHandlers = [];
    (globalThis as { __linkHandlers?: unknown[] }).__linkHandlers = [];
    delete world.__treeLog;
  }
  beforeEach(freshWorld);
  afterEach(() => {
    for (const { m, tag } of surfaces.splice(0)) m.stopSurface(tag);
    jest.useRealTimers();
  });

  const load = () => loadRouter<Module>(entry);
  /** Starts `component` on a surface of its own (stopped when the test ends) and returns what it exports and the tag. */
  function startOn(m: Module, component: unknown, props: Record<string, unknown> = {}) {
    const tag = ++surface;
    const app = m.startSurface(tag, component, props);
    surfaces.push({ m, tag });
    return { app, tag };
  }
  async function mountApp(m: Module, props: Record<string, unknown> = {}) {
    const { app, tag } = startOn(m, m.Fixture, props);
    await turn(m);
    return { router: (app.root as () => Router)(), tag, settle: () => turn(m), inEffect: app.inEffect as unknown as (fn: () => unknown) => { runs(): number; stop(): void } };
  }
  return { host, world, load, startOn, mountApp, freshWorld };
}
