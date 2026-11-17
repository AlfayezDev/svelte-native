import type { ExpoConfig } from "expo/config";
import { AndroidConfig } from "expo/config-plugins.js";
/** Why the app uses the location: the text iOS shows when it asks (`NSLocationWhenInUseUsageDescription`), or that and the reason for the background too. */
export type LocationCapability = string | {
    /** While the app is in use: `NSLocationWhenInUseUsageDescription`. */
    whenInUse: string;
    /**
     * In the background as well (`NSLocationAlwaysAndWhenInUseUsageDescription`, iOS's `location` background mode, Android's `ACCESS_BACKGROUND_LOCATION` and
     * its foreground service): for expo-location's own background APIs (`startLocationUpdatesAsync`, geofencing). `navigator.geolocation` needs only `whenInUse`.
     */
    background?: string;
    /**
     * Why the app uses the motion activity (`NSMotionUsageDescription`), for expo-location's `getMotionActivityAsync`. iOS links CoreMotion with expo-location, so
     * the key is always written; without this text it is expo-location's default. `navigator.geolocation` never asks for it, so iOS never shows that one.
     */
    motion?: string;
};
/**
 * The identifiers push needs in the build, per platform: a platform is served when it is named. Nothing in it may be a secret (the FCM service account, the
 * APNs `.p8`): those belong to the server (PUSH.md), and the plugin refuses a config that holds one.
 */
export type PushCapability = {
    android?: {
        /** The Firebase project's `google-services.json`, from the app's directory. It needs a client for `android.package`. Expo copies it into the Android project and applies the Google services Gradle plugin. */
        googleServicesFile: string;
        /** A PNG for the notification's small icon (white on a transparent background, as Android draws it), from the app's directory: copied into `res/drawable`, and FCM's default icon. */
        icon?: string;
        /** The accent color of a notification, `#RRGGBB` (also `#RGB`, `#ARGB` and `#AARRGGBB`): FCM's default color. */
        color?: string;
        /** The channel the notifications go to, which the user sees in the app's notification settings (`name`). Default: id `default`, name `Notifications`. */
        channel?: {
            id?: string;
            name: string;
            description?: string;
        };
    };
    ios?: {
        /** The `aps-environment` entitlement: `development` for a build signed for development, `production` for TestFlight and the App Store. The token carries it, and the sender picks the APNs endpoint with it. */
        mode: "development" | "production";
    };
};
/** `false` (or leaving it out) is off. */
export type Capabilities = {
    location?: LocationCapability | false;
    push?: PushCapability | false;
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
 * Applies the capabilities to the config: each one on gets what its library needs (`location`: its library's plugin with the app's texts; `push`: the entries of
 * the platforms' projects). Throws a `CapabilityConfigError` for a capability without its library, for a library without its capability, and for a config that
 * cannot be built as it stands.
 */
export declare function withCapabilities(config: ExpoConfig, capabilities: Capabilities | undefined, options?: CapabilityOptions): ExpoConfig;
/** The native code of push: an Expo module of its own, so that Firebase is in the apps that use push and in no other. */
export declare const pushPackage = "@alfayez/svelte-native-push";
/** Where the notifications go when the app names no channel, and what the user reads in the app's notification settings. */
export declare const defaultPushChannel: {
    readonly id: "default";
    readonly name: "Notifications";
};
/**
 * What the plugin writes into the Android manifest, which is how the native code reads it (PUSH.md): the first three are Firebase's own, read when it shows a
 * notification itself (the app in the background); the channel's id, name and description are the module's, for the channel it creates, and always written
 * (defaults for what the app leaves out). A `<meta-data android:value>` that looks like a number reads back as a number (`Bundle.getString` is then `null`), so
 * the native code reads them with `Bundle.get(name)?.toString()`.
 */
export declare const pushMetaData: {
    readonly icon: "com.google.firebase.messaging.default_notification_icon";
    readonly color: "com.google.firebase.messaging.default_notification_color";
    readonly firebaseChannel: "com.google.firebase.messaging.default_notification_channel_id";
    readonly channelId: "expo.modules.sveltepush.channel_id";
    readonly channelName: "expo.modules.sveltepush.channel_name";
    readonly channelDescription: "expo.modules.sveltepush.channel_description";
};
/** The icon's file in `res/drawable` (without its extension) and the color's name in `res/values/colors.xml`: fixed, so the manifest and the file agree. */
export declare const pushResources: {
    readonly icon: "svelte_push_icon";
    readonly color: "svelte_push_color";
};
/** What `capabilities.push` says once it has been checked. */
export type PushSettings = {
    android?: {
        googleServicesFile: string;
        icon?: string;
        color?: string;
        channel: {
            id: string;
            name: string;
            description?: string;
        };
    };
    ios?: {
        mode: "development" | "production";
    };
};
/**
 * The first server secret in `value`, and where it is (`where` names the value): a service account (an object with `"type": "service_account"`, or any `private_key`
 * in it, or JSON text that has either), a PEM private key, or the path of a `.p8` file (the APNs key). Push needs the identifiers of the app in its build
 * (`google-services.json`, the `aps-environment` mode), and none of these: a key that can send to every user is the server's, never the app's.
 */
export declare function findPushSecret(value: unknown, where: string): {
    where: string;
    what: string;
} | undefined;
/**
 * Checks `capabilities.push` (already known not to be off, and to hold no secret) and returns what it says. Reads the Google services file and the icon, from the
 * app's directory, so that a file that is not there stops the prebuild here, with its path, and not in a Gradle log. Throws a `CapabilityConfigError`.
 */
export declare function pushSettings(push: unknown, appPackage: string | undefined, projectRoot: string): PushSettings;
/**
 * The manifest entries push reads: Firebase's default icon, color and channel (the first two only when the app gives them) and the module's channel, with its
 * defaults. The messaging service and `POST_NOTIFICATIONS` are static, so the library's own manifest declares them.
 */
export declare function applyPushManifest(application: AndroidConfig.Manifest.ManifestApplication, android: NonNullable<PushSettings["android"]>): void;
/** Copies the notification icon into the Android project's `res/drawable`, under the fixed name the manifest names. */
export declare function copyPushIcon(source: string, platformProjectRoot: string): Promise<void>;
export {};
