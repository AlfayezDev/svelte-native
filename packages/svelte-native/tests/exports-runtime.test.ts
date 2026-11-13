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

/**
 * The main entry and the deprecated entries, bundled together and evaluated (React Native's modules are stubs, as in the other bundle tests): the deprecated entries hand out
 * the very same values as the main entry, and the main entry's SVG, animation and gesture exports are the ones the old entries had.
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
async function load(): Promise<{ main: Entry; animation: Entry; gestures: Entry; svg: Entry; nativeModules: Entry; platform: Entry }> {
  const bundle = await build({
    stdin: {
      contents: `import * as main from '../src/index.ts';
        import * as animation from '../src/deprecated/animation.ts';
        import * as gestures from '../src/deprecated/gestures.ts';
        import * as svg from '../src/deprecated/svg.ts';
        import * as nativeModules from '../src/deprecated/native-modules.ts';
        import * as platform from '../src/platform.ts';
        export { main, animation, gestures, svg, nativeModules, platform };`,
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

test("the main entry has the SVG components, the animation, the gestures and BlurView, and the deprecated entries are the same values under their old names", async () => {
  const { main, animation, gestures, svg, nativeModules, platform } = await load();
  // Names: reading the key list reads nothing lazy.
  for (const name of ["Svg", "Path", "SvgText", "SvgImage", "LinearGradient", "SvgXml", "withSpring", "withTiming", "createSharedValue", "AnimatedView", "Easing", "Gesture", "GestureDetector", "gesture", "State", "runOnJS", "BlurView", "View", "Text", "Image"]) {
    expect([name, name in main]).toEqual([name, true]);
  }
  expect(Object.keys(main)).not.toContain("default");

  // `/svg`: the old names for the same components. The main entry's Text and Image are still the views.
  expect([svg.default, svg.Svg, svg.Path, svg.SvgXml, svg.LinearGradient]).toEqual([main.Svg, main.Svg, main.Path, main.SvgXml, main.LinearGradient]);
  expect([svg.Text, svg.Image]).toEqual([main.SvgText, main.SvgImage]);
  expect([main.SvgText === main.Text, main.SvgImage === main.Image]).toEqual([false, false]);
  expect(Object.keys(svg).sort()).toEqual([...Object.keys(main).filter((name) => ["Svg", "G", "Path", "Rect", "Circle", "Ellipse", "Line", "Polygon", "Polyline", "TSpan", "TextPath", "Use", "Defs", "ClipPath", "LinearGradient", "RadialGradient", "Stop", "Pattern", "Mask", "Marker", "Symbol", "ForeignObject", "Filter", "FeBlend", "FeColorMatrix", "FeComposite", "FeDropShadow", "FeFlood", "FeGaussianBlur", "FeMerge", "FeMergeNode", "FeOffset", "SvgXml", "SvgUri"].includes(name)), "Text", "Image", "default"].sort());

  // `/animation` and `/gestures`: the same functions, objects and components.
  expect(Object.keys(animation).sort()).toEqual(["AnimatedView", "Easing", "ReduceMotion", "cancelAnimation", "createSharedValue", "runOnJS", "runOnUIAsync", "runOnUISync", "scheduleOnRN", "withDelay", "withRepeat", "withSequence", "withSpring", "withTiming"]);
  for (const name of Object.keys(animation)) expect([name, animation[name] === main[name]]).toEqual([name, true]);
  expect(Object.keys(gestures).sort()).toEqual(["ActionType", "Directions", "Gesture", "GestureDetector", "GestureStateManager", "PointerType", "State", "TouchEventType", "gesture", "runOnJS", "scheduleOnRN"]);
  for (const name of Object.keys(gestures)) expect([name, gestures[name] === main[name]]).toEqual([name, true]);

  // `/native-modules` and `/platform`.
  expect(Object.keys(nativeModules).sort()).toEqual(["nativeModule", "turboModule"]);
  expect([nativeModules.turboModule, nativeModules.nativeModule]).toEqual([platform.turboModule, platform.nativeModule]);
}, 60_000);
