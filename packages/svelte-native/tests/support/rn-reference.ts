import { build, type Plugin } from "esbuild";
import { transformSync } from "@babel/core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

/**
 * React Native's own view configs and attribute payload code, built from its Flow sources, as the reference the static
 * view configs (`src/fabric/view-configs.ts`) are compared with. Platform files (`.android.js`, `.ios.js`) resolve as
 * Metro resolves them, and native components that rely on build-time codegen run through the same Babel plugin Metro uses.
 */
export type Platform = "android" | "ios";
type Table = Record<string, unknown>;
export type RegisteredConfig = {
  uiViewClassName: string;
  validAttributes: Table;
  bubblingEventTypes: Record<string, { phasedRegistrationNames: { bubbled: string } }>;
  directEventTypes: Record<string, { registrationName: string }>;
};
export type Reference = {
  get(name: string): RegisteredConfig;
  create(props: object, validAttributes: object): object | null;
  diff(previous: object, next: object, validAttributes: object): object | null;
  /** The static view configs, built into the same bundle so their lazy `require`s reach React Native's real modules. */
  configs: typeof import("../../src/fabric/view-configs.ts");
};

const require = createRequire(import.meta.url);
const hermesParser = require.resolve("babel-plugin-syntax-hermes-parser");
const stripFlow = require.resolve("@babel/plugin-transform-flow-strip-types");
const flowEnums = require.resolve("babel-plugin-transform-flow-enums");
const codegen = require.resolve("@react-native/babel-plugin-codegen");
const fabricDirectory = resolve(import.meta.dirname, "../../src/fabric");
const reactNative = /[\\/]node_modules[\\/]react-native[\\/]/;

/** The native components whose registration `ReactNativeViewConfigRegistry.get` needs: one import per view name the host maps. */
const components = [
  "Components/View/ViewNativeComponent", "Text/TextNativeComponent", "Components/ScrollView/ScrollViewNativeComponent",
  "Components/TextInput/AndroidTextInputNativeComponent", "Components/TextInput/RCTSingelineTextInputNativeComponent",
  "Components/TextInput/RCTMultilineTextInputNativeComponent", "Image/ImageViewNativeComponent",
  "Components/Switch/AndroidSwitchNativeComponent", "Components/Switch/SwitchNativeComponent",
  "Components/ProgressBarAndroid/ProgressBarAndroidNativeComponent", "Components/ActivityIndicator/ActivityIndicatorViewNativeComponent",
  "Modal/RCTModalHostViewNativeComponent", "Components/SafeAreaView/RCTSafeAreaViewNativeComponent",
];

const transformed = new Map<string, string>();
function stripped(path: string): string {
  const known = transformed.get(path);
  if (known !== undefined) return known;
  const source = readFileSync(path, "utf8");
  const plugins = [[hermesParser, { parseLangTypes: "flow" }], ...(/\bcodegenNativeComponent</.test(source) ? [codegen] : []), stripFlow, flowEnums];
  const result: { code?: string | null } | null = transformSync(source, { filename: path, babelrc: false, configFile: false, plugins, sourceType: "unambiguous" });
  const code = result?.code ?? "";
  transformed.set(path, code);
  return code;
}

/** Resolves and loads React Native's JavaScript for an esbuild bundle: Flow stripped, `Platform` fixed, the renderer left out. */
export function reactNativeSources(platform: Platform): Plugin {
  return {
    name: "react-native-sources",
    setup(builder) {
      builder.onResolve({ filter: /(^|\/)Platform$/ }, (args) => reactNative.test(args.importer) || args.path.startsWith("react-native/") ? { path: "Platform", namespace: "rn-platform" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "rn-platform" }, () => ({ contents: `export default { OS: ${JSON.stringify(platform)}, Version: 34, select: (options) => options[${JSON.stringify(platform)}] ?? options.default };`, loader: "js" }));
      // The renderer is not part of the host; Metro stubs the same three modules.
      builder.onResolve({ filter: /RendererProxy$|shims\/ReactFabric$|createReactNativeComponentClass$/ }, (args) => reactNative.test(args.importer)
        ? { path: resolve(fabricDirectory, /RendererProxy/.test(args.path) ? "renderer-stub.ts" : /ReactFabric/.test(args.path) ? "react-fabric-stub.ts" : "component-class-stub.ts") }
        : undefined);
      builder.onLoad({ filter: reactNative }, (args) => (args.path.endsWith(".js") ? { contents: stripped(args.path), loader: "js" } : undefined));
    },
  };
}

/**
 * For a fixture bundle that stubs the rest of `react-native`: lets the static view configs' lazy `require`s of React
 * Native's own style converters (`StyleSheet/process*`) reach the real modules. The bundle needs `mainFields: ["main"]`.
 */
export function reactNativeConverters(platform: Platform): Plugin[] {
  return [
    {
      name: "react-native-converters",
      setup(builder) {
        builder.onResolve({ filter: /^react-native\/Libraries\/StyleSheet\/process/ }, (args) => ({ path: require.resolve(args.path) }));
      },
    },
    reactNativeSources(platform),
  ];
}

export const resolveExtensions = (platform: Platform): string[] => [`.${platform}.js`, ".ts", ".js", ".json"];

/** Constants the native modules would answer when React Native's modules evaluate; feature flags take their defaults. */
const nativeModules = (name: string) => (name.startsWith("NativeReactNativeFeatureFlags") ? null : { getConstants: () => ({ Dimensions: { window: { width: 360, height: 640, scale: 2, fontScale: 1 }, screen: { width: 360, height: 640, scale: 2, fontScale: 1 } } }) });

/** Installs the globals React Native's registry reads (`RN$Bridgeless` selects static view configs) and returns what puts the previous values back. */
function installGlobals(): () => void {
  const scope = globalThis as Record<string, unknown>;
  const keys = ["RN$Bridgeless", "__turboModuleProxy", "nativeModuleProxy"];
  const saved = keys.map((key) => [key, scope[key], key in scope] as const);
  scope.RN$Bridgeless = true;
  scope.__turboModuleProxy = nativeModules;
  scope.nativeModuleProxy = {};
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  return () => {
    console.error = error;
    console.warn = warn;
    for (const [key, value, had] of saved) { if (had) scope[key] = value; else delete scope[key]; }
  };
}

export function withReactNativeGlobals<T>(run: () => T): T {
  const restore = installGlobals();
  try { return run(); } finally { restore(); }
}

/** Bundles `entry` (source text) with React Native's real modules for `platform` and imports the result. */
export async function importWithReactNative<T>(platform: Platform, entry: string, plugins: Plugin[] = []): Promise<T> {
  const bundle = await build({
    stdin: { contents: entry, resolveDir: import.meta.dirname },
    bundle: true, format: "esm", platform: "neutral", write: false, keepNames: true, mainFields: ["main"],
    resolveExtensions: resolveExtensions(platform),
    define: { __DEV__: "false", "process.env.NODE_ENV": '"production"' },
    plugins: [reactNativeSources(platform), ...plugins],
    logLevel: "error",
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-reference-"));
  try {
    const file = resolve(directory, "bundle.mjs");
    await writeFile(file, bundle.outputFiles[0].contents);
    const restore = installGlobals();
    try { return await import(pathToFileURL(file).href) as T; } finally { restore(); }
  } finally {
    await rm(directory, { recursive: true });
  }
}

const references = new Map<Platform, Promise<Reference>>();

/** React Native's registry and attribute payload code for a platform, with the static view configs beside it, built once per test run. */
export function loadReference(platform: Platform): Promise<Reference> {
  let loaded = references.get(platform);
  if (!loaded) {
    const base = "react-native/Libraries";
    const entry = `${components.map((component) => `import "${base}/${component}";`).join("\n")}
      export { get } from "${base}/Renderer/shims/ReactNativeViewConfigRegistry";
      export { create, diff } from "${base}/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload";
      export * as configs from ${JSON.stringify(resolve(fabricDirectory, "view-configs.ts"))};`;
    loaded = importWithReactNative<Reference>(platform, entry).then((module) => ({
      get: (name) => withReactNativeGlobals(() => module.get(name)),
      create: module.create,
      diff: module.diff,
      configs: module.configs,
    }));
    references.set(platform, loaded);
  }
  return loaded;
}
