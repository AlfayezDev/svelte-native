import { expect, test } from "bun:test";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import type { NativeNode } from "../src/renderer.ts";

// `windowSize` and Svelte's `svelte/reactivity/window` values against a stand-in for React Native's Dimensions module: what a screen that
// reads them draws, when the window changes, and the one listener its readers share.
type Size = { width: number; height: number; scale: number; fontScale: number };
const dimensions = { window: { width: 400, height: 800, scale: 2, fontScale: 1 } as Size, listeners: [] as (() => void)[], added: 0, removed: 0 };
(globalThis as { __dimensions?: unknown }).__dimensions = dimensions;
const dimensionsModule = `const stub = globalThis.__dimensions;
  export default {
    get: (which) => which === "screen" ? { ...stub.window, height: stub.window.height + 48 } : stub.window,
    addEventListener: (type, listener) => {
      stub.added++;
      stub.listeners.push(listener);
      return { remove() { stub.removed++; stub.listeners = stub.listeners.filter((entry) => entry !== listener); } };
    },
  };`;

async function load() {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './window-size-fixture.svelte';
        import renderer, { NativeNode } from '../src/renderer.ts';
        import { mergeHostProps } from '../src/native-props.ts';
        import { windowSize } from '../src/window-size.ts';
        import { mount, tick, unmount } from 'svelte';
        export { Fixture, renderer, NativeNode, mergeHostProps, windowSize, mount, tick, unmount };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "window-size-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^react-native\/Libraries\// }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onResolve({ filter: /^(react-native|expo-modules-core)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: args.path.endsWith("/Dimensions") ? dimensionsModule : "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({ contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code, loader: "js" }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-window-size-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0]?.contents ?? "");
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}

function nodes(node: NativeNode): NativeNode[] { return [node, ...node.getSnapshot().children.flatMap(nodes)]; }

async function mountFixture(m: Awaited<ReturnType<typeof load>>, readers = 1) {
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props: { readers } });
  await m.tick();
  const drawn = () => nodes(root).filter((node) => node.name === "native-view").map((node) => m.mergeHostProps(node.getSnapshot().props).testID);
  return { app, drawn };
}

const resize = (window: Partial<Size>) => {
  dimensions.window = { ...dimensions.window, ...window };
  for (const listener of [...dimensions.listeners]) listener();
};

test("a screen draws the window's size, and draws again when the window changes; Svelte's window values read the same", async () => {
  const m = await load();
  dimensions.window = { width: 400, height: 800, scale: 2, fontScale: 1 };
  const { app, drawn } = await mountFixture(m);
  expect(drawn()).toEqual(["0:400x800:narrow:400:2:undefined"]);
  resize({ width: 820, height: 400 });
  await m.tick();
  expect(drawn()).toEqual(["0:820x400:wide:820:2:undefined"]);
  resize({ scale: 3 });
  await m.tick();
  expect(drawn()).toEqual(["0:820x400:wide:820:3:undefined"]);
  m.unmount(app);
});

test("readers share one listener on Dimensions, and it is removed when the last of them goes", async () => {
  const m = await load();
  const [added, removed] = [dimensions.added, dimensions.removed];
  const { app, drawn } = await mountFixture(m, 3);
  expect(drawn()).toHaveLength(3);
  expect(dimensions.added - added).toBe(1);
  m.unmount(app);
  await m.tick();
  expect(dimensions.removed - removed).toBe(1);
  expect(dimensions.listeners).toEqual([]);
});

test("a read outside an effect gets the current value and subscribes to nothing", async () => {
  const m = await load();
  const added = dimensions.added;
  dimensions.window = { width: 360, height: 780, scale: 3, fontScale: 1.3 };
  expect(m.windowSize.width).toBe(360);
  expect(m.windowSize.fontScale).toBe(1.3);
  expect(m.windowSize.screen).toEqual({ width: 360, height: 828 });
  expect(dimensions.added).toBe(added);
});
