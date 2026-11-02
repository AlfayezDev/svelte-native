import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The lazy module registry in patches/expo-modules-core@57.0.23.patch names every module it defers, because the name lives
// in `definition()`, which must not run at startup. A rename in an Expo upgrade would otherwise show up as a crash at the
// first JavaScript access, so the lists are checked against the module sources here.
const root = join(import.meta.dirname, "../../..");
const patch = readFileSync(join(root, "patches/expo-modules-core@57.0.23.patch"), "utf8");
const installed = join(root, "node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/ModuleRegistry.kt");

/** Lines the patch adds to `ModuleRegistry.kt`, without the diff markers. */
function addedRegistryLines(): string {
  const start = patch.indexOf("diff --git a/android/src/main/java/expo/modules/kotlin/ModuleRegistry.kt");
  const end = patch.indexOf("diff --git", start + 1);
  return patch
    .slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

function block(source: string, header: RegExp): string {
  const match = header.exec(source);
  if (!match) throw new Error(`${header} not found in the registry`);
  const rest = source.slice(match.index + match[0].length);
  return rest.slice(0, rest.search(/^\s*\)\s*$/m));
}

const strings = (text: string) => [...text.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
const registry = addedRegistryLines();
const lazyEntries = [...block(registry, /LAZY_MODULE_NAMES = mapOf\(/).matchAll(/"([\w.]+)" to "(\w+)"/g)].map((match) => [match[1] ?? "", match[2] ?? ""] as const);
const prewarm = strings(block(registry, /PREWARM_MODULE_NAMES = listOf\(/));
const startup = strings(/STARTUP_MODULE_NAMES = listOf\(([^)]*)\)/.exec(registry)?.[1] ?? "");
const definitionOnly = strings(/DEFINITION_ONLY_MODULE_NAMES = setOf\(([^)]*)\)/.exec(registry)?.[1] ?? "");
// Registered through `registerLazily` in `AppContext`, not through the modules provider.
const coreModules: Record<string, string> = { NativeModulesProxy: "NativeModulesProxyModuleName", ExpoModulesCoreJSLogger: "JSLoggerModuleName" };

const packageDirectories = [join(root, "node_modules"), join(root, "apps/platform/modules")].flatMap((base) => readdirSync(base).map((entry) => join(base, entry)));

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
      expect(source, `${className} sources not found under node_modules or apps/platform/modules`).toBeDefined();
      expect(declaresName(source ?? "", name), `${className} does not declare the name ${name}`).toBe(true);
      const hooks = viewsOnDemand.has(name) ? /\b(OnNewIntent|OnUserLeavesActivity)\b/m : /\b(OnActivityEntersForeground|OnActivityEntersBackground|OnNewIntent|OnUserLeavesActivity|ViewManager)\b|^\s*View\(/m;
      expect(hooks.test(source ?? ""), `${className} defines hooks that a late registration would miss`).toBe(false);
    });
  }

  test("the modules with views served on demand are the ones the engine's ExpoViews builds", () => {
    const views = readFileSync(join(root, "apps/platform/modules/svelte-engine/android/src/main/java/expo/modules/svelteengine/ExpoViews.kt"), "utf8");
    expect(views).toContain("class ExpoViews(");
    for (const name of viewsOnDemand) expect(lazyEntries.map(([, lazyName]) => lazyName)).toContain(name);
    // The engine builds views only for those modules: Expo exports the views of every module that is not lazy when the host starts, so
    // `prepare` leaves those alone.
    expect(strings(/ON_DEMAND_MODULES = setOf\(([^)]*)\)/.exec(views)?.[1] ?? "").sort()).toEqual([...viewsOnDemand].sort());
  });

  test("the modules whose views the foreign components mount are built on demand, not at start", () => {
    // `ViewManagerAdapter_ExpoImage`, `_ExpoBlur_*`, `_ExpoLinearGradient`, `_ConicGradient`: the first screen mounts none of them, and
    // building them with the host cost the pool thread that initializes the TurboModules about 25 ms of the start (SPEC, "Boot on the phone", round 2).
    for (const name of ["ExpoImage", "ExpoBlur", "ExpoLinearGradient", "ConicGradient"]) expect(lazyEntries.some(([, lazyName]) => lazyName === name), name).toBe(true);
  });

  test("the lookup of a view's module searches the built modules before it builds the pending ones", () => {
    // `getModuleHolder(viewClass)` used to build every pending module first: the first view event paid for about twenty module definitions on its thread.
    const lookup = /fun <T : View> getModuleHolder\(viewClass: Class<T>\): ModuleHolder<\*>\? \{([\s\S]*?)\n  \}/.exec(readFileSync(installed, "utf8"))?.[1] ?? "";
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
    const atBoot = ["ExpoApplication", "ExpoSecureStore", "ExponentConstants", "ExpoSplashScreen", "SvelteEngine", "SvelteUpdates"];
    for (const name of atBoot) {
      expect(lazyEntries.some(([, lazyName]) => lazyName === name), `${name} is not lazy`).toBe(true);
      expect(prewarm, `${name} is not prewarmed`).toContain(name);
    }
  });

  test("the native view adapter loads the component registry on its first view, not at import", () => {
    // The registry evaluates `getNativeComponentAttributes` and `UIManager`; the host needs neither before the first screen.
    const adapter = readFileSync(join(root, "node_modules/expo-modules-core/src/NativeViewManagerAdapter.native.tsx"), "utf8");
    expect(adapter).not.toMatch(/^import .*NativeComponentRegistry/m);
    expect(adapter).toMatch(/require\('react-native\/Libraries\/NativeComponent\/NativeComponentRegistry'\)/);
  });

  test("the installed package carries the patch", () => {
    // pnpm applies the patch on install; a stale node_modules means `pnpm install` was not run after editing it.
    const text = readFileSync(installed, "utf8");
    for (const [className, name] of lazyEntries) expect(text).toContain(`"${className}" to "${name}"`);
    for (const name of [...prewarm, ...startup]) expect(text).toContain(`"${name}"`);
  });
});
