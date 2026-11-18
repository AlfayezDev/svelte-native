import { type VendoredPackage } from "./vendored.js";
/** The options of one library: what its own config plugin takes. */
export type LibraryOptions = Record<string, unknown>;
/**
 * `libraries` as the app writes it: the name of an optional library (`expo-image`, `react-native-maps`, ...) to `true`, to `false` (the same as leaving it out, for a config that
 * decides per build) or to the options of the library's own config plugin (`{ androidGoogleMapsApiKey }` for react-native-maps), which the plugin runs from the library's copy.
 */
export type LibrariesOption = Record<string, boolean | LibraryOptions>;
/** A `libraries` the config plugin cannot make sense of: the prebuild stops with the message. */
export declare class LibrariesConfigError extends Error {
    name: string;
}
/** The names `libraries` takes. */
export declare const libraryNames: readonly string[];
/** What `libraries` says once it has been checked. */
export type Libraries = {
    /** The libraries the app named (not `false`), with the options for their plugins (`undefined` for `true`). */
    listed: ReadonlyMap<string, LibraryOptions | undefined>;
    /** Every library that is on: the listed ones and those they need, in the registry's order. */
    enabled: readonly string[];
};
/** The message that tells how to turn a library on: Metro's stub throws it, the wrapper components throw the same (`fabric/foreign-libraries.ts`, which a test keeps equal). */
export declare const enableMessage: (name: string) => string;
/**
 * Checks the `libraries` option of the plugin (`undefined` is none): an object whose keys are optional libraries and whose values are `true`, `false` or the options of the library's own
 * config plugin (a library with no plugin takes no options). Throws a `LibrariesConfigError` that says what to write.
 */
export declare function checkLibraries(option: unknown): Libraries;
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
export declare function libraryLinks(enabled: readonly string[]): LibraryLinks;
/** The directories of the Expo modules that are on, which Expo's autolinker gets as search paths (a directory with a `package.json` is one module). */
export declare const expoModuleSearchPaths: (expo: readonly string[], root?: string) => string[];
/** What `appPluginOptions` read: the options the app's config gives the library's plugin, or why they are not known (`unknown`). */
export type PluginOptionsRead = {
    options: Record<string, unknown> | undefined;
} | {
    unknown: string;
    error?: unknown;
};
/**
 * The options the app's config gives the library's plugin, read as Expo reads it (`getConfig` from `expo/config`, which runs `app.config.*` and applies its plugins, this library's too:
 * an invalid `libraries` throws there, as in a prebuild). `{ options: undefined }` is a config that lists the plugin without options. `unknown` says why the options are not known: the
 * config could not be read (`error` is what it threw), or no entry of `plugins` is the plugin by a name or a path (a function, say). `from` is where `expo/config` is found: the
 * library's own location by default (its peer `expo`), the app's for the doctor.
 */
export declare function appPluginOptions(projectRoot: string, from?: string): PluginOptionsRead;
/** The platforms `capabilities.push` names in the plugin's options (`undefined` when its push settings are malformed: the prebuild refuses those). */
export declare function pushPlatformsOf(options: Record<string, unknown> | undefined): {
    android: boolean;
    ios: boolean;
} | undefined;
/**
 * The libraries the app's config turns on, for Metro, which reads the config and does not write a build: `undefined` when its `libraries` is malformed (the prebuild refuses that),
 * and then Metro keeps every library, as it keeps the push client: what the build links decides on the device.
 */
export declare function enabledLibraries(options: Record<string, unknown> | undefined): Libraries | undefined;
/**
 * The package's own config plugin of a library, loaded from its copy in `vendor/`: a function `(config, options) => config`, the file's export or its default. `undefined` for a
 * library that has none. The copy resolves `expo/config-plugins` (and `@expo/config-plugins`) from its own place under the library's `node_modules`, where the app's hoisted `expo`
 * is, as the plugin of an installed package would.
 */
export declare function libraryPlugin(vendored: VendoredPackage, root?: string): ((config: never, options?: never) => unknown) | undefined;
