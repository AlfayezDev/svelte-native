/** Why the app uses the location: the text iOS shows when it asks (`NSLocationWhenInUseUsageDescription`), or that and the reason for the background too. */
export type LocationCapability = string | {
    /** While the app is in use: `NSLocationWhenInUseUsageDescription`. */
    whenInUse: string;
    /**
     * In the background as well (`NSLocationAlwaysAndWhenInUseUsageDescription`, iOS's `location` background mode, Android's `ACCESS_BACKGROUND_LOCATION` and
     * its foreground service): for expo-location's own background APIs (`startLocationUpdatesAsync`, geofencing). `navigator.geolocation` needs only `whenInUse`.
     */
    background?: string;
};
export type Capabilities = {
    location?: LocationCapability;
};
export declare class CapabilityConfigError extends Error {
    name: string;
}
/** The props of expo-location's config plugin a location capability makes: its texts, and nothing of the background unless it is asked for. */
export declare function locationPluginProps(location: LocationCapability): Record<string, string | boolean>;
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
export declare function withCapabilities<Config extends {
    _internal?: Record<string, unknown>;
    plugins?: unknown[];
}>(config: Config, capabilities: Capabilities | undefined, options?: CapabilityOptions): Config;
export {};
