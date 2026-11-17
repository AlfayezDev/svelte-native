import type { ExpoConfig } from "expo/config";
import { AndroidConfig } from "expo/config-plugins.js";
import { findPushSecret, pushPackage } from "./push/config.js";
export { findPushSecret, pushPackage };
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
/** Where the notifications go when the app names no channel, and what the user reads in the app's notification settings. */
export declare const defaultPushChannel: {
    readonly id: "default";
    readonly name: "Notifications";
};
/**
 * What the plugin writes into the Android manifest, which is how the native code reads it (PUSH.md): the first three are Firebase's own, read when it shows a
 * notification itself (the app in the background); the channel's id, name and description are the module's, for the channel it creates, and always written
 * (defaults for what the app leaves out). The icon and the color are references to resources of the app (`android:resource`) and the channel's texts are references
 * to string resources (`android:value="@string/…"`, `pushResources`): a text written into `android:value` itself is read by the resource compiler, which takes a text that
 * looks like a number (`007`), a boolean (`true`), a color (`#fff`) or a reference (`@null`, `?what`) for one, and the native code would read another text back. A
 * reference to a string resource reads back as the string, character for character; the native code reads them with `Bundle.get(name)?.toString()`.
 */
export declare const pushMetaData: {
    readonly icon: "com.google.firebase.messaging.default_notification_icon";
    readonly color: "com.google.firebase.messaging.default_notification_color";
    readonly firebaseChannel: "com.google.firebase.messaging.default_notification_channel_id";
    readonly channelId: "expo.modules.sveltepush.channel_id";
    readonly channelName: "expo.modules.sveltepush.channel_name";
    readonly channelDescription: "expo.modules.sveltepush.channel_description";
};
/**
 * The resources the capability writes into the Android project, by fixed names so that the manifest and the files agree and a later prebuild finds what an earlier one
 * wrote: the icon's file in `res/drawable` (without its extension), the color's name in `res/values/colors.xml`, and the three texts of the channel in `res/values/strings.xml`.
 */
export declare const pushResources: {
    readonly icon: "svelte_push_icon";
    readonly color: "svelte_push_color";
    readonly channelId: "svelte_push_channel_id";
    readonly channelName: "svelte_push_channel_name";
    readonly channelDescription: "svelte_push_channel_description";
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
 * Checks `capabilities.push` (already known not to be off, and to hold no secret) and returns what it says. The shape is `checkPushConfig`'s, the one the doctor checks too; this reads
 * the Google services file and the icon, from the app's directory, so that a file that is not there stops the prebuild here, with its path, and not in a Gradle log. Throws a
 * `CapabilityConfigError`.
 */
export declare function pushSettings(push: unknown, appPackage: string | undefined, projectRoot: string): PushSettings;
/**
 * `AppDelegate.swift` (iOS) for an app with push: rule 2 of PUSH.md, a push that wakes the app mounts no screen. Expo's template starts React Native's surface in
 * `application(_:didFinishLaunchingWithOptions:)`, which mounts the first screen, and iOS also runs that method when it launches the app in the background for a silent push,
 * where nobody can see the screen. The template's `factory.startReactNative(...)` call is wrapped in `SveltePushBackgroundLaunch.start` (`@alfayez/svelte-native-push`),
 * which makes the same call in the same place in every launch the user makes, and in a launch in the background starts only the React host (`initializeReactHost`, which
 * is what the first `startReactNative` would have done before it made the surface) and makes the call at the first `didBecomeActive`. JavaScript, `init` and the push hooks
 * run meanwhile. The template's call is not touched, only wrapped, so that taking the wrapper away gives the template back: the patch is idempotent, and a prebuild replaces
 * what an older version wrote. Throws when the template has no such call, since a build that lost this silently would mount a screen in the background.
 */
export declare function applyPushAppDelegate(contents: string): string;
/**
 * Takes out of the application element what `applyPushManifest` wrote, and nothing else: the module's own meta-data (its names are ours), and Firebase's icon, color and channel only when
 * they name what the capability wrote (the icon and color resources, the channel's id string; or, for the channel, the id as text beside the module's own entry, as an earlier version
 * wrote it). An app that set one of Firebase's defaults itself keeps it, whatever the capability says.
 */
export declare function removePushManifest(application: AndroidConfig.Manifest.ManifestApplication): void;
/**
 * The manifest entries push reads: Firebase's default icon, color and channel (the first two only when the app gives them) and the module's channel, with its
 * defaults, the texts as references to the string resources of `applyPushStrings` (`pushMetaData`). What an earlier prebuild wrote is taken away first, so that a description,
 * an icon or a color the config no longer has is not kept. The messaging service and `POST_NOTIFICATIONS` are static, so the library's own manifest declares them.
 */
export declare function applyPushManifest(application: AndroidConfig.Manifest.ManifestApplication, android: NonNullable<PushSettings["android"]>): void;
/**
 * `text` as the content of a `<string>` of `res/values/strings.xml` that the resource compiler (aapt2) reads back as exactly `text`: in double quotes (so that its spaces are kept, not trimmed
 * and collapsed), with `\` and `"` escaped, a line break and a tab as their escapes, any other control character as `\uXXXX`, and a leading `@` or `?` escaped (it would be a reference). The
 * string is written with `formatted="false"` (`applyPushStrings`), so a `%` in the text is a `%`. (The XML's own escaping of `&` and `<` is the writer's.)
 */
export declare function androidStringText(text: string): string;
/** Takes the channel's string resources out of `strings.xml`: the names are ours. */
export declare function removePushStrings(strings: AndroidConfig.Resources.ResourceXML): AndroidConfig.Resources.ResourceXML;
/**
 * The channel's id, name and description as string resources, which the manifest's meta-data refer to (`pushMetaData`): a text in a resource reaches the native code exactly as the config has it
 * (`androidStringText`), where the same text in `android:value` would be read by the resource compiler for a number, a boolean, a color or a reference. They are `translatable="false"`, which also
 * keeps Expo from escaping and unescaping them a second time (it does so for the strings it reads and writes), and `formatted="false"`.
 */
export declare function applyPushStrings(strings: AndroidConfig.Resources.ResourceXML, channel: NonNullable<PushSettings["android"]>["channel"]): AndroidConfig.Resources.ResourceXML;
/** Copies the notification icon into the Android project's `res/drawable`, under the fixed name the manifest names. */
export declare function copyPushIcon(source: string, platformProjectRoot: string): Promise<void>;
