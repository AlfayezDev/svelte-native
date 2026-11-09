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

type Bundle = { bytes: number; modules: string[] };
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
  return { bytes: statSync(output).size, modules: sources.map((source) => source.replace(/^\//, "")) };
}

/** Every `+mobile.svelte` and `+layout.mobile.svelte` of src/routes, as the paths the source map names (from the repository root). */
const routeModules = (): string[] => readdirSync(join(app, "src/routes"), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /^\+(?:layout\.)?mobile\.svelte$/.test(entry.name))
  .map((entry) => `apps/example/${entry.parentPath.slice(app.length + 1)}/${entry.name}`);

for (const platform of ["android", "ios"] as const) {
  describe(`the ${platform} bundle`, () => {
    test("is made, holds every screen of the app, and carries nothing of the QA app or the library's tests", () => {
      const { bytes, modules } = bundle(platform);
      console.log(`[example bundle] ${platform}: ${bytes} bytes in ${modules.length} modules`);
      expect(bytes).toBeGreaterThan(100_000);
      expect(routeModules().filter((module) => !modules.includes(module))).toEqual([]);
      expect(modules.filter((module) => /^apps\/qa\/|^packages\/svelte-native\/tests\//.test(module))).toEqual([]);
      // No React renderer: the library renders Svelte to Fabric directly. (React itself is there: some of React Native's modules import it.)
      expect(modules.filter((module) => /react-dom|react-reconciler|\/scheduler\//.test(module))).toEqual([]);
      // A standard URL: the router builds every location as a `SvelteURL`, which React Native's own `URL` cannot construct, so the library's
      // polyfills load Expo's WinterCG runtime. Without it the app started blank (9 Nov 2026, the first run of this app on an emulator).
      expect(modules.some((module) => /node_modules\/expo\/src\/winter\/runtime\.native\.ts$/.test(module))).toBe(true);
    }, 300_000);
  });
}
