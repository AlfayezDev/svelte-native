import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applyHeadlessApplication, headlessExcludedPackages } from "../src/expo.ts";

// The Kotlin and Swift modules and the TypeScript client share a contract that no compiler checks across languages:
// the module name, its constants and functions, and how each platform finds its launch hook. These tests pin it.
const app = resolve(import.meta.dirname, "../../../apps/qa");
const module = resolve(import.meta.dirname, "../native/svelte-core");
const read = (path: string) => readFileSync(join(module, path), "utf8");
const kotlin = (file: string) => read(`android/src/main/java/expo/modules/svelteupdates/${file}`);
const names = (source: string, kind: "Constant" | "AsyncFunction") => [...source.matchAll(new RegExp(`${kind}\\("(\\w+)"\\)`, "g"))].map((match) => match[1] ?? "").sort();

const nativeType = readFileSync(resolve(import.meta.dirname, "../src/updates/native.ts"), "utf8").split("export type SvelteUpdatesNative = {")[1]?.split("\n};")[0] ?? "";
const typeScriptConstants = [...nativeType.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1] ?? "").sort();
const typeScriptFunctions = [...nativeType.matchAll(/^ {2}(\w+)\(/gm)].map((match) => match[1] ?? "").sort();

describe("native module contract", () => {
  test("the TypeScript declaration is not empty", () => {
    expect(typeScriptConstants.length).toBeGreaterThan(5);
    expect(typeScriptFunctions).toContain("downloadAsset");
  });
  test("Android and iOS expose the constants and functions the client declares", () => {
    const swift = read("ios/updates/SvelteUpdatesModule.swift");
    const android = kotlin("SvelteUpdatesModule.kt");
    expect(names(android, "Constant")).toEqual(typeScriptConstants);
    expect(names(swift, "Constant")).toEqual(typeScriptConstants);
    expect(names(android, "AsyncFunction")).toEqual(typeScriptFunctions);
    expect(names(swift, "AsyncFunction")).toEqual(typeScriptFunctions);
    expect(android).toContain('Name("SvelteUpdates")');
    expect(swift).toContain('Name("SvelteUpdates")');
  });
  test("both platforms read and write the same store layout", () => {
    for (const source of [kotlin("UpdateStore.kt"), read("ios/updates/UpdateStore.swift")]) {
      for (const field of ["clientId", "buildTime", "embeddedCreatedAt", "pending", "failedIds", "serverDefinedHeaders", "manifestFilters", "updates"]) expect(source).toContain(`"${field}"`);
    }
    expect(kotlin("UpdateStore.kt")).toContain('"index.android.bundle"');
    expect(read("ios/updates/UpdateStore.swift")).toContain('"main.jsbundle"');
  });
  test("both platforms sync a download before it gets its name, and trust an asset in place only after it hashes to the manifest's", () => {
    const android = kotlin("Http.kt");
    const swift = read("ios/updates/Http.swift");
    // The Kotlin side is run by `updates-store-native.test.ts`; the Swift side is compiled only on the Mac, so its order is pinned here.
    expect(android.indexOf("fd.sync()")).toBeGreaterThan(-1);
    expect(android.indexOf("fd.sync()")).toBeLessThan(android.indexOf("renameTo"));
    expect(swift.indexOf("synchronize()")).toBeGreaterThan(-1);
    expect(swift.indexOf("synchronize()")).toBeLessThan(swift.indexOf(".moveItem(at: temporary"));
    expect(kotlin("SvelteUpdatesModule.kt")).toContain("Http.ensure(");
    expect(read("ios/updates/SvelteUpdatesModule.swift")).toContain("Http.ensure(");
    expect(kotlin("SvelteUpdatesModule.kt")).not.toContain("Http.sha256(");
    expect(read("ios/updates/SvelteUpdatesModule.swift")).not.toContain("Http.sha256(");
  });
  test("the config keys are the ones Expo's config plugin writes", () => {
    const keys = ["ENABLED", "EXPO_UPDATE_URL", "EXPO_RUNTIME_VERSION", "UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY", "EXPO_UPDATES_CHECK_ON_LAUNCH", "EXPO_UPDATES_LAUNCH_WAIT_MS", "HAS_EMBEDDED_UPDATE"];
    const android = kotlin("UpdatesConfig.kt");
    for (const key of keys) expect(android).toContain(`"${key}"`);
    const ios = read("ios/updates/UpdatesConfig.swift");
    for (const key of ["EXUpdatesEnabled", "EXUpdatesURL", "EXUpdatesRuntimeVersion", "EXUpdatesRequestHeaders", "EXUpdatesCheckOnLaunch", "EXUpdatesLaunchWaitMs", "EXUpdatesHasEmbeddedUpdate"]) expect(ios).toContain(`"${key}"`);
  });
});

describe("launch hooks", () => {
  test("the package's module config registers the module and the iOS bundle handler", () => {
    const config = JSON.parse(readFileSync(join(module, "../../expo-module.config.json"), "utf8")) as { android: { projects: { name: string; path: string; modules: string[] }[] }; apple: { podspecPath: string[]; modules: string[]; reactDelegateHandlers: string[] } };
    expect(config.android.projects.find((project) => project.name === "svelte-core")?.path).toBe("native/svelte-core/android");
    expect(config.android.projects.find((project) => project.name === "svelte-core")?.modules).toContain("expo.modules.svelteupdates.SvelteUpdatesModule");
    expect(config.apple.podspecPath).toContain("native/svelte-core/ios/SvelteCore.podspec");
    expect(config.apple.modules).toContain("SvelteUpdatesModule");
    expect(config.apple.reactDelegateHandlers).toEqual(["SvelteUpdatesReactDelegateHandler"]);
    expect(read("ios/updates/Launch.swift")).toContain("public final class SvelteUpdatesReactDelegateHandler: ExpoReactDelegateHandler");
  });
  test("Expo autolinking finds the Android bundle handler: a *Package file that imports expo.modules.core.interfaces.Package", () => {
    const source = kotlin("SvelteUpdatesPackage.kt");
    // The same two checks `expo-modules-autolinking` makes before it adds a class to `ExpoModulesPackageList`.
    expect(source).toMatch(/\bimport\s+expo\.modules\.core\.(interfaces\.Package|BasePackage)\b/);
    expect(source).toMatch(/^package expo\.modules\.svelteupdates$/m);
    expect(source).toContain("class SvelteUpdatesPackage : Package");
    expect(source).toContain("override fun getJSBundleFile(useDeveloperSupport: Boolean)");
  });
  test("the bundle handler only works if the generated MainApplication builds its host through ExpoReactHostFactory", () => {
    const application = `class MainApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // add(MyReactNativePackage())
        }
    )
  }
  override fun onCreate() {
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}
`;
    expect(applyHeadlessApplication(application)).toContain("ExpoReactHostFactory.getDefaultReactHost(");
  });
  test("the module stays autolinked: it is not on the headless exclusion list", () => {
    // `expo-updates` itself is excluded on purpose: it is a devDependency only so that `eas update` runs; the engine ships its own module.
    expect(headlessExcludedPackages.filter((name) => /svelte-updates|updates/.test(name))).toEqual(["expo-updates", "expo-updates-interface"]);
    expect(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).expo.autolinking.exclude).not.toContain("svelte-updates");
  });
});

describe("build configuration", () => {
  // The config reads the channel when it is evaluated, so each case evaluates it in its own process.
  const load = (channel: string | undefined) => {
    const env = { ...process.env };
    delete env.UPDATES_CHANNEL;
    if (channel !== undefined) env.UPDATES_CHANNEL = channel;
    const evaluated = Bun.spawnSync([process.execPath, "-e", `import(${JSON.stringify(pathToFileURL(join(app, "app.config.ts")).href)}).then((module) => console.log(JSON.stringify(module.default)))`], { env });
    return JSON.parse(evaluated.stdout.toString()) as { runtimeVersion: unknown; updates: Record<string, unknown> };
  };
  test("app.config points at the project's EAS Update URL with an app-version runtime policy", () => {
    const config = load("production");
    expect(config.runtimeVersion).toEqual({ policy: "appVersion" });
    expect(config.updates).toEqual({
      url: "https://u.expo.dev/bb048172-896f-48f1-97c0-c9ec765842c0",
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
      requestHeaders: { "expo-channel-name": "production" },
    });
  });
  test("a build without a channel (a local build, or `eas update` reading the config) sends no channel and does not check", () => {
    const config = load(undefined);
    expect(config.updates.url).toBe("https://u.expo.dev/bb048172-896f-48f1-97c0-c9ec765842c0");
    expect(config.updates.checkAutomatically).toBe("NEVER");
    expect(config.updates.requestHeaders).toBeUndefined();
  });
  test("each store-bound profile has a channel, and the config reads the same one", () => {
    const eas = JSON.parse(readFileSync(join(app, "eas.json"), "utf8")) as { build: Record<string, { channel?: string; env?: Record<string, string> }> };
    for (const profile of ["preview", "production"]) {
      expect(eas.build[profile]?.channel).toBe(profile);
      expect(eas.build[profile]?.env?.UPDATES_CHANNEL).toBe(profile);
    }
    expect(eas.build.development?.channel).toBeUndefined();
  });
});
