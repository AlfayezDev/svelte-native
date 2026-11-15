import { expect } from "bun:test";
import { resolve } from "node:path";
import { reanimatedStubs } from "../../reanimated-stubs.ts";
import type { Platform } from "../../rn-reference.ts";
import { load as loadBundle, src } from "../../support/bundle.ts";
import { type FakeNode, type HostCall, createHost, describeCall, flatten, settle as settleHost } from "../../support/host.ts";
import type { ExpoViewConfig } from "../../upstream/support/specs.ts";

/**
 * A fake Fabric binding, engine module and Expo native module for tests of the components that mount other libraries' views
 * (`src/components/*.svelte`, SPEC.md "Foreign views"): the tests read back the nodes, props and commands the host sent and
 * send events to the handlers the way React Native's event emitter does. The native halves are device work.
 */
export type { FakeNode };
export { expoViewConfigs, specOf, type ExpoViewConfig } from "../../upstream/support/specs.ts";

/** What the stubbed React Native modules answer: assets by number, TurboModules and legacy native modules by name. */
export type EngineCaptureAnswer = string | null | Error;
export type Natives = {
  assets: Record<number, { uri: string; width?: number; height?: number; scale?: number }>;
  turbo: Record<string, object>;
  modules: Record<string, object>;
  opened: string[];
  /**
   * What the engine's `captureView` answers: a URI or data, null for a tag that is not an engine view of its own, or an `Error` it rejects with
   * (what `Capture.kt` does for an option it does not capture). A function answers per call, as the engine does per tag and options.
   */
  engineCapture?: EngineCaptureAnswer | ((tag: number, options: Record<string, unknown>) => EngineCaptureAnswer);
  /** `I18nManager.isRTL`. */
  rtl?: boolean;
};

/** The lines of `calls` the foreign tests read: what the host creates and clones, and the commands and props it sends through Fabric (the engine's calls are written to the same log). */
const foreignCall = (call: HostCall): string | undefined => {
  switch (call.op) {
    case "create": case "cloneProps": case "cloneBoth": return describeCall(call);
    case "dispatchCommand": return `fabric.dispatchCommand ${call.node.name} ${call.command} ${JSON.stringify(call.args)}`;
    case "setNativeProps": return `fabric.setNativeProps ${call.node.name} ${JSON.stringify(call.props)}`;
    default: return undefined;
  }
};

/** What the stubbed React Native modules do, reading `globalThis.__harness` when called, so a bundle is the same text for every harness. */
const stubs = {
  ...reanimatedStubs,
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => (typeof source === 'number' ? (globalThis.__harness.natives.assets[source] ?? null) : source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null);",
  "react-native/Libraries/TurboModule/TurboModuleRegistry": "export const getEnforcing = (name) => { const module = globalThis.__harness.natives.turbo[name]; if (!module) throw new Error('no TurboModule ' + name); return module; };",
  "react-native/Libraries/BatchedBridge/NativeModules": "export default globalThis.__harness.natives.modules;",
  "react-native/Libraries/ReactNative/I18nManager": "export default { get isRTL() { return globalThis.__harness.natives.rtl === true; } };",
  "react-native/Libraries/Linking/Linking": "export default { openURL: (url) => { globalThis.__harness.natives.opened.push(url); return Promise.resolve(); } };",
  "expo-modules-core": "export const requireOptionalNativeModule = (name) => (name === 'SvelteEngine' ? globalThis.__harness.engine : null);",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

/**
 * The harness installs its fake binding, engine module and Expo module on the global object when it is created, as the bundles read them; `restore()` puts the global
 * object back (`support/host.ts`).
 */
export function createHarness(platform: Platform, options: {
  expo?: Record<string, Record<string, ExpoViewConfig>>;
  natives?: Partial<Natives>;
  /** Expo native modules by name, as `expo.modules` holds them (an Expo view's `ViewPrototypes`). */
  expoModules?: Record<string, object>;
  /** More stubbed modules, by import path (the source of an ES module). */
  stubs?: Record<string, string>;
  /** Esbuild plugins that resolve before the harness's own (a library's own sources, for the tests that bundle them). */
  plugins?: import("esbuild").Plugin[];
  /** Names the bundle when it has plugins, so it is built once (`support/bundle.ts`). */
  cacheKey?: string;
  /** More exports of the bundle, as source text appended to its entry (`export * as svg from '../src/fabric/foreign-svg.ts'`, resolved from `tests/`). */
  exports?: string;
  /** Where `load()` looks for a fixture that is not an absolute path. Default: `tests/foreign/fixtures`. */
  fixtures?: string;
} = {}) {
  const calls: string[] = [];
  // The views the host has created, which a test that clears `calls` does not forget: the engine must be told a name before the first view of it.
  const created = new Set<string>();
  const host = createHost({ calls, describe: (call) => { if (call.op === "create") created.add(call.name); return foreignCall(call); } });
  const natives: Natives = { assets: {}, turbo: {}, modules: {}, opened: [], ...options.natives };
  const engine = {
    install: () => true,
    dispatchCommand: (tag: number, name: string, args: unknown[]) => { calls.push(`engine.dispatchCommand ${tag} ${name} ${JSON.stringify(args)}`); },
    setNativeProps: () => {},
    registerForeign: (name: string) => {
      if (created.has(name)) throw new Error(`the engine was told ${name} after a view of that name was created`);
      calls.push(`engine.registerForeign ${name}`);
      return true;
    },
    captureView: (tag: number, options: Record<string, unknown>) => {
      calls.push(`engine.captureView ${tag} ${JSON.stringify(options)}`);
      const answer = typeof natives.engineCapture === "function" ? natives.engineCapture(tag, options) : natives.engineCapture ?? null;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  /** The callable modules the host registered with React Native (`RN$registerCallableModule`), by name: what the native side calls into. */
  const callable: Record<string, () => Record<string, (event: object) => void>> = {};
  const installed = host.install({
    RN$registerCallableModule: (name: string, factory: () => Record<string, (event: object) => void>) => { callable[name] = factory; },
    expo: {
      getViewConfig: (moduleName: string, viewName?: string) => options.expo?.[moduleName]?.[viewName ?? ""] ?? null,
      modules: { SvelteEngine: engine, ...options.expoModules },
    },
    __harness: { engine, natives },
  });

  async function load(fixture: string) {
    return loadBundle<{ foreign: typeof import("../../../src/fabric/foreign.ts"); configs: typeof import("../../../src/fabric/view-configs.ts"); datetime: typeof import("../../../src/fabric/foreign-datetime.ts"); startSurface: (rootTag: number, app: unknown, props: object) => Record<string, unknown>; stopSurface: (rootTag: number) => void; tick: () => Promise<void>; Fixture: unknown }>({
      entry: `import Fixture from ${JSON.stringify(resolve(options.fixtures ?? resolve(import.meta.dirname, "../fixtures"), fixture))};
          import { startSurface, stopSurface } from ${JSON.stringify(src("fabric/host.ts"))};
          import { tick } from 'svelte';
          export * as foreign from ${JSON.stringify(src("fabric/foreign.ts"))};
          export * as configs from ${JSON.stringify(src("fabric/view-configs.ts"))};
          export * as datetime from ${JSON.stringify(src("fabric/foreign-datetime.ts"))};
          export { startSurface, stopSurface, tick, Fixture };
          ${options.exports ?? ""}`,
      platform,
      stubs: { ...stubs, ...options.stubs },
      plugins: options.plugins,
      cacheKey: options.cacheKey,
    });
  }

  return {
    calls,
    natives,
    callable,
    roots: () => host.roots,
    /** Sends a native event to the node, as React Native's event emitter does (`topLoad`, not `onLoad`). */
    emit: (target: unknown, type: string, event: object = {}) => host.emit(target, type, event),
    /**
     * Every foreign view is announced to the engine (`registerForeign`) before the first view of its name is created, or the engine's frame cannot lay it out: the harness
     * refuses the reverse order as it happens, and this asserts that each name was announced.
     */
    expectToldFirst(...names: string[]) {
      for (const name of names) {
        const told = calls.indexOf(`engine.registerForeign ${name}`);
        expect(told, `${name} is told to the engine`).toBeGreaterThanOrEqual(0);
        expect(told, `${name} is told before it is created`).toBeLessThan(calls.indexOf(`create ${name}`));
      }
    },
    load,
    /** Puts the global object back as it was before the harness was created. */
    restore: () => installed.restore(),
  };
}

export const find = (nodes: FakeNode[], name: string): FakeNode[] => flatten(nodes).filter((node) => node.name === name);
export const settle = settleHost;
export type { Platform };
