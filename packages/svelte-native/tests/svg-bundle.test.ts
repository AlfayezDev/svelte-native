import { expect, test } from "bun:test";
import { build, type Plugin } from "esbuild";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { compile } from "svelte/compiler";

/**
 * The `@rasheed/svelte-native/svg` entry (SPEC.md, "react-native-svg") bundled as Metro bundles it: the library's own sources are imported by deep path (the
 * extractors in `src/lib`), the library's `react-native` import resolves to the host's lite shim, and everything of React Native's is an external that is
 * recorded. React must stay out, and with it every part of the library that is React: its elements, its XML renderer, its fabric components and its index.
 */
const root = resolve(import.meta.dirname, "../../..");
const lite = resolve(import.meta.dirname, "../src/fabric/react-native-lite.ts");
const library = resolve(root, "node_modules/react-native-svg");

type Bundle = { externals: string[]; inputs: string[] };
async function bundleSvgEntry(): Promise<Bundle> {
  const externals = new Set<string>();
  const metro: Plugin = {
    name: "metro",
    setup(builder) {
      // Metro: the library's own `react-native` import goes to the lite shim (`LITE_ORIGINS` in `metro.ts`).
      builder.onResolve({ filter: /^react-native$/ }, (args) => (args.importer.startsWith(library) ? { path: lite } : (externals.add(args.path), { path: args.path, external: true })));
      builder.onResolve({ filter: /^react-native-svg\// }, async (args) => {
        if (args.pluginData?.skip) return undefined;
        return builder.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { skip: true } });
      });
      builder.onResolve({ filter: /^(react|react-dom|react-native|expo|@react-native|@react-native-community|react-native-[\w-]+|expo-[\w-]+)(\/|$)/ }, (args) => {
        if (args.pluginData?.skip) return undefined;
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
  };
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, "../src/svg.ts")],
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false, metafile: true, logLevel: "silent",
    plugins: [metro],
  });
  return { externals: [...externals].sort(), inputs: Object.keys(result.metafile.inputs) };
}

test("the svg entry bundles no React, and of the library only the extractors of src/lib that need none", async () => {
  const { externals, inputs } = await bundleSvgEntry();
  // Nothing of React: no package, no import.
  expect(externals.filter((path) => path === "react" || path.startsWith("react/") || path.startsWith("react-dom")), "React imports").toEqual([]);
  for (const path of inputs) for (const name of ["react", "react-dom", "scheduler"]) expect(path.includes(`node_modules/${name}/`), `${path} is part of the bundle`).toBe(false);
  // Of the library: these files and no others (its elements, `xml.tsx`, the fabric components and the index all import React or `codegenNativeComponent`).
  const fromLibrary = inputs.filter((path) => path.includes("react-native-svg/")).map((path) => relative(library, resolve(process.cwd(), path))).sort();
  expect(fromLibrary).toEqual([
    "src/lib/Matrix2D.ts",
    "src/lib/extract/extractBrush.ts",
    "src/lib/extract/extractFill.ts",
    "src/lib/extract/extractLengthList.ts",
    "src/lib/extract/extractOpacity.ts",
    "src/lib/extract/extractPolyPoints.ts",
    "src/lib/extract/extractProps.ts",
    "src/lib/extract/extractResponder.ts",
    "src/lib/extract/extractStroke.ts",
    "src/lib/extract/extractTransform.ts",
    "src/lib/extract/extractViewBox.ts",
    "src/lib/extract/transform.js",
    "src/lib/extract/transformToRn.js",
    "src/lib/maskType.ts",
    "src/lib/units.ts",
    "src/lib/util.ts",
    "src/lib/utils/convertPercentageColor.ts",
  ].sort());
  // The packages besides: `warn-once`, a dependency of the library's `util.ts` (plain JavaScript), and Svelte's own `clsx`.
  expect(inputs.filter((path) => path.includes("node_modules/") && !path.includes("react-native-svg/") && !path.includes("node_modules/svelte/")).map((path) => /node_modules\/([^/]+)\//.exec(path)?.[1]).sort()).toEqual(["clsx", "warn-once"]);
  // The entry's own files: every element and both XML components.
  for (const file of ["Svg", "G", "Path", "Rect", "Circle", "Ellipse", "Line", "Polygon", "Polyline", "Text", "TSpan", "TextPath", "Use", "Image", "Defs", "ClipPath", "LinearGradient", "RadialGradient", "Stop", "Pattern", "Mask", "Marker", "Symbol", "ForeignObject", "Filter", "FeBlend", "FeColorMatrix", "FeComposite", "FeDropShadow", "FeFlood", "FeGaussianBlur", "FeMerge", "FeMergeNode", "FeOffset", "SvgXml", "SvgUri"]) {
    expect(inputs.some((path) => path.endsWith(`components/svg/${file}.svelte`)), file).toBe(true);
  }
});

test("React Native is reached by deep paths only: the lite shim's modules and the converters the host already uses", async () => {
  const { externals } = await bundleSvgEntry();
  expect(externals.filter((path) => !path.startsWith("react-native/Libraries/")), "imports that are not React Native deep paths").toEqual([]);
  expect(externals).toEqual([
    // What the lite shim imports (`react-native-lite.ts`): seven modules it evaluates at once and those it requires on first use. Its `View`, `Text` and
    // `findNodeHandle` are placeholders, so no component of React Native is among them; `PanResponder` is the one export the library's `extractResponder` needs.
    "react-native/Libraries/AppState/AppState",
    "react-native/Libraries/BatchedBridge/NativeModules",
    "react-native/Libraries/EventEmitter/NativeEventEmitter",
    "react-native/Libraries/Interaction/PanResponder",
    "react-native/Libraries/Components/StatusBar/StatusBar",
    "react-native/Libraries/Network/RCTNetworking",
    "react-native/Libraries/ReactNative/I18nManager",
    "react-native/Libraries/StyleSheet/StyleSheet",
    "react-native/Libraries/StyleSheet/processColor",
    "react-native/Libraries/TurboModule/TurboModuleRegistry",
    "react-native/Libraries/Utilities/Appearance",
    "react-native/Libraries/Utilities/Dimensions",
    "react-native/Libraries/Utilities/PixelRatio",
    "react-native/Libraries/Utilities/Platform",
    "react-native/Libraries/Utilities/codegenNativeComponent",
    "react-native/Libraries/Utilities/useColorScheme",
    // The host's own: the converters of its static view configs, asset resolution and the registry for a name it does not list.
    "react-native/Libraries/Image/resolveAssetSource",
    "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload",
    "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry",
    "react-native/Libraries/StyleSheet/processAspectRatio",
    "react-native/Libraries/StyleSheet/processBackgroundImage",
    "react-native/Libraries/StyleSheet/processBackgroundPosition",
    "react-native/Libraries/StyleSheet/processBackgroundRepeat",
    "react-native/Libraries/StyleSheet/processBackgroundSize",
    "react-native/Libraries/StyleSheet/processBoxShadow",
    "react-native/Libraries/StyleSheet/processFilter",
    "react-native/Libraries/StyleSheet/processFontVariant",
    "react-native/Libraries/StyleSheet/processTransform",
    "react-native/Libraries/StyleSheet/processTransformOrigin",
  ].sort());
});

test("no source of the svg entry imports React, the library's index or one of its components", () => {
  const sources = ["src/svg.ts", "src/fabric/svg-library.js", "src/fabric/foreign-svg.ts", "src/fabric/foreign-svg-kinds.ts", "src/fabric/foreign-svg-extract.ts", "src/fabric/foreign-svg-xml.ts", "src/fabric/foreign-text.ts"];
  for (const file of sources) {
    const text = readFileSync(resolve(import.meta.dirname, "..", file), "utf8");
    for (const specifier of text.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)) {
      const path = specifier[1] ?? "";
      expect(/^(react|react\/.*|react-dom.*)$/.test(path), `${file} imports ${path}`).toBe(false);
      // The library only by deep path into `src/lib`, and only from `svg-library.js`.
      if (path.startsWith("react-native-svg")) {
        expect(path.startsWith("react-native-svg/src/lib/"), `${file} imports ${path}`).toBe(true);
        expect(file, `${file} imports ${path}`).toBe("src/fabric/svg-library.js");
      }
    }
  }
});

test("Metro gives the library's own sources the lite shim, which exports what its extractors import", async () => {
  // `LITE_ORIGINS` (`metro.ts`) lists the packages whose `react-native` import is the lite shim; the library's `src/lib` imports `processColor` and `PanResponder`.
  const metro = readFileSync(resolve(import.meta.dirname, "../src/metro.ts"), "utf8");
  expect(/const LITE_ORIGINS = [^\n]*\|react-native-svg\)/.test(metro)).toBe(true);
  const imported = new Set<string>();
  for (const file of ["extractFill", "extractBrush", "extractResponder"]) {
    const text = readFileSync(resolve(library, `src/lib/extract/${file}.ts`), "utf8");
    for (const match of text.matchAll(/import \{ ([^}]+) \} from 'react-native';/g)) for (const name of (match[1] ?? "").split(",")) imported.add(name.trim());
  }
  expect([...imported].sort()).toEqual(["PanResponder", "processColor"]);
  const liteSource = readFileSync(lite, "utf8");
  for (const name of imported) expect(liteSource).toContain(`export const ${name} =`);
});
