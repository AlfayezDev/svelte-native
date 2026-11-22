import { expect, test } from "bun:test";
import { resolve } from "node:path";
import type { NativeNode } from "../../src/renderer.ts";
import { load, src } from "../support/bundle.ts";

/**
 * `windowSize` and Svelte's `svelte/reactivity/window` values against a stand-in for React Native's Dimensions module: what a screen that reads them draws, when the window
 * changes, and the one listener its readers share. The stand-in is part of the bundle and its state is exported with the rest, so each test has a window of its own.
 */
type Size = { width: number; height: number; scale: number; fontScale: number };
type Dimensions = { window: Size; listeners: (() => void)[]; added: number; removed: number };

const dimensionsModule = `export const state = { window: { width: 400, height: 800, scale: 2, fontScale: 1 }, listeners: [], added: 0, removed: 0 };
  export default {
    get: (which) => which === "screen" ? { ...state.window, height: state.window.height + 48 } : state.window,
    addEventListener: (type, listener) => {
      state.added++;
      state.listeners.push(listener);
      return { remove() { state.removed++; state.listeners = state.listeners.filter((entry) => entry !== listener); } };
    },
  };`;

type Loaded = {
  Fixture: unknown; renderer: unknown; NativeNode: typeof NativeNode; mergeHostProps: (props: unknown) => Record<string, unknown>; windowSize: { width: number; fontScale: number; screen: unknown };
  mount: (component: unknown, options: object) => unknown; tick: () => Promise<void>; unmount: (app: unknown) => void; dimensions: Dimensions;
};

const loadModule = () => load<Loaded>({
  entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/window-size-fixture.svelte"))};
    import renderer, { NativeNode } from ${JSON.stringify(src("renderer.ts"))};
    import { mergeHostProps } from ${JSON.stringify(src("native-props.ts"))};
    import { windowSize } from ${JSON.stringify(src("window-size.ts"))};
    import { mount, tick, unmount } from 'svelte';
    export { state as dimensions } from 'react-native/Libraries/Utilities/Dimensions';
    export { Fixture, renderer, NativeNode, mergeHostProps, windowSize, mount, tick, unmount };`,
  stubs: { "react-native/Libraries/Utilities/Dimensions": dimensionsModule },
  converters: false,
});

function nodes(node: NativeNode): NativeNode[] { return [node, ...node.getSnapshot().children.flatMap(nodes)]; }

async function mountFixture(m: Loaded, readers = 1) {
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: { readers } });
  await m.tick();
  const drawn = () => nodes(root).filter((node) => node.name === "native-view").map((node) => m.mergeHostProps(node.getSnapshot().props).testID);
  return { app, drawn };
}

const resize = (dimensions: Dimensions, window: Partial<Size>) => {
  dimensions.window = { ...dimensions.window, ...window };
  for (const listener of [...dimensions.listeners]) listener();
};

test("a screen draws the window's size, and draws again when the window changes; Svelte's window values read the same", async () => {
  const m = await loadModule();
  const { app, drawn } = await mountFixture(m);
  expect(drawn()).toEqual(["0:400x800:narrow:400:2:undefined"]);
  resize(m.dimensions, { width: 820, height: 400 });
  await m.tick();
  expect(drawn()).toEqual(["0:820x400:wide:820:2:undefined"]);
  resize(m.dimensions, { scale: 3 });
  await m.tick();
  expect(drawn()).toEqual(["0:820x400:wide:820:3:undefined"]);
  m.unmount(app);
});

test("readers share one listener on Dimensions, and it is removed when the last of them goes", async () => {
  const m = await loadModule();
  const { app, drawn } = await mountFixture(m, 3);
  expect(drawn()).toHaveLength(3);
  expect(m.dimensions.added).toBe(1);
  m.unmount(app);
  await m.tick();
  expect(m.dimensions.removed).toBe(1);
  expect(m.dimensions.listeners).toEqual([]);
});

test("a read outside an effect gets the current value and subscribes to nothing", async () => {
  const m = await loadModule();
  m.dimensions.window = { width: 360, height: 780, scale: 3, fontScale: 1.3 };
  expect(m.windowSize.width).toBe(360);
  expect(m.windowSize.fontScale).toBe(1.3);
  expect(m.windowSize.screen).toEqual({ width: 360, height: 828 });
  expect(m.dimensions.added).toBe(0);
});
