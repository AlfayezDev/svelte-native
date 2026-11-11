import { build, transform } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { reactNativeConverters } from "./rn-reference.ts";

/**
 * The harness of `fork.test.ts`: a bundle of the renderer, the Fabric host and a fixture, with Svelte's async mode on, which `fork()` needs and which the library leaves off
 * (`compile-options.ts`). The components are compiled with the library's own options and the bundle imports the flag module first, which is how an app turns the mode on
 * (`svelte/internal/flags/async`); `compiled: true` compiles every component with `experimental.async` instead (the same output but for that one import, `fork.test.ts`).
 * The bundle carries its own copy of Svelte's runtime, so the flag stays in that bundle and no other test's runtime sees it.
 *
 * The host runs against a fake of `nativeFabricUIManager` that records every call, as `fabric.test.ts` does, so a test can tell what Fabric was asked to build and when.
 */
export type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; target?: unknown };
export const fabric = { calls: [] as string[], roots: {} as Record<number, FakeNode[]> };
const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown): FakeNode { fabric.calls.push(`create ${name}`); return { tag, name, props: { ...props }, children: [], target }; },
  cloneNodeWithNewChildren(node: FakeNode): FakeNode { fabric.calls.push(`cloneChildren ${node.name}`); return { ...node, children: [] }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>): FakeNode { fabric.calls.push(`cloneProps ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [...node.children] }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>): FakeNode { fabric.calls.push(`cloneBoth ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [] }; },
  appendChild(parent: FakeNode, child: FakeNode) { parent.children.push(child); },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) { fabric.calls.push("completeRoot"); fabric.roots[root] = set.children; },
  registerEventHandler() {},
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;
// React Native has `requestAnimationFrame`, which `tick()` waits for in async mode; bun has none.
(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame ??= (callback: () => void) => setTimeout(callback, 16);

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Linking/Linking": "export default { addEventListener: () => ({ remove() {} }), getInitialURL: () => Promise.resolve(null) };",
  "react-native/Libraries/Image/resolveAssetSource": "export default () => null;",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

/** The modules a fork test reaches into, as the bundle exports them. */
export type ForkModule = {
  Fixture: import("svelte").Component<Record<string, unknown>, Record<string, unknown>>;
  renderer: import("svelte/renderer").Renderer<never, never, never, never>;
  NativeNode: typeof import("../src/renderer.ts").NativeNode;
  mergeHostProps: typeof import("../src/native-props.ts").mergeHostProps;
  mount: typeof import("svelte").mount;
  unmount: typeof import("svelte").unmount;
  tick: typeof import("svelte").tick;
  flushSync: typeof import("svelte").flushSync;
  fork: (fn: () => void) => { commit(): Promise<void>; discard(): void };
  startSurface: typeof import("../src/fabric/host.ts").startSurface;
  flush: typeof import("../src/fabric/host.ts").flush;
  fabricStats: typeof import("../src/fabric/host.ts").fabricStats;
  asyncFlag: () => boolean;
};

const flags = resolve(dirname(createRequire(import.meta.url).resolve("svelte/package.json")), "src/internal/flags/index.js");

/** Bundles the fixture with async mode on (`async: false` is the control: the same bundle without the flag). */
export async function loadFork(fixture: string, { async = true, compiled = false, realConfigs = false }: { async?: boolean; compiled?: boolean; realConfigs?: boolean } = {}): Promise<ForkModule> {
  const bundle = await build({
    stdin: {
      contents: `${async ? "import 'svelte/internal/flags/async';" : ""}
        import Fixture from './${fixture}';
        import renderer, { NativeNode } from '../src/renderer.ts';
        import { mergeHostProps } from '../src/native-props.ts';
        import { startSurface, flush, fabricStats } from '../src/fabric/host.ts';
        import { mount, unmount, tick, flushSync, fork } from 'svelte';
        import { async_mode_flag } from '${flags}';
        export const asyncFlag = () => async_mode_flag;
        export { Fixture, renderer, NativeNode, mergeHostProps, mount, unmount, tick, flushSync, fork, startSurface, flush, fabricStats };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    plugins: [...(realConfigs ? reactNativeConverters("android") : []), {
      name: "fork-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        // The stand-in passes every prop through as it is; `realConfigs` runs the host's own payload builder (React Native's style converters included), which is what a device pays.
        if (!realConfigs) builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: resolve(import.meta.dirname, "view-configs-stub.ts") }));
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
          const options = componentOptions(path);
          const experimental = compiled ? { ...options.experimental, async: true } : options.experimental;
          return { contents: compile(await readFile(path, "utf8"), { ...options, experimental }).js.code, loader: "js" };
        });
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
          const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
          return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
        });
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-fork-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0]?.contents ?? "");
  const loaded = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return loaded;
}

export const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((n) => [...(n.name === name ? [n] : []), ...find(n.children, name)]);
