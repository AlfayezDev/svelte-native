import { expect, test } from "bun:test";
import { build, transformSync } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { componentOptions } from "../src/compile-options.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { svgLibraryStubs } from "./svg-library-stubs.ts";
import { animation, gestures, nativeModules, svg, svgRenamed } from "./removed-entries.ts";

/**
 * The main entry and `/platform`, bundled together and evaluated (React Native's modules are stubs, as in the other bundle tests): they export every name the entries
 * 0.4.0-rc.7 removed (`/animation`, `/gestures`, `/svg`, `/native-modules`) exported, as values of the same kind.
 */
const stubs: Record<string, string> = {
  ...reanimatedStubs,
  ...svgLibraryStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => ({ ...next });",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: {}, directEventTypes: {} });",
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Linking/Linking": "export default { addEventListener: () => ({ remove() {} }), getInitialURL: () => Promise.resolve(null) };",
  "react-native/Libraries/Image/resolveAssetSource": "export default () => null;",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;",
};

type Entry = Record<string, unknown>;
async function load(): Promise<{ main: Entry; platform: Entry }> {
  const bundle = await build({
    stdin: {
      contents: `import * as main from '../src/index.ts';
        import * as platform from '../src/platform.ts';
        export { main, platform };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "exports-runtime",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /^@alfayez\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => ({
          contents: compileModule(transformSync(await readFile(path, "utf8"), { loader: "ts" }).code, { filename: path, generate: "client" }).js.code,
          loader: "js",
        }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({ contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code, loader: "js" }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-exports-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const loaded = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return loaded;
}

test("the main entry has the SVG components, the animation, the gestures and BlurView, and `/platform` the two native module lookups: every name the removed entries exported", async () => {
  const { main, platform } = await load();
  // Names: reading the key list reads nothing lazy.
  for (const name of ["Svg", "Path", "SvgText", "SvgImage", "SvgLinearGradient", "SvgMarker", "SvgXml", "withSpring", "withTiming", "createSharedValue", "AnimatedView", "Easing", "Gesture", "GestureDetector", "gesture", "State", "runOnJS", "BlurView", "View", "Text", "Image"]) {
    expect([name, name in main]).toEqual([name, true]);
  }
  expect(Object.keys(main)).not.toContain("default");

  // `/svg`: the main entry has its elements under react-native-svg's names, but the four that clash with the views' and `/foreign`'s, which are `SvgText`, `SvgImage`, `SvgLinearGradient` and `SvgMarker`
  // (the main entry's Text and Image are the views). Its default export was `Svg`.
  for (const name of svg.values) expect([name, name in main]).toEqual([name, true]);
  for (const [old, name] of Object.entries(svgRenamed)) expect([old, name, name in main]).toEqual([old, name, true]);
  expect(["LinearGradient", "Marker"].filter((name) => name in main)).toEqual([]);
  expect([main.SvgText === main.Text, main.SvgImage === main.Image]).toEqual([false, false]);

  // `/animation` and `/gestures`: the functions, objects and components are the main entry's (the gestures' `runOnJS` and `scheduleOnRN` are the animation's).
  for (const name of [...animation.values, ...gestures.values]) expect([name, name in main]).toEqual([name, true]);
  expect([typeof main.withSpring, typeof main.AnimatedView, typeof main.createSharedValue]).toEqual(["function", "function", "function"]);

  // `/native-modules` is `/platform`.
  for (const name of nativeModules.values) expect([name, typeof platform[name]]).toEqual([name, "function"]);
}, 60_000);
