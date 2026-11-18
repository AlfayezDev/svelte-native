import { afterEach, expect, test } from "bun:test";
import { expoEnvironment } from "../../src/build.ts";

/**
 * Expo's TypeScript setup is for React apps: on a Svelte app, whose `tsconfig.json` is SvelteKit's, it asks to install `@types/react`, which the app never uses. The commands that
 * run Expo turn it off, and an environment that sets the variable keeps its value. `upstream/expo-typescript-setup.test.ts` pins the switch in Expo's command line.
 */
const saved = process.env.EXPO_NO_TYPESCRIPT_SETUP;
afterEach(() => {
  if (saved === undefined) delete process.env.EXPO_NO_TYPESCRIPT_SETUP; else process.env.EXPO_NO_TYPESCRIPT_SETUP = saved;
});

test("expo runs without its TypeScript setup, whatever the command", () => {
  delete process.env.EXPO_NO_TYPESCRIPT_SETUP;
  for (const command of ["run:android", "run:ios", "start", "export:embed"]) expect([command, expoEnvironment([command]).EXPO_NO_TYPESCRIPT_SETUP]).toEqual([command, "1"]);
});

test("the setting of the environment wins", () => {
  process.env.EXPO_NO_TYPESCRIPT_SETUP = "0";
  expect(expoEnvironment(["start"]).EXPO_NO_TYPESCRIPT_SETUP).toBe("0");
});
