/**
 * `svelte-native android-autolinking <command...>`: runs React Native's autolinking config command (the one `settings.gradle` gives
 * `autolinkLibrariesFromCommand`, Expo's `react-native-config`) and prints its JSON with the Nitro modules' packages relinked, so that their
 * native libraries load after the start instead of during it. The app's `settings.gradle` runs it (`applyHeadlessSettings` in `expo.ts`
 * writes the command); it is not a command for people.
 *
 * Each package below exists only to load its module's library, from a static initializer, which `PackageList` runs on the main thread while the
 * host is being built (7 ms of a cold start on the Galaxy A16). Linked instead: `DeferredNitroPackage`, which registers the library, and around
 * Nitro's own package `NitroGate`, which loads what is registered before Nitro is installed in JavaScript (`DeferredLibraries.kt`, svelte-core).
 * A package the app links its own way (a `packageInstance` or `packageImportPath` of its own) is left alone, and so is everything when Nitro's
 * package is not the one expected: without the gate, a deferred library could be missing when JavaScript asks for its module.
 */
import { spawnSync } from "node:child_process";

type AndroidDependency = { packageImportPath?: string | null; packageInstance?: string | null; [key: string]: unknown };
type Dependency = { platforms?: { android?: AndroidDependency | null; [platform: string]: unknown }; [key: string]: unknown };
export type AutolinkingConfig = { dependencies?: Record<string, Dependency>; [key: string]: unknown };

type Linked = { packageImportPath: string; packageInstance: string };

const core = "expo.modules.sveltecore";

/** The packages that load a native library and nothing else, as autolinking links them, and the library each one loads. */
export const deferredNitroPackages: Readonly<Record<string, Linked & { library: string }>> = {
  "react-native-mmkv": { packageImportPath: "import com.margelo.nitro.mmkv.NitroMmkvPackage;", packageInstance: "new NitroMmkvPackage()", library: "NitroMmkv" },
  "react-native-quick-crypto": { packageImportPath: "import com.margelo.nitro.quickcrypto.QuickCryptoPackage;", packageInstance: "new QuickCryptoPackage()", library: "QuickCrypto" },
};

/** Nitro's own package, as autolinking links it. */
export const nitroPackage = { name: "react-native-nitro-modules", packageImportPath: "import com.margelo.nitro.NitroModulesPackage;", packageInstance: "new NitroModulesPackage()" } as const;

/**
 * The relinked packages. React Native's `PackageList` generator puts the full name of the imported class wherever its short name stands in the
 * instance (`\bName\b`), so an instance names the imported class by its short name and every other class in full.
 */
export function relinkedPackage(name: string): Linked | undefined {
  const deferred = deferredNitroPackages[name];
  if (deferred) return { packageImportPath: `import ${core}.DeferredNitroPackage;`, packageInstance: `new DeferredNitroPackage("${deferred.library}")` };
  if (name === nitroPackage.name) return { packageImportPath: `import ${core}.NitroGate;`, packageInstance: "new NitroGate(new com.margelo.nitro.NitroModulesPackage())" };
  return undefined;
}

const linkedAsDefault = (android: AndroidDependency | null | undefined, linked: Linked): android is AndroidDependency =>
  android != null && android.packageImportPath === linked.packageImportPath && android.packageInstance === linked.packageInstance;

/** The config with the deferred packages and Nitro's relinked, when Nitro's package and at least one of them are linked as autolinking links them. */
export function deferNitroLibraries(config: AutolinkingConfig): AutolinkingConfig {
  const dependencies = config.dependencies ?? {};
  if (!linkedAsDefault(dependencies[nitroPackage.name]?.platforms?.android, nitroPackage)) return config;
  const deferred = Object.keys(deferredNitroPackages).filter((name) => linkedAsDefault(dependencies[name]?.platforms?.android, deferredNitroPackages[name]!));
  if (deferred.length === 0) return config;
  const relinked = { ...dependencies };
  for (const name of [...deferred, nitroPackage.name]) {
    const dependency = dependencies[name]!;
    relinked[name] = { ...dependency, platforms: { ...dependency.platforms, android: { ...dependency.platforms!.android, ...relinkedPackage(name) } } };
  }
  return { ...config, dependencies: relinked };
}

/**
 * Runs `command`, and prints what it printed with `deferNitroLibraries` applied; its standard error and its exit status are its own. Output that is
 * not a JSON object is printed as it came (the build then fails on it where it would have).
 */
export function runAndroidAutolinking(command: readonly string[]): number {
  const [program, ...args] = command;
  if (!program) {
    console.error("svelte-native android-autolinking: no command (settings.gradle gives it React Native's config command)");
    return 2;
  }
  const result = spawnSync(program, args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024 });
  if (result.error) {
    console.error(`svelte-native android-autolinking: could not run ${program}: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    return result.status ?? 1;
  }
  let config: unknown;
  try {
    config = JSON.parse(result.stdout);
  } catch {
    process.stdout.write(result.stdout);
    return 0;
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    process.stdout.write(result.stdout);
    return 0;
  }
  process.stdout.write(JSON.stringify(deferNitroLibraries(config as AutolinkingConfig)));
  return 0;
}
