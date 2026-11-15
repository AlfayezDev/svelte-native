import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { src } from "../support/bundle.ts";
import type { NativeNode } from "../../src/renderer.ts";
import { hostGlobals, load, resize, settle, switchScheme, type World } from "./support/match-media-harness.ts";

/**
 * Svelte's own `MediaQuery` (`svelte/reactivity`) on the device: it calls `window.matchMedia` and listens with `svelte/events`' `on`, which a component reaches through the library's renderer.
 * The polyfills (`window.matchMedia`) are what is installed first, as on a device; the system is the stand-ins of `match-media-harness.ts`.
 */
const host = hostGlobals();
let world: World;

const fixtures = resolve(import.meta.dirname, "fixtures");
const entry = `import ${JSON.stringify(src("polyfills.ts"))};
  import { MediaQuery } from "svelte/reactivity";
  import Fixture from ${JSON.stringify(resolve(fixtures, "match-media-fixture.svelte"))};
  import renderer, { NativeNode } from ${JSON.stringify(src("renderer.ts"))};
  import { mergeHostProps } from ${JSON.stringify(src("native-props.ts"))};
  import { flushSync, mount, tick, unmount } from "svelte";
  export { watch } from ${JSON.stringify(resolve(fixtures, "match-media-fixture.svelte.ts"))};
  export { MediaQuery, Fixture, renderer, NativeNode, mergeHostProps, flushSync, mount, tick, unmount };`;

type Module = {
  MediaQuery: new (query: string, fallback?: boolean) => { current: boolean };
  Fixture: unknown;
  renderer: unknown;
  NativeNode: new (name: string) => NativeNode;
  mergeHostProps(props: unknown): { testID: string };
  mount(component: unknown, options: object): unknown;
  tick(): Promise<void>;
  unmount(app: unknown): void;
  watch(query: string): { media: { current: boolean }; seen: boolean[]; stop(): void };
};

const start = async (): Promise<Module> => load<Module>(entry);

beforeEach(() => { world = host.install(); });
afterAll(() => host.restore());

const nodes = (node: NativeNode): NativeNode[] => [node, ...node.getSnapshot().children.flatMap(nodes)];

async function mountFixture(m: Module, props: { queries: string[]; readers?: number }) {
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props });
  await m.tick();
  const drawn = () => nodes(root).filter((node) => node.name === "native-view").map((node) => m.mergeHostProps(node.getSnapshot().props).testID);
  return { app, drawn };
}

describe("MediaQuery through the polyfill", () => {
  test("constructing one needs nothing but window.matchMedia, and `current` is the system's answer as it is", async () => {
    const m = await start();
    const wide = new m.MediaQuery("min-width: 600px"); // Svelte wraps a bare feature in parentheses
    expect(wide.current).toBe(false);
    resize(world, { width: 700 });
    expect(wide.current).toBe(true);
    expect(new m.MediaQuery("(orientation: portrait)").current).toBe(true);
    expect(new m.MediaQuery("screen").current).toBe(true);
    expect(new m.MediaQuery("print").current).toBe(false);
    expect(new m.MediaQuery("screen and (min-width: 600px)").current).toBe(true);
    expect(new m.MediaQuery("(prefers-color-scheme: dark)").current).toBe(false);
    expect(new m.MediaQuery("hover: none").current).toBe(true);
    // A read outside an effect subscribes to nothing.
    expect(world.added).toBe(0);
  });

  test("inside an effect it follows the window: the effect runs again when the result flips, and only then", async () => {
    const m = await start();
    const { seen, stop } = m.watch("(min-width: 600px)");
    expect(seen).toEqual([false]);
    expect(world.listeners.dimensions.size).toBe(1);
    resize(world, { width: 500 });
    m.flushSync();
    expect(seen).toEqual([false]);
    resize(world, { width: 700 });
    m.flushSync();
    expect(seen).toEqual([false, true]);
    resize(world, { width: 800 });
    m.flushSync();
    expect(seen).toEqual([false, true]);
    resize(world, { width: 300 });
    m.flushSync();
    expect(seen).toEqual([false, true, false]);
    stop();
  });

  test("the effect that goes takes the system's listener with it: no leak when Svelte tears its subscriber down", async () => {
    const m = await start();
    const first = m.watch("(orientation: portrait)");
    const second = m.watch("(orientation: portrait)");
    const dark = m.watch("(prefers-color-scheme: dark)");
    expect([world.listeners.dimensions.size, world.listeners.appearance.size]).toEqual([1, 1]);
    first.stop();
    await settle();
    expect(world.listeners.dimensions.size).toBe(1); // the second effect still listens
    second.stop();
    dark.stop();
    await settle();
    expect([world.listeners.dimensions.size, world.listeners.appearance.size]).toEqual([0, 0]);
    expect(world.added).toBe(world.removed);
    // Reading again after the teardown subscribes anew.
    const again = m.watch("(orientation: portrait)");
    expect(world.listeners.dimensions.size).toBe(1);
    resize(world, { width: 900, height: 400 });
    m.flushSync();
    expect(again.seen).toEqual([true, false]);
    again.stop();
    await settle();
    expect(world.listeners.dimensions.size).toBe(0);
  });

  test("the scheme and a turn reach what reads them", async () => {
    const m = await start();
    const dark = m.watch("(prefers-color-scheme: dark)");
    const landscape = m.watch("(orientation: landscape)");
    expect([dark.seen, landscape.seen]).toEqual([[false], [false]]);
    switchScheme(world, "dark");
    resize(world, { width: 891, height: 411 });
    m.flushSync();
    expect([dark.seen, landscape.seen]).toEqual([[false, true], [false, true]]);
    switchScheme(world, "light");
    m.flushSync();
    expect(dark.seen).toEqual([false, true, false]);
    dark.stop();
    landscape.stop();
  });
});

describe("MediaQuery in a component, through the library's renderer", () => {
  test("a screen draws the answer and draws again when it flips", async () => {
    const m = await start();
    const { app, drawn } = await mountFixture(m, { queries: ["(min-width: 600px)", "(orientation: portrait)", "(prefers-color-scheme: dark)"] });
    expect(drawn()).toEqual(["0:false", "1:true", "2:false"]);
    resize(world, { width: 900, height: 500 });
    await m.tick();
    expect(drawn()).toEqual(["0:true", "1:false", "2:false"]);
    switchScheme(world, "dark");
    await m.tick();
    expect(drawn()).toEqual(["0:true", "1:false", "2:true"]);
    m.unmount(app);
  });

  test("readers share the system's listeners, and the last of them to go removes them", async () => {
    const m = await start();
    const { app, drawn } = await mountFixture(m, { queries: ["(min-width: 600px)", "(prefers-color-scheme: dark)"], readers: 3 });
    expect(drawn()).toHaveLength(6);
    expect([world.listeners.dimensions.size, world.listeners.appearance.size]).toEqual([1, 1]);
    resize(world, { width: 700 });
    await m.tick();
    expect(drawn().filter((line) => line.endsWith(":true"))).toHaveLength(3);
    m.unmount(app);
    await m.tick();
    await settle();
    expect([world.listeners.dimensions.size, world.listeners.appearance.size]).toEqual([0, 0]);
    expect(world.added).toBe(world.removed);
  });
});
