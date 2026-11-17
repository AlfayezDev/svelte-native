import { build, transform, type BuildOptions, type Plugin } from "esbuild";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { compile, compileModule } from "svelte/compiler";
import { componentOptions, lowersHtml } from "../../src/compile-options.ts";
import { lowerPrimitives } from "../../src/lower.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { reactNativeConverters, type Platform } from "./rn-reference.ts";

/**
 * The one loader of the suite's host tests: a Svelte fixture (and the library's own sources it reaches) bundled with esbuild against stand-ins for React Native, and
 * evaluated as a module. It resolves the renderer and `esm-env` as an app's bundler does, compiles `.svelte` and `.svelte.ts` files with the options the library compiles
 * with (`componentOptions`), and hands React Native's modules to a table of stubs.
 *
 * A bundle is built once per run for each (entry, platform, options) and evaluated afresh for each `load()`: a test gets module state of its own (handler tags, records,
 * Svelte's runtime), at the price of evaluating the text and not of building it. A call with a plugin or a function in its options is built every time unless it
 * names itself with `cacheKey`, because a function cannot be part of a key.
 */
export type { Platform };

/** Where the tests are, the default place the imports of an entry resolve from, and `src` for a path in the package's sources. */
export const tests = resolve(import.meta.dirname, "..");
export const src = (path: string): string => resolve(tests, "../src", path);

export type BundleOptions = {
  /** The source of the bundle's entry module. Its imports resolve from `resolveDir`. */
  entry: string;
  /** Default: the tests directory. */
  resolveDir?: string;
  /** The operating system the React Native converters are built for. Default "android". */
  platform?: Platform;
  /** The stand-ins for `react-native*`, `expo-modules-core` and any other import path that is a key (source text of an ES module). Default: `baseStubs(platform)`. */
  stubs?: Record<string, string>;
  /**
   * What stands in for `src/fabric/view-configs.ts`: the real tables (default), `view-configs-stub.ts`, which passes every prop through, or `payload-tap.ts`, which also asks React
   * Native's own registry for every payload the host builds (for the importer `fabric/host.ts` only) and records both.
   */
  viewConfigs?: "real" | "pass-through" | "payload-tap";
  /** Let React Native's own style converters and platform file resolve (`rn-reference.ts`). Default true. */
  converters?: boolean;
  /** Lower the primitives of `@alfayez/svelte-native` to host tags as the Metro transformer does; `html` also lowers the HTML elements, in the files `lowersHtml` names. */
  lower?: { html?: boolean };
  /** Compile components with Svelte's async mode: `true` for every file, or a function that chooses (give it a `cacheKey`). */
  compiled?: boolean | ((path: string) => boolean);
  /** `define` of esbuild, for example `{ __DEV__: "true" }`. */
  define?: Record<string, string>;
  /** Change the source of the files whose path matches `file` (a regular expression's source) before they are bundled: replace the first occurrence of `find` (a spy on a function), or put `prepend` before the file's code. */
  patches?: ({ file: string; find: string; replace: string } | { file: string; prepend: string })[];
  /** Plugins that resolve before the built-in ones. */
  plugins?: Plugin[];
  /** Names the bundle when it has plugins or a function in its options, so it can be cached. */
  cacheKey?: string;
  /** More esbuild options, over the defaults (`mainFields: []`, for example). */
  esbuild?: Partial<BuildOptions>;
};

export type Bundle = { code: string; /** What the lowering warned about while the bundle was built. */ warnings: string[] };

/** The stand-ins a fixture that mounts through the host needs: Reanimated's, the platform, assets, the native components' registrations, Expo's core and the app registry. */
export function baseStubs(platform: Platform = "android"): Record<string, string> {
  return {
    ...reanimatedStubs,
    "react-native/Libraries/Utilities/Platform": `export default { OS: ${JSON.stringify(platform)}, Version: 34 };`,
    "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
    "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
    "react-native/Libraries/Text/TextNativeComponent": "export {};",
    "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
    "expo-modules-core": "export const requireOptionalNativeModule = () => null;",
    "react-native": "export const AppRegistry = { registerRunnable() {} };",
  };
}

/** What the router and the keyboard reach in React Native, for the tests that mount an app with a `<Router>`. */
export const appStubs: Record<string, string> = {
  "react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;",
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Built = Promise<Bundle>;
const cache = new Map<string, Built>();

function keyOf(options: BundleOptions): string | undefined {
  const uncacheable = options.plugins?.length || typeof options.compiled === "function";
  if (uncacheable && !options.cacheKey) return undefined;
  const serialisable = Object.fromEntries(Object.entries(options).filter(([name]) => name !== "plugins" && name !== "compiled"));
  // The environment the compile options read: a test that changes it gets a bundle of its own.
  const environment = [process.env.SVELTE_NATIVE_RUNES, process.env.SVELTE_NATIVE_ASYNC, process.env.SVELTE_NATIVE_TEST_ASYNC];
  return JSON.stringify({ ...serialisable, compiled: typeof options.compiled === "function" ? "function" : options.compiled, environment });
}

export type HostPluginOptions = Pick<BundleOptions, "platform" | "stubs" | "viewConfigs" | "lower" | "compiled" | "patches"> & {
  /** Lets any module import any name from a stub, as a CommonJS module does: for the tests that read the import graph and do not run the code. */
  openStubs?: boolean;
  /** Where what the lowering warned about is collected. */
  warnings?: string[];
};

/** The esbuild plugin that makes a bundle a host test's: the stubs, the view configs, the renderer and `esm-env`, and Svelte's compiler. */
export function hostPlugin(options: HostPluginOptions = {}): Plugin {
  const stubs = options.stubs ?? baseStubs(options.platform);
  const viewConfigs = options.viewConfigs ?? "real";
  const compiled = options.compiled;
  const warnings = options.warnings ?? [];
  const named = Object.keys(stubs).filter((name) => !/^(react-native|expo-modules-core)/.test(name));
  return {
    name: "svelte-native-test-host",
    setup(builder) {
      // The vendored packages (`#vendor/<name>`, `vendor/`) are react-native-* packages the library carries: stood in for like the installed ones were, so their React Native imports are not bundled.
      builder.onResolve({ filter: /^(react-native|expo-modules-core|#vendor\/)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
      if (named.length) builder.onResolve({ filter: new RegExp(`^(${named.map(escapeRegExp).join("|")})$`) }, (args) => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: options.openStubs ? "module.exports = new Proxy({}, { get: () => () => {} });" : stubs[args.path] ?? "export {};", loader: "js", resolveDir: tests }));
      if (viewConfigs === "pass-through") builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: resolve(import.meta.dirname, "view-configs-stub.ts") }));
      if (viewConfigs === "payload-tap") builder.onResolve({ filter: /\/view-configs\.ts$/ }, (args) => (args.importer.endsWith("/fabric/host.ts") ? { path: resolve(import.meta.dirname, "payload-tap.ts") } : undefined));
      builder.onResolve({ filter: /^@alfayez\/svelte-native\/renderer$/ }, () => ({ path: src("renderer.ts") }));
      builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: src("environment.ts") }));
      for (const patch of options.patches ?? []) {
        builder.onLoad({ filter: new RegExp(patch.file) }, async ({ path }) => {
          const source = await readFile(path, "utf8");
          return { contents: "prepend" in patch ? patch.prepend + source : source.replace(patch.find, patch.replace), loader: "ts" };
        });
      }
      builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
        const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
        return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
      });
      builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
        const source = await readFile(path, "utf8");
        const lowered = options.lower ? lowerPrimitives(source, { filename: path, html: options.lower.html ? lowersHtml(path) : undefined, warn: (message) => warnings.push(message) }) : source;
        const defaults = componentOptions(path);
        const async = typeof compiled === "function" ? compiled(path) : compiled;
        const experimental = async ? { ...defaults.experimental, async: true } : defaults.experimental;
        return { contents: compile(lowered, { ...defaults, experimental }).js.code, loader: "js" };
      });
    },
  };
}

async function bundleFrom(options: BundleOptions): Promise<Bundle> {
  const platform = options.platform ?? "android";
  const warnings: string[] = [];
  const result = await build({
    stdin: { contents: options.entry, resolveDir: options.resolveDir ?? tests },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false,
    ...(options.define ? { define: options.define } : {}),
    ...options.esbuild,
    plugins: [...(options.plugins ?? []), ...((options.converters ?? true) ? reactNativeConverters(platform) : []), hostPlugin({ ...options, warnings })],
  });
  return { code: result.outputFiles?.[0]?.text ?? "", warnings };
}

/** The bundle of `options`: built the first time and kept for the run. */
export function bundle(options: BundleOptions): Promise<Bundle> {
  const key = keyOf(options);
  if (key === undefined) return bundleFrom(options);
  let built = cache.get(key);
  if (!built) {
    built = bundleFrom(options);
    cache.set(key, built);
    built.catch(() => cache.delete(key));
  }
  return built;
}

/**
 * The bundles that were run lately, as the text `evaluate` runs: converting one is a pass of esbuild, and a file evaluates the bundle of its harness for each test. Not every bundle
 * is kept (the differential test builds one for each page), only the ones used last.
 */
const scripts = new Map<string, string>();
const KEPT_SCRIPTS = 16;
const nodeRequire = createRequire(import.meta.url);
let evaluations = 0;

/**
 * Evaluates bundled text as a module of its own: its module state is new.
 *
 * The text runs as a function, not as an `import()` of a file: Bun keeps every module it has imported until the process ends, and with it the functions and scopes of the bundle (the
 * renderer, Svelte's runtime and the fixture: about 1,200 functions) and its code, whatever the test does with the result. After a few hundred of them every garbage collection of
 * the process takes several times as long (in a measurement, 250 imported bundles made the 20 seeds of the HTML differential test, which builds and runs a bundle for each seed,
 * take four times as long, almost all of it collections; the same bundles run as functions and kept alive took as long as none), so the files late in a run were the slowest. A bundle
 * run this way is garbage when its test lets go of it.
 */
export async function evaluate<T = Record<string, unknown>>(code: string): Promise<T> {
  let script = scripts.get(code);
  if (script === undefined) {
    const converted = await transform(code, { format: "iife", globalName: "__bundle", target: "esnext", logLevel: "silent" });
    script = `"use strict";\n${converted.code}\nreturn __bundle;`;
  }
  // The map is in the order of use, so what goes when it is full is the one used longest ago.
  scripts.delete(code);
  scripts.set(code, script);
  if (scripts.size > KEPT_SCRIPTS) scripts.delete(scripts.keys().next().value as string);
  return new Function("require", `${script}\n//# sourceURL=svelte-native-bundle-${++evaluations}.js`)(nodeRequire) as T;
}

/** Bundles (or takes the kept bundle of) `options` and evaluates it. */
export async function load<T = Record<string, unknown>>(options: BundleOptions): Promise<T> {
  return evaluate<T>((await bundle(options)).code);
}
