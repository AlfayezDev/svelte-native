import { test, expect } from "bun:test";
import { build, transform } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import type { NativeNode } from "../src/renderer.ts";

type Event = { top: number; right: number; bottom: number; left: number; keyboardHeight: number; keyboardVisible: boolean; frame: { x: number; y: number; width: number; height: number } };
const event = (patch: Partial<Event> = {}): Event => ({ top: 24, right: 0, bottom: 34, left: 0, keyboardHeight: 0, keyboardVisible: false, frame: { x: 0, y: 0, width: 400, height: 800 }, ...patch });

const stub = { listener: null as null | ((e: Event) => void), current: null as Event | null, removed: 0 };
(globalThis as { __insetsStub?: unknown }).__insetsStub = stub;
const stubs: Record<string, string> = {
  "expo-modules-core": `const stub = globalThis.__insetsStub;
    export const EventEmitter = class {};
    export const requireOptionalNativeModule = () => ({ getInsets: () => stub.current, addListener: (name, listener) => { if (name === "insets") stub.listener = listener; return { remove() { stub.removed++; } }; } });`,
};

async function load() {
  const bundle = await build({
    stdin: {
      contents: `import Fixture from './insets-fixture.svelte';
        import renderer, { NativeNode } from '../src/renderer.ts';
        import { mergeHostProps } from '../src/native-props.ts';
        import { insets, resetInsets } from '../src/insets.svelte.ts';
        import { mount, tick, unmount } from 'svelte';
        export { avoidingStyle, flattenStyle, keyboardOverlap, safeAreaStyle } from '../src/fabric/insets.ts';
        export { Fixture, renderer, NativeNode, mergeHostProps, insets, resetInsets, mount, tick, unmount };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "insets-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code,
          loader: "js",
        }));
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
          const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
          return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
        });
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-insets-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}

function nodes(node: NativeNode): NativeNode[] { return [node, ...node.getSnapshot().children.flatMap(nodes)]; }
type Props = Record<string, unknown>;

async function mountFixture(m: Awaited<ReturnType<typeof load>>, props: Props = {}) {
  const root = new m.NativeNode("fragment");
  const app = m.mount(m.Fixture, { target: root, renderer: m.renderer, props });
  await m.tick();
  const props_of = (name: string, index = 0): Props => m.mergeHostProps(nodes(root).filter((n) => n.name === name)[index].getSnapshot().props);
  return { root, app, props_of };
}

test("the insets store follows the module event and the first read", async () => {
  const m = await load();
  stub.listener = null;
  stub.current = event({ top: 10 });
  m.resetInsets();
  const { props_of } = await mountFixture(m);
  expect(m.insets.top).toBe(10);
  stub.listener?.(event({ top: 30, keyboardHeight: 250, keyboardVisible: true }));
  await m.tick();
  expect(m.insets.top).toBe(30);
  expect(m.insets.bottom).toBe(34);
  expect(m.insets.keyboardHeight).toBe(250);
  expect(m.insets.keyboardVisible).toBe(true);
  expect(m.insets.frame.height).toBe(800);
  expect(props_of("native-safe-area").style).toEqual([{ flex: 1, paddingTop: 4 }, { paddingTop: 34, paddingRight: 0, paddingBottom: 34, paddingLeft: 0 }]);
});

test("SafeAreaView pads only the selected edges and adds the inset to the style's own padding", async () => {
  const m = await load();
  stub.current = event({ top: 24, bottom: 34 });
  m.resetInsets();
  const { props_of } = await mountFixture(m, { edges: ["bottom"] });
  expect(props_of("native-safe-area").style).toEqual([{ flex: 1, paddingTop: 4 }, { paddingBottom: 34 }]);
  expect(props_of("native-safe-area").edges).toBeUndefined();
});

test("KeyboardAvoidingView pads, shrinks or lifts by the keyboard's overlap with the measured view", async () => {
  const m = await load();
  for (const [behavior, offset, bottom] of [["padding", 0, 300], ["padding", 50, 350], ["height", 0, 300], ["position", 0, 300]] as const) {
    stub.current = event({ keyboardHeight: 300, keyboardVisible: true });
    m.resetInsets();
    const { props_of } = await mountFixture(m, { behavior, offset });
    // The view sits at y 400..800 of an 800 high surface; the keyboard covers 500..800.
    const measured = { measureInWindow: (callback: (...a: number[]) => void) => callback(0, 400, 400, 400) };
    const outer = () => props_of("native-view", 0);
    (outer().ref as (h: unknown) => void)(measured);
    (outer().onLayout as (e: unknown) => void)({ nativeEvent: {} });
    await m.tick();
    await m.tick();
    if (behavior === "padding") expect(outer().style).toEqual([{ flex: 1 }, { paddingBottom: bottom }]);
    if (behavior === "height") expect(outer().style).toEqual([{ flex: 1 }, { height: 400 - bottom, flex: 0 }]);
    if (behavior === "position") expect(props_of("native-view", 1).style).toEqual([{ flex: 1 }, { bottom }]);
    stub.listener?.(event());
    await m.tick();
    await m.tick();
    if (behavior === "padding") expect(outer().style).toEqual([{ flex: 1 }, { paddingBottom: 0 }]);
    if (behavior === "height") expect(outer().style).toEqual({ flex: 1 });
    if (behavior === "position") expect(props_of("native-view", 1).style).toEqual([{ flex: 1 }, { bottom: 0 }]);
  }
});

test("padding math", async () => {
  const { avoidingStyle, flattenStyle, keyboardOverlap, safeAreaStyle } = await load();
  const insets = { top: 20, right: 1, bottom: 30, left: 2 };
  expect(flattenStyle([{ a: 1 }, false, [{ b: 2 }]])).toEqual({ a: 1, b: 2 });
  expect(safeAreaStyle({ padding: 8 }, insets)).toEqual([{ padding: 8 }, { paddingTop: 28, paddingRight: 9, paddingBottom: 38, paddingLeft: 10 }]);
  expect(safeAreaStyle({ paddingVertical: 5, paddingBottom: 1 }, insets, ["top", "bottom"])).toEqual([{ paddingVertical: 5, paddingBottom: 1 }, { paddingTop: 25, paddingBottom: 31 }]);
  expect(keyboardOverlap({ viewY: 0, viewHeight: 400, rootHeight: 800, keyboardHeight: 300 })).toBe(0);
  expect(keyboardOverlap({ viewY: 0, viewHeight: 700, rootHeight: 800, keyboardHeight: 300 })).toBe(200);
  expect(keyboardOverlap({ viewY: 0, viewHeight: 700, rootHeight: 800, keyboardHeight: 300, offset: 100 })).toBe(300);
  expect(keyboardOverlap({ viewY: 0, viewHeight: 500, rootHeight: 800, keyboardHeight: 300, behavior: "height", previous: 200 })).toBe(200);
  expect(avoidingStyle("height", { flex: 1 }, 0, 700)).toEqual({ flex: 1 });
  expect(avoidingStyle("height", { flex: 1 }, 200, 700)).toEqual([{ flex: 1 }, { height: 500, flex: 0 }]);
  expect(avoidingStyle(undefined, { flex: 1 }, 200, 700)).toEqual({ flex: 1 });
});
