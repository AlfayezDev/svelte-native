import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";
import { isInPackage, stubCoreSource, stubSource, withSvelteNative } from "../src/metro.ts";

/** The part of Metro's config `withSvelteNative` reads. */
function fakeConfig(projectRoot: string): ConfigT {
  return {
    projectRoot,
    resolver: { sourceExts: ["ts"], resolveRequest: undefined },
    serializer: { getModulesRunBeforeMainModule: () => [] },
    transformer: {},
  } as unknown as ConfigT;
}

const real = { resolveRequest: (_context: unknown, moduleName: string) => ({ type: "sourceFile", filePath: `/real/${moduleName}` }) };
const resolve = (config: ConfigT, moduleName: string, origin = "/app/src/a.ts") => {
  const resolveRequest = config.resolver.resolveRequest as (context: unknown, moduleName: string, platform: string) => { filePath: string };
  return resolveRequest({ ...real, originModulePath: origin, unstable_conditionNames: [] }, moduleName, "android").filePath;
};

describe("Metro resolves the packages an app does not link to stubs", () => {
  test("a package and every path inside it, and nothing else", () => {
    const root = mkdtempSync(join(tmpdir(), "metro-stubs-"));
    const config = withSvelteNative(fakeConfig(root), { stubbedPackages: ["react-native-mmkv", "@react-native-firebase/app", "expo-haptics"], variant: "qa" });
    const stub = (name: string) => resolve(config, name);
    expect(stub("react-native-mmkv")).toBe(join(root, ".svelte-native/stubs/react-native-mmkv.js"));
    expect(stub("react-native-mmkv/lib/index")).toBe(stub("react-native-mmkv"));
    expect(stub("@react-native-firebase/app/lib/internal")).toBe(join(root, ".svelte-native/stubs/_react-native-firebase_app.js"));
    expect(stub("expo-haptics")).toBe(join(root, ".svelte-native/stubs/expo-haptics.js"));
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
    const root = mkdtempSync(join(tmpdir(), "metro-stubs-"));
    withSvelteNative(fakeConfig(root), { stubbedPackages: ["react-native-mmkv", "expo-haptics"], variant: "production" });
    const directory = join(root, ".svelte-native/stubs");
    expect(readdirSync(directory).toSorted()).toEqual(["_core.js", "expo-haptics.js", "react-native-mmkv.js"]);
    expect(readFileSync(join(directory, "expo-haptics.js"), "utf8")).toBe(stubSource("expo-haptics", "production"));
    expect(readFileSync(join(directory, "_core.js"), "utf8")).toBe(stubCoreSource);
    expect(stubSource("expo-haptics", "production")).toContain('require("./_core.js")("expo-haptics", "production")');
  });
  test("with nothing to stub the config is as it was: no files, no change to the cache key", () => {
    const root = mkdtempSync(join(tmpdir(), "metro-stubs-"));
    const plain = withSvelteNative(fakeConfig(root));
    expect(readdirSync(root)).toEqual([]);
    expect(plain.cacheVersion).toBe("+svelte-native-2");
    expect(resolve(plain, "react-native-mmkv")).toBe("/real/react-native-mmkv");
    expect(withSvelteNative(fakeConfig(root), { stubbedPackages: ["x"], variant: "qa" }).cacheVersion).toBe("+svelte-native-2+stubs-qa");
    expect(withSvelteNative(fakeConfig(root), { stubbedPackages: ["x"], variant: "production" }).cacheVersion).toBe("+svelte-native-2+stubs-production");
  });
  test("a source file of the app can be stubbed the same way, by the import that reaches it", () => {
    const root = mkdtempSync(join(tmpdir(), "metro-stubs-"));
    const checks = join(root, "src/lib/smoke-checks.ts");
    const config = withSvelteNative(fakeConfig(root), { stubbedFiles: [checks], variant: "qa" });
    const stubbed = join(root, ".svelte-native/stubs/src_lib_smoke-checks.js");
    expect(resolve(config, "./smoke-checks.ts", join(root, "src/lib/smoke.ts"))).toBe(stubbed);
    expect(resolve(config, "./smoke-checks", join(root, "src/lib/smoke.ts"))).toBe(stubbed);
    expect(resolve(config, "../lib/smoke-checks.ts", join(root, "src/other/x.ts"))).toBe(stubbed);
    expect(resolve(config, "./smoke-log.ts", join(root, "src/lib/smoke.ts"))).toBe("/real/./smoke-log.ts");
    expect(resolve(config, "./smoke-checks.ts", join(root, "src/elsewhere/smoke.ts"))).toBe("/real/./smoke-checks.ts");
    expect(readFileSync(stubbed, "utf8")).toContain('("src/lib/smoke-checks", "qa")');
  });
});

describe("what a stub does", () => {
  const load = (name: string, variant: string): unknown => {
    const root = mkdtempSync(join(tmpdir(), "metro-stub-run-"));
    withSvelteNative(fakeConfig(root), { stubbedPackages: [name], variant });
    return createRequire(import.meta.url)(join(root, ".svelte-native/stubs", `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`));
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
