import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { withPlugins } from "@expo/config-plugins";
import { syncNative } from "../../src/build.ts";
import expoPlugin from "../../src/expo.ts";
import { closeWatchers, withExpoSvelte } from "../../src/metro.ts";
import { expoSvelte } from "../../src/vite.ts";
import { DEFAULT_VARIANT, routesTableFile, variantName } from "../../src/variant.ts";
import { cssProject, removeCssProjects } from "../support/css-project.ts";
import { fakeConfig } from "../support/metro.ts";
import { type Project, createProject } from "../support/project.ts";

/**
 * An app that has variants of its own, and a default of its own (the QA app's is `qa`), says so to the plugins instead of setting `APP_VARIANT` from a config that every
 * tool importing it would inherit: `variant` is an option of the Expo plugin, of the Vite plugin and of Metro's `withExpoSvelte`. Without it the variant is
 * `APP_VARIANT`, and `app` when that is empty or unset. Every tool that writes a table per variant follows that one rule.
 */
const saved = process.env.APP_VARIANT;
const projects: Project[] = [];
afterEach(() => {
  closeWatchers();
  if (saved === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = saved;
  for (const project of projects.splice(0)) project.remove();
});
afterEach(removeCssProjects);

function project(): string {
  const created = createProject({ "src/routes/+mobile.svelte": "" }, "variant-");
  projects.push(created);
  return created.directory;
}

/** Runs the dangerous mod the Expo plugin registers for a platform: what `expo prebuild` runs first. */
async function prebuild(root: string, options?: { variant?: string }): Promise<void> {
  const config = withPlugins({ name: "a", slug: "a", android: { package: "io.e.a" }, ios: { bundleIdentifier: "io.e.a" }, _internal: { projectRoot: root } }, [[expoPlugin, options]]);
  const mod = (config.mods as Record<string, Record<string, (config: object) => Promise<unknown>>>).ios?.dangerous;
  await mod?.({ ...config, modRequest: { projectRoot: root, platformProjectRoot: root, platform: "ios", modName: "dangerous", introspect: false }, modResults: {} });
}

/** The tables a tool writes into `.expo-svelte` for a project, given the `variant` option or none: the files that start with `prefix`. */
const entryPoints: { name: string; prefix: string; root?: () => string; run(root: string, variant?: string): Promise<void> | void }[] = [
  { name: "expo-svelte sync", prefix: "routes.", run: (root, variant) => syncNative(root, variant ? { variant } : {}) },
  { name: "the Expo plugin", prefix: "routes.", run: (root, variant) => prebuild(root, variant ? { variant } : undefined) },
  {
    name: "the Vite plugin's native target", prefix: "routes.",
    async run(root, variant) {
      const plugin = expoSvelte({ target: "native", ...(variant ? { variant } : {}) }) as { configResolved(config: { root: string }): void; buildStart(): Promise<void> };
      plugin.configResolved({ root });
      await plugin.buildStart();
    },
  },
  { name: "Metro's withExpoSvelte (the route table)", prefix: "routes.", run: (root, variant) => { withExpoSvelte(fakeConfig(root), variant ? { variant } : {}); } },
  { name: "Metro's withExpoSvelte (the class table)", prefix: "classes.", root: cssProject, run: (root, variant) => { withExpoSvelte(fakeConfig(root), { css: "src/global.css", ...(variant ? { variant } : {}) }); } },
];

test("the variant of an app that names none is app, and an empty APP_VARIANT is none", () => {
  expect(DEFAULT_VARIANT).toBe("app");
  expect(variantName({})).toBe("app");
  expect(variantName({ APP_VARIANT: "" })).toBe("app");
  expect(variantName({ APP_VARIANT: "qa" })).toBe("qa");
  expect(routesTableFile(variantName({}))).toBe("routes.app.ts");
});

for (const { name, prefix, root: makeRoot, run } of entryPoints) {
  test(`${name} writes the table of its variant option, the environment's, or app; the option wins over the environment`, async () => {
    const tables = (root: string): string[] => readdirSync(join(root, ".expo-svelte")).filter((file) => file.startsWith(prefix)).sort();
    const written = async (environment: string | undefined, variant?: string): Promise<string[]> => {
      if (environment === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = environment;
      const root = makeRoot ? makeRoot() : project();
      await run(root, variant);
      return tables(root);
    };
    expect(await written(undefined, "qa")).toEqual([`${prefix}qa.ts`]);
    expect(await written(undefined)).toEqual([`${prefix}app.ts`]);
    expect(await written("")).toEqual([`${prefix}app.ts`]); // an empty APP_VARIANT is none
    expect(await written("smoke")).toEqual([`${prefix}smoke.ts`]);
    expect(await written("smoke", "qa")).toEqual([`${prefix}qa.ts`]);
  });
}
