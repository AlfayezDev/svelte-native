import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withPlugins } from "@expo/config-plugins";
import expoPlugin from "../src/expo.ts";
import { svelteNative } from "../src/vite.ts";
import { DEFAULT_VARIANT, routesTableFile, variantName } from "../src/variant.ts";

/**
 * An app that has variants of its own, and a default of its own (the QA app's is `qa`), says so to the plugins instead of setting `APP_VARIANT` from a config that every
 * tool importing it would inherit: `variant` is an option of the Expo plugin and of the Vite plugin (Metro's `withSvelteNative` has had it). Without it the variant is
 * `APP_VARIANT`, and `app` when that is empty or unset.
 */
const saved = process.env.APP_VARIANT;
const directories: string[] = [];
afterEach(() => {
  if (saved === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = saved;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "variant-options-"));
  directories.push(root);
  mkdirSync(join(root, "src/routes"), { recursive: true });
  writeFileSync(join(root, "src/routes/+mobile.svelte"), "");
  return root;
}
const tables = (root: string): string[] => readdirSync(join(root, ".svelte-native")).filter((file) => file.startsWith("routes.")).sort();

/** Runs the dangerous mod the Expo plugin registers for a platform: what `expo prebuild` runs first. */
async function prebuild(root: string, options?: { variant?: string }): Promise<void> {
  const config = withPlugins({ name: "a", slug: "a", android: { package: "io.e.a" }, ios: { bundleIdentifier: "io.e.a" }, _internal: { projectRoot: root } }, [[expoPlugin, options]]);
  const mod = (config.mods as Record<string, Record<string, (config: object) => Promise<unknown>>>).ios?.dangerous;
  await mod?.({ ...config, modRequest: { projectRoot: root, platformProjectRoot: root, platform: "ios", modName: "dangerous", introspect: false }, modResults: {} });
}

test("the variant of an app that names none is app, and an empty APP_VARIANT is none", () => {
  expect(DEFAULT_VARIANT).toBe("app");
  expect(variantName({})).toBe("app");
  expect(variantName({ APP_VARIANT: "" })).toBe("app");
  expect(variantName({ APP_VARIANT: "qa" })).toBe("qa");
  expect(routesTableFile(variantName({}))).toBe("routes.app.ts");
});

test("the Expo plugin writes the table of its variant option, the environment's, or app", async () => {
  delete process.env.APP_VARIANT;
  const root = project();
  await prebuild(root, { variant: "qa" });
  expect(tables(root)).toEqual(["routes.qa.ts"]);
  const other = project();
  await prebuild(other);
  expect(tables(other)).toEqual(["routes.app.ts"]);
  process.env.APP_VARIANT = "smoke";
  const third = project();
  await prebuild(third);
  expect(tables(third)).toEqual(["routes.smoke.ts"]);
  // The option wins over the environment.
  const fourth = project();
  await prebuild(fourth, { variant: "qa" });
  expect(tables(fourth)).toEqual(["routes.qa.ts"]);
});

test("the Vite plugin's native target writes the table of its variant option", async () => {
  delete process.env.APP_VARIANT;
  const root = project();
  const plugin = svelteNative({ target: "native", variant: "qa" }) as { configResolved(config: { root: string }): void; buildStart(): Promise<void> };
  plugin.configResolved({ root });
  await plugin.buildStart();
  expect(tables(root)).toEqual(["routes.qa.ts"]);
  const other = project();
  const unnamed = svelteNative({ target: "native" }) as typeof plugin;
  unnamed.configResolved({ root: other });
  await unnamed.buildStart();
  expect(tables(other)).toEqual(["routes.app.ts"]);
});
