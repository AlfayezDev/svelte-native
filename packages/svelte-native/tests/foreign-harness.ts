import { build } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import ts from "typescript";
import { reactNativeConverters, type Platform } from "./rn-reference.ts";

/**
 * A fake Fabric binding, engine module and Expo native module for tests of the components that mount other libraries' views
 * (`src/components/*.svelte`, SPEC.md "Foreign views"): the tests read back the nodes, props and commands the host sent and
 * send events to the handlers the way React Native's event emitter does. The native halves are device work.
 */
export type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
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

export function createHarness(platform: Platform, options: {
  expo?: Record<string, Record<string, ExpoViewConfig>>;
  natives?: Partial<Natives>;
  /** More stubbed modules, by import path (the source of an ES module). */
  stubs?: Record<string, string>;
  /** Esbuild plugins that resolve before the harness's own (a library's own sources, for the tests that bundle them). */
  plugins?: import("esbuild").Plugin[];
  /** More exports of the bundle, as source text appended to its entry (`export * as svg from '../src/fabric/foreign-svg.ts'`). */
  exports?: string;
} = {}) {
  const calls: string[] = [];
  const state = { roots: {} as Record<number, FakeNode[]>, handler: undefined as ((target: unknown, type: string, event: object) => void) | undefined };
  const natives: Natives = { assets: {}, turbo: {}, modules: {}, opened: [], ...options.natives };
  const fake = {
    createNode(tag: number, name: string, _root: number, props: Record<string, unknown> | null, target: unknown) { calls.push(`create ${name}`); return { tag, name, props: { ...props }, children: [], sealed: false, target }; },
    cloneNodeWithNewChildren(node: FakeNode) { return { ...node, children: [], sealed: false }; },
    cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneProps ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
    cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { calls.push(`cloneBoth ${node.name}`); return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
    appendChild(parent: FakeNode, child: FakeNode) { parent.children.push(child); },
    createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
    appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
    completeRoot(root: number, set: { children: FakeNode[] }) { state.roots[root] = set.children; },
    measure() {},
    measureInWindow() {},
    dispatchCommand(node: FakeNode, name: string, args: unknown[]) { calls.push(`fabric.dispatchCommand ${node.name} ${name} ${JSON.stringify(args)}`); },
    setNativeProps(node: FakeNode, props: object) { calls.push(`fabric.setNativeProps ${node.name} ${JSON.stringify(props)}`); },
    registerEventHandler(next: typeof state.handler) { state.handler = next; },
  };
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
  const scope = globalThis as Record<string, unknown>;
  scope.nativeFabricUIManager = fake;
  scope.RN$registerCallableModule = () => {};
  scope.expo = {
    getViewConfig: (moduleName: string, viewName?: string) => options.expo?.[moduleName]?.[viewName ?? ""] ?? null,
    modules: { SvelteEngine: engine },
  };
  scope.__harness = { engine, natives };

  const stubs: Record<string, string> = {
    ...reanimatedStubs,
    "react-native/Libraries/Image/resolveAssetSource": "export default (source) => (typeof source === 'number' ? (globalThis.__harness.natives.assets[source] ?? null) : source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null);",
    "react-native/Libraries/TurboModule/TurboModuleRegistry": "export const getEnforcing = (name) => { const module = globalThis.__harness.natives.turbo[name]; if (!module) throw new Error('no TurboModule ' + name); return module; };",
    "react-native/Libraries/BatchedBridge/NativeModules": "export default globalThis.__harness.natives.modules;",
    "react-native/Libraries/ReactNative/I18nManager": "export default { get isRTL() { return globalThis.__harness.natives.rtl === true; } };",
    "react-native/Libraries/Linking/Linking": "export default { openURL: (url) => { globalThis.__harness.natives.opened.push(url); return Promise.resolve(); } };",
    "expo-modules-core": "export const requireOptionalNativeModule = (name) => (name === 'SvelteEngine' ? globalThis.__harness.engine : null);",
    "react-native": "export const AppRegistry = { registerRunnable() {} };",
    ...options.stubs,
  };

  async function load(fixture: string) {
    const bundle = await build({
      stdin: {
        contents: `import Fixture from ${JSON.stringify(resolve(import.meta.dirname, fixture))};
          import { startSurface, stopSurface } from '../src/fabric/host.ts';
          import { tick } from 'svelte';
          export * as foreign from '../src/fabric/foreign.ts';
          export * as configs from '../src/fabric/view-configs.ts';
          export * as datetime from '../src/fabric/foreign-datetime.ts';
          export { startSurface, stopSurface, tick, Fixture };
          ${options.exports ?? ""}`,
        resolveDir: import.meta.dirname,
      },
      bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
      plugins: [...(options.plugins ?? []), ...reactNativeConverters(platform), {
        name: "foreign-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
          builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
          builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
          builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
          builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
            contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code,
            loader: "js",
          }));
        },
      }],
    });
    const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-foreign-libraries-"));
    const file = resolve(directory, "bundle.mjs");
    await writeFile(file, bundle.outputFiles[0].contents);
    const loaded = await import(pathToFileURL(file).href);
    await rm(directory, { recursive: true });
    return loaded as { foreign: typeof import("../src/fabric/foreign.ts"); configs: typeof import("../src/fabric/view-configs.ts"); datetime: typeof import("../src/fabric/foreign-datetime.ts"); startSurface: (rootTag: number, app: unknown, props: object) => Record<string, unknown>; stopSurface: (rootTag: number) => void; tick: () => Promise<void>; Fixture: unknown };
  }

  return {
    calls,
    natives,
    roots: () => state.roots,
    /** Sends a native event to the node, as React Native's event emitter does (`topLoad`, not `onLoad`). */
    emit: (target: unknown, type: string, event: object = {}) => state.handler?.(target, type, event),
    load,
  };
}

export const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((node) => [...(node.name === name ? [node] : []), ...find(node.children, name)]);
export const settle = async (loaded: { tick: () => Promise<void> }) => { await loaded.tick(); await Promise.resolve(); await Promise.resolve(); };
export type { Platform };
