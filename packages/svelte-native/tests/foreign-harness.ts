import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import type { Platform } from "./rn-reference.ts";
import { load as loadBundle } from "./support/bundle.ts";
import { type FakeNode, type HostCall, createHost, describeCall, flatten, settle as settleHost } from "./support/host.ts";

/**
 * A fake Fabric binding, engine module and Expo native module for tests of the components that mount other libraries' views
 * (`src/components/*.svelte`, SPEC.md "Foreign views"): the tests read back the nodes, props and commands the host sent and
 * send events to the handlers the way React Native's event emitter does. The native halves are device work.
 */
export type { FakeNode };
export type ExpoViewConfig = { validAttributes: Record<string, unknown>; directEventTypes?: Record<string, { registrationName: string }> | null };

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

const modules = resolve(import.meta.dirname, "../../../node_modules");

/** The props and handlers a library's codegen spec (a TypeScript `interface X extends ViewProps`) declares, read from its source: the tables in `view-configs.ts` are compared with them. */
export function specOf(file: string, interfaceName: string): { props: string[]; handlers: string[]; viewProps: boolean } {
  const path = resolve(modules, file);
  const source = ts.createSourceFile(path, ts.sys.readFile(path) ?? "", ts.ScriptTarget.Latest, true);
  const props: string[] = [];
  const handlers: string[] = [];
  let viewProps = false;
  const visit = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      viewProps = node.heritageClauses?.some((clause) => clause.types.some((type) => type.getText(source) === "ViewProps")) ?? false;
      for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        const name = member.name.getText(source).replace(/['"]/g, "");
        const type = member.type?.getText(source) ?? "";
        (/EventHandler|Event$/.test(type) || /^on[A-Z]/.test(name) ? handlers : props).push(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { props, handlers, viewProps };
}


/** The props and events a view of an Expo module declares, read from the module's Kotlin source (`View(X::class) { Name("..."); Events(...); Prop("...") }`). */
export function expoViewConfigs(moduleFile: string): Record<string, ExpoViewConfig> {
  const source = readFileSync(resolve(modules, moduleFile), "utf8");
  const configs: Record<string, ExpoViewConfig> = {};
  for (const match of source.matchAll(/\bView\(\w+::class\)\s*\{/g)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth > 0 && index < source.length) {
      const char = source[index++];
      if (char === "{") depth++;
      else if (char === "}") depth--;
    }
    const block = source.slice(start, index);
    const name = /\bName\("(\w+)"\)/.exec(block)?.[1] ?? "";
    const props = [...block.matchAll(/\bProp\("(\w+)"\)/g)].map((prop) => prop[1]);
    const events = [...(/\bEvents\(([^)]*)\)/.exec(block)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((event) => event[1]);
    configs[name] = {
      validAttributes: Object.fromEntries(props.map((prop) => [prop, true])),
      directEventTypes: events.length ? Object.fromEntries(events.map((event) => [`top${event.slice(2)}`, { registrationName: event }])) : null,
    };
  }
  return configs;
}

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
  /** More exports of the bundle, as source text appended to its entry (`export * as svg from '../src/fabric/foreign-svg.ts'`). */
  exports?: string;
} = {}) {
  const calls: string[] = [];
  const host = createHost({ calls, describe: foreignCall });
  const natives: Natives = { assets: {}, turbo: {}, modules: {}, opened: [], ...options.natives };
  const engine = {
    install: () => true,
    dispatchCommand: (tag: number, name: string, args: unknown[]) => { calls.push(`engine.dispatchCommand ${tag} ${name} ${JSON.stringify(args)}`); },
    setNativeProps: () => {},
    registerForeign: (name: string) => { calls.push(`engine.registerForeign ${name}`); return true; },
    captureView: (tag: number, options: Record<string, unknown>) => {
      calls.push(`engine.captureView ${tag} ${JSON.stringify(options)}`);
      const answer = typeof natives.engineCapture === "function" ? natives.engineCapture(tag, options) : natives.engineCapture ?? null;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  const installed = host.install({
    RN$registerCallableModule: () => {},
    expo: {
      getViewConfig: (moduleName: string, viewName?: string) => options.expo?.[moduleName]?.[viewName ?? ""] ?? null,
      modules: { SvelteEngine: engine, ...options.expoModules },
    },
    __harness: { engine, natives },
  });

  async function load(fixture: string) {
    return loadBundle<{ foreign: typeof import("../src/fabric/foreign.ts"); configs: typeof import("../src/fabric/view-configs.ts"); datetime: typeof import("../src/fabric/foreign-datetime.ts"); startSurface: (rootTag: number, app: unknown, props: object) => Record<string, unknown>; stopSurface: (rootTag: number) => void; tick: () => Promise<void>; Fixture: unknown }>({
      entry: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, fixture))};
          import { startSurface, stopSurface } from '../src/fabric/host.ts';
          import { tick } from 'svelte';
          export * as foreign from '../src/fabric/foreign.ts';
          export * as configs from '../src/fabric/view-configs.ts';
          export * as datetime from '../src/fabric/foreign-datetime.ts';
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
    roots: () => host.roots,
    /** Sends a native event to the node, as React Native's event emitter does (`topLoad`, not `onLoad`). */
    emit: (target: unknown, type: string, event: object = {}) => host.emit(target, type, event),
    load,
    /** Puts the global object back as it was before the harness was created. */
    restore: () => installed.restore(),
  };
}

export const find = (nodes: FakeNode[], name: string): FakeNode[] => flatten(nodes).filter((node) => node.name === name);
export const settle = settleHost;
export type { Platform };
