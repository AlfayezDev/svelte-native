import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

/**
 * The commands that run Expo set `EXPO_NO_TYPESCRIPT_SETUP` (`cli/expo-environment.test.ts`), so that Expo does not stop a Svelte app's first run to ask to install
 * `@types/react`. The variable works because the one place in Expo's command line that asks for `@types/react`, its TypeScript prerequisite, returns on it before it
 * looks for the packages, both where it asks and where the dev server installs them unasked. If an update of Expo moves the check, renames the variable or asks for
 * `@types/react` somewhere else, the question can come back.
 */
const expo = createRequire(createRequire(import.meta.url).resolve("expo/package.json"));
const cli = resolve(expo.resolve("@expo/cli/package.json"), "..");
const prerequisiteFile = "build/src/start/doctor/typescript/TypeScriptProjectPrerequisite.js";

async function scripts(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return scripts(path);
    return Promise.resolve(entry.name.endsWith(".js") ? [path] : []);
  }));
  return found.flat();
}

test("Expo's TypeScript prerequisite returns on EXPO_NO_TYPESCRIPT_SETUP before it asks for packages", async () => {
  const prerequisite = await readFile(resolve(cli, prerequisiteFile), "utf8");
  const env = await readFile(resolve(cli, "build/src/utils/env.js"), "utf8");
  expect(env).toContain("(0, _getenv().boolish)('EXPO_NO_TYPESCRIPT_SETUP', false)");
  for (const [method, returned] of [["async assertImplementation() {", "return true;"], ["async bootstrapAsync() {", "return;"]] as const) {
    const at = prerequisite.indexOf(method);
    expect([method, at > -1]).toEqual([method, true]);
    const body = prerequisite.slice(at);
    const guard = new RegExp(String.raw`^\s*if \(_env\.env\.EXPO_NO_TYPESCRIPT_SETUP\) \{\s*warnDisabled\(\);\s*${returned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s*\}`);
    expect([method, guard.test(body.slice(method.length))]).toEqual([method, true]);
  }
});

test("@types/react is asked for nowhere else in Expo's command line", async () => {
  const askers: string[] = [];
  for (const file of await scripts(resolve(cli, "build/src"))) {
    if ((await readFile(file, "utf8")).includes("@types/react")) askers.push(relative(cli, file));
  }
  expect(askers).toEqual([prerequisiteFile]);
});
