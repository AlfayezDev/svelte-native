import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";
import { syncRoutes } from "../src/build.ts";
import { closeRouteWatchers, withSvelteNative } from "../src/metro.ts";
import { routesTableFile } from "../src/variant.ts";

/**
 * The route table is per variant (the product's leaves the development lab out): each variant has a file of its own under
 * `.svelte-native/`, Metro writes its variant's when its config loads and resolves `./routes` (the generated entry's import) and
 * `@example/svelte-native/routes` (the app's read of `variant` and `lab`) to it. No file is shared, so a sync for another variant, in
 * a script or beside a running Metro, changes nothing it serves (apps/example/modules/svelte-engine/SPEC.md, "What the product contains: no development lab (JavaScript)").
 */
const fakeConfig = (projectRoot: string): ConfigT => ({
  projectRoot,
  resolver: { sourceExts: ["ts"], resolveRequest: undefined },
  serializer: { getModulesRunBeforeMainModule: () => [] },
  transformer: {},
}) as unknown as ConfigT;

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "metro-routes-"));
  for (const path of ["+layout.mobile.svelte", "workspaces/+mobile.svelte", "__dev/+mobile.svelte", "__dev/screen/+mobile.svelte"]) {
    mkdirSync(join(root, "src/routes", path, ".."), { recursive: true });
    writeFileSync(join(root, "src/routes", path), "");
  }
  return root;
}
const tableFile = (root: string, variant: string) => join(root, ".svelte-native", routesTableFile(variant));
const table = (root: string, variant: string) => readFileSync(tableFile(root, variant), "utf8");
const real = { type: "sourceFile", filePath: "/real/module.ts" };
/** What Metro's resolver answers for an import of `moduleName` by `origin`. */
function resolveFrom(config: ConfigT, origin: string, moduleName: string): string {
  const resolveRequest = config.resolver.resolveRequest as (context: unknown, moduleName: string, platform: string) => { filePath: string };
  return resolveRequest({ resolveRequest: () => real, originModulePath: origin, unstable_conditionNames: [] }, moduleName, "android").filePath;
}
const until = async (condition: () => boolean, ms = 5_000) => {
  const deadline = Date.now() + ms;
  while (!condition() && Date.now() < deadline) await new Promise((done) => setTimeout(done, 25));
};

const environment = process.env.NODE_ENV;
const variantEnvironment = process.env.APP_VARIANT;
const rootEnvironment = process.env.SVELTE_NATIVE_ROOT;
afterEach(() => {
  closeRouteWatchers();
  if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment;
  if (variantEnvironment === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = variantEnvironment;
  if (rootEnvironment === undefined) delete process.env.SVELTE_NATIVE_ROOT; else process.env.SVELTE_NATIVE_ROOT = rootEnvironment;
});

describe("Metro writes the route table of the variant it bundles", () => {
  test("when the config loads: the product's leaves the lab out, a lab variant's has it, and each is a file of its own", () => {
    const root = project();
    withSvelteNative(fakeConfig(root), { variant: "qa" });
    withSvelteNative(fakeConfig(root), { variant: "production" });
    withSvelteNative(fakeConfig(root), { variant: "smoke" });
    expect(table(root, "production")).not.toContain("__dev");
    expect(table(root, "production")).toContain("export const lab = false;");
    expect(table(root, "production")).toContain('export const variant = "production";');
    for (const variant of ["qa", "smoke"]) {
      expect(table(root, variant)).toContain('require("../src/routes/__dev/screen/+mobile.svelte")');
      expect(table(root, variant)).toContain("export const lab = true;");
      expect(table(root, variant)).toContain(`export const variant = "${variant}";`);
    }
    expect(existsSync(join(root, ".svelte-native/routes.ts"))).toBe(false);
    // The entry is written beside them, so a project nobody synced bundles.
    expect(readFileSync(join(root, ".svelte-native/entry.ts"), "utf8")).toContain("import { tree } from './routes';");
  });
  test("the variant defaults to APP_VARIANT, qa for none", () => {
    const root = project();
    process.env.APP_VARIANT = "production";
    withSvelteNative(fakeConfig(root));
    expect(existsSync(tableFile(root, "production"))).toBe(true);
    expect(existsSync(tableFile(root, "qa"))).toBe(false);
    delete process.env.APP_VARIANT;
    withSvelteNative(fakeConfig(root));
    expect(existsSync(tableFile(root, "qa"))).toBe(true);
  });
  test("a project without src/routes, or told not to, is left alone", () => {
    const empty = mkdtempSync(join(tmpdir(), "metro-routes-"));
    withSvelteNative(fakeConfig(empty), { variant: "production" });
    expect(existsSync(tableFile(empty, "production"))).toBe(false);
    const root = project();
    withSvelteNative(fakeConfig(root), { variant: "production", syncRoutes: false });
    expect(existsSync(tableFile(root, "production"))).toBe(false);
  });
});

describe("Metro resolves the route table to the bundling variant's file", () => {
  test("`./routes` from the generated entry, and the app's `@example/svelte-native/routes` from anywhere", () => {
    const root = project();
    const entry = join(root, ".svelte-native/entry.ts");
    for (const variant of ["production", "qa", "smoke"]) {
      const config = withSvelteNative(fakeConfig(root), { variant });
      expect(resolveFrom(config, entry, "./routes")).toBe(tableFile(root, variant));
      expect(resolveFrom(config, join(root, "src/lib/native/state.svelte.ts"), "@example/svelte-native/routes")).toBe(tableFile(root, variant));
    }
    // Any other `./routes` is the real thing.
    const config = withSvelteNative(fakeConfig(root), { variant: "qa" });
    expect(resolveFrom(config, join(root, "src/lib/other.ts"), "./routes")).toBe("/real/module.ts");
  });
  test("a sync for another variant, before or while a Metro runs, changes nothing it resolves or serves", () => {
    const root = project();
    const product = withSvelteNative(fakeConfig(root), { variant: "production" });
    const smoke = withSvelteNative(fakeConfig(root), { variant: "smoke" });
    const served = { production: table(root, "production"), smoke: table(root, "smoke") };
    const modified = { production: statSync(tableFile(root, "production")).mtimeMs, smoke: statSync(tableFile(root, "smoke")).mtimeMs };
    // A QA sync (a script, the QA harness, another Metro), and a new route synced for QA only.
    mkdirSync(join(root, "src/routes/inbox"), { recursive: true });
    writeFileSync(join(root, "src/routes/inbox/+mobile.svelte"), "");
    syncRoutes(root, { variant: "qa" });
    expect(table(root, "qa")).toContain('path: "/inbox"');
    for (const variant of ["production", "smoke"] as const) {
      expect(table(root, variant)).toBe(served[variant]);
      expect(statSync(tableFile(root, variant)).mtimeMs).toBe(modified[variant]);
    }
    const entry = join(root, ".svelte-native/entry.ts");
    expect(resolveFrom(product, entry, "./routes")).toBe(tableFile(root, "production"));
    // QA and the smoke app differ in their header alone: neither is ever served the other's table.
    expect(resolveFrom(smoke, entry, "./routes")).toBe(tableFile(root, "smoke"));
    expect(tableFile(root, "smoke")).not.toBe(tableFile(root, "qa"));
  });
});

describe("the entry", () => {
  test("a Metro that starts without SVELTE_NATIVE_ROOT keeps the entry a sync with it wrote; a Metro that has it writes it; sync rewrites it", () => {
    const root = project();
    const entry = () => readFileSync(join(root, ".svelte-native/entry.ts"), "utf8");
    process.env.SVELTE_NATIVE_ROOT = "src/lib/Spike.svelte";
    syncRoutes(root, { variant: "qa" });
    expect(entry()).toContain("src/lib/Spike.svelte");
    delete process.env.SVELTE_NATIVE_ROOT;
    withSvelteNative(fakeConfig(root), { variant: "qa" });
    expect(entry()).toContain("src/lib/Spike.svelte"); // not reverted
    syncRoutes(root, { variant: "qa" });
    expect(entry()).toContain("import { tree } from './routes';"); // `svelte-native sync` is what rewrites it
    process.env.SVELTE_NATIVE_ROOT = "src/lib/Spike.svelte";
    withSvelteNative(fakeConfig(root), { variant: "production" });
    expect(entry()).toContain("src/lib/Spike.svelte"); // a Metro with the environment honours it
  });
});

describe("in development the table follows the route files", () => {
  test("under NODE_ENV=development the config watches src/routes: a route added is in the variant's table a moment later, and in no other", async () => {
    const root = project();
    process.env.NODE_ENV = "development";
    withSvelteNative(fakeConfig(root), { variant: "production" });
    syncRoutes(root, { variant: "qa" });
    const qa = table(root, "qa");
    expect(table(root, "production")).not.toContain("/inbox");
    mkdirSync(join(root, "src/routes/inbox"), { recursive: true });
    writeFileSync(join(root, "src/routes/inbox/+mobile.svelte"), '<script module>export const presentation = "modal";</script>');
    await until(() => table(root, "production").includes('path: "/inbox"'));
    expect(table(root, "production")).toContain('path: "/inbox", presentation: "modal"');
    expect(table(root, "production")).not.toContain("__dev");
    expect(table(root, "qa")).toBe(qa); // another variant's table is not the watcher's
  });
  test("a route tree the build rejects is logged and the next change recovers", async () => {
    const root = project();
    process.env.NODE_ENV = "development";
    withSvelteNative(fakeConfig(root), { variant: "production" });
    const errors: unknown[][] = [];
    const log = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      mkdirSync(join(root, "src/routes/bad"), { recursive: true });
      writeFileSync(join(root, "src/routes/bad/+mobile.svelte"), '<script module>export const presentation = cond ? "modal" : "push";</script>');
      await until(() => errors.length > 0);
      expect(String(errors[0][0])).toContain("bad/+mobile.svelte: export `presentation` as one of the literals");
      writeFileSync(join(root, "src/routes/bad/+mobile.svelte"), '<script module>export const presentation = "sheet";</script>');
      await until(() => table(root, "production").includes('path: "/bad"'));
    } finally {
      console.error = log;
    }
    expect(table(root, "production")).toContain('path: "/bad", presentation: "sheet"');
  });
  test("outside development nothing watches: the table is the one the config wrote", async () => {
    const root = project();
    process.env.NODE_ENV = "production";
    withSvelteNative(fakeConfig(root), { variant: "production" });
    mkdirSync(join(root, "src/routes/inbox"), { recursive: true });
    writeFileSync(join(root, "src/routes/inbox/+mobile.svelte"), "");
    await new Promise((done) => setTimeout(done, 300));
    expect(table(root, "production")).not.toContain("/inbox");
  });
});
