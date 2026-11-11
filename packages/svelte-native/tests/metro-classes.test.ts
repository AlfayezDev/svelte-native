import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";
import { closeWatchers, withSvelteNative } from "../src/metro.ts";
import { sourceFile } from "../src/package-root.ts";
import { classesTableFile } from "../src/variant.ts";
import { cssProject, removeCssProjects } from "./css-project.ts";

/**
 * `class` through Metro: the `css` option builds the variant's class table when the config loads (and in development again when the sources change),
 * and `@rasheed/svelte-native/classes-table`, which the library's resolver imports, resolves to that file; without the option it is the library's empty table.
 */
const fakeConfig = (projectRoot: string): ConfigT => ({
  projectRoot,
  resolver: { sourceExts: ["ts"], resolveRequest: undefined },
  serializer: { getModulesRunBeforeMainModule: () => [] },
  transformer: {},
}) as unknown as ConfigT;

const real = { type: "sourceFile", filePath: "/real/module.ts" };
/** What Metro's resolver answers for an import of `moduleName` by `origin`. */
function resolveFrom(config: ConfigT, origin: string, moduleName: string): string {
  const resolveRequest = config.resolver.resolveRequest as (context: unknown, moduleName: string, platform: string) => { filePath: string };
  return resolveRequest({ resolveRequest: () => real, originModulePath: origin, unstable_conditionNames: [] }, moduleName, "android").filePath;
}
const tableFile = (root: string, variant: string) => join(root, ".svelte-native", classesTableFile(variant));
const classesOf = (root: string, variant: string): string[] => [...readFileSync(tableFile(root, variant), "utf8").matchAll(/^ {4}"([^"]+)": \[/gm)].map((match) => match[1] as string);
const until = async (condition: () => boolean, ms = 10_000) => {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await new Promise((done) => setTimeout(done, 25));
};
const id = "@rasheed/svelte-native/classes-table";

const environment = process.env.NODE_ENV;
afterAll(removeCssProjects);
afterEach(() => {
  closeWatchers();
  spyOn(console, "warn").mockRestore();
  if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment;
});

describe("with the css option", () => {
  test("the table of the variant is built when the config loads, and the id resolves to it from anywhere", () => {
    const root = cssProject();
    const config = withSvelteNative(fakeConfig(root), { variant: "qa", css: "src/global.css" });
    expect(classesOf(root, "qa").sort()).toEqual(["card", "dark:bg-slate-900", "md:p-10", "p-4", "text-red-500", "text-sm", "tracking-wide"]);
    expect(resolveFrom(config, join(root, "src/lib/a.ts"), id)).toBe(tableFile(root, "qa"));
    expect(resolveFrom(config, sourceFile("css/load-table.ts"), id)).toBe(tableFile(root, "qa"));
    // Any other import is the real thing.
    expect(resolveFrom(config, join(root, "src/lib/a.ts"), "./classes")).toBe("/real/module.ts");
  });

  test("each variant has a table of its own, and a Metro never resolves another's", () => {
    const root = cssProject();
    const production = withSvelteNative(fakeConfig(root), { variant: "production", css: "src/global.css" });
    const qa = withSvelteNative(fakeConfig(root), { variant: "qa", css: "src/global.css" });
    expect(readdirSync(join(root, ".svelte-native")).filter((file) => file.startsWith("classes.")).sort()).toEqual(["classes.production.ts", "classes.qa.ts"]);
    expect(resolveFrom(production, join(root, "src/a.ts"), id)).toBe(tableFile(root, "production"));
    expect(resolveFrom(qa, join(root, "src/a.ts"), id)).toBe(tableFile(root, "qa"));
  });

  test("the variant defaults to APP_VARIANT, app for none", () => {
    const root = cssProject();
    const variant = process.env.APP_VARIANT;
    try {
      delete process.env.APP_VARIANT;
      const config = withSvelteNative(fakeConfig(root), { css: "src/global.css" });
      expect(resolveFrom(config, join(root, "src/a.ts"), id)).toBe(tableFile(root, "app"));
    } finally {
      if (variant !== undefined) process.env.APP_VARIANT = variant;
    }
  });

  test("a second load of the config with nothing changed leaves the file alone: a running Metro watches its modification time", async () => {
    const root = cssProject();
    withSvelteNative(fakeConfig(root), { variant: "app", css: "src/global.css" });
    const written = statSync(tableFile(root, "app")).mtimeMs;
    await new Promise((done) => setTimeout(done, 20));
    withSvelteNative(fakeConfig(root), { variant: "app", css: "src/global.css" });
    expect(statSync(tableFile(root, "app")).mtimeMs).toBe(written);
  });

  test("a build that cannot run fails the config with what to do", () => {
    expect(() => withSvelteNative(fakeConfig(cssProject({}, { tailwind: false })), { variant: "app", css: "src/global.css" })).toThrow(/needs Tailwind CSS in the app: pnpm add -D tailwindcss@4\.3\.3/);
    expect(() => withSvelteNative(fakeConfig(cssProject()), { variant: "app", css: "src/nothing.css" })).toThrow(/the css option names src\/nothing\.css, which is not a file/);
  });

  test("what the converter cannot express is one summary line in development, and the table says why for the classes that are used", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    process.env.NODE_ENV = "development";
    const root = cssProject({ "src/routes/+mobile.svelte": '<View class="p-4 hover:opacity-50" />\n' });
    withSvelteNative(fakeConfig(root), { variant: "app", css: "src/global.css" });
    const said = warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("mention"));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^svelte-native: \d+ class(es)? the sources mention (is|are) not supported on native; a class that is used warns when it renders$/);
    expect(warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("hover:opacity-50"))).toEqual([]);
    expect(readFileSync(tableFile(root, "app"), "utf8")).toMatch(/"hover:opacity-50": "[^"]*:hover/);
    // Another build: no new class, no new line.
    warn.mockClear();
    withSvelteNative(fakeConfig(cssProject({ "src/routes/+mobile.svelte": '<View class="p-4 hover:opacity-50" />\n' })), { variant: "app", css: "src/global.css" });
    expect(warn).not.toHaveBeenCalled();
    // Not in any other build.
    process.env.NODE_ENV = "production";
    withSvelteNative(fakeConfig(cssProject({ "src/routes/+mobile.svelte": '<View class="p-4 hover:opacity-50 fixed grid" />\n' })), { variant: "app", css: "src/global.css" });
    expect(warn).not.toHaveBeenCalled();
  });

  test("a CSS file that has a @plugin or @config (the web build shares it) does not stop the config: it is skipped with one line", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const root = cssProject({ "src/global.css": '@import "tailwindcss";\n@plugin "metro-shared-plugin";\n' });
    const config = withSvelteNative(fakeConfig(root), { variant: "app", css: "src/global.css" });
    expect(resolveFrom(config, join(root, "src/a.ts"), id)).toBe(tableFile(root, "app"));
    expect(classesOf(root, "app")).toContain("p-4");
    expect(warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("metro-shared-plugin"))).toEqual(['svelte-native: plugins and JS config do not apply on native: @plugin "metro-shared-plugin" is ignored']);
  });

  test("in development a source with a new class builds the table again; not in any other build", async () => {
    process.env.NODE_ENV = "development";
    const root = cssProject();
    withSvelteNative(fakeConfig(root), { variant: "app", css: "src/global.css" });
    const classes = () => classesOf(root, "app");
    expect(classes()).not.toContain("rounded-xl");
    mkdirSync(join(root, "src/lib"), { recursive: true });
    writeFileSync(join(root, "src/lib/a.ts"), "export const a = 'rounded-xl';");
    await until(() => classes().includes("rounded-xl"));
    expect(classes()).toContain("rounded-xl");
    closeWatchers();
    writeFileSync(join(root, "src/lib/a.ts"), "export const a = 'rounded-xl shadow-md';");
    await new Promise((done) => setTimeout(done, 500));
    expect(classes()).not.toContain("shadow-md");

    process.env.NODE_ENV = "production";
    const release = cssProject();
    withSvelteNative(fakeConfig(release), { variant: "app", css: "src/global.css" });
    writeFileSync(join(release, "src/routes/+mobile.svelte"), '<View class="p-4 rounded-xl" />\n');
    await new Promise((done) => setTimeout(done, 500));
    expect(classesOf(release, "app")).not.toContain("rounded-xl");
  });
});

describe("without the css option", () => {
  test("the id is the library's empty table, and nothing is built or written", async () => {
    const root = cssProject();
    const config = withSvelteNative(fakeConfig(root), { variant: "qa" });
    expect(resolveFrom(config, join(root, "src/lib/a.ts"), id)).toBe(sourceFile("css/empty-table.ts"));
    expect(readdirSync(join(root, ".svelte-native")).filter((file) => file.startsWith("classes."))).toEqual([]);
    expect(((await import("../src/css/empty-table.ts")) as { default: unknown }).default).toEqual({ version: 1, classes: {} });
  });

  test("the package exports the id (a type check, a test and any bundler that Metro does not serve see the empty table)", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as { exports: Record<string, string> };
    expect(manifest.exports["./classes-table"]).toBe("./src/css/empty-table.ts");
    expect(existsSync(join(import.meta.dirname, "..", manifest.exports["./classes-table"] as string))).toBe(true);
    expect(sourceFile("css/empty-table.ts")).toBe(join(import.meta.dirname, "../src/css/empty-table.ts"));
  });
});

test("svelte/reactivity/window resolves to the native module from an app's code (Svelte's own reads the DOM's window)", () => {
  const root = cssProject();
  const config = withSvelteNative(fakeConfig(root), { variant: "qa" });
  expect(resolveFrom(config, join(root, "src/routes/+mobile.svelte"), "svelte/reactivity/window")).toBe(sourceFile("reactivity-window.ts"));
});
