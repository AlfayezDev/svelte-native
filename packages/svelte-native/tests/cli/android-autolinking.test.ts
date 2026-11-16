import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AutolinkingConfig, deferNitroLibraries, deferredNitroPackages, nitroPackage, relinkedPackage } from "../../src/autolinking.ts";

/**
 * `svelte-native android-autolinking` (`autolinking.ts`): React Native's autolinking config with the Nitro modules' packages relinked, so that
 * their native libraries load after the start (`DeferredLibraries.kt`). The config below has the shape Expo's `react-native-config --json
 * --platform android` prints (SDK 57), trimmed to the fields the packages' code generation reads.
 */
const android = (packageImportPath: string, packageInstance: string, extra: Record<string, unknown> = {}) => ({
  sourceDir: "/app/node_modules/x/android",
  packageImportPath,
  packageInstance,
  buildTypes: [],
  componentDescriptors: [],
  cmakeListsPath: "/app/node_modules/x/android/build/generated/source/codegen/jni/CMakeLists.txt",
  ...extra,
});
const dependency = (name: string, platform: ReturnType<typeof android> | null) => ({ root: `/app/node_modules/${name}`, name, platforms: { android: platform } });

function config(): AutolinkingConfig {
  return {
    root: "/app",
    reactNativePath: "/app/node_modules/react-native",
    dependencies: {
      "react-native-mmkv": dependency("react-native-mmkv", android("import com.margelo.nitro.mmkv.NitroMmkvPackage;", "new NitroMmkvPackage()")),
      "react-native-nitro-modules": dependency("react-native-nitro-modules", android("import com.margelo.nitro.NitroModulesPackage;", "new NitroModulesPackage()", { libraryName: "NitroModulesSpec" })),
      "react-native-quick-base64": dependency("react-native-quick-base64", android("import com.reactnativequickbase64.QuickBase64Package;", "new QuickBase64Package()")),
      "react-native-quick-crypto": dependency("react-native-quick-crypto", android("import com.margelo.nitro.quickcrypto.QuickCryptoPackage;", "new QuickCryptoPackage()", { libraryName: "QuickCrypto" })),
    },
    project: { android: { packageName: "io.example.app" } },
  };
}

type Platform = { packageImportPath: string; packageInstance: string; [key: string]: unknown };
const androidOf = (result: AutolinkingConfig, name: string) => result.dependencies?.[name]?.platforms?.android as Platform;

/** What React Native's `GeneratePackageListTask` writes for a dependency (0.85: the imported class's short name becomes its full name, `\bName\b`). */
function packageListInstance(platform: Platform): string {
  const fqcn = /^import\s+([\w.]+)\s*;?$/.exec(platform.packageImportPath)?.[1];
  if (!fqcn) return platform.packageInstance;
  const className = fqcn.slice(fqcn.lastIndexOf(".") + 1);
  return platform.packageInstance.replace(new RegExp(`\\b${className}\\b`, "g"), fqcn);
}

describe("the relinked config", () => {
  test("MMKV's and quick-crypto's packages become stand-ins that register their library, and Nitro's package is gated", () => {
    const result = deferNitroLibraries(config());
    expect(packageListInstance(androidOf(result, "react-native-mmkv"))).toBe('new expo.modules.sveltecore.DeferredNitroPackage("NitroMmkv")');
    expect(packageListInstance(androidOf(result, "react-native-quick-crypto"))).toBe('new expo.modules.sveltecore.DeferredNitroPackage("QuickCrypto")');
    expect(packageListInstance(androidOf(result, "react-native-nitro-modules"))).toBe("new expo.modules.sveltecore.NitroGate(new com.margelo.nitro.NitroModulesPackage())");
    // The library names are the ones the packages load (`System.loadLibrary` in their static initializers).
    expect(Object.fromEntries(Object.entries(deferredNitroPackages).map(([name, linked]) => [name, linked.library]))).toEqual({ "react-native-mmkv": "NitroMmkv", "react-native-quick-crypto": "QuickCrypto" });
  });

  test("everything else is kept: the other fields of the relinked packages, the other packages, the rest of the config", () => {
    const before = config();
    const result = deferNitroLibraries(before);
    const withoutLinks = (platform: Platform) => Object.fromEntries(Object.entries(platform).filter(([key]) => key !== "packageImportPath" && key !== "packageInstance"));
    for (const name of ["react-native-mmkv", "react-native-quick-crypto", "react-native-nitro-modules"]) expect(withoutLinks(androidOf(result, name))).toEqual(withoutLinks(androidOf(before, name)));
    expect(result.dependencies?.["react-native-quick-base64"]).toEqual(before.dependencies?.["react-native-quick-base64"]);
    expect({ ...result, dependencies: undefined }).toEqual({ ...before, dependencies: undefined });
    // The input is not changed.
    expect(before).toEqual(config());
  });

  test("a package the app links its own way is left alone, and the others are still deferred", () => {
    const own = config();
    androidOf(own, "react-native-mmkv").packageInstance = "new NitroMmkvPackage(BuildConfig.DEBUG)";
    const result = deferNitroLibraries(own);
    expect(androidOf(result, "react-native-mmkv").packageInstance).toBe("new NitroMmkvPackage(BuildConfig.DEBUG)");
    expect(androidOf(result, "react-native-quick-crypto").packageInstance).toBe('new DeferredNitroPackage("QuickCrypto")');
    expect(androidOf(result, "react-native-nitro-modules").packageInstance).toStartWith("new NitroGate(");
  });

  test("nothing changes without Nitro's own package as expected (no gate, no deferral), or without a package to defer", () => {
    const noNitro = config();
    delete noNitro.dependencies!["react-native-nitro-modules"];
    expect(deferNitroLibraries(noNitro)).toEqual(noNitro);
    const ownNitro = config();
    androidOf(ownNitro, "react-native-nitro-modules").packageImportPath = "import com.example.MyNitroPackage;";
    expect(deferNitroLibraries(ownNitro)).toEqual(ownNitro);
    const unlinkedNitro = config();
    unlinkedNitro.dependencies!["react-native-nitro-modules"]!.platforms!.android = null;
    expect(deferNitroLibraries(unlinkedNitro)).toEqual(unlinkedNitro);
    const nothingToDefer = config();
    delete nothingToDefer.dependencies!["react-native-mmkv"];
    delete nothingToDefer.dependencies!["react-native-quick-crypto"];
    expect(deferNitroLibraries(nothingToDefer)).toEqual(nothingToDefer);
    expect(deferNitroLibraries({})).toEqual({});
  });

  test("only the deferred packages and Nitro's are relinked", () => {
    expect(relinkedPackage("react-native-quick-base64")).toBeUndefined();
    expect(relinkedPackage(nitroPackage.name)?.packageImportPath).toBe("import expo.modules.sveltecore.NitroGate;");
  });
});

describe("the command", () => {
  const node = Bun.which("node");
  const cli = resolve(import.meta.dirname, "../../src/cli.ts");
  const run = (...command: string[]) => Bun.spawnSync([node!, cli, "android-autolinking", ...command], { cwd: import.meta.dirname });

  test.skipIf(!node)("prints the config command's JSON with the packages relinked, whole (a pipe takes it in pieces)", () => {
    // A config a few megabytes long: the output must not stop at the pipe's buffer.
    const length = 3 * 1024 * 1024;
    const result = run(node!, "-e", `process.stdout.write(JSON.stringify({ ...${JSON.stringify(config())}, padding: "x".repeat(${length}) }))`);
    expect(result.exitCode).toBe(0);
    const printed = JSON.parse(result.stdout.toString()) as AutolinkingConfig & { padding: string };
    expect(printed.padding.length).toBe(length);
    expect(androidOf(printed, "react-native-mmkv").packageInstance).toBe('new DeferredNitroPackage("NitroMmkv")');
  });

  test.skipIf(!node)("a command that fails keeps its status and its error; output that is not JSON goes out as it came", () => {
    const failed = run(node!, "-e", "console.error('no config'); process.exit(3)");
    expect(failed.exitCode).toBe(3);
    expect(failed.stderr.toString()).toContain("no config");
    const text = run(node!, "-e", "process.stdout.write('not json')");
    expect([text.exitCode, text.stdout.toString()]).toEqual([0, "not json"]);
    const missing = run();
    expect(missing.exitCode).toBe(2);
  });
});

describe("the installed packages are what the rewrite assumes (a version bump that changes one fails here)", () => {
  /** A package's directory, from the package's own node_modules or a parent's (the repository installs them hoisted). */
  function packageDirectory(name: string): string | undefined {
    for (let directory = resolve(import.meta.dirname, "../.."); ; directory = resolve(directory, "..")) {
      const candidate = resolve(directory, "node_modules", name);
      if (existsSync(resolve(candidate, "package.json"))) return candidate;
      if (resolve(directory, "..") === directory) return undefined;
    }
  }
  const read = (name: string, path: string) => readFileSync(resolve(packageDirectory(name)!, path), "utf8");
  const installed = ["react-native-mmkv", "react-native-quick-crypto", "react-native-nitro-modules"].every((name) => packageDirectory(name) !== undefined);

  test.skipIf(!installed)("MMKV's and quick-crypto's packages make no module and only load their library, under the name the stand-in loads", () => {
    const mmkv = read("react-native-mmkv", "android/src/main/java/com/margelo/nitro/mmkv/NitroMmkvPackage.java");
    expect(mmkv).toContain("static {\n    NitroMmkvOnLoad.initializeNative();\n  }");
    expect(read("react-native-mmkv", "nitrogen/generated/android/kotlin/com/margelo/nitro/mmkv/NitroMmkvOnLoad.kt")).toContain(`System.loadLibrary("${deferredNitroPackages["react-native-mmkv"]!.library}")`);
    const crypto = read("react-native-quick-crypto", "android/src/main/java/com/margelo/nitro/quickcrypto/QuickCryptoPackage.java");
    expect(crypto).toContain(`private static final String TAG = "${deferredNitroPackages["react-native-quick-crypto"]!.library}";`);
    expect(crypto).toContain("System.loadLibrary(TAG);");
    for (const source of [mmkv, crypto]) {
      expect(source).toMatch(/public NativeModule getModule\(String name, ReactApplicationContext reactContext\) \{\s*return null;\s*\}/);
      expect(source).toMatch(/return \(\) -> \{\s*return new HashMap<>\(\);\s*\};/);
      // Nothing else: no view managers, no other override.
      expect(source.match(/@Override/g)).toHaveLength(2);
    }
  });

  test.skipIf(!installed)("Nitro's package is one TurboModule, NitroModules, made by getModule, and nothing else", () => {
    const nitro = read("react-native-nitro-modules", "android/src/main/java/com/margelo/nitro/NitroModulesPackage.kt");
    expect(nitro).toContain("class NitroModulesPackage : BaseReactPackage()");
    expect(nitro.match(/override fun (\w+)/g)).toEqual(["override fun getModule", "override fun getReactModuleInfoProvider"]);
    expect(read("react-native-nitro-modules", "android/src/main/java/com/margelo/nitro/NitroModules.kt")).toContain('const val NAME = "NitroModules"');
    // JavaScript reaches Nitro through that TurboModule only.
    expect(read("react-native-nitro-modules", "src/turbomodule/NativeNitroModules.ts")).toContain("TurboModuleRegistry.getEnforcing<Spec>('NitroModules')");
  });
});

test.skipIf(!Bun.which("node"))("the shipped CLI (dist/node/cli.js, what settings.gradle runs) relinks too", () => {
  const cli = resolve(import.meta.dirname, "../../dist/node/cli.js");
  const result = Bun.spawnSync([Bun.which("node")!, cli, "android-autolinking", Bun.which("node")!, "-e", `process.stdout.write(JSON.stringify(${JSON.stringify(config())}))`]);
  expect(result.exitCode).toBe(0);
  expect(androidOf(JSON.parse(result.stdout.toString()) as AutolinkingConfig, "react-native-quick-crypto").packageInstance).toBe('new DeferredNitroPackage("QuickCrypto")');
});
