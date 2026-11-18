/**
 * `svelte-native android-autolinking <command...>` and `svelte-native ios-autolinking <command...>`: run React Native's autolinking config command (the one `settings.gradle` gives
 * `autolinkLibrariesFromCommand` and the Podfile gives `use_native_modules!`, Expo's `react-native-config`) and print its JSON with the packages the library carries linked from
 * its own `vendor/` directory (`vendored.ts`, VENDORING.md), so the app's package.json lists none of them; on Android, with the Nitro modules' packages relinked, so that their
 * native libraries load after the start instead of during it. The app's `settings.gradle` and Podfile run them (`applyHeadlessSettings` and `applyPodfileVendoredLinking` in
 * `expo.ts` write the commands); they are not commands for people.
 *
 * The optional libraries (`libraries.ts`) are linked only when named: `--link <name>` before the command, once per library, which the plugin writes from the app's `libraries`
 * option. A library that is not named is taken out of the config if autolinking found an original of it.
 *
 * Each package below exists only to load its module's library, from a static initializer, which `PackageList` runs on the main thread while the
 * host is being built (7 ms of a cold start on the Galaxy A16). Linked instead: `DeferredNitroPackage`, which registers the library, and around
 * Nitro's own package `NitroGate`, which loads what is registered before Nitro is installed in JavaScript (`DeferredLibraries.kt`, svelte-core).
 * A package the app links its own way (a `packageInstance` or `packageImportPath` of its own) is left alone, and so is everything when Nitro's
 * package is not the one expected: without the gate, a deferred library could be missing when JavaScript asks for its module.
 */
import { spawnSync } from "node:child_process";
import { linkVendored, VendoredCollision, type LinkPlatform } from "./vendored.ts";

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

/** The `--link <name>` pairs in front of the config command (the optional libraries that are on), and the command that follows them. */
export function splitLinks(argv: readonly string[]): { link: string[]; command: string[] } {
  const link: string[] = [];
  let index = 0;
  while (argv[index] === "--link" && argv[index + 1] !== undefined) {
    link.push(argv[index + 1] as string);
    index += 2;
  }
  return { link, command: argv.slice(index) };
}

/**
 * Runs `command`, and prints what it printed with the vendored packages linked and `transform` applied; its standard error and its exit status are its own. Output that is
 * not a JSON object is printed as it came (the build then fails on it where it would have). An app that declares a vendored package itself is refused (`VendoredCollision`).
 */
function runAutolinking(name: string, platform: LinkPlatform, given: readonly string[], transform: (config: AutolinkingConfig) => AutolinkingConfig): number {
  const { link, command } = splitLinks(given);
  const [program, ...args] = command;
  if (!program) {
    console.error(`svelte-native ${name}: no command (${platform === "android" ? "settings.gradle" : "the Podfile"} gives it React Native's config command)`);
    return 2;
  }
  const result = spawnSync(program, args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024 });
  if (result.error) {
    console.error(`svelte-native ${name}: could not run ${program}: ${result.error.message}`);
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
  try {
    process.stdout.write(JSON.stringify(transform(linkVendored(config as AutolinkingConfig, platform, undefined, link))));
  } catch (error) {
    if (!(error instanceof VendoredCollision)) throw error;
    console.error(`svelte-native ${name}: ${error.message}`);
    return 1;
  }
  return 0;
}

/** `svelte-native android-autolinking`: the config with the vendored packages linked and the Nitro libraries deferred. */
export const runAndroidAutolinking = (command: readonly string[]): number => runAutolinking("android-autolinking", "android", command, deferNitroLibraries);

/** `svelte-native ios-autolinking`: the config with the vendored packages linked. */
export const runIosAutolinking = (command: readonly string[]): number => runAutolinking("ios-autolinking", "ios", command, (config) => config);
