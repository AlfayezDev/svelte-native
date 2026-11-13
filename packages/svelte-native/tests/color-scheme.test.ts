import { expect, test } from "bun:test";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import type { NativeNode } from "../src/renderer.ts";

// `colorScheme.current` against a stand-in for React Native's Appearance module: what a screen that reads it draws, when the system
// switches between light and dark, and the one listener its readers share.
type Scheme = "light" | "dark" | null;
const appearance = { scheme: "dark" as Scheme, listeners: [] as ((event: { colorScheme: Scheme }) => void)[], added: 0, removed: 0 };
(globalThis as { __appearance?: unknown }).__appearance = appearance;
const appearanceModule = `const stub = globalThis.__appearance;
  export const getColorScheme = () => stub.scheme;
  export const setColorScheme = (scheme) => { stub.scheme = scheme; };
  export const addChangeListener = (listener) => {
    stub.added++;
    stub.listeners.push(listener);
    return { remove() { stub.removed++; stub.listeners = stub.listeners.filter((entry) => entry !== listener); } };
  };`;

async function load() {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './color-scheme-fixture.svelte';
        import renderer, { NativeNode } from '../src/renderer.ts';
        import { mergeHostProps } from '../src/native-props.ts';
        import { mount, tick, unmount } from 'svelte';
        export { Fixture, renderer, NativeNode, mergeHostProps, mount, tick, unmount };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "color-scheme-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^react-native\/Libraries\// }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onResolve({ filter: /^(react-native|expo-modules-core)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: args.path.endsWith("/Appearance") ? appearanceModule : "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@alfayez\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({ contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code, loader: "js" }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-color-scheme-"));
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

const notify = (scheme: Scheme) => {
  appearance.scheme = scheme;
  for (const listener of [...appearance.listeners]) listener({ colorScheme: scheme });
};

test("a screen draws the system's scheme, and draws again when the user switches", async () => {
  const m = await load();
  appearance.scheme = "dark";
  const { app, drawn } = await mountFixture(m);
  expect(drawn()).toEqual(["0:dark"]);
  notify("light");
  await m.tick();
  expect(drawn()).toEqual(["0:light"]);
  // A system that reports no scheme is light, as React Native's own views are.
  notify(null);
  await m.tick();
  expect(drawn()).toEqual(["0:light"]);
  notify("dark");
  await m.tick();
  expect(drawn()).toEqual(["0:dark"]);
  m.unmount(app);
});

test("readers share one listener on the system, and it is removed when the last of them goes", async () => {
  const m = await load();
  appearance.scheme = "light";
  const [added, removed] = [appearance.added, appearance.removed];
  const { app, drawn } = await mountFixture(m, 3);
  expect(drawn()).toEqual(["0:light", "1:light", "2:light"]);
  expect(appearance.added - added).toBe(1);
  notify("dark");
  await m.tick();
  expect(drawn()).toEqual(["0:dark", "1:dark", "2:dark"]);
  m.unmount(app);
  await m.tick();
  expect(appearance.removed - removed).toBe(1);
  expect(appearance.listeners).toEqual([]);
});
