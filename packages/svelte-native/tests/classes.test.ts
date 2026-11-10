import { expect, test } from "bun:test";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { classList } from "../src/classes.ts";
import { componentOptions } from "../src/compile-options.ts";
import { lowerPrimitives } from "../src/lower.ts";
import type { NativeNode } from "../src/renderer.ts";

// `class` on components through `@example/svelte-native/uniwind`, against stand-ins for the two modules of Uniwind's runtime it reads:
// a store that gives `themed` a color from the color scheme (dependency 1, as Uniwind's `dark:` does) and the listener it notifies.
type Uniwind = { scheme: "light" | "dark"; listeners: Map<number, Set<() => void>>; calls: string[] };
const uniwind: Uniwind = { scheme: "light", listeners: new Map(), calls: [] };
(globalThis as { __uniwind?: Uniwind }).__uniwind = uniwind;
const storeModule = `const stub = globalThis.__uniwind;
  const fixed = { card: { padding: 16 }, loud: { borderWidth: 2 }, label: { fontSize: 18 }, muted: { opacity: 0.5 } };
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
        builder.onResolve({ filter: /^uniwind\/src\/core\/(native|listener)$/ }, (args) => ({ path: args.path, namespace: "uniwind" }));
        builder.onLoad({ filter: /.*/, namespace: "uniwind" }, (args) => ({ contents: args.path.endsWith("/native") ? storeModule : listenerModule, loader: "js" }));
        builder.onResolve({ filter: /^react-native\/Libraries\// }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onResolve({ filter: /^(react-native|expo-modules-core)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^@example\/svelte-native$/ }, () => ({ path: "primitives", namespace: "package" }));
        builder.onLoad({ filter: /.*/, namespace: "package" }, () => ({
          contents: `export { default as View } from ${JSON.stringify(resolve(import.meta.dirname, "../src/components/View.svelte"))};
            export { default as Text } from ${JSON.stringify(resolve(import.meta.dirname, "../src/components/Text.svelte"))};`,
          loader: "js", resolveDir: import.meta.dirname,
        }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
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
    expect(warnings[0]).toContain("@example/svelte-native/uniwind");
    m.unmount(app);
  } finally {
    console.warn = warn;
  }
});
}
