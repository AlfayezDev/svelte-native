import { expect, test } from "bun:test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "svelte/compiler";
import { componentOptions } from "../../src/compile-options.ts";
import { src } from "../support/bundle.ts";
import { packageRoot } from "../support/paths.ts";

/**
 * What the entry `@alfayez/svelte-native/foreign` pulls into a bundle (SPEC.md, "Foreign views"): the twelve native-view libraries (expo-image, expo-blur, expo-linear-gradient,
 * react-native-video, @react-native-community/datetimepicker, lottie-react-native, react-native-pdf with react-native-blob-util, react-native-view-shot, rive-react-native,
 * expo-conic-gradient, react-native-fast-shadow, react-native-animateable-text). React must stay out: the components mount the native views by name and port the libraries' prop
 * handling, so nothing of the libraries' JavaScript (which imports React) is bundled. What the libraries declare is compared with the host's tables in `tests/upstream/`.
 */
const libraries = [
  "expo-image", "expo-blur", "expo-linear-gradient", "expo-video", "react-native-video", "@react-native-community/datetimepicker", "lottie-react-native", "react-native-webview", "react-native-maps",
  "react-native-pdf", "react-native-blob-util", "react-native-view-shot", "rive-react-native", "expo-conic-gradient", "react-native-fast-shadow", "react-native-animateable-text",
];
const components = ["ExpoView", "ExpoImage", "BlurView", "ExpoBlurView", "BlurTargetView", "LinearGradient", "Video", "DateTimePicker", "LottieView", "Pdf", "ViewShot", "Rive", "ConicGradient", "ShadowedView", "AnimateableText"];
const helpers = ["expo-view", "image", "gradient", "video", "datetime", "lottie", "pdf", "capture", "rive", "shadow"];

type Bundle = { externals: string[]; inputs: string[] };
async function bundleForeignEntry(): Promise<Bundle> {
  const externals = new Set<string>();
  const result = await build({
    entryPoints: [src("foreign.ts")],
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], mainFields: ["main"], write: false, metafile: true, logLevel: "silent",
    plugins: [{
      name: "foreign-entry",
      setup(builder) {
        // Everything the app's bundler resolves from React Native or Expo is external here, and recorded: a library or React among them fails the test below.
        builder.onResolve({ filter: /^(react|react-dom|react-native|expo|@react-native|@react-native-community|lottie-react-native|react-native-[\w-]+|expo-[\w-]+)(\/|$)/ }, (args) => {
          externals.add(args.path);
          return { path: args.path, external: true };
        });
        builder.onResolve({ filter: /^@alfayez\/svelte-native\/renderer$/ }, () => ({ path: src("renderer.ts") }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: src("environment.ts") }));
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(await readFile(path, "utf8"), componentOptions(path)).js.code,
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
  // The two that are not React Native's: `expo-constants`, read (lazily) for the libraries the build has when a foreign component is made (`fabric/foreign-libraries.ts`), and `expo-video/build/VideoPlayer`,
  // which `createVideoPlayer` requires by name when it is called: Metro resolves the name to the library's copy, or to the stub that says how to turn `expo-video` on.
  const lazy = ["expo-constants", "expo-video/build/VideoPlayer"];
  expect(externals.filter((path) => !path.startsWith("react-native/Libraries/") && !lazy.includes(path)), "imports that are not React Native deep paths").toEqual([]);
  for (const path of inputs) {
    for (const library of ["react", "react-dom", "scheduler", ...libraries]) expect(path.includes(`node_modules/${library}/`), `${path} is part of the bundle`).toBe(false);
  }
  // The deep modules are native module accessors, `Platform`, the converters and the host's own registry code: no component that renders through React.
  const allowed = new Set([
    "react-native/Libraries/BatchedBridge/NativeModules",
    // The gesture host's JS receiver (`deviceEventEmitter` in `deps-rn.ts`): required with the first gesture, never at boot.
    "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter",
    "react-native/Libraries/Image/resolveAssetSource",
    "react-native/Libraries/Linking/Linking",
    // Right-to-left layouts (`ShadowedView`'s corner radii).
    "react-native/Libraries/ReactNative/I18nManager",
    // The host's lazy requires for a name its static tables do not list (`view-configs.ts`).
    "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload",
    "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry",
    "react-native/Libraries/StyleSheet/processColor",
    "react-native/Libraries/TurboModule/TurboModuleRegistry",
    "react-native/Libraries/Utilities/Platform",
    // The light or dark mode of a text with no colour of its own (`withInk` in `host.ts`), required with the first one.
    "react-native/Libraries/Utilities/Appearance",
    // The hairline of an `<hr>` (`nativeBase="hairline"`, `hairline()` in `host.ts`), required with the first one.
    "react-native/Libraries/Utilities/PixelRatio",
  ]);
  for (const path of externals) {
    if (!path.startsWith("react-native/Libraries/StyleSheet/process") && !lazy.includes(path)) expect(allowed.has(path), `${path} is not an allowed deep import`).toBe(true);
  }
  // The twelve libraries' components and helpers are part of the entry.
  for (const file of components) expect(inputs.some((path) => path.endsWith(`components/${file}.svelte`)), file).toBe(true);
  for (const file of helpers) expect(inputs.some((path) => path.endsWith(`fabric/foreign-${file}.ts`)), file).toBe(true);
});

// The bundle above does not see an `import type`, which esbuild erases, and a type import of a library or of React would put its types in every app that checks the entry.
test("no source of the package imports one of the libraries or React", () => {
  const sources = ["src/foreign.ts", "src/components/define-expo-view.ts", "src/fabric/foreign.ts", ...helpers.map((name) => `src/fabric/foreign-${name}.ts`), ...components.map((name) => `src/components/${name}.svelte`)];
  for (const file of sources) {
    const text = readFileSync(resolve(packageRoot, file), "utf8");
    for (const specifier of text.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)) {
      const path = specifier[1] ?? "";
      expect(/^(react|react\/.*|react-dom.*)$/.test(path) || libraries.some((library) => path === library || path.startsWith(`${library}/`)), `${file} imports ${path}`).toBe(false);
    }
  }
});
