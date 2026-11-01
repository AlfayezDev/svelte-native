import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";
import { syncRoutes, watchRoutes } from "../src/build.ts";
import { withSvelteNative } from "../src/metro.ts";
import { routesHeader, routesHeaderOf } from "../src/variant.ts";

/**
 * The route table is per variant (the product's leaves the development lab out), and `.svelte-native/routes.ts` is one file: Metro
 * writes it for its own variant when its config loads and refuses to resolve one written for another, so a bundle cannot carry the
 * routes of a variant it is not (SPEC.md, "What the product contains").
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
const table = (root: string) => readFileSync(join(root, ".svelte-native/routes.ts"), "utf8");
/** What Metro's resolver does with `./routes` imported by the entry: the real resolver finds the table. */
function resolveTable(config: ConfigT, root: string): string {
  const resolveRequest = config.resolver.resolveRequest as (context: unknown, moduleName: string, platform: string) => { filePath: string };
  const context = { resolveRequest: () => ({ type: "sourceFile", filePath: join(root, ".svelte-native/routes.ts") }), originModulePath: join(root, ".svelte-native/entry.ts"), unstable_conditionNames: [] };
  return resolveRequest(context, "./routes", "android").filePath;
}

describe("the header of the route table", () => {
  test("records the variant and whether the lab's routes are in it", () => {
    expect(routesHeaderOf(`${routesHeader("production", false)}export const tree = {};`)).toEqual({ variant: "production", lab: false });
    expect(routesHeaderOf(`${routesHeader("qa", true)}export const tree = {};`)).toEqual({ variant: "qa", lab: true });
    expect(routesHeaderOf("export const tree = {};")).toBeNull();
    const root = project();
    syncRoutes(root, { variant: "smoke" });
    expect(table(root).split("\n")[0]).toBe("// svelte-native routes: variant=smoke lab=yes");
    syncRoutes(root, { variant: "production" });
    expect(table(root).split("\n")[0]).toBe("// svelte-native routes: variant=production lab=no");
  });
});

describe("Metro syncs the routes for the variant it bundles", () => {
  test("when the config loads: the product leaves the lab out whatever table was there, a lab variant puts it back", () => {
    const root = project();
    syncRoutes(root, { variant: "qa" });
    expect(table(root)).toContain("__dev");
    withSvelteNative(fakeConfig(root), { variant: "production" });
    expect(table(root)).not.toContain("__dev");
    expect(routesHeaderOf(table(root))).toEqual({ variant: "production", lab: false });
    withSvelteNative(fakeConfig(root), { variant: "smoke" });
    expect(table(root)).toContain('require("../src/routes/__dev/screen/+mobile.svelte")');
    expect(routesHeaderOf(table(root))).toEqual({ variant: "smoke", lab: true });
    // The entry is written beside it, so a project nobody synced bundles.
    expect(readFileSync(join(root, ".svelte-native/entry.ts"), "utf8")).toContain("import { tree } from './routes';");
  });
  test("a project without src/routes, or told not to, is left alone", () => {
    const empty = mkdtempSync(join(tmpdir(), "metro-routes-"));
    withSvelteNative(fakeConfig(empty), { variant: "production" });
    expect(() => table(empty)).toThrow();
    const root = project();
    withSvelteNative(fakeConfig(root), { variant: "production", syncRoutes: false });
    expect(() => table(root)).toThrow();
  });
});

describe("Metro refuses a route table of another variant", () => {
  test("the table the config wrote resolves", () => {
    const root = project();
    for (const variant of ["production", "qa", "smoke"]) {
      const config = withSvelteNative(fakeConfig(root), { variant });
      expect(resolveTable(config, root)).toBe(join(root, ".svelte-native/routes.ts"));
    }
  });
  test("a table synced for the QA app after the config loaded is a resolve error in the product, and the other way round", () => {
    const root = project();
    const product = withSvelteNative(fakeConfig(root), { variant: "production" });
    syncRoutes(root, { variant: "qa" }); // a sync running beside Metro, or a Metro started before it
    expect(() => resolveTable(product, root)).toThrow(/routes\.ts was synced for the qa app \(lab routes in\), and this bundle is the production app \(lab routes out\)/);
    const qa = withSvelteNative(fakeConfig(root), { variant: "qa" });
    syncRoutes(root, { variant: "production" });
    expect(() => resolveTable(qa, root)).toThrow(/was synced for the production app \(lab routes out\), and this bundle is the qa app/);
    // The smoke app is not the QA app: the table says which, though both have the lab.
    const smoke = withSvelteNative(fakeConfig(root), { variant: "smoke" });
    syncRoutes(root, { variant: "qa" });
    expect(() => resolveTable(smoke, root)).toThrow(/was synced for the qa app/);
  });
  test("a table that records no variant (made by an older sync or by hand) is refused too", () => {
    const root = project();
    const product = withSvelteNative(fakeConfig(root), { variant: "production" });
    writeFileSync(join(root, ".svelte-native/routes.ts"), "export const tree = {};\n");
    expect(() => resolveTable(product, root)).toThrow(/was synced for no variant/);
  });
  test("only the table is checked: other files resolve as they did", () => {
    const root = project();
    const config = withSvelteNative(fakeConfig(root), { variant: "production" });
    const resolveRequest = config.resolver.resolveRequest as (context: unknown, moduleName: string, platform: string) => { filePath: string };
    syncRoutes(root, { variant: "qa" });
    expect(resolveRequest({ resolveRequest: () => ({ type: "sourceFile", filePath: join(root, ".svelte-native/entry.ts") }), originModulePath: "/x.ts", unstable_conditionNames: [] }, "./entry", "android").filePath).toBe(join(root, ".svelte-native/entry.ts"));
  });
});

describe("in development the table follows the route files", () => {
  test("a route added under src/routes is in the table a moment later, for the variant", async () => {
    const root = project();
    syncRoutes(root, { variant: "production" });
    expect(table(root)).not.toContain("/inbox");
    const watcher = watchRoutes(root, { variant: "production" }, 20);
    try {
      mkdirSync(join(root, "src/routes/inbox"), { recursive: true });
      writeFileSync(join(root, "src/routes/inbox/+mobile.svelte"), '<script module>export const presentation = "modal";</script>');
      const deadline = Date.now() + 5_000;
      while (!table(root).includes('path: "/inbox"') && Date.now() < deadline) await new Promise((done) => setTimeout(done, 25));
      expect(table(root)).toContain('path: "/inbox", presentation: "modal"');
      expect(routesHeaderOf(table(root))).toEqual({ variant: "production", lab: false });
      expect(table(root)).not.toContain("__dev");
    } finally {
      watcher.close();
    }
  });
});
