import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { src } from "../support/bundle.ts";
import { packageRoot } from "../support/paths.ts";
import { fakeConfig, resolveFrom as resolveWith } from "../support/metro.ts";
import { createProject } from "../support/project.ts";
import { withExpoSvelte } from "../../src/metro.ts";

// Metro gives `react-native`'s AppRegistry the library's (`fabric/app-registry.ts`, which `renderer/app-registry.test.ts` runs).
const project = createProject();
afterAll(() => project.remove());

test("AppRegistry.js and AppRegistryImpl.js, from a library and from the app, are the library's; the rest of React Native is as before", () => {
  const root = project.directory;
  const config = withExpoSvelte(fakeConfig(root), { variant: "qa" });
  const rn = join(root, "node_modules/react-native");
  const real = (_context: { originModulePath: string }, moduleName: string) => ({ type: "sourceFile", filePath: moduleName.startsWith(".") ? join(rn, "Libraries/ReactNative", `${moduleName}.js`) : join(rn, "node_modules-relative", moduleName) });
  const resolveFrom = (origin: string, moduleName: string) => resolveWith(config, origin, moduleName, real);
  const ours = src("fabric/app-registry.ts");
  const index = join(rn, "index.js");
  const appRegistry = join(rn, "Libraries/ReactNative/AppRegistry.js");
  expect(resolveFrom(index, "./AppRegistry")).toBe(ours);
  expect(resolveFrom(appRegistry, "./AppRegistryImpl")).toBe(ours);
  expect(resolveFrom(index, "./AppState")).toBe(join(rn, "Libraries/ReactNative/AppState.js"));
});

test("expo-video's resolveAssetSource.js is the library's module, which takes React Native's resolveAssetSource from its own file and not from the whole index", () => {
  const config = withExpoSvelte(fakeConfig(project.directory), { variant: "qa" });
  const video = join(project.directory, "node_modules/expo-svelte/vendor/expo-video/build");
  const real = (_context: { originModulePath: string }, moduleName: string) => ({ type: "sourceFile", filePath: join(video, `${moduleName.replace(/^\.\//, "")}.js`) });
  const lean = src("fabric/expo-video-asset-source.ts");
  expect(resolveWith(config, join(video, "VideoPlayer.js"), "./resolveAssetSource", real)).toBe(lean);
  expect(resolveWith(config, join(video, "VideoPlayer.js"), "./VideoView", real)).toBe(join(video, "VideoView.js"));
  // The copy still takes it from the whole of react-native (when a version stops, the entry can go), and the replacement imports the one file.
  expect(readFileSync(join(packageRoot, "vendor/expo-video/build/resolveAssetSource.js"), "utf8")).toContain("import { Image } from 'react-native';");
  expect(readFileSync(lean, "utf8")).toContain('from "react-native/Libraries/Image/resolveAssetSource"');
});
