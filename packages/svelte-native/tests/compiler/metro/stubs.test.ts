import { beforeAll, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";
import { isInPackage, pushPlatforms, stubCoreSource, stubSource, withSvelteNative } from "../../../src/metro.ts";
import { packageRoot, sourceFile } from "../../../src/package-root.ts";
import { type RealResolver, fakeConfig, resolveFrom, watchUntouched } from "../../support/metro.ts";
import { createProject } from "../../support/project.ts";

/** What Metro's own resolver answers: a file named after the module. */
const real: RealResolver = (_context, moduleName) => ({ type: "sourceFile", filePath: `/real/${moduleName}` });
const resolve = (config: ConfigT, moduleName: string, origin = "/app/src/a.ts") => resolveFrom(config, origin, moduleName, real);

describe("Metro resolves the packages an app does not link to stubs", () => {
  test("a package and every path inside it, and nothing else", () => {
    using project = createProject({}, "metro-stubs-");
    const root = project.directory;
    const config = withSvelteNative(fakeConfig(root), { stubbedPackages: ["react-native-mmkv", "@react-native-firebase/app", "expo-haptics"], variant: "qa" });
    const stub = (name: string) => resolve(config, name);
    expect(stub("react-native-mmkv")).toBe(join(root, ".svelte-native/stubs/qa/react-native-mmkv.js"));
    expect(stub("react-native-mmkv/lib/index")).toBe(stub("react-native-mmkv"));
    expect(stub("@react-native-firebase/app/lib/internal")).toBe(join(root, ".svelte-native/stubs/qa/_react-native-firebase_app.js"));
    expect(stub("expo-haptics")).toBe(join(root, ".svelte-native/stubs/qa/expo-haptics.js"));
    // A name that only starts like a stubbed one, a sibling package and a relative import are the real thing.
    expect(stub("react-native-mmkv-extra")).toBe("/real/react-native-mmkv-extra");
    expect(stub("@react-native-firebase/appx")).toBe("/real/@react-native-firebase/appx");
    expect(stub("@react-native-firebase/messaging")).toBe("/real/@react-native-firebase/messaging");
    expect(stub("./react-native-mmkv")).toBe("/real/./react-native-mmkv");
    expect(stub("svelte")).not.toContain("stubs");
    expect(isInPackage("a/b", "a")).toBe(true);
    expect(isInPackage("ab", "a")).toBe(false);
  });
  test("the stub files are written when the config is made, one core and one line per package", () => {
    using project = createProject({}, "metro-stubs-");
    const root = project.directory;
    withSvelteNative(fakeConfig(root), { stubbedPackages: ["react-native-mmkv", "expo-haptics"], variant: "production" });
    const directory = join(root, ".svelte-native/stubs/production");
    expect(readdirSync(directory).toSorted()).toEqual(["_core.js", "expo-haptics.js", "react-native-mmkv.js"]);
    expect(readFileSync(join(directory, "expo-haptics.js"), "utf8")).toBe(stubSource("expo-haptics", "production"));
    expect(readFileSync(join(directory, "_core.js"), "utf8")).toBe(stubCoreSource);
    expect(stubSource("expo-haptics", "production")).toContain('require("./_core.js")("expo-haptics", "production")');
  });
  test("each variant's stubs are files of their own, and a stub that is current is not written again: a bundle leaves a running Metro's files alone", () => {
    using project = createProject({}, "metro-stubs-");
    const root = project.directory;
    withSvelteNative(fakeConfig(root), { stubbedPackages: ["react-native-mmkv"], stubbedFiles: [join(root, "src/lib/smoke-checks.ts")], variant: "qa" });
    const files = ["_core.js", "react-native-mmkv.js", "src_lib_smoke-checks.js"].map((name) => join(root, ".svelte-native/stubs/qa", name));
    const text = files.map((file) => readFileSync(file, "utf8"));
    const untouched = watchUntouched(files);
    withSvelteNative(fakeConfig(root), { stubbedPackages: ["react-native-mmkv"], stubbedFiles: [join(root, "src/lib/smoke-checks.ts")], variant: "production" });
    withSvelteNative(fakeConfig(root), { stubbedPackages: ["react-native-mmkv"], stubbedFiles: [join(root, "src/lib/smoke-checks.ts")], variant: "qa" });
    untouched();
    expect(readFileSync(join(root, ".svelte-native/stubs/production/react-native-mmkv.js"), "utf8")).toContain('"production"');
    expect(text[1]).toContain('"qa"');
  });
  test("with nothing to stub the config is as it was: no files, no change to the cache key", () => {
    using project = createProject({}, "metro-stubs-");
    const root = project.directory;
    const plain = withSvelteNative(fakeConfig(root));
    expect(readdirSync(root)).toEqual([]);
    expect(plain.cacheVersion).toBe("+svelte-native-2");
    expect(resolve(plain, "react-native-mmkv")).toBe("/real/react-native-mmkv");
    expect(withSvelteNative(fakeConfig(root), { stubbedPackages: ["x"], variant: "qa" }).cacheVersion).toBe("+svelte-native-2+stubs-qa");
    expect(withSvelteNative(fakeConfig(root), { stubbedPackages: ["x"], variant: "production" }).cacheVersion).toBe("+svelte-native-2+stubs-production");
  });
  test("a source file of the app can be stubbed the same way, by the import that reaches it", () => {
    using project = createProject({}, "metro-stubs-");
    const root = project.directory;
    const checks = join(root, "src/lib/smoke-checks.ts");
    const config = withSvelteNative(fakeConfig(root), { stubbedFiles: [checks], variant: "qa" });
    const stubbed = join(root, ".svelte-native/stubs/qa/src_lib_smoke-checks.js");
    expect(resolve(config, "./smoke-checks.ts", join(root, "src/lib/smoke.ts"))).toBe(stubbed);
    expect(resolve(config, "./smoke-checks", join(root, "src/lib/smoke.ts"))).toBe(stubbed);
    expect(resolve(config, "../lib/smoke-checks.ts", join(root, "src/other/x.ts"))).toBe(stubbed);
    expect(resolve(config, "./smoke-log.ts", join(root, "src/lib/smoke.ts"))).toBe("/real/./smoke-log.ts");
    expect(resolve(config, "./smoke-checks.ts", join(root, "src/elsewhere/smoke.ts"))).toBe("/real/./smoke-checks.ts");
    expect(readFileSync(stubbed, "utf8")).toContain('("src/lib/smoke-checks", "qa")');
  });
});

describe("Metro resolves a directory the app does not carry to the directory's stub", () => {
  /** The real resolver finds a file: a `#lib/…` alias under the app's `src/lib`, a relative import from the origin, anything else under node_modules. */
  const resolving = (root: string): RealResolver => (context, moduleName) => ({
    type: "sourceFile",
    filePath: moduleName.startsWith("#lib/") ? join(root, "src/lib", moduleName.slice("#lib/".length))
      : moduleName.startsWith(".") ? join(dirname(context.originModulePath), moduleName)
      : join(root, "node_modules", moduleName),
  });
  const resolveIn = (config: ConfigT, root: string, moduleName: string, origin: string) => resolveFrom(config, origin, moduleName, resolving(root));

  test("every import that lands in it, by alias or by path, and nothing beside it", () => {
    using project = createProject({}, "metro-stubs-");
    const root = project.directory;
    const config = withSvelteNative(fakeConfig(root), { stubbedDirectories: [join(root, "src/lib/native/dev"), join(root, "src/routes/__dev/")], variant: "production" });
    const lab = join(root, ".svelte-native/stubs/production/src_lib_native_dev_.js");
    const routes = join(root, ".svelte-native/stubs/production/src_routes___dev_.js");
    const from = join(root, "src/routes/+layout.mobile.svelte");
    expect(resolveIn(config, root, "#lib/native/dev/errors.ts", from)).toBe(lab);
    expect(resolveIn(config, root, "#lib/native/dev/gestures/Box.svelte", from)).toBe(lab);
    expect(resolveIn(config, root, "../lib/native/dev/qa.ts", from)).toBe(lab);
    expect(resolveIn(config, root, "./__dev/screen/+mobile.svelte", from)).toBe(routes);
    // A directory that only starts like it, a file beside it and a package are the real thing.
    expect(resolveIn(config, root, "#lib/native/dev-tools/x.ts", from)).toBe(join(root, "src/lib/native/dev-tools/x.ts"));
    expect(resolveIn(config, root, "#lib/native/state.svelte.ts", from)).toBe(join(root, "src/lib/native/state.svelte.ts"));
    expect(resolveIn(config, root, "./__devices/x.ts", from)).toBe(join(root, "src/routes/__devices/x.ts"));
    expect(resolveIn(config, root, "svelte", from)).not.toContain(".svelte-native/stubs");
    expect(readFileSync(lab, "utf8")).toBe(stubSource("src/lib/native/dev/", "production"));
    expect(readFileSync(routes, "utf8")).toBe(stubSource("src/routes/__dev/", "production"));
  });
  test("a stubbed file is stubbed by any import of it, and the cache key tells the variants apart", () => {
    using project = createProject({}, "metro-stubs-");
    const root = project.directory;
    const config = withSvelteNative(fakeConfig(root), { stubbedFiles: [join(root, "src/lib/smoke-checks.ts")], variant: "qa" });
    expect(resolveIn(config, root, "#lib/smoke-checks.ts", join(root, "src/routes/a.ts"))).toBe(join(root, ".svelte-native/stubs/qa/src_lib_smoke-checks.js"));
    expect(resolveIn(config, root, "#lib/smoke.ts", join(root, "src/routes/a.ts"))).toBe(join(root, "src/lib/smoke.ts"));
    expect(withSvelteNative(fakeConfig(root), { stubbedDirectories: [join(root, "d")], variant: "production" }).cacheVersion).toBe("+svelte-native-2+stubs-production");
    expect(withSvelteNative(fakeConfig(root), { stubbedDirectories: [] }).cacheVersion).toBe("+svelte-native-2");
  });
  test("what is in the directory is never read: a stub throws when a lab module's export is used", () => {
    using project = createProject({}, "metro-stubs-");
    const root = project.directory;
    withSvelteNative(fakeConfig(root), { stubbedDirectories: [join(root, "src/lib/native/dev")], variant: "production" });
    const stub = createRequire(import.meta.url)(join(root, ".svelte-native/stubs/production/src_lib_native_dev_.js")) as Record<string, unknown>;
    expect(stub.__esModule).toBe(false);
    expect(() => stub.installErrorCounter).toThrow("src/lib/native/dev/ is not in this app (APP_VARIANT=production)");
  });
});

describe("what a stub does", () => {
  const load = (name: string, variant: string): unknown => {
    using project = createProject({}, "metro-stub-run-");
    const root = project.directory;
    withSvelteNative(fakeConfig(root), { stubbedPackages: [name], variant });
    return createRequire(import.meta.url)(join(root, ".svelte-native/stubs", variant, `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`));
  };
  test("importing it is harmless, using it throws the package name and the variant", () => {
    const module = load("react-native-mmkv", "production") as Record<string, unknown> & (() => unknown);
    const message = "react-native-mmkv is not in this app (APP_VARIANT=production)";
    // What Babel's interop reads when the module is imported.
    expect(module.__esModule).toBe(false);
    expect(Object.keys(module)).toEqual([]);
    expect("createMMKV" in module).toBe(false);
    expect(() => module.createMMKV).toThrow(message);
    expect(() => module.default).toThrow(message);
    expect(() => module()).toThrow(message);
    expect(() => new (module as unknown as new () => unknown)()).toThrow(message);
    expect(typeof module[Symbol.iterator as unknown as string]).toBe("undefined");
  });
});

describe("a platform whose push is off bundles push's stand-in, not its client", () => {
  // Bun (1.3) with a cold transpiler cache gives Expo's plugin resolver, which `require`s the library's `app.plugin.js` (an ES module), an object without its default
  // export the first time, and the config then cannot be read. Loading the plugin once first avoids it; Metro runs on Node, where `require` of it is right every time.
  beforeAll(async () => { await import(join(packageRoot, "app.plugin.js")); });
  // The library's own file, as Metro finds it from `push/load.ts` and from the `./push` entry.
  const library: RealResolver = (context, moduleName) => ({ type: "sourceFile", filePath: moduleName.startsWith(".") ? join(dirname(context.originModulePath), moduleName) : `/real/${moduleName}` });
  const fromLoad = sourceFile("push/load.ts");
  const client = sourceFile("push/push.svelte.ts");
  const absent = sourceFile("push/absent.ts");
  /**
   * A project whose app.json gives the library's plugin these options. Expo's `getConfig` applies the plugins (that is what keeps their options in `exp.plugins`), so the
   * library is linked into the project's node_modules, with a Google services file for the package push names.
   */
  const app = (options?: object, name = "@alfayez/svelte-native") => {
    const project = createProject({}, "metro-push-");
    project.write("package.json", JSON.stringify({ name: "app", version: "1.0.0", dependencies: { "@alfayez/svelte-native": "*" } }));
    project.write("google-services.json", JSON.stringify({ project_info: { project_id: "p" }, client: [{ client_info: { android_client_info: { package_name: "dev.example.app" } } }] }));
    project.write("app.json", JSON.stringify({ expo: { name: "app", slug: "app", android: { package: "dev.example.app" }, ios: { bundleIdentifier: "dev.example.app" }, plugins: [options === undefined ? name : [name, options]] } }));
    mkdirSync(project.path("node_modules/@alfayez"), { recursive: true });
    symlinkSync(packageRoot, project.path("node_modules/@alfayez/svelte-native"));
    return project;
  };
  const resolveOn = (config: ConfigT, platform: string, origin = fromLoad, name = "./push.svelte.ts") => {
    const resolveRequest = config.resolver.resolveRequest as (context: unknown, moduleName: string, platform: string) => { filePath: string };
    return resolveRequest({ resolveRequest: (context: { originModulePath: string }, request: string) => library(context as never, request), originModulePath: origin, unstable_conditionNames: [] }, name, platform).filePath;
  };

  test("push off (the plugin with no options, or push: false): the client resolves to the stand-in by any import of it, on both platforms; nothing else moves", () => {
    for (const options of [undefined, {}, { capabilities: { push: false } }]) {
      using project = app(options);
      const config = withSvelteNative(fakeConfig(project.directory), {});
      expect(pushPlatforms(project.directory)).toEqual({ android: false, ios: false });
      expect([resolveOn(config, "android"), resolveOn(config, "ios")]).toEqual([absent, absent]);
      expect(resolveOn(config, "android", sourceFile("push/index.ts"))).toBe(absent);
      expect(resolveOn(config, "android", fromLoad, "./client.ts")).toBe(sourceFile("push/client.ts"));
      // A file of the app's own with the same name is the app's.
      expect(resolveOn(config, "android", project.path("src/lib/a.ts"))).toBe(project.path("src/lib/push.svelte.ts"));
    }
  });

  test("push on for one platform: that platform bundles the client, the other the stand-in", () => {
    using android = app({ capabilities: { push: { android: { googleServicesFile: "./google-services.json" } } } });
    const forAndroid = withSvelteNative(fakeConfig(android.directory), {});
    expect(pushPlatforms(android.directory)).toEqual({ android: true, ios: false });
    expect([resolveOn(forAndroid, "android"), resolveOn(forAndroid, "ios")]).toEqual([client, absent]);
    using both = app({ capabilities: { push: { android: { googleServicesFile: "./google-services.json" }, ios: { mode: "production" } } } }, "@alfayez/svelte-native/app.plugin");
    const forBoth = withSvelteNative(fakeConfig(both.directory), {});
    expect([resolveOn(forBoth, "android"), resolveOn(forBoth, "ios")]).toEqual([client, client]);
  });

  test("a config that cannot be read, or push settings the plugin refuses, keep the client: the device's own flag decides then", () => {
    using unreadable = createProject({}, "metro-push-");
    unreadable.write("app.config.js", "throw new Error('broken config');");
    expect(pushPlatforms(unreadable.directory)).toBeUndefined();
    expect(resolveOn(withSvelteNative(fakeConfig(unreadable.directory), {}), "android")).toBe(client);
    using refused = app({ capabilities: { push: {} } });
    expect(pushPlatforms(refused.directory)).toBeUndefined();
    expect(resolveOn(withSvelteNative(fakeConfig(refused.directory), {}), "ios")).toBe(client);
  });
});
