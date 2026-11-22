import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Project, createProject } from "../support/project.ts";

/**
 * `expo-svelte/mmkv` for the web. react-native-mmkv has a web implementation (`createMMKV.web.js`, over the browser's `localStorage`), which a bundler finds only when it tries
 * the `.web.js` extensions first (React Native web's convention); the web target of `expoSvelte()` sets them. A real Vite build of the entry, in a scratch project that has the package
 * installed as an app does (`fixtures/web-mmkv-probe.ts`, under Node): with the plugin it resolves, bundles the web implementation and none of React Native or Nitro; without it Vite meets
 * `react-native`'s Flow source.
 */
let scratch: Project;
let seen: { plugins: number; withPlugin: Record<string, unknown>; without: { built: boolean; message?: string } };

beforeAll(async () => {
  scratch = createProject({ "entry.ts": 'import { createMMKV, localStorageMMKV } from "expo-svelte/mmkv";\nexport { createMMKV, localStorageMMKV };\n' });
  mkdirSync(scratch.path("node_modules"), { recursive: true });
  symlinkSync(resolve(import.meta.dirname, "../.."), scratch.path("node_modules/expo-svelte"));
  const run = Bun.spawn(["node", join(import.meta.dirname, "fixtures/web-mmkv-probe.ts")], { cwd: scratch.directory, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]);
  if ((await run.exited) !== 0) throw new Error(`the web probe failed:\n${err.slice(-2000)}`);
  seen = JSON.parse(out.trim().split("\n").at(-1) ?? "");
});
afterAll(() => scratch?.remove());

test("with the web target's plugin the subpath resolves and bundles react-native-mmkv's web implementation, with no React Native and no Nitro", () => {
  expect(seen.plugins).toBe(1);
  expect(seen.withPlugin).toMatchObject({ built: true, exports: ["createMMKV", "localStorageMMKV"], reactNative: false, nitro: false, web: true });
});

test("without the `.web.js` extensions Vite takes the native createMMKV and stops at React Native's Flow source: the plugin's setting is what makes the build work", () => {
  expect(seen.without.built).toBe(false);
  expect(seen.without.message).toContain("react-native");
});
