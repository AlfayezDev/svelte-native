import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { adapterLoadsRegistryLazily, lazyRegistry, moduleRegistryPath, strings } from "../../src/doctor/shapes.ts";
import { patchVersion } from "../support/versions.ts";

// The lazy module registry in patches/expo-modules-core@<version>.patch (of the package) names every module it defers, because the name lives
// in `definition()`, which must not run at startup. A rename in an Expo upgrade would otherwise show up as a crash at the
// first JavaScript access, so the lists are checked against the module sources here. The lists are read from the patch by
// `src/doctor/shapes.ts`, which `expo-svelte doctor` also uses to tell whether an app's installed package carries the patch.
const root = join(import.meta.dirname, "../../../..");
const patch = readFileSync(join(root, `packages/expo-svelte/patches/expo-modules-core@${patchVersion("expo-modules-core")}.patch`), "utf8");
const installedPackage = join(root, "node_modules/expo-modules-core");
const installed = join(installedPackage, moduleRegistryPath);

const { lazyEntries, prewarm, startup, definitionOnly } = lazyRegistry(patch);
// Registered through `registerLazily` in `AppContext`, not through the modules provider.
const coreModules: Record<string, string> = { NativeModulesProxy: "NativeModulesProxyModuleName", ExpoModulesCoreJSLogger: "JSLoggerModuleName" };

// The Expo modules the package carries (`vendor/`: expo-image, expo-blur, ...) are looked in beside the installed ones.
const packageDirectories = [join(root, "node_modules"), join(root, "apps/qa/modules"), join(root, "packages/expo-svelte/native"), join(root, "packages/expo-svelte/vendor")].flatMap((base) => readdirSync(base).map((entry) => join(base, entry)));

/** Kotlin source of a module class, looked up in the Expo packages and in the app's local modules. */
function sourceOf(className: string): string | undefined {
  const file = `${className.replaceAll(".", "/")}.kt`;
  for (const directory of packageDirectories) {
    const candidate = join(directory, "android/src/main/java", file);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  return undefined;
}

/** `Name("x")`, or `Name(constant)` with `const val constant = "x"` in the same file. */
const declaresName = (source: string, name: string) => source.includes(`Name("${name}")`) || new RegExp(`const val \\w+ = "${name}"`).test(source);

describe("lazy Expo module registry", () => {
  test("the patch lists modules", () => {
    expect(lazyEntries.length).toBeGreaterThan(10);
    expect(prewarm.length).toBeGreaterThan(5);
  });

  // Modules with views that are registered lazily anyway: the engine builds the module and registers its Fabric components when the
  // first component of it is mounted (`ExpoViews.kt`, SPEC.md "Foreign views"), and its foreground and background hooks only
  // act on transitions after the module exists. The intent hooks, which a late registration would miss for good, stay forbidden.
  const viewsOnDemand = new Set(["ExpoVideo", "ExpoBlur", "ConicGradient", "ExpoImage", "ExpoLinearGradient"]);

  for (const [className, name] of lazyEntries) {
    test(`${name} is the name ${className.split(".").pop()} declares and it needs no foreground, view or intent hooks`, () => {
      const source = sourceOf(className);
      expect(source, `${className} sources not found under node_modules, apps/qa/modules, packages/expo-svelte/native or packages/expo-svelte/vendor`).toBeDefined();
      expect(declaresName(source ?? "", name), `${className} does not declare the name ${name}`).toBe(true);
      const hooks = viewsOnDemand.has(name) ? /\b(OnNewIntent|OnUserLeavesActivity)\b/m : /\b(OnActivityEntersForeground|OnActivityEntersBackground|OnNewIntent|OnUserLeavesActivity|ViewManager)\b|^\s*View\(/m;
      expect(hooks.test(source ?? ""), `${className} defines hooks that a late registration would miss`).toBe(false);
    });
  }

  test("the modules with views served on demand are the ones the engine's ExpoViews builds", () => {
    const views = readFileSync(join(root, "packages/expo-svelte/native/svelte-core/android/src/main/java/expo/modules/svelteengine/ExpoViews.kt"), "utf8");
    expect(views).toContain("class ExpoViews(");
    for (const name of viewsOnDemand) expect(lazyEntries.map(([, lazyName]) => lazyName)).toContain(name);
    // The engine builds views only for those modules: Expo exports the views of every module that is not lazy when the host starts, so
    // `prepare` leaves those alone.
    expect(strings(/ON_DEMAND_MODULES = setOf\(([^)]*)\)/.exec(views)?.[1] ?? "").sort()).toEqual([...viewsOnDemand].sort());
  });

  test("the lookup of a view's module searches the built modules before it builds the pending ones", () => {
    // `getModuleHolder(viewClass)` used to build every pending module first: the first view event paid for about twenty module definitions on its thread.
    const lookup = /fun <T : View> getModuleHolder\(viewClass: Class<T>\): ModuleHolder<\*>\? \{([\s\S]*?)\n {2}\}/.exec(readFileSync(installed, "utf8"))?.[1] ?? "";
    expect(lookup).toContain("materializeAllPending()");
    expect(lookup.indexOf("viewHolder(viewClass)")).toBeGreaterThanOrEqual(0);
    expect(lookup.indexOf("viewHolder(viewClass)")).toBeLessThan(lookup.indexOf("materializeAllPending()"));
    expect(lookup).toContain("return null");
  });

  test("core modules registered lazily keep their names", () => {
    const sources = join(root, "node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/defaultmodules");
    const constants = readFileSync(join(sources, "NativeModulesProxyModule.kt"), "utf8") + readFileSync(join(sources, "JSLoggerModule.kt"), "utf8");
    for (const [name, constant] of Object.entries(coreModules)) expect(constants).toContain(`${constant} = "${name}"`);
  });

  test("every prewarmed and startup module is known by name", () => {
    const known = new Set([...lazyEntries.map(([, name]) => name), ...Object.keys(coreModules)]);
    for (const name of [...prewarm, ...startup]) expect(known.has(name), name).toBe(true);
    for (const name of definitionOnly) expect(prewarm).toContain(name);
    expect(new Set(prewarm).size).toBe(prewarm.length);
  });

  test("the modules the host and the app touch at boot are lazy and prewarmed", () => {
    // `SvelteUpdates` is read by `updates/launch.ts` when the host loads, the others by the app and the engine before the first commit.
    // (`ExpoApplication` and `ExpoCrypto` are Expo Modules API 2.0 modules since SDK 58, which Expo installs on its own runtime: they are not in this registry.)
    const atBoot = ["ExpoSecureStore", "ExponentConstants", "ExpoSplashScreen", "SvelteEngine", "SvelteUpdates"];
    for (const name of atBoot) {
      expect(lazyEntries.some(([, lazyName]) => lazyName === name), `${name} is not lazy`).toBe(true);
      expect(prewarm, `${name} is not prewarmed`).toContain(name);
    }
  });

  test("the modules left out are the ones Expo moved to its second module API, which this registry does not hold", () => {
    for (const [name, className] of [["ExpoApplication", "expo.modules.application.ApplicationModule"], ["ExpoCrypto", "expo.modules.crypto.CryptoModule"]] as const) {
      const source = sourceOf(className);
      expect(source, `${className} sources not found`).toBeDefined();
      expect(source).toContain(`@ExpoModule("${name}")`);
      expect(lazyEntries.some(([listed]) => listed === className), `${className} is listed but is not in the registry`).toBe(false);
    }
  });

  test("the native view adapter loads the component registry on its first view, not at import", () => {
    // The registry evaluates `getNativeComponentAttributes` and `UIManager`; the host needs neither before the first screen.
    const adapter = readFileSync(join(installedPackage, "src/NativeViewManagerAdapter.native.tsx"), "utf8");
    expect(adapterLoadsRegistryLazily(adapter)).toBe(true);
  });
});
