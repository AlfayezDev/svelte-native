import { afterEach, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { expoEnvironment, runExpo } from "../../src/build.ts";

/**
 * Expo's TypeScript setup is for React apps: it stops the first run of a Svelte app, whose TypeScript is SvelteKit's, to ask to install `@types/react`. The commands that run Expo
 * turn it off, and an environment that sets the variable keeps its value. `upstream/expo-typescript-setup.test.ts` pins the switch in Expo's command line.
 */
const saved = process.env.EXPO_NO_TYPESCRIPT_SETUP;
afterEach(() => {
  if (saved === undefined) delete process.env.EXPO_NO_TYPESCRIPT_SETUP; else process.env.EXPO_NO_TYPESCRIPT_SETUP = saved;
});

test("Expo is started without its TypeScript setup", async () => {
  delete process.env.EXPO_NO_TYPESCRIPT_SETUP;
  // `runExpo` (what `android`, `ios` and `dev` call) runs through a stand-in for `spawn` that records the environment it was given.
  const childProcess = { ...(await import("node:child_process")) };
  let started: { args: string[]; env: NodeJS.ProcessEnv } | undefined;
  mock.module("node:child_process", () => ({
    ...childProcess,
    spawn: (_command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      started = { args, env: options.env };
      return new EventEmitter();
    },
  }));
  try {
    runExpo("/work/app", ["run:android"]);
    expect(started?.args).toContain("run:android");
    expect(started?.env.EXPO_NO_TYPESCRIPT_SETUP).toBe("1");
  } finally {
    mock.module("node:child_process", () => childProcess);
  }
});

test("the setting of the environment wins", () => {
  process.env.EXPO_NO_TYPESCRIPT_SETUP = "0";
  expect(expoEnvironment(["start"]).EXPO_NO_TYPESCRIPT_SETUP).toBe("0");
});
