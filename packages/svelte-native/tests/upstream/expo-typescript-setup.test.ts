import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * The commands that run Expo set `EXPO_NO_TYPESCRIPT_SETUP` (`cli/expo-environment.test.ts`), so that Expo does not ask a Svelte app to install `@types/react`. The variable works
 * because Expo's command line returns early on it, before it looks for the packages, both where it asks and where the dev server waits for TypeScript. If an update of Expo
 * moves the check or renames the variable, the question comes back.
 */
const expo = createRequire(createRequire(import.meta.url).resolve("expo/package.json"));
const cli = resolve(expo.resolve("@expo/cli/package.json"), "..");

test("Expo's TypeScript setup returns before it asks for packages when EXPO_NO_TYPESCRIPT_SETUP is set", async () => {
  const prerequisite = await readFile(resolve(cli, "build/src/start/doctor/typescript/TypeScriptProjectPrerequisite.js"), "utf8");
  const assertAt = prerequisite.indexOf("async assertImplementation() {");
  const bootstrapAt = prerequisite.indexOf("async bootstrapAsync() {");
  for (const start of [assertAt, bootstrapAt]) {
    expect(start).toBeGreaterThan(-1);
    const body = prerequisite.slice(start);
    expect(body.indexOf("if (_env.env.EXPO_NO_TYPESCRIPT_SETUP) {")).toBeGreaterThan(-1);
    expect(body.indexOf("if (_env.env.EXPO_NO_TYPESCRIPT_SETUP) {")).toBeLessThan(body.indexOf("_ensureDependenciesInstalledAsync("));
  }
  const env = await readFile(resolve(cli, "build/src/utils/env.js"), "utf8");
  expect(env).toContain("(0, _getenv().boolish)('EXPO_NO_TYPESCRIPT_SETUP', false)");
  const devServers = await readFile(resolve(cli, "build/src/start/server/DevServerManager.js"), "utf8");
  expect(devServers).toMatch(/if \(_env\.env\.EXPO_NO_TYPESCRIPT_SETUP\) \{\s*return;\s*\}/);
});
