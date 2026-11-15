import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { src } from "../support/bundle.ts";
import { fakeConfig } from "../support/metro.ts";
import { createProject } from "../support/project.ts";
import { withSvelteNative } from "../../src/metro.ts";

// Metro gives `react-native`'s AppRegistry the library's (`fabric/app-registry.ts`, which `renderer/app-registry.test.ts` runs).
const project = createProject();
afterAll(() => project.remove());

test("AppRegistry.js and AppRegistryImpl.js, from a library and from the app, are the library's; the rest of React Native is as before", () => {
  const root = project.directory;
  const config = withSvelteNative(fakeConfig(root), { variant: "qa" });
  const resolveRequest = config.resolver.resolveRequest as (context: unknown, moduleName: string, platform: string) => { filePath: string };
  const rn = join(root, "node_modules/react-native");
  const real = (_context: unknown, moduleName: string) => ({ type: "sourceFile", filePath: moduleName.startsWith(".") ? join(rn, "Libraries/ReactNative", `${moduleName}.js`) : join(rn, "node_modules-relative", moduleName) });
  const resolveFrom = (origin: string, moduleName: string) => resolveRequest({ resolveRequest: real, originModulePath: origin, unstable_conditionNames: [] }, moduleName, "android").filePath;
  const ours = src("fabric/app-registry.ts");
  const index = join(rn, "index.js");
  const appRegistry = join(rn, "Libraries/ReactNative/AppRegistry.js");
  expect(resolveFrom(index, "./AppRegistry")).toBe(ours);
  expect(resolveFrom(appRegistry, "./AppRegistryImpl")).toBe(ours);
  expect(resolveFrom(index, "./AppState")).toBe(join(rn, "Libraries/ReactNative/AppState.js"));
});
