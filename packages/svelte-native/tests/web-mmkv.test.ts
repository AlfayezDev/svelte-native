import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * `@alfayez/svelte-native/mmkv` for the web. react-native-mmkv has a web implementation (`createMMKV.web.js`, over the browser's `localStorage`), which a bundler finds only when it tries
 * the `.web.js` extensions first (React Native web's convention); the web target of `svelteNative()` sets them. A real Vite build of the entry, in a scratch project that has the package
 * installed as an app does (`web-mmkv-probe.ts`, under Node): with the plugin it resolves, bundles the web implementation and none of React Native or Nitro; without it Vite meets
 * `react-native`'s Flow source.
 */
const scratch = mkdtempSync(join(tmpdir(), "svelte-native-web-mmkv-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
mkdirSync(join(scratch, "node_modules/@alfayez"), { recursive: true });
symlinkSync(resolve(import.meta.dirname, ".."), join(scratch, "node_modules/@alfayez/svelte-native"));
writeFileSync(join(scratch, "entry.ts"), 'import { createMMKV, localStorageMMKV } from "@alfayez/svelte-native/mmkv";\nexport { createMMKV, localStorageMMKV };\n');
const done = Bun.spawnSync(["node", join(import.meta.dirname, "web-mmkv-probe.ts")], { cwd: scratch, stdout: "pipe", stderr: "pipe" });
if (done.exitCode !== 0) throw new Error(`the web probe failed:\n${done.stderr.toString().slice(-2000)}`);
const seen = JSON.parse(done.stdout.toString().trim().split("\n").at(-1) ?? "") as { plugins: number; withPlugin: Record<string, unknown>; without: { built: boolean; message?: string } };

test("with the web target's plugin the subpath resolves and bundles react-native-mmkv's web implementation, with no React Native and no Nitro", () => {
  expect(seen.plugins).toBe(1);
  expect(seen.withPlugin).toMatchObject({ built: true, exports: ["createMMKV", "localStorageMMKV"], reactNative: false, nitro: false, web: true });
});

test("without the `.web.js` extensions Vite takes the native createMMKV and stops at React Native's Flow source: the plugin's setting is what makes the build work", () => {
  expect(seen.without.built).toBe(false);
  expect(seen.without.message).toContain("react-native");
});
