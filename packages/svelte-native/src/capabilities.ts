/**
 * The capabilities an app turns on in the config plugin (`capabilities: { location }`): the web APIs that need a permission of the system, and with it a native
 * library and a purpose text. A capability is off until the config says why the app uses it, and the plugin refuses the two half-made states, each of which an
 * app would only find out about on a device or in review:
 *
 * - on, without its library installed: the build would have no native module, and the API would read as `undefined`;
 * - its library installed, but off: Expo would apply the library's own plugin with its default text ("Allow $(PRODUCT_NAME) to …"), which says nothing of why,
 *   and App Review rejects that. A library that is linked is in the binary, and Apple and Google ask about the permissions it declares whether or not it is called.
 *
 * An app that lists the library's own plugin in `plugins` (with its texts) has configured it there, and one that leaves the library out of autolinking
 * (`autolinkingExclude`) does not link it: neither needs the capability.
 *
 * `location` is expo-location: `navigator.geolocation` and `navigator.permissions` use its native module (`geolocation.ts`).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

/** Why the app uses the location: the text iOS shows when it asks (`NSLocationWhenInUseUsageDescription`), or that and the reason for the background too. */
export type LocationCapability =
  | string
  | {
      /** While the app is in use: `NSLocationWhenInUseUsageDescription`. */
      whenInUse: string;
      /**
       * In the background as well (`NSLocationAlwaysAndWhenInUseUsageDescription`, iOS's `location` background mode, Android's `ACCESS_BACKGROUND_LOCATION` and
       * its foreground service): for expo-location's own background APIs (`startLocationUpdatesAsync`, geofencing). `navigator.geolocation` needs only `whenInUse`.
       */
      background?: string;
    };

export type Capabilities = { location?: LocationCapability };

export class CapabilityConfigError extends Error {
  override name = "CapabilityConfigError";
}

/** The props of expo-location's config plugin a location capability makes: its texts, and nothing of the background unless it is asked for. */
export function locationPluginProps(location: LocationCapability): Record<string, string | boolean> {
  const { whenInUse, background } = typeof location === "string" ? { whenInUse: location, background: undefined } : location;
  if (typeof whenInUse !== "string" || whenInUse.trim() === "")
    throw new CapabilityConfigError("capabilities.location needs the reason the app uses the location, as the user will read it: `capabilities: { location: \"Shows the stores near you.\" }`");
  if (background !== undefined && (typeof background !== "string" || background.trim() === ""))
    throw new CapabilityConfigError("capabilities.location.background needs the reason the app uses the location in the background, as the user will read it");
  return {
    locationWhenInUsePermission: whenInUse,
    locationAlwaysAndWhenInUsePermission: background ?? false,
    locationAlwaysPermission: background ?? false,
    isIosBackgroundLocationEnabled: background !== undefined,
    isAndroidBackgroundLocationEnabled: background !== undefined,
  };
}

/** The app's own dependencies, by name: what autolinking links. */
function dependenciesOf(projectRoot: string): Set<string> {
  try {
    const manifest = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    return new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
  } catch {
    return new Set();
  }
}

/** Whether the config's `plugins` names the package's plugin, alone (`"expo-location"`) or with its props (`["expo-location", { … }]`). */
function listsPlugin(config: { plugins?: unknown[] }, name: string): boolean {
  return (config.plugins ?? []).some((entry) => (Array.isArray(entry) ? entry[0] : entry) === name);
}

type Plugin<Config> = (config: Config, props: Record<string, string | boolean>) => Config;

type CapabilityOptions = {
  /** The app's directory. Default: the config's, else the working directory. */
  projectRoot?: string;
  /** Finds a library's config plugin from the app (tests pass their own). */
  load?: (request: string) => unknown;
  /** The packages `autolinkingExclude` leaves out of the build: one of them is not linked, so it needs no capability. */
  excluded?: readonly string[];
};

/**
 * Applies the capabilities to the config: each one on gets its library's plugin with its texts. Throws a `CapabilityConfigError` for a capability without its
 * library and for a library without its capability.
 */
export function withCapabilities<Config extends { _internal?: Record<string, unknown>; plugins?: unknown[] }>(config: Config, capabilities: Capabilities | undefined, options: CapabilityOptions = {}): Config {
  const projectRoot = options.projectRoot ?? (config._internal?.projectRoot as string | undefined) ?? process.cwd();
  const load = options.load ?? ((request: string) => createRequire(join(projectRoot, "package.json"))(request));
  const location = capabilities?.location;
  const installed = dependenciesOf(projectRoot).has("expo-location") && !(options.excluded ?? []).includes("expo-location");
  // An app that lists expo-location's own plugin gave its texts there. Both would be two answers to one question, and only one would apply (Expo runs a
  // library's plugin once): the second, silently ignored.
  if (listsPlugin(config, "expo-location")) {
    if (location !== undefined && location !== null)
      throw new CapabilityConfigError("The app config sets capabilities.location and also lists expo-location's own plugin: keep one. capabilities.location gives expo-location its texts; its own plugin entry takes all of its options.");
    return config;
  }
  if (location === undefined || location === null) {
    if (installed)
      throw new CapabilityConfigError(
        "expo-location is installed, but the location capability is off. Say why the app uses the location (the text iOS shows when it asks) in the @alfayez/svelte-native plugin: " +
          "`plugins: [[\"@alfayez/svelte-native\", { capabilities: { location: \"Shows the stores near you.\" } }]]`, or uninstall expo-location.",
      );
    return config;
  }
  const props = locationPluginProps(location);
  let plugin: unknown;
  try {
    plugin = load("expo-location/app.plugin.js");
  } catch {
    throw new CapabilityConfigError("capabilities.location needs expo-location, which is not installed: `npx expo install expo-location`, then prebuild again.");
  }
  const apply = ((plugin as { default?: unknown }).default ?? plugin) as Plugin<Config>;
  if (typeof apply !== "function") throw new CapabilityConfigError("expo-location's config plugin (expo-location/app.plugin.js) is not a function: is the installed expo-location the one this Expo SDK uses?");
  return apply(config, props);
}
