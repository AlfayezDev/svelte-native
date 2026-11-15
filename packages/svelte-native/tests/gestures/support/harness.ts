/**
 * The Fabric host with the gesture host loaded, in a bundle of its own per call: a fake `nativeFabricUIManager`, a fake
 * `RNGestureHandlerModule` that records every call (`calls`), a fake `RCTDeviceEventEmitter`, the Reanimated fakes of
 * `tests/reanimated-stubs.ts`, and react-native-gesture-handler's real pure modules (the ones `src/gestures/rngh.js` reuses).
 * What a test sees of the world is on `globalThis.__gh`, reset by `load()`.
 */
import type { Plugin } from "esbuild";
import { resolve } from "node:path";
import { reanimatedStubs, type AnimLog } from "../../reanimated-stubs.ts";
import { type HostPluginOptions, hostPlugin as supportHostPlugin, load as loadBundle, src } from "../../support/bundle.ts";
import { type FakeNode, type Installed, createHost } from "../../support/host.ts";

export type { FakeNode };
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
  "@alfayez/svelte-native": `export const View = null, Text = null, Pressable = null, ScrollView = null, Image = null; export * from ${JSON.stringify(src("gestures/index.ts"))};`,
  "expo-modules-core": "export const requireOptionalNativeModule = (name) => (name === 'SvelteEngine' ? globalThis.__gh.engine : null);",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

/** What each load put on the global object, newest last: the globals stay for the rest of the file, and `restoreWorld()` puts them back. */
const installs: Installed[] = [];

function installWorld(os: World["os"]): void {
  const log: string[] = [];
  const host = createHost({ calls: log, describe: (call) => (call.op === "completeRoot" ? "completeRoot" : undefined) });
  const world: World = {
    calls: [], log, roots: host.roots, listeners: new Map(),
    engine: { install: () => false, enableGestures: () => { log.push("enableGestures"); return true; } },
    os,
    get dispatch() { return host.handler ?? null; },
  };
  installs.push(host.install({
    __gh: world,
    RN$Bridgeless: true, // RNGH's remote-debugging check, which turns worklets off, reads this
    ...("global" in globalThis ? {} : { global: globalThis }),
  }));
  delete (globalThis as { __anim?: unknown }).__anim;
}

/** Puts the global object back as it was before the first `load()`. */
export function restoreWorld(): void {
  for (const installed of installs.splice(0).reverse()) installed.restore();
}

/** Resolves the world the host runs in: `react-native*` and `expo-modules-core` to the fakes above (RNGH's own sources are real), Svelte fixtures compiled for the custom renderer. */
export function hostPlugin(options: Pick<HostPluginOptions, "openStubs"> = {}): Plugin {
  return supportHostPlugin({ ...options, stubs, lower: {} });
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
  gestures: typeof import("../../../src/gestures/index.ts");
  bootSummary(): string;
  /** The bundle's own copies of what a test inspects: the JS receiver's memory, RNGH's mount registry and handler registry. */
  probe: {
    receiverSize(): { stateManagers: number; lastUpdates: number };
    /** The numbers `src/gestures/animated.ts` copies, by RNGH's names; the module is evaluated by this call and not before. */
    copiedConstants(): Promise<{ State: Record<string, number>; TouchEventType: Record<string, number>; CALLBACK_TYPE: Record<string, number> }>;
    MountRegistry: typeof import("../../../src/gestures/rngh.js").MountRegistry;
    findHandler: typeof import("../../../src/gestures/rngh.js").findHandler;
    findHandlerByTestID(testID: string): { handlerTag: number } | null;
  };
};

type LoadOptions = {
  /** The Svelte fixture, relative to `tests/gestures/fixtures` (or an absolute path). */
  fixture: string;
  /** `__DEV__` in the bundle; the development guards depend on it. Default true. */
  dev?: boolean;
  /** Extra esbuild plugins, ahead of the built-in ones (the toolchain test adds the real Babel transform for `.svelte` files). */
  plugins?: Plugin[];
  /** Names the bundle when it has plugins, so it is built once (`support/bundle.ts`). */
  cacheKey?: string;
  /** Where a fixture that is not an absolute path is looked for. Default: `tests/gestures/fixtures`. */
  fixtures?: string;
  os?: "android" | "ios";
};

/** A fresh world and a fresh evaluation of the bundle: module state (handler tags, records, listeners) starts from zero on every call. */
export async function load(options: LoadOptions): Promise<Loaded> {
  installWorld(options.os ?? "android");
  return loadBundle<Loaded>({
    entry: `import Fixture from ${JSON.stringify(resolve(options.fixtures ?? resolve(import.meta.dirname, "../fixtures"), options.fixture))};
        import { startSurface, stopSurface, fabricStats, flush } from ${JSON.stringify(src("fabric/host.ts"))};
        import { bootSummary } from ${JSON.stringify(src("boot-marks.ts"))};
        import * as gestures from ${JSON.stringify(src("gestures/index.ts"))};
        import { receiverSize } from ${JSON.stringify(src("gestures/events.ts"))};
        import { MountRegistry, findHandler } from ${JSON.stringify(src("gestures/rngh.js"))};
        import { findHandlerByTestID } from 'react-native-gesture-handler/src/handlers/handlersRegistry';
        import { tick, flushSync } from 'svelte';
        // animated.ts evaluates Reanimated, which a test about the app that never uses a gesture must not see: it is read on demand.
        const copiedConstants = async () => (await import(${JSON.stringify(src("gestures/animated.ts"))})).copiedConstants;
        const probe = { receiverSize, copiedConstants, MountRegistry, findHandler, findHandlerByTestID };
        export { startSurface, stopSurface, fabricStats, flush, tick, flushSync, Fixture, gestures, bootSummary, probe };`,
    resolveDir: import.meta.dirname,
    stubs,
    converters: false,
    lower: {},
    define: { __DEV__: options.dev === false ? "false" : "true" },
    plugins: options.plugins,
    cacheKey: options.cacheKey,
  });
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
