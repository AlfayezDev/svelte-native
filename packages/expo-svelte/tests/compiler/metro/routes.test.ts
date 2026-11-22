import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncRoutes } from "../../../src/build.ts";
import { closeWatchers, withExpoSvelte } from "../../../src/metro.ts";
import { routesTableFile } from "../../../src/variant.ts";
import { fakeConfig, resolveFrom, until, watchUntouched } from "../../support/metro.ts";
import { type Project, createProject } from "../../support/project.ts";

/**
 * The route table is per variant (the product's leaves the development lab out): each variant has a file of its own under
 * `.expo-svelte/`, Metro writes its variant's when its config loads and resolves `./routes` (the generated entry's import) and
 * `expo-svelte/routes` (the app's read of `variant` and `lab`) to it. No file is shared, so a sync for another variant, in
 * a script or beside a running Metro, changes nothing it serves (packages/expo-svelte/native/svelte-core/SPEC.md, "What the product contains: no development lab (JavaScript)").
 */
const projects: Project[] = [];
/** A project with a home screen, a route and a lab route, removed after the test. */
function project(): string {
  const created = createProject(Object.fromEntries(["+layout.mobile.svelte", "workspaces/+mobile.svelte", "__dev/+mobile.svelte", "__dev/screen/+mobile.svelte"].map((path) => [`src/routes/${path}`, ""])), "metro-routes-");
  projects.push(created);
  return created.directory;
}
const tableFile = (root: string, variant: string) => join(root, ".expo-svelte", routesTableFile(variant));
const table = (root: string, variant: string) => readFileSync(tableFile(root, variant), "utf8");

const environment = process.env.NODE_ENV;
const variantEnvironment = process.env.APP_VARIANT;
const rootEnvironment = process.env.EXPO_SVELTE_ROOT;
afterEach(() => {
  closeWatchers();
  for (const created of projects.splice(0)) created.remove();
  if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment;
  if (variantEnvironment === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = variantEnvironment;
  if (rootEnvironment === undefined) delete process.env.EXPO_SVELTE_ROOT; else process.env.EXPO_SVELTE_ROOT = rootEnvironment;
});

describe("Metro writes the route table of the variant it bundles", () => {
  test("when the config loads: the product's leaves the lab out, a lab variant's has it, and each is a file of its own", () => {
    const root = project();
    withExpoSvelte(fakeConfig(root), { variant: "qa" });
    withExpoSvelte(fakeConfig(root), { variant: "production" });
    withExpoSvelte(fakeConfig(root), { variant: "smoke" });
    expect(table(root, "production")).not.toContain("__dev");
    expect(table(root, "production")).toContain("export const lab = false;");
    expect(table(root, "production")).toContain('export const variant = "production";');
    for (const variant of ["qa", "smoke"]) {
      expect(table(root, variant)).toContain('require("../src/routes/__dev/screen/+mobile.svelte")');
      expect(table(root, variant)).toContain("export const lab = true;");
      expect(table(root, variant)).toContain(`export const variant = "${variant}";`);
    }
    expect(existsSync(join(root, ".expo-svelte/routes.ts"))).toBe(false);
    // The entry is written beside them, so a project nobody synced bundles.
    expect(readFileSync(join(root, ".expo-svelte/entry.ts"), "utf8")).toContain("import { tree } from './routes';");
  });
  test("a project without src/routes, or told not to, is left alone", () => {
    const emptyProject = createProject();
    projects.push(emptyProject);
    const empty = emptyProject.directory;
    withExpoSvelte(fakeConfig(empty), { variant: "production" });
    expect(existsSync(tableFile(empty, "production"))).toBe(false);
    const root = project();
    withExpoSvelte(fakeConfig(root), { variant: "production", syncRoutes: false });
    expect(existsSync(tableFile(root, "production"))).toBe(false);
  });
});

describe("Metro resolves the route table to the bundling variant's file", () => {
  test("`./routes` from the generated entry, and the app's `expo-svelte/routes` from anywhere", () => {
    const root = project();
    const entry = join(root, ".expo-svelte/entry.ts");
    for (const variant of ["production", "qa", "smoke"]) {
      const config = withExpoSvelte(fakeConfig(root), { variant });
      expect(resolveFrom(config, entry, "./routes")).toBe(tableFile(root, variant));
      expect(resolveFrom(config, join(root, "src/lib/native/state.svelte.ts"), "expo-svelte/routes")).toBe(tableFile(root, variant));
    }
    // Any other `./routes` is the real thing.
    const config = withExpoSvelte(fakeConfig(root), { variant: "qa" });
    expect(resolveFrom(config, join(root, "src/lib/other.ts"), "./routes")).toBe("/real/module.ts");
  });
  test("a sync for another variant, before or while a Metro runs, changes nothing it resolves or serves", () => {
    const root = project();
    const product = withExpoSvelte(fakeConfig(root), { variant: "production" });
    const smoke = withExpoSvelte(fakeConfig(root), { variant: "smoke" });
    const untouched = watchUntouched([tableFile(root, "production"), tableFile(root, "smoke")]);
    // A QA sync (a script, the QA harness, another Metro), and a new route synced for QA only.
    mkdirSync(join(root, "src/routes/inbox"), { recursive: true });
    writeFileSync(join(root, "src/routes/inbox/+mobile.svelte"), "");
    syncRoutes(root, { variant: "qa" });
    expect(table(root, "qa")).toContain('path: "/inbox"');
    untouched();
    const entry = join(root, ".expo-svelte/entry.ts");
    expect(resolveFrom(product, entry, "./routes")).toBe(tableFile(root, "production"));
    // QA and the smoke app differ in their header alone: neither is ever served the other's table.
    expect(resolveFrom(smoke, entry, "./routes")).toBe(tableFile(root, "smoke"));
    expect(tableFile(root, "smoke")).not.toBe(tableFile(root, "qa"));
  });
});

describe("the entry", () => {
  test("a Metro that starts without EXPO_SVELTE_ROOT keeps the entry a sync with it wrote; a Metro that has it writes it; sync rewrites it", () => {
    const root = project();
    const entry = () => readFileSync(join(root, ".expo-svelte/entry.ts"), "utf8");
    process.env.EXPO_SVELTE_ROOT = "src/lib/Spike.svelte";
    syncRoutes(root, { variant: "qa" });
    expect(entry()).toContain("src/lib/Spike.svelte");
    delete process.env.EXPO_SVELTE_ROOT;
    withExpoSvelte(fakeConfig(root), { variant: "qa" });
    expect(entry()).toContain("src/lib/Spike.svelte"); // not reverted
    syncRoutes(root, { variant: "qa" });
    expect(entry()).toContain("import { tree } from './routes';"); // `expo-svelte sync` is what rewrites it
    process.env.EXPO_SVELTE_ROOT = "src/lib/Spike.svelte";
    withExpoSvelte(fakeConfig(root), { variant: "production" });
    expect(entry()).toContain("src/lib/Spike.svelte"); // a Metro with the environment honours it
  });
});

describe("an entry from an earlier release", () => {
  /** What `expo-svelte sync` wrote in 0.4.0-rc.5 and before: the three boot imports of paths that 0.4.0-rc.7 removed. */
  const old = `import 'expo-svelte/init';
import 'expo-svelte/polyfills';
import { createFabricApp, remountSurfaces } from 'expo-svelte/fabric';
import App from '../src/routes/+layout.mobile.svelte';
import { tree } from './routes';
createFabricApp(App, { tree });
declare const module: { hot?: { accept(callback?: () => void): void } };
if (__DEV__) module.hot?.accept(() => remountSurfaces());
`;
  const current = "import { createFabricApp, remountSurfaces } from 'expo-svelte/app';";
  const entryFile = (root: string) => join(root, ".expo-svelte/entry.ts");

  test("a Metro that keeps the entry rewrites one that imports a path the library removed, so an upgraded app starts", () => {
    const root = project();
    delete process.env.EXPO_SVELTE_ROOT;
    syncRoutes(root, { variant: "qa" });
    writeFileSync(entryFile(root), old);
    withExpoSvelte(fakeConfig(root), { variant: "qa" });
    const entry = readFileSync(entryFile(root), "utf8");
    expect(entry).toContain(current);
    expect(entry).toContain("import App from '../src/routes/+layout.mobile.svelte';");
    for (const removed of ["/init", "/polyfills", "/fabric"]) expect(entry).not.toContain(`expo-svelte${removed}`);
  });

  test("each removed path is enough: /animation, /gestures, /svg, /native-modules and /expo, and a path the package never had", () => {
    for (const path of ["animation", "gestures", "svg", "native-modules", "expo", "init", "polyfills", "fabric", "nothing/here"]) {
      const root = project();
      delete process.env.EXPO_SVELTE_ROOT;
      syncRoutes(root, { variant: "qa" });
      writeFileSync(entryFile(root), `${readFileSync(entryFile(root), "utf8")}import "expo-svelte/${path}";\n`);
      withExpoSvelte(fakeConfig(root), { variant: "qa" });
      expect([path, readFileSync(entryFile(root), "utf8").includes(`expo-svelte/${path}`)]).toEqual([path, false]);
    }
  });

  test("a specifier in double quotes or a require is found, and an entry from before the package's rename too", () => {
    for (const stale of [`import "expo-svelte/init";\n`, `require("expo-svelte/fabric");\n`, `import '@example/svelte-native/init';\n`, `import { x } from "@example/svelte-native";\n`, `import { x } from "@alfayez/svelte-native/app";\n`]) {
      const root = project();
      delete process.env.EXPO_SVELTE_ROOT;
      syncRoutes(root, { variant: "qa" });
      writeFileSync(entryFile(root), `${stale}${readFileSync(entryFile(root), "utf8")}`);
      withExpoSvelte(fakeConfig(root), { variant: "qa" });
      expect([stale, readFileSync(entryFile(root), "utf8").includes(stale.trim())]).toEqual([stale, false]);
    }
  });

  test("an entry that imports only what the package exports stays as it is, edited or not", () => {
    const root = project();
    delete process.env.EXPO_SVELTE_ROOT;
    syncRoutes(root, { variant: "qa" });
    const edited = `import 'expo-svelte/platform';\nimport { gesture } from "expo-svelte";\nimport "expo-svelte-extras/thing";\n${readFileSync(entryFile(root), "utf8")}// mine\n`;
    writeFileSync(entryFile(root), edited);
    withExpoSvelte(fakeConfig(root), { variant: "qa" });
    expect(readFileSync(entryFile(root), "utf8")).toBe(edited);
    // The same for the root a sync with EXPO_SVELTE_ROOT wrote.
    process.env.EXPO_SVELTE_ROOT = "src/lib/Spike.svelte";
    syncRoutes(root, { variant: "qa" });
    delete process.env.EXPO_SVELTE_ROOT;
    const spike = readFileSync(entryFile(root), "utf8");
    withExpoSvelte(fakeConfig(root), { variant: "qa" });
    expect(readFileSync(entryFile(root), "utf8")).toBe(spike);
  });

  test("the rewrite is once: the next Metro finds an entry that is current and leaves it", () => {
    const root = project();
    delete process.env.EXPO_SVELTE_ROOT;
    syncRoutes(root, { variant: "qa" });
    writeFileSync(entryFile(root), old);
    withExpoSvelte(fakeConfig(root), { variant: "qa" });
    const untouched = watchUntouched([entryFile(root)]);
    withExpoSvelte(fakeConfig(root), { variant: "qa" });
    untouched();
  });

  test("a stale entry written for a custom root is rewritten for what the environment names", () => {
    const root = project();
    process.env.EXPO_SVELTE_ROOT = "src/lib/Spike.svelte";
    syncRoutes(root, { variant: "qa" });
    writeFileSync(entryFile(root), old.replace("import App from '../src/routes/+layout.mobile.svelte';", "import App from '../src/lib/Spike.svelte';"));
    delete process.env.EXPO_SVELTE_ROOT;
    withExpoSvelte(fakeConfig(root), { variant: "qa" });
    expect(readFileSync(entryFile(root), "utf8")).toContain(current); // the default, which is what the environment asks for
  });
});

describe("in development the table follows the route files", () => {
  test("under NODE_ENV=development the config watches src/routes: a route added is in the variant's table a moment later, and in no other", async () => {
    const root = project();
    process.env.NODE_ENV = "development";
    withExpoSvelte(fakeConfig(root), { variant: "production" });
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
    withExpoSvelte(fakeConfig(root), { variant: "production" });
    const log = spyOn(console, "error").mockImplementation(() => {});
    const errors = () => log.mock.calls;
    try {
      mkdirSync(join(root, "src/routes/bad"), { recursive: true });
      writeFileSync(join(root, "src/routes/bad/+mobile.svelte"), '<script module>export const presentation = cond ? "modal" : "push";</script>');
      await until(() => errors().length > 0);
      expect(String(errors()[0]?.[0])).toContain("bad/+mobile.svelte: export `presentation` as one of the literals");
      writeFileSync(join(root, "src/routes/bad/+mobile.svelte"), '<script module>export const presentation = "sheet";</script>');
      await until(() => table(root, "production").includes('path: "/bad"'));
    } finally {
      log.mockRestore();
    }
    expect(table(root, "production")).toContain('path: "/bad", presentation: "sheet"');
  });
  test("outside development nothing watches: the table is the one the config wrote", async () => {
    const root = project();
    process.env.NODE_ENV = "production";
    withExpoSvelte(fakeConfig(root), { variant: "production" });
    mkdirSync(join(root, "src/routes/inbox"), { recursive: true });
    writeFileSync(join(root, "src/routes/inbox/+mobile.svelte"), "");
    await new Promise((done) => setTimeout(done, 300));
    expect(table(root, "production")).not.toContain("/inbox");
  });
});

describe("src/hooks.mobile.ts", () => {
  const hooksModule = (root: string) => readFileSync(join(root, ".expo-svelte/hooks.ts"), "utf8");

  test("a development Metro writes the hooks module again when the file appears or goes; the entry stays as it is", async () => {
    const root = project();
    process.env.NODE_ENV = "development";
    delete process.env.EXPO_SVELTE_ROOT;
    withExpoSvelte(fakeConfig(root), { variant: "qa" });
    const entry = readFileSync(join(root, ".expo-svelte/entry.ts"), "utf8");
    expect(entry).toContain("import './hooks';");
    expect(hooksModule(root)).toContain("registerHooks({});");
    writeFileSync(join(root, "src/hooks.mobile.ts"), "export const init = () => {};\n");
    await until(() => hooksModule(root).includes("registerHooks(hooks);"));
    expect(hooksModule(root)).toContain('import * as hooks from "../src/hooks.mobile";');
    rmSync(join(root, "src/hooks.mobile.ts"));
    await until(() => hooksModule(root).includes("registerHooks({});"));
    expect(hooksModule(root)).not.toContain("import * as hooks");
    expect(readFileSync(join(root, ".expo-svelte/entry.ts"), "utf8")).toBe(entry);
  });

  test("a Metro that keeps the entry rewrites one from before the hooks module (it would leave the file unloaded)", () => {
    const root = project();
    delete process.env.EXPO_SVELTE_ROOT;
    syncRoutes(root, { variant: "qa" });
    const entryFile = join(root, ".expo-svelte/entry.ts");
    const current = readFileSync(entryFile, "utf8");
    writeFileSync(entryFile, current.replace("import './hooks';\n", ""));
    withExpoSvelte(fakeConfig(root), { variant: "qa" });
    expect(readFileSync(entryFile, "utf8")).toBe(current);
  });
});
