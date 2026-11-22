import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { baseStubs, load as loadBundle, src } from "../support/bundle.ts";
import type { NativeNode } from "../../src/renderer.ts";

// `colorScheme.current` against a stand-in for React Native's Appearance module: what a screen that reads it draws, when the system
// switches between light and dark, and the one listener its readers share.
type Scheme = "light" | "dark" | null;
type Appearance = { scheme: Scheme; listeners: ((event: { colorScheme: Scheme }) => void)[]; added: number; removed: number };
/** The stand-in keeps its state in the bundle, and the entry hands it to the test: nothing is shared through the global object. */
const appearanceModule = `export const state = { scheme: "dark", listeners: [], added: 0, removed: 0 };
  export const getColorScheme = () => state.scheme;
  export const setColorScheme = (scheme) => { state.scheme = scheme; };
  export const addChangeListener = (listener) => {
    state.added++;
    state.listeners.push(listener);
    return { remove() { state.removed++; state.listeners = state.listeners.filter((entry) => entry !== listener); } };
  };`;
const entry = `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/color-scheme-fixture.svelte"))};
  import renderer, { NativeNode } from ${JSON.stringify(src("renderer.ts"))};
  import { mergeHostProps } from ${JSON.stringify(src("native-props.ts"))};
  import { state as appearance } from 'react-native/Libraries/Utilities/Appearance';
  import { mount, tick, unmount } from 'svelte';
  export { Fixture, renderer, NativeNode, mergeHostProps, appearance, mount, tick, unmount };`;

type Loaded = {
  Fixture: unknown; renderer: unknown; NativeNode: new (kind: string) => NativeNode; mergeHostProps: (props: Record<string, unknown>) => Record<string, unknown>;
  appearance: Appearance; mount: (...args: unknown[]) => unknown; tick: () => Promise<void>; unmount: (app: unknown) => void;
};
const load = () => loadBundle<Loaded>({ entry, stubs: { ...baseStubs(), "react-native/Libraries/Utilities/Appearance": appearanceModule }, converters: false });

function nodes(node: NativeNode): NativeNode[] { return [node, ...node.getSnapshot().children.flatMap(nodes)]; }

async function mountFixture(m: Loaded, readers = 1) {
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: { readers } });
  await m.tick();
  const drawn = () => nodes(root).filter((node) => node.name === "native-view").map((node) => m.mergeHostProps(node.getSnapshot().props).testID);
  return { app, drawn };
}

const notify = (m: Loaded, scheme: Scheme) => {
  m.appearance.scheme = scheme;
  for (const listener of [...m.appearance.listeners]) listener({ colorScheme: scheme });
};

test("a screen draws the system's scheme, and draws again when the user switches", async () => {
  const m = await load();
  m.appearance.scheme = "dark";
  const { app, drawn } = await mountFixture(m);
  expect(drawn()).toEqual(["0:dark"]);
  notify(m, "light");
  await m.tick();
  expect(drawn()).toEqual(["0:light"]);
  // A system that reports no scheme is light, as React Native's own views are.
  notify(m, null);
  await m.tick();
  expect(drawn()).toEqual(["0:light"]);
  notify(m, "dark");
  await m.tick();
  expect(drawn()).toEqual(["0:dark"]);
  m.unmount(app);
});

test("readers share one listener on the system, and it is removed when the last of them goes", async () => {
  const m = await load();
  m.appearance.scheme = "light";
  const { app, drawn } = await mountFixture(m, 3);
  expect(drawn()).toEqual(["0:light", "1:light", "2:light"]);
  expect(m.appearance.added).toBe(1);
  notify(m, "dark");
  await m.tick();
  expect(drawn()).toEqual(["0:dark", "1:dark", "2:dark"]);
  m.unmount(app);
  await m.tick();
  expect(m.appearance.removed).toBe(1);
  expect(m.appearance.listeners).toEqual([]);
});
