/**
 * The `libraries` option of the config plugin: the optional native view libraries the package carries (`optional-libraries.ts`, `vendor/<name>/`) that an app turns on.
 *
 *     ["@alfayez/svelte-native", { libraries: { "expo-image": true, "react-native-maps": { androidGoogleMapsApiKey: "…" } } }]
 *
 * A listed library is linked on Android and on iOS, bundled by Metro, and its own config plugin (from the copy in `vendor/`) runs with the options given (`true` is none). An unlisted
 * one is none of that: no native code in the build (on iOS not even compiled: App Store Connect scans a binary for the APIs it uses, and react-native-maps references CoreLocation),
 * and Metro resolves its name to a stub that says how to turn it on. The decision is made twice, from the one option: at prebuild the plugin writes the names into the generated
 * `settings.gradle` and `Podfile` (`--link <name>` for React Native's autolinking, search paths for Expo's), and at bundle time Metro reads the same option from the app's config.
 *
 * Loading this file reads nothing and imports no Expo config plugin (`appPluginOptions` and `libraryPlugin` do that when they are called): the doctor, which is bundled into the CLI, and Metro both load it.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { checkPushConfig, pushIsOn } from "./push/config.ts";
import { optionalPackages, vendoredPackage, vendoredRoot, withRequired, type VendoredPackage } from "./vendored.ts";

/** The options of one library: what its own config plugin takes. */
export type LibraryOptions = Record<string, unknown>;

/**
 * `libraries` as the app writes it: the name of an optional library (`expo-image`, `react-native-maps`, ...) to `true`, to `false` (the same as leaving it out, for a config that
 * decides per build) or to the options of the library's own config plugin (`{ androidGoogleMapsApiKey }` for react-native-maps), which the plugin runs from the library's copy.
 */
export type LibrariesOption = Record<string, boolean | LibraryOptions>;

/** A `libraries` the config plugin cannot make sense of: the prebuild stops with the message. */
export class LibrariesConfigError extends Error {
  override name = "LibrariesConfigError";
}

/** The names `libraries` takes. */
export const libraryNames: readonly string[] = optionalPackages.map((vendored) => vendored.name);

/** What `libraries` says once it has been checked. */
export type Libraries = {
  /** The libraries the app named (not `false`), with the options for their plugins (`undefined` for `true`). */
  listed: ReadonlyMap<string, LibraryOptions | undefined>;
  /** Every library that is on: the listed ones and those they need, in the registry's order. */
  enabled: readonly string[];
};

/** The message that tells how to turn a library on: Metro's stub throws it, the wrapper components throw the same (`fabric/foreign-libraries.ts`, which a test keeps equal). */
export const enableMessage = (name: string): string =>
  `${name} is not in this app: turn it on with \`libraries: { "${name}": true }\` in the @alfayez/svelte-native plugin options (app.json or app.config.*), then prebuild and build the app again`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks the `libraries` option of the plugin (`undefined` is none): an object whose keys are optional libraries and whose values are `true`, `false` or the options of the library's own
 * config plugin (a library with no plugin takes no options). Throws a `LibrariesConfigError` that says what to write.
 */
export function checkLibraries(option: unknown): Libraries {
  if (option === undefined || option === null) return { listed: new Map(), enabled: [] };
  if (!isObject(option)) throw new LibrariesConfigError('`libraries` takes an object of library names: `libraries: { "react-native-maps": true }`');
  const listed = new Map<string, LibraryOptions | undefined>();
  for (const [name, value] of Object.entries(option)) {
    const vendored = vendoredPackage(name);
    if (vendored?.optional === undefined) {
      const always = vendored !== undefined ? ` ${name} is in every app: there is nothing to turn on.` : "";
      throw new LibrariesConfigError(`\`libraries\` names "${name}", which is not one of the optional libraries @alfayez/svelte-native carries.${always} The libraries: ${libraryNames.join(", ")}.`);
    }
    if (value === false) continue;
    if (value === true) {
      listed.set(name, undefined);
      continue;
    }
    if (!isObject(value)) throw new LibrariesConfigError(`libraries["${name}"] is \`true\`, \`false\` or the options of ${name}'s config plugin (an object), not ${JSON.stringify(value) ?? String(value)}`);
    if (vendored.optional.plugin === undefined && Object.keys(value).length > 0) {
      throw new LibrariesConfigError(`libraries["${name}"] has options (${Object.keys(value).join(", ")}), and ${name} has no config plugin to give them to: write \`libraries: { "${name}": true }\``);
    }
    listed.set(name, value);
  }
  const wanted = withRequired(listed.keys());
  return { listed, enabled: libraryNames.filter((name) => wanted.includes(name)) };
}

/** How the enabled libraries link: React Native's through the autolinking config, Expo's through Expo's search paths; the Expo modules left out are named for Expo's `exclude`. */
export type LibraryLinks = {
  /** Every library that is on. */
  enabled: readonly string[];
  /** The React Native packages among them: the names `--link` gives the autolinking commands. */
  reactNative: readonly string[];
  /** The Expo modules among them: their directories are Expo's search paths. */
  expo: readonly string[];
  /** The Expo modules that are off: left out of Expo's autolinker by name, so a copy installed for another package's sake is not linked either. */
  expoOff: readonly string[];
};

const kindOf = (name: string): "react-native" | "expo" => vendoredPackage(name)?.optional?.kind ?? "react-native";

export function libraryLinks(enabled: readonly string[]): LibraryLinks {
  const on = new Set(withRequired(enabled));
  const ordered = libraryNames.filter((name) => on.has(name));
  return {
    enabled: ordered,
    reactNative: ordered.filter((name) => kindOf(name) === "react-native"),
    expo: ordered.filter((name) => kindOf(name) === "expo"),
    expoOff: libraryNames.filter((name) => kindOf(name) === "expo" && !on.has(name)),
  };
}

/** The directories of the Expo modules that are on, which Expo's autolinker gets as search paths (a directory with a `package.json` is one module). */
export const expoModuleSearchPaths = (expo: readonly string[], root?: string): string[] => expo.map((name) => vendoredRoot(name, root));

/** The packages whose options a plugin entry of the app's config may carry: the library's plugin under its own name, or under the names Expo resolves to the same file. */
const PLUGIN_NAMES: ReadonlySet<string> = new Set(["@alfayez/svelte-native", "@alfayez/svelte-native/app.plugin", "@alfayez/svelte-native/expo"]);

/** What `appPluginOptions` read: the options the app's config gives the library's plugin, or why they are not known (`unknown`). */
export type PluginOptionsRead = { options: Record<string, unknown> | undefined } | { unknown: string; error?: unknown };

/** An entry of `plugins` that is the library's plugin: one of its names, or a path to the package or its `app.plugin` (`./node_modules/@alfayez/svelte-native/app.plugin.js`). */
function isLibraryPlugin(entry: unknown): boolean {
  if (typeof entry !== "string") return false;
  if (PLUGIN_NAMES.has(entry)) return true;
  const path = entry.replace(/\\/g, "/").replace(/\/$/, "").replace(/\.js$/, "");
  return [...PLUGIN_NAMES].some((name) => path.endsWith(`/node_modules/${name}`));
}

/**
 * The options the app's config gives the library's plugin, read as Expo reads it (`getConfig` from `expo/config`, which runs `app.config.*` and applies its plugins, this library's too:
 * an invalid `libraries` throws there, as in a prebuild). `{ options: undefined }` is a config that lists the plugin without options. `unknown` says why the options are not known: the
 * config could not be read (`error` is what it threw), or no entry of `plugins` is the plugin by a name or a path (a function, say). `from` is where `expo/config` is found: the
 * library's own location by default (its peer `expo`), the app's for the doctor.
 */
export function appPluginOptions(projectRoot: string, from: string = import.meta.url): PluginOptionsRead {
  let plugins: unknown;
  try {
    const { getConfig } = createRequire(from)("expo/config") as typeof import("expo/config");
    plugins = getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp.plugins;
  } catch (error) {
    return { unknown: `could not read the app's config: ${error instanceof Error ? error.message : String(error)}`, error };
  }
  const entry = (Array.isArray(plugins) ? plugins : []).find((plugin: unknown) => isLibraryPlugin(Array.isArray(plugin) ? plugin[0] : plugin));
  if (entry === undefined) return { unknown: "no entry of the app's `plugins` names @alfayez/svelte-native" };
  const options: unknown = Array.isArray(entry) ? entry[1] : undefined;
  return { options: isObject(options) ? options : undefined };
}

/** The platforms `capabilities.push` names in the plugin's options (`undefined` when its push settings are malformed: the prebuild refuses those). */
export function pushPlatformsOf(options: Record<string, unknown> | undefined): { android: boolean; ios: boolean } | undefined {
  const push: unknown = isObject(options?.capabilities) ? (options.capabilities as { push?: unknown }).push : undefined;
  if (!pushIsOn(push)) return { android: false, ios: false };
  const checked = checkPushConfig(push);
  return "config" in checked ? { android: checked.config.android !== undefined, ios: checked.config.ios !== undefined } : undefined;
}

/**
 * The libraries the app's config turns on, for Metro, which reads the config and does not write a build: `undefined` when its `libraries` is malformed (the prebuild refuses that),
 * and then Metro keeps every library, as it keeps the push client: what the build links decides on the device.
 */
export function enabledLibraries(options: Record<string, unknown> | undefined): Libraries | undefined {
  try {
    return checkLibraries(options?.libraries);
  } catch (error) {
    if (error instanceof LibrariesConfigError) return undefined;
    throw error;
  }
}

/**
 * The package's own config plugin of a library, loaded from its copy in `vendor/`: a function `(config, options) => config`, the file's export or its default. `undefined` for a
 * library that has none. The copy resolves `expo/config-plugins` (and `@expo/config-plugins`) from its own place under the library's `node_modules`, where the app's hoisted `expo`
 * is, as the plugin of an installed package would.
 */
export function libraryPlugin(vendored: VendoredPackage, root?: string): ((config: never, options?: never) => unknown) | undefined {
  const file = vendored.optional?.plugin;
  if (file === undefined) return undefined;
  const path = join(vendoredRoot(vendored.name, root), file);
  const loaded: unknown = createRequire(import.meta.url)(path);
  const plugin = typeof loaded === "function" ? loaded : (loaded as { default?: unknown } | null)?.default;
  if (typeof plugin !== "function") throw new LibrariesConfigError(`${path} is the config plugin of ${vendored.name} and exports no function`);
  return plugin as (config: never, options?: never) => unknown;
}
