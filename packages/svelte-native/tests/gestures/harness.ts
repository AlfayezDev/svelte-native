/**
 * The Fabric host with the gesture host loaded, in a bundle of its own per call: a fake `nativeFabricUIManager`, a fake
 * `RNGestureHandlerModule` that records every call (`calls`), a fake `RCTDeviceEventEmitter`, the Reanimated fakes of
 * `tests/reanimated-stubs.ts`, and react-native-gesture-handler's real pure modules (the ones `src/gestures/rngh.js` reuses).
 * What a test sees of the world is on `globalThis.__gh`, reset by `load()`.
 */
import { build, type Plugin } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../../src/compile-options.ts";
import { lowerPrimitives } from "../../src/lower.ts";
import { reanimatedStubs, type AnimLog } from "../reanimated-stubs.ts";

export type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; target?: unknown };
/** One call to the fake gesture-handler module, as the native side receives it: the method name, then its arguments. */
export type NativeCall = [method: string, ...args: unknown[]];
export type World = {
  calls: NativeCall[];
  /** Everything else that happened, in order: `completeRoot`, `enableGestures`, listener subscriptions. */
  log: string[];
  roots: Record<number, FakeNode[]>;
  listeners: Map<string, ((event: object) => void)[]>;
  /** What `SvelteEngine.enableGestures()` returns; `undefined` stands for the engine module being absent (iOS). */
  engine: { install(): boolean; enableGestures?: () => boolean } | null;
  /** The platform `Platform.OS` reports. */
  os: "android" | "ios";
  /** The host's event handler (`registerEventHandler`): what Fabric calls with a touch for a node's `target`. */
  dispatch: ((target: unknown, type: string, event: object) => void) | null;
};

export const world = (): World => (globalThis as unknown as { __gh: World }).__gh;
export const anim = (): AnimLog => (globalThis as unknown as { __anim: AnimLog }).__anim;

/** Every call a test can see on the module, JSON-cloned so later mutation of the arguments cannot change history. */
const recorderSource = `
const W = () => globalThis.__gh;
const record = (name) => (...args) => { W().calls.push(JSON.parse(JSON.stringify([name, ...args]))); W().log.push('native ' + name); };
export const get = () => null;
export const getEnforcing = (name) => {
  if (name !== 'RNGestureHandlerModule') throw new Error('unexpected native module ' + name);
  return { createGestureHandler: record('createGestureHandler'), attachGestureHandler: record('attachGestureHandler'), updateGestureHandler: record('updateGestureHandler'), dropGestureHandler: record('dropGestureHandler'), flushOperations: record('flushOperations'), handleSetJSResponder: record('handleSetJSResponder'), handleClearJSResponder: record('handleClearJSResponder') };
};`;
const emitterSource = `
export default {
  addListener(name, listener) {
    const map = globalThis.__gh.listeners;
    map.set(name, [...(map.get(name) ?? []), listener]);
    globalThis.__gh.log.push('listen ' + name);
    return { remove() { map.set(name, (map.get(name) ?? []).filter((entry) => entry !== listener)); globalThis.__gh.log.push('unlisten ' + name); } };
  },
};`;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/Utilities/Platform": "export default { get OS() { return globalThis.__gh.os; }, Version: 34 };",
  "react-native/Libraries/Image/resolveAssetSource": "export default () => null;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "react-native/Libraries/TurboModule/TurboModuleRegistry": recorderSource,
  "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter": emitterSource,
  // The main entry: the primitives (lowered away) and the gestures it re-exports (`src/index.ts`).
  primitives: `export const View = null, Text = null, Pressable = null, ScrollView = null, Image = null; export * from ${JSON.stringify(resolve(import.meta.dirname, "../../src/gestures/index.ts"))};`,
  "expo-modules-core": "export const requireOptionalNativeModule = (name) => (name === 'SvelteEngine' ? globalThis.__gh.engine : null);",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

function installWorld(): void {
  const roots: Record<number, FakeNode[]> = {};
  const g = globalThis as unknown as { __gh: World; __anim?: unknown; RN$Bridgeless?: boolean; nativeFabricUIManager?: unknown; global?: unknown };
  const previous = g.__gh;
  g.__gh = { calls: [], log: [], roots, listeners: new Map(), engine: { install: () => false, enableGestures: () => { g.__gh.log.push("enableGestures"); return true; } }, os: previous?.os ?? "android", dispatch: null };
  delete g.__anim;
  g.RN$Bridgeless = true; // RNGH's remote-debugging check, which turns worklets off, reads this
  g.global ??= globalThis;
  g.nativeFabricUIManager = {
    createNode: (tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown): FakeNode => ({ tag, name, props: { ...props }, children: [], target }),
    cloneNodeWithNewChildren: (node: FakeNode): FakeNode => ({ ...node, children: [] }),
    cloneNodeWithNewProps: (node: FakeNode, props: Record<string, unknown>): FakeNode => ({ ...node, props: { ...node.props, ...props }, children: [...node.children] }),
    cloneNodeWithNewChildrenAndProps: (node: FakeNode, props: Record<string, unknown>): FakeNode => ({ ...node, props: { ...node.props, ...props }, children: [] }),
    appendChild: (parent: FakeNode, child: FakeNode) => { parent.children.push(child); },
    createChildSet: (root: number) => ({ root, children: [] as FakeNode[] }),
    appendChildToSet: (set: { children: FakeNode[] }, child: FakeNode) => { set.children.push(child); },
    completeRoot: (root: number, set: { children: FakeNode[] }) => { g.__gh.log.push("completeRoot"); roots[root] = set.children; },
    registerEventHandler: (handler: (target: unknown, type: string, event: object) => void) => { g.__gh.dispatch = handler; },
  };
}

/** Resolves the world the host runs in: `react-native*` and `expo-modules-core` to the fakes above (RNGH's own sources are real), Svelte fixtures compiled for the custom renderer. */
export function hostPlugin(options: { openStubs?: boolean } = {}): Plugin {
  return {
    name: "gesture-fixture",
    setup(builder) {
      builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
      // `openStubs` (the import-graph tests) lets any module import any name from a stub, as a CommonJS module does.
      builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: options.openStubs ? "module.exports = new Proxy({}, { get: () => () => {} });" : stubs[args.path] ?? "export {};", loader: "js", resolveDir: import.meta.dirname }));
      builder.onResolve({ filter: /^@alfayez\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../../src/renderer.ts") }));
      builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../../src/environment.ts") }));
      // A fixture that imports primitives from the package is lowered as the transformer does; the import itself is then unused.
      builder.onResolve({ filter: /^@alfayez\/svelte-native$/ }, () => ({ path: "primitives", namespace: "stub" }));
      builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
        contents: compile(lowerPrimitives(await readFile(path, "utf8"), { filename: path, warn: () => {} }), componentOptions(path)).js.code,
        loader: "js",
      }));
    },
  };
}

export type Loaded = {
  startSurface(rootTag: number, App: unknown, props: Record<string, unknown>): Record<string, (...args: never[]) => unknown>;
  stopSurface(rootTag: number): void;
  /** The host's commit, now: a test that expects it to throw calls it itself instead of leaving it to a microtask. */
  flush(): void;
  flushSync(run?: () => void): void;
  fabricStats(): { gesturesLoaded: boolean; animationLoaded: boolean; gestures: { records: number; handlers: number; eventHandlers: number } | null };
  tick(): Promise<void>;
  Fixture: unknown;
  /** The bundle's own copy of the gestures the main entry (`@alfayez/svelte-native`) exports. */
  gestures: typeof import("../../src/gestures/index.ts");
  bootSummary(): string;
  /** The bundle's own copies of what a test inspects: the JS receiver's memory, RNGH's mount registry and handler registry. */
  probe: {
    receiverSize(): { stateManagers: number; lastUpdates: number };
    /** The numbers `src/gestures/animated.ts` copies, by RNGH's names; the module is evaluated by this call and not before. */
    copiedConstants(): Promise<{ State: Record<string, number>; TouchEventType: Record<string, number>; CALLBACK_TYPE: Record<string, number> }>;
    MountRegistry: typeof import("../../src/gestures/rngh.js").MountRegistry;
    findHandler: typeof import("../../src/gestures/rngh.js").findHandler;
    findHandlerByTestID(testID: string): { handlerTag: number } | null;
  };
};

type LoadOptions = {
  /** The Svelte fixture, relative to `tests/gestures`. */
  fixture: string;
  /** `__DEV__` in the bundle; the development guards depend on it. Default true. */
  dev?: boolean;
  /** Extra esbuild plugins, ahead of the built-in ones (the toolchain test adds the real Babel transform for `.svelte` files). */
  plugins?: Plugin[];
  os?: "android" | "ios";
};

/** A fresh world and a fresh bundle: module state (handler tags, records, listeners) starts from zero on every call. */
export async function load(options: LoadOptions): Promise<Loaded> {
  installWorld();
  world().os = options.os ?? "android";
  const bundle = await build({
    stdin: {
      contents: `import Fixture from ${JSON.stringify(`./${options.fixture}`)};
        import { startSurface, stopSurface, fabricStats, flush } from '../../src/fabric/host.ts';
        import { bootSummary } from '../../src/boot-marks.ts';
        import * as gestures from '../../src/gestures/index.ts';
        import { receiverSize } from '../../src/gestures/events.ts';
        import { MountRegistry, findHandler } from '../../src/gestures/rngh.js';
        import { findHandlerByTestID } from 'react-native-gesture-handler/src/handlers/handlersRegistry';
        import { tick, flushSync } from 'svelte';
        // animated.ts evaluates Reanimated, which a test about the app that never uses a gesture must not see: it is read on demand.
        const copiedConstants = async () => (await import('../../src/gestures/animated.ts')).copiedConstants;
        const probe = { receiverSize, copiedConstants, MountRegistry, findHandler, findHandlerByTestID };
        export { startSurface, stopSurface, fabricStats, flush, tick, flushSync, Fixture, gestures, bootSummary, probe };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    define: { __DEV__: options.dev === false ? "false" : "true" },
    plugins: [...(options.plugins ?? []), hostPlugin()],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-gestures-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0]?.contents ?? "");
  const loaded = await import(`${pathToFileURL(file).href}?${Math.random()}`);
  await rm(directory, { recursive: true });
  return loaded as Loaded;
}

/** Lets the host's flush (a microtask) and the gesture batch (a `setImmediate`) run. */
export async function settle(loaded: Pick<Loaded, "tick">): Promise<void> {
  await loaded.tick();
  await Promise.resolve();
  await new Promise((done) => setImmediate(done));
  await Promise.resolve();
}

/** The Fabric nodes of a surface, flattened. */
export const nodesOf = (rootTag: number): FakeNode[] => {
  const walk = (nodes: FakeNode[]): FakeNode[] => nodes.flatMap((node) => [node, ...walk(node.children)]);
  return walk(world().roots[rootTag] ?? []);
};
export const byId = (rootTag: number, id: string): FakeNode | undefined => nodesOf(rootTag).find((node) => node.props.testID === id);

/** The calls of one method, with the others filtered out. */
export const callsOf = (...methods: string[]): NativeCall[] => world().calls.filter((call) => methods.includes(call[0]));
