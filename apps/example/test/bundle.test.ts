import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The app's JavaScript, bundled the way React Native's Gradle and Xcode scripts do it: `expo export:embed`, release, not minified (Hermes
 * compiles the result on a build; this test stops before that). It proves that every screen compiles with the Svelte compiler and that
 * every import resolves, on both platforms, without a device. The Metro cache is a directory of its own and is removed afterwards.
 */
const app = join(import.meta.dirname, "..");
const made: string[] = [];
afterAll(() => { for (const directory of made) rmSync(directory, { recursive: true, force: true }); });

type Bundle = { bytes: number; modules: string[]; text: string };
function bundle(platform: "android" | "ios"): Bundle {
  const directory = mkdtempSync(join(tmpdir(), `example-bundle-${platform}-`));
  const cache = mkdtempSync(join(tmpdir(), "example-metro-"));
  made.push(directory, cache);
  mkdirSync(join(directory, "assets"));
  const output = join(directory, `index.${platform}.bundle`);
  const sourceMap = `${output}.map`;
  // `bun test` sets NODE_ENV=test; Metro's transform cache is not keyed by it, so the bundle is made as production with a cache of its own.
  const env = { ...process.env, CI: "1", EXPO_NO_TELEMETRY: "1", NODE_ENV: "production", TMPDIR: cache };
  const done = spawnSync(
    "pnpm",
    ["exec", "expo", "export:embed", "--platform", platform, "--dev", "false", "--minify", "false", "--reset-cache", "--entry-file", ".svelte-native/entry.ts", "--bundle-output", output, "--sourcemap-output", sourceMap, "--assets-dest", join(directory, "assets")],
    { cwd: app, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (done.status !== 0) throw new Error(`export:embed (${platform}) failed: ${(done.stderr || done.stdout).slice(-800)}`);
  const { sources } = JSON.parse(readFileSync(sourceMap, "utf8")) as { sources: string[] };
  return { bytes: statSync(output).size, modules: sources.map((source) => source.replace(/^\//, "")), text: readFileSync(output, "utf8") };
}

/** Every `+mobile.svelte` and `+layout.mobile.svelte` of src/routes, as the paths the source map names (from the repository root). */
const routeModules = (): string[] => readdirSync(join(app, "src/routes"), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /^\+(?:layout\.)?mobile\.svelte$/.test(entry.name))
  .map((entry) => `apps/example/${entry.parentPath.slice(app.length + 1)}/${entry.name}`);

for (const platform of ["android", "ios"] as const) {
  describe(`the ${platform} bundle`, () => {
    test("is made, holds every screen of the app, and carries nothing of the QA app or the library's tests", () => {
      const { bytes, modules, text } = bundle(platform);
      console.log(`[example bundle] ${platform}: ${bytes} bytes in ${modules.length} modules`);
      expect(bytes).toBeGreaterThan(100_000);
      expect(routeModules().filter((module) => !modules.includes(module))).toEqual([]);
      expect(modules.filter((module) => /^apps\/qa\/|^packages\/svelte-native\/tests\//.test(module))).toEqual([]);
      // The lowering of HTML and the converter of `style="..."` (the `css/` compiler: `dist/node/transformer.cjs` and `lower.js` carry about 90 kB of it) run in Node, when Metro transforms a file: the app's JavaScript does not hold them.
      expect(modules.filter((module) => /packages\/svelte-native\/src\/(?:lower|lower-html|transformer|css\/(?:inline|convert|properties|parse|values|color))\.ts$/.test(module))).toEqual([]);
      // The list of style keys the development warning of `html-style.ts` checks names against is loaded only when `__DEV__` is true: a release build leaves it out.
      expect(modules.filter((module) => /packages\/svelte-native\/src\/html-style(?:-known)?\.ts$/.test(module)).map((module) => module.split("/").pop())).toEqual(["html-style.ts"]);
      // The /sveltekit screen's imports of `$app/navigation`, `$app/state`, `$app/env` and `$app/paths` are the library's files for the device, and SvelteKit's own implementation of them is not in the bundle (the remote functions stub imports other parts of SvelteKit's client).
      expect(["navigation", "state", "env", "paths"].filter((file) => !modules.includes(`packages/svelte-native/src/kit/${file}.ts`))).toEqual([]);
      expect(modules.filter((module) => /node_modules\/@sveltejs\/kit\/src\/runtime\/app\/(?:navigation|state|env|environment|paths)\//.test(module))).toEqual([]);
      // No React renderer: the library renders Svelte to Fabric directly. (React itself is there: some of React Native's modules import it.)
      expect(modules.filter((module) => /react-dom|react-reconciler|\/scheduler\//.test(module))).toEqual([]);
      // A standard URL: the router builds every location as a `SvelteURL`, which React Native's own `URL` cannot construct, so the library's
      // polyfills load Expo's WinterCG runtime. Without it the app started blank (9 Nov 2026, the first run of this app on an emulator).
      expect(modules.some((module) => /node_modules\/expo\/src\/winter\/runtime\.native\.ts$/.test(module))).toBe(true);
      // The animation, gestures and svg libraries (gesture handler, Worklets, Reanimated, svg) are the library's copies too: its own imports, a library's and the app's all reach `vendor/`, and no original is bundled beside them (a package
      // manager installs one of gesture handler, Reanimated and Worklets for Expo Router's peers: Metro never reaches it, and the Worklets plugin that Babel runs is the copy's, `tests/compiler/worklets-plugin.test.ts`).
      // `crypto` and `localStorage` are react-native-quick-crypto and react-native-mmkv, with the Nitro runtime they share, and the `Intl` constructors Hermes lacks are hermes-intl: required when first used,
      // so Metro bundles them. Their import of `react-native` is the library's lite shim (`LITE_ORIGINS`): the index that lists every component of React Native (and the 238 modules it brings) is not in
      // the bundle. They, quick-crypto's base64 module and the Nitro runtime are the library's own copies (`vendor/`, VENDORING.md), whoever imports them, and the app has no original of any: not even
      // `react-native-quick-base64`, which a package manager installs for the Buffer package's dependency on it.
      for (const name of ["react-native-quick-crypto", "react-native-quick-base64", "hermes-intl", "react-native-mmkv", "react-native-nitro-modules", "react-native-gesture-handler", "react-native-worklets", "react-native-reanimated", "react-native-svg"]) {
        expect([name, modules.some((module) => module.includes(`packages/svelte-native/vendor/${name}/`))]).toEqual([name, true]);
        expect([name, modules.filter((module) => module.includes(`node_modules/${name}/`))]).toEqual([name, []]);
      }
      // The native view libraries are the library's own copies, turned on in `libraries` of app.config.ts, and this app installs none of them. The components mount their native views by name and import
      // none of their JavaScript, so no copy is in the bundle either; `createVideoPlayer` requires expo-video by name, and the app did not turn that one on (no screen uses it), so the name is the
      // stub that says how to turn it on, a few lines, and not the package.
      const views = ["expo-image", "expo-blur", "expo-linear-gradient", "expo-conic-gradient", "expo-video", "react-native-video", "lottie-react-native", "rive-react-native", "@react-native-community/datetimepicker", "react-native-pdf", "react-native-blob-util", "react-native-webview", "react-native-maps", "react-native-view-shot", "react-native-fast-shadow", "react-native-animateable-text"];
      expect(modules.filter((module) => views.some((name) => module.includes(`node_modules/${name}/`) || module.includes(`packages/svelte-native/vendor/${name}/`)))).toEqual([]);
      expect(modules.filter((module) => /\.svelte-native\/stubs\/app\//.test(module)).map((module) => module.split("/").pop()).sort()).toEqual(["_core.js", "expo-video.js"]);
      // The worklets of the copies and of the app went through the Worklets Babel plugin: the babel preset adds the copy's (the transformer makes `react-native-worklets/plugin` resolve to it), and the app has no package of that name to add.
      expect(text.match(/__workletHash/g)?.length ?? 0).toBeGreaterThan(50);
      expect(modules.some((module) => /node_modules\/react-native\/index\.js$/.test(module))).toBe(false);
    }, 300_000);
  });
}
