import { test, expect } from "bun:test";
import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { lowerPrimitives } from "../src/lower.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { reactNativeConverters } from "./rn-reference.ts";

/**
 * `Text` keeps the whitespace it is given, as React Native's `Text` does: a sentence split across source lines reaches the native text with its line break and the next line's
 * indent, where a browser would show one space. (Svelte's compiler trims what sits at the edges of an element's content and turns a whitespace-only gap between two nodes into one
 * space; it leaves the rest of a text as written, and in a browser it is CSS that collapses it.) This pins that behaviour, documented in REFERENCE.md ("Text") and the README ("Coming from
 * Svelte on the web"), so a change to it is a decision: the pattern for a long sentence is `{"one long string"}` or one source line.
 */
type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean };
let roots: Record<number, FakeNode[]> = {};
const fake = {
  createNode: (tag: number, name: string, _root: number, props: Record<string, unknown>) => ({ tag, name, props: { ...props }, children: [], sealed: false }),
  cloneNodeWithNewChildren: (node: FakeNode) => ({ ...node, children: [], sealed: false }),
  cloneNodeWithNewProps: (node: FakeNode, props: Record<string, unknown>) => ({ ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }),
  cloneNodeWithNewChildrenAndProps: (node: FakeNode, props: Record<string, unknown>) => ({ ...node, props: { ...node.props, ...props }, children: [], sealed: false }),
  appendChild(parent: FakeNode, child: FakeNode) { parent.children.push(child); },
  createChildSet: (root: number) => ({ root, children: [] as FakeNode[] }),
  appendChildToSet: (set: { children: FakeNode[] }, child: FakeNode) => { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) { roots[root] = set.children; },
  measure: () => {},
  measureInWindow: () => {},
  dispatchCommand: () => {},
  registerEventHandler: () => {},
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "expo-modules-core": "export const requireOptionalNativeModule = () => null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
  // The fixture's `import { Text } from "@rasheed/svelte-native"` is lowered to `<native-text>` and the import is then unused.
  "@rasheed/svelte-native": "export const Text = null;",
};

async function load() {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './text-whitespace-fixture.svelte';
        import { startSurface, flush } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, flush, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    plugins: [...reactNativeConverters("android"), {
      name: "text-whitespace",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core|@rasheed\/svelte-native$)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        // The way Metro's transformer does it: the primitives are lowered to host tags first.
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(lowerPrimitives(await readFile(path, "utf8"), { filename: path }), componentOptions(path)).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-text-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}

/** The text of each `RCTText` that is not inside another one, with what is inside nested ones in the order they were written. */
const textsOf = (nodes: FakeNode[]): string[][] => nodes.flatMap((node) => {
  if (node.name === "RCTText") return [node.children.flatMap((child) => (child.name === "RCTRawText" ? [String(child.props.text)] : child.name === "RCTVirtualText" ? child.children.map((inner) => String(inner.props.text)) : []))];
  return textsOf(node.children);
});

test("a sentence split across source lines reaches the native text with its line break and indent", async () => {
  const m = await load();
  roots = {};
  const app = m.startSurface(21, m.Fixture, {}) as { rename(next: string): void };
  const texts = textsOf(roots[21]);
  // Lowered `Text` and the `Text` component alike.
  expect(texts[0]).toEqual(["A sentence that is split\n    across two source lines."]);
  expect(texts[1]).toEqual(["The same through\n    the component."]);
  // An expression is part of the same string; the interior whitespace is as written.
  expect(texts[2]).toEqual(["Hello Ada,\n    welcome   back."]);
  app.rename("Grace");
  await m.tick();
  await Promise.resolve();
  expect(textsOf(roots[21])[2]).toEqual(["Hello Grace,\n    welcome   back."]);
});

test("what Svelte's compiler trims stays trimmed: the edges of the content, and a whitespace-only gap becomes one space", async () => {
  const m = await load();
  roots = {};
  m.startSurface(22, m.Fixture, {});
  const texts = textsOf(roots[22]);
  // The recommended pattern for a long sentence: one string, no line break in it.
  expect(texts[3]).toEqual(["one long string"]);
  // Spaces around the content of one line are dropped; the line breaks around a nested `Text` are one space each.
  expect(texts[4]).toEqual(["padded on one line"]);
  expect(texts[5]).toEqual(["Before ", "nested", " after."]);
  // The other way to wrap a long sentence in the source: a string built from pieces has no line break in it.
  expect(texts[6]).toEqual(["A long sentence written over two source lines."]);
});
