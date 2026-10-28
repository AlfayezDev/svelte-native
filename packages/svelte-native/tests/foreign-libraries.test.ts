import { expect, test } from "bun:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "svelte/compiler";
import { createHarness } from "./foreign-harness.ts";

/**
 * The six native-view libraries (expo-image, expo-blur, expo-linear-gradient, react-native-video, @react-native-community/datetimepicker,
 * lottie-react-native; SPEC.md, "Foreign views"): what the entry `@rasheed/svelte-native/foreign` pulls into a bundle, and the static
 * view configs that are not compared with a TypeScript spec in `foreign.test.ts`. React must stay out: the components mount the native
 * views by name and port the libraries' prop handling, so nothing of the libraries' JavaScript (which imports React) is bundled.
 */
const modules = resolve(import.meta.dirname, "../../../node_modules");
const libraries = ["expo-image", "expo-blur", "expo-linear-gradient", "expo-video", "react-native-video", "@react-native-community/datetimepicker", "lottie-react-native", "react-native-webview", "react-native-maps"];

type Bundle = { externals: string[]; inputs: string[] };
async function bundleForeignEntry(): Promise<Bundle> {
  const externals = new Set<string>();
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, "../src/foreign.ts")],
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false, metafile: true, logLevel: "silent",
    plugins: [{
      name: "foreign-entry",
      setup(builder) {
        // Everything the app's bundler resolves from React Native or Expo is external here, and recorded: a library or React among them fails the test below.
        builder.onResolve({ filter: /^(react|react-dom|react-native|expo|@react-native|@react-native-community|lottie-react-native|react-native-[\w-]+|expo-[\w-]+)(\/|$)/ }, (args) => {
          externals.add(args.path);
          return { path: args.path, external: true };
        });
        builder.onResolve({ filter: /^@rasheed\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), { filename: path, css: "external", dev: false, experimental: { customRenderer: "@rasheed/svelte-native/renderer" } }).js.code,
          loader: "js",
        }));
      },
    }],
  });
  return { externals: [...externals].sort(), inputs: Object.keys(result.metafile.inputs) };
}

test("the foreign entry bundles no React and none of the libraries' JavaScript, and reaches React Native only by deep paths", async () => {
  const { externals, inputs } = await bundleForeignEntry();
  // Nothing of React, React Native's index (which loads every component) or a library's package is imported.
  expect(externals.filter((path) => !path.startsWith("react-native/Libraries/")), "imports that are not React Native deep paths").toEqual([]);
  for (const path of inputs) {
    for (const library of ["react", "react-dom", "scheduler", ...libraries]) expect(path.includes(`node_modules/${library}/`), `${path} is part of the bundle`).toBe(false);
  }
  // The deep modules are native module accessors, `Platform`, the converters and the host's own registry code: no component that renders through React.
  const allowed = new Set([
    "react-native/Libraries/BatchedBridge/NativeModules",
    "react-native/Libraries/Image/resolveAssetSource",
    "react-native/Libraries/Linking/Linking",
    // The host's lazy requires for a name its static tables do not list (`view-configs.ts`).
    "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload",
    "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry",
    "react-native/Libraries/StyleSheet/processColor",
    "react-native/Libraries/TurboModule/TurboModuleRegistry",
    "react-native/Libraries/Utilities/Platform",
  ]);
  for (const path of externals) {
    if (!path.startsWith("react-native/Libraries/StyleSheet/process")) expect(allowed.has(path), `${path} is not an allowed deep import`).toBe(true);
  }
  // The six components and their helpers are part of the entry.
  for (const file of ["ExpoImage", "BlurView", "BlurTargetView", "LinearGradient", "Video", "DateTimePicker", "LottieView"]) expect(inputs.some((path) => path.endsWith(`components/${file}.svelte`)), file).toBe(true);
  for (const file of ["foreign-image", "foreign-gradient", "foreign-video", "foreign-datetime", "foreign-lottie"]) expect(inputs.some((path) => path.endsWith(`fabric/${file}.ts`)), file).toBe(true);
});

test("no source of the package imports one of the libraries or React", () => {
  const sources = ["src/foreign.ts", "src/fabric/foreign.ts", ...["image", "gradient", "video", "datetime", "lottie"].map((name) => `src/fabric/foreign-${name}.ts`),
    ...["ExpoImage", "BlurView", "BlurTargetView", "LinearGradient", "Video", "DateTimePicker", "LottieView"].map((name) => `src/components/${name}.svelte`)];
  for (const file of sources) {
    const text = readFileSync(resolve(import.meta.dirname, "..", file), "utf8");
    for (const specifier of text.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)) {
      const path = specifier[1] ?? "";
      expect(/^(react|react\/.*|react-dom.*)$/.test(path) || libraries.some((library) => path === library || path.startsWith(`${library}/`)), `${file} imports ${path}`).toBe(false);
    }
  }
});

// The datetimepicker spec is Flow, which the TypeScript reader of `foreign.test.ts` cannot parse: its props are read from the source text.
function flowSpec(file: string): { props: string[]; colors: string[]; handlers: string[] } {
  const text = readFileSync(resolve(modules, file), "utf8");
  const body = /type NativeProps = \$ReadOnly<\{\|([\s\S]*?)\|\}>;/.exec(text)?.[1] ?? "";
  const props: string[] = [];
  const colors: string[] = [];
  const handlers: string[] = [];
  const members = [...body.matchAll(/^ {2}(\w+)\?: ([\s\S]*?),\n(?= {2}\w+\?:|$)/gm)];
  for (const [, name = "", type = ""] of members) {
    if (/EventHandler/.test(type)) handlers.push(name);
    else {
      props.push(name);
      if (/ColorValue/.test(type)) colors.push(name);
    }
  }
  return { props, colors, handlers };
}

test("the static config of RNDateTimePicker lists the props, colours and events of the library's Flow spec", async () => {
  const spec = flowSpec("@react-native-community/datetimepicker/src/specs/DateTimePickerNativeComponent.js");
  expect(spec.props.length).toBeGreaterThan(8);
  const loaded = await createHarness("ios").load("foreign-datetime-fixture.svelte");
  const config = loaded.configs.viewConfigFor("RNDateTimePicker", "ios");
  const base = loaded.configs.viewConfigFor("RCTView", "ios");
  const own = Object.keys(config.attributes).filter((key) => !(key in base.attributes)).sort();
  expect(own).toEqual([...spec.props].sort());
  expect(Object.keys(config.attributes).filter((key) => typeof config.attributes[key] === "function" && typeof base.attributes[key] !== "function").sort()).toEqual([...spec.colors].sort());
  const events = [...config.events.values()];
  for (const handler of spec.handlers) expect(events, handler).toContain(handler);
  // Android has no view: the config is the same table, and the component does not mount the name there (`foreign-datetime.test.ts`).
});

test("every prop and event the Android RCTVideo manager reads or emits is in the static config", async () => {
  const directory = resolve(modules, "react-native-video/android/src/main/java/com/brentvatne");
  const manager = readFileSync(resolve(directory, "exoplayer/ReactExoplayerViewManager.kt"), "utf8");
  const emitter = readFileSync(resolve(directory, "common/react/VideoEventEmitter.kt"), "utf8");
  const props = [...manager.matchAll(/@ReactProp\(name = (\w+)/g)].map((match) => new RegExp(`const val ${match[1]} =\\s*"(\\w+)"`).exec(manager)?.[1] ?? "");
  expect(props.length).toBeGreaterThan(20);
  const events = [...emitter.matchAll(/EVENT_\w+\("(on\w+)"\)/g)].map((match) => `top${(match[1] ?? "").slice(2)}`);
  expect(events.length).toBeGreaterThan(20);
  const loaded = await createHarness("android").load("foreign-video-fixture.svelte");
  const config = loaded.configs.viewConfigFor("RCTVideo", "android");
  for (const prop of props) expect(prop in config.attributes, `prop ${prop}`).toBe(true);
  for (const event of events) expect(config.events.has(event), `event ${event}`).toBe(true);
  // The shutter colour is the one colour prop.
  expect(typeof config.attributes.shutterColor).toBe("function");
});
