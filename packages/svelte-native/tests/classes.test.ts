import { expect, test } from "bun:test";
import { build, transform } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { classList } from "../src/classes.ts";
import { componentOptions } from "../src/compile-options.ts";
import { lowerPrimitives } from "../src/lower.ts";
import type { NativeNode } from "../src/renderer.ts";

// `class` on components through `@rasheed/svelte-native/uniwind`, against stand-ins for the two modules of Uniwind's runtime it reads:
// a store that gives `themed` a color from the color scheme (dependency 1, as Uniwind's `dark:` does) and the listener it notifies.
type Insets = { top: number; right: number; bottom: number; left: number };
type Uniwind = { scheme: "light" | "dark"; listeners: Map<number, Set<() => void>>; calls: string[]; insets: Insets[]; engine: { current: (Insets & Record<string, unknown>) | null; listener: ((event: Insets & Record<string, unknown>) => void) | null } };
const uniwind: Uniwind = { scheme: "light", listeners: new Map(), calls: [], insets: [], engine: { current: null, listener: null } };
(globalThis as { __uniwind?: Uniwind }).__uniwind = uniwind;
const storeModule = `const stub = globalThis.__uniwind;
  const fixed = { card: { padding: 16 }, loud: { borderWidth: 2 }, label: { fontSize: 18 }, muted: { opacity: 0.5 }, "p-4": { padding: 16 } };
  export const UniwindStore = {
    getStyles(className, props, state, context) {
      stub.calls.push(className);
      const styles = {};
      const dependencies = [];
      for (const name of className.split(" ")) {
        if (name === "themed") { Object.assign(styles, { backgroundColor: stub.scheme === "dark" ? "black" : "white" }); dependencies.push(1); }
        else Object.assign(styles, fixed[name]);
      }
      return { styles, dependencies, dependencySum: dependencies.length };
    },
  };`;
const configModule = `const stub = globalThis.__uniwind;
  export const Uniwind = { updateInsets(insets) { stub.insets.push(insets); } };`;
// The engine module the insets come from (expo-modules-core's requireOptionalNativeModule), with the current value it reports first.
const expoModulesCore = `const stub = globalThis.__uniwind;
  export const EventEmitter = class {};
  export const requireOptionalNativeModule = (name) => name !== "SvelteEngine" ? null : ({
    getInsets: () => stub.engine.current,
    addListener: (event, listener) => { if (event === "insets") stub.engine.listener = listener; return { remove() {} }; },
  });`;
const listenerModule = `const stub = globalThis.__uniwind;
  export const UniwindListener = {
    subscribe(listener, dependencies) {
      for (const dependency of dependencies) {
        if (!stub.listeners.has(dependency)) stub.listeners.set(dependency, new Set());
        stub.listeners.get(dependency).add(listener);
      }
      return () => { for (const dependency of dependencies) stub.listeners.get(dependency)?.delete(listener); };
    },
  };`;

async function load(withUniwind: boolean, lowered = false) {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './${lowered ? "classes-lowered-fixture" : "classes-fixture"}.svelte';
        ${withUniwind ? "import '../src/uniwind.ts';" : ""}
        import renderer, { NativeNode } from '../src/renderer.ts';
        import { mergeHostProps } from '../src/native-props.ts';
        import { setClassResolver } from '../src/classes.ts';
        import { mount, tick, unmount } from 'svelte';
        export { Fixture, renderer, NativeNode, mergeHostProps, setClassResolver, mount, tick, unmount };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false, define: { __DEV__: "true" },
    plugins: [{
      name: "classes-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^uniwind\/src\/core\/(native|listener|config)$/ }, (args) => ({ path: args.path, namespace: "uniwind" }));
        builder.onLoad({ filter: /.*/, namespace: "uniwind" }, (args) => ({ contents: args.path.endsWith("/native") ? storeModule : args.path.endsWith("/config") ? configModule : listenerModule, loader: "js" }));
        builder.onResolve({ filter: /^react-native\/Libraries\// }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onResolve({ filter: /^(react-native|expo-modules-core)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: args.path === "expo-modules-core" ? expoModulesCore : "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native$/ }, () => ({ path: "primitives", namespace: "package" }));
        builder.onLoad({ filter: /.*/, namespace: "package" }, () => ({
          contents: `export { default as View } from ${JSON.stringify(resolve(import.meta.dirname, "../src/components/View.svelte"))};
            export { default as Text } from ${JSON.stringify(resolve(import.meta.dirname, "../src/components/Text.svelte"))};
            export { default as SafeAreaView } from ${JSON.stringify(resolve(import.meta.dirname, "../src/components/SafeAreaView.svelte"))};`,
          loader: "js", resolveDir: import.meta.dirname,
        }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
          const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
          return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
        });
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
          const source = await readFile(path, "utf8");
          return { contents: compile(path.endsWith("-lowered-fixture.svelte") ? lowerPrimitives(source, { filename: path }) : source, componentOptions(path)).js.code, loader: "js" };
        });
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-classes-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0]?.contents ?? "");
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}

function nodes(node: NativeNode): NativeNode[] { return [node, ...node.getSnapshot().children.flatMap(nodes)]; }

async function mountFixture(m: Awaited<ReturnType<typeof load>>, props: { inline?: boolean } = {}) {
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props });
  await m.tick();
  const styleOf = (testID: string) => {
    const node = nodes(root).find((candidate) => candidate.name.startsWith("native-") && m.mergeHostProps(candidate.getSnapshot().props).testID === testID);
    const props = node ? m.mergeHostProps(node.getSnapshot().props) : undefined;
    expect(props).toBeDefined();
    expect(props).not.toHaveProperty("class");
    return props?.style;
  };
  return { app, styleOf };
}

const notify = (dependency: number) => { for (const listener of [...(uniwind.listeners.get(dependency) ?? [])]) listener(); };

test("class takes a string, an array or an object of names, as on a DOM element", () => {
  expect(classList("  a b ")).toBe("a b");
  expect(classList(["a", false, null, undefined, ["b", { c: true, d: false }], 0, 1])).toBe("a b c 1");
  expect(classList({ a: 1, b: "", c: "yes" })).toBe("a c");
  expect(classList(undefined)).toBe("");
  expect(classList(true)).toBe("");
});

for (const lowered of [false, true]) {
const how = lowered ? "lowered to host tags" : "as components";

test(`the classes become the style, under the inline style (${how})`, async () => {
  const m = await load(true, lowered);
  const { app, styleOf } = await mountFixture(m, { inline: true });
  expect(styleOf("card")).toEqual([{ padding: 16 }, { padding: 1 }]);
  expect(styleOf("label")).toEqual({ fontSize: 18, opacity: 0.5 });
  expect(styleOf("bare")).toBeUndefined();
  m.unmount(app);
});

test(`classes follow the component's state (${how})`, async () => {
  const m = await load(true, lowered);
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("card")).toEqual({ padding: 16 });
  expect(styleOf("label")).toEqual({ fontSize: 18, opacity: 0.5 });
  app.setTone("loud");
  await m.tick();
  expect(styleOf("card")).toEqual({ padding: 16, borderWidth: 2 });
  expect(styleOf("label")).toEqual({ fontSize: 18 });
  m.unmount(app);
});

test(`a class that depends on the color scheme draws again when Uniwind says it changed, and only that element works it out again (${how})`, async () => {
  const m = await load(true, lowered);
  uniwind.scheme = "light";
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("themed")).toEqual({ backgroundColor: "white" });
  expect(uniwind.listeners.get(1)?.size).toBe(1);
  uniwind.calls.length = 0;
  uniwind.scheme = "dark";
  notify(1);
  await m.tick();
  expect(styleOf("themed")).toEqual({ backgroundColor: "black" });
  expect(uniwind.calls).toEqual(["themed"]);
  m.unmount(app);
  await m.tick();
  // The last reader gone, the subscription to Uniwind goes too.
  expect(uniwind.listeners.get(1)?.size ?? 0).toBe(0);
});

test(`a spread's class is resolved, and on a lowered tag the class: toggles next to it apply to it (${how})`, async () => {
  const m = await load(true, lowered);
  const { app, styleOf } = await mountFixture(m);
  expect(styleOf("spread")).toEqual({ padding: 16 });
  app.setTone("loud");
  await m.tick();
  expect(styleOf("spread")).toEqual(lowered ? { padding: 16, borderWidth: 2 } : { padding: 16 });
  m.unmount(app);
});

test(`a safe area adds the insets to the padding of its classes (${how})`, async () => {
  uniwind.engine.current = { top: 24, right: 0, bottom: 34, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 } };
  const m = await load(true, lowered);
  const { app, styleOf } = await mountFixture(m);
  const flat = (style: unknown): Record<string, unknown> => Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : (style as Record<string, unknown>) ?? {};
  expect(flat(styleOf("safe"))).toMatchObject({ paddingTop: 40, paddingRight: 16, paddingBottom: 50, paddingLeft: 16 });
  m.unmount(app);
  uniwind.engine.current = null;
});

test(`without a resolver, class is dropped with one warning in development (${how})`, async () => {
  const m = await load(false, lowered);
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => { warnings.push(message); };
  try {
    const { app, styleOf } = await mountFixture(m);
    expect(styleOf("card")).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^svelte-native: class="[a-z ]+" has no effect/);
    expect(warnings[0]).toContain("@rasheed/svelte-native/uniwind");
    m.unmount(app);
  } finally {
    console.warn = warn;
  }
});
}

test("Uniwind's safe-area insets come from the engine: the current value at once, then each change", async () => {
  uniwind.insets.length = 0;
  uniwind.engine.current = { top: 24, right: 0, bottom: 34, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 } };
  await load(true);
  expect(uniwind.insets).toEqual([{ top: 24, right: 0, bottom: 34, left: 0 }]);
  // The keyboard moving is an insets event too; the safe area did not change, so Uniwind is not told.
  uniwind.engine.listener?.({ ...uniwind.engine.current, keyboardHeight: 300, keyboardVisible: true });
  expect(uniwind.insets).toHaveLength(1);
  uniwind.engine.listener?.({ ...uniwind.engine.current, top: 0, bottom: 0, left: 48 });
  expect(uniwind.insets).toEqual([{ top: 24, right: 0, bottom: 34, left: 0 }, { top: 0, right: 0, bottom: 0, left: 48 }]);
  uniwind.engine.current = null;
});
