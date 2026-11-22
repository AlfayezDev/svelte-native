import type { ExpoConfig } from "expo/config";
import type { AndroidConfig } from "expo/config-plugins.js";
import { findPushSecret } from "./push/config.js";
export { findPushSecret };
/**
 * Why the app uses the location: the text iOS shows when it asks (`NSLocationWhenInUseUsageDescription`), as a string or as `{ whenInUse }`. Foreground location only: `navigator.geolocation` while the
 * app is in use. (`background` and `motion`, which the capability once passed to expo-location's plugin, are refused: see `locationSettings`.)
 */
export type LocationCapability = string | {
    whenInUse: string;
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
/** The meta-data of the application element that turns the native code on, on Android: svelte-core's `LocationManifest` reads it (`LocationRules.META_ENABLED`; the host check `location.sh` compares). */
export declare const locationMetaData: {
    readonly enabled: "expo.modules.sveltelocation.enabled";
};
/** The Info.plist flag (a boolean) that turns the native code on, on iOS: svelte-core's `SvelteLocationFlag`. Written when `capabilities.location` is set, and taken away without. */
export declare const locationInfoPlistFlag = "SvelteLocationEnabled";
/**
 * The key the plugin writes into Expo's `ios/Podfile.properties.json` (Podfile properties are strings) when location is on for iOS, and takes away without: `SvelteCore.podspec` reads it and adds the compile
 * condition `SVELTE_LOCATION` (`locationCompileCondition`) to the pod, and only then is the iOS location code compiled in. An app without it has no CoreLocation code, no reference to it and no link to it
 * in its binary: App Store Connect refuses a binary that uses the API without `NSLocationWhenInUseUsageDescription`, so a native code that merely does nothing when it is off is not enough.
 * `tests/package/location-native.test.ts` compares the podspec's text with these two.
 */
export declare const locationPodfileProperty = "expoSvelte.location";
export declare const locationCompileCondition = "SVELTE_LOCATION";
/** The Info.plist key of the text iOS shows when the app asks for the location while it is in use: the capability's text. */
export declare const locationUsageKey = "NSLocationWhenInUseUsageDescription";
/** The two permissions of Android's location: the precise one and the approximate one, which a user may grant alone (the module serves both). */
export declare const locationAndroidPermissions: readonly ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"];
/** What `capabilities.location` says once it has been checked: the text the user reads when iOS asks. */
export type LocationSettings = {
    whenInUse: string;
};
/**
 * Checks `capabilities.location` (already known not to be off) and returns what it says. The text is what the user reads when iOS asks, so an empty one is refused; `background` and `motion`, which an
 * earlier version passed to expo-location's plugin, are refused with what to do instead. Throws a `CapabilityConfigError`.
 */
export declare function locationSettings(location: unknown): LocationSettings;
type CapabilityOptions = {
    /** The app's directory. Default: the config's, else the working directory. */
    projectRoot?: string;
    /** The packages `autolinkingExclude` leaves out of the build: one of them is not linked, so it is no other push library of the app's. */
    excluded?: readonly string[];
};
/**
 * Applies the capabilities to the config: each one on gets the entries its native code needs (`location`: the flags, the permissions and the usage text; `push`: the entries of the platforms'
 * projects), and each one off takes away what an earlier prebuild wrote. Throws a `CapabilityConfigError` for a config that cannot be built as it stands.
 */
export declare function withCapabilities(config: ExpoConfig, capabilities: Capabilities | undefined, options?: CapabilityOptions): ExpoConfig;
/**
 * Whether an earlier prebuild turned location on in this manifest: the module's `enabled` flag is there (its name is ours). It is how the plugin tells the permissions it added from the app's own,
 * when location goes off (`removeLocationPermissions`).
 */
export declare function hasLocationFlag(application: AndroidConfig.Manifest.ManifestApplication): boolean;
/** The `enabled` flag out of the application element, and nothing else: its name is ours. */
export declare function removeLocationFlag(application: AndroidConfig.Manifest.ManifestApplication): void;
/**
 * Takes the location permissions out of the manifest of an app that turned location off, when it can tell that they are the capability's: an earlier prebuild turned location on (`hasLocationFlag`,
 * read by the caller before `removeLocationFlag` takes the flag away), and the app's own config does not ask for the permission itself (`android.permissions`; each of the two is judged alone).
 * A permission that something else wanted anyway is asked for again by that something at the next prebuild; an app that wants one without the capability lists it in `android.permissions`.
 */
export declare function removeLocationPermissions(manifest: AndroidConfig.Manifest.AndroidManifest, appPermissions: readonly string[] | undefined): void;
/** Where the notifications go when the app names no channel, and what the user reads in the app's notification settings. */
export declare const defaultPushChannel: {
    readonly id: "default";
    readonly name: "Notifications";
};
/**
 * What the plugin writes into the Android manifest, which is how the native code reads it (PUSH.md): `enabled` is the flag that turns the native code on (svelte-core is in every app; without
 * `<meta-data … android:value="true" />` the module, the package's listeners and the Application callbacks do nothing); the next three are Firebase's own, read when it shows a
 * notification itself (the app in the background); the channel's id, name and description are the module's, for the channel it creates, and always written
 * (defaults for what the app leaves out). The icon and the color are references to resources of the app (`android:resource`) and the channel's texts are references
 * to string resources (`android:value="@string/…"`, `pushResources`): a text written into `android:value` itself is read by the resource compiler, which takes a text that
 * looks like a number (`007`), a boolean (`true`), a color (`#fff`) or a reference (`@null`, `?what`) for one, and the native code would read another text back. A
 * reference to a string resource reads back as the string, character for character; the native code reads them with `Bundle.get(name)?.toString()`.
 */
export declare const pushMetaData: {
    readonly enabled: "expo.modules.sveltepush.enabled";
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
/**
 * The dependency of the app that makes Firebase Messaging part of its build: the plugin adds it to `android/app/build.gradle` for `capabilities.push.android` and takes it away without. Svelte-core
 * depends on the same version `compileOnly` (`native/svelte-core/android/build.gradle`; `tests/package/push-native.test.ts` compares the two), because that project is in every app and Firebase
 * must be in none that has no push. An exact version: a message is delivered by this library's service, and an app should get the one the library was exercised on.
 */
export declare const pushFirebaseDependency = "com.google.firebase:firebase-messaging:26.0.2";
/** The messaging service of the native code, which the plugin declares in the app's manifest: svelte-core's own manifest declares none, since a service there would be in every app. */
export declare const pushMessagingService = "expo.modules.sveltepush.SveltePushMessagingService";
/** Firebase's action for a message, and the permission Android 13 asks for at run time. */
export declare const firebaseMessagingEvent = "com.google.firebase.MESSAGING_EVENT";
export declare const postNotificationsPermission = "android.permission.POST_NOTIFICATIONS";
/** The Info.plist flag (a boolean) that turns the native code on, on iOS: svelte-core's `SveltePushEnabled` check. Written when `capabilities.push.ios` is set, and taken away without. */
export declare const pushInfoPlistFlag = "SveltePushEnabled";
/**
 * The key of `ios/Podfile.properties.json` that compiles push's iOS code into SvelteCore (`SVELTE_PUSH`, read by `SvelteCore.podspec`). Off, none of it is compiled: App Store Connect
 * warns about a binary that registers for remote notifications without the `aps-environment` entitlement, whether or not it ever calls the API.
 */
export declare const pushPodfileProperty = "expoSvelte.push";
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
 * `AppDelegate.swift` without what `applyPushAppDelegate` wrote (the wrapper of the template's call, and the import of the module that holds it): the template's own text again. A file that has
 * none of it is returned as it is, so this is the whole of what an app that turned push off needs, and the first half of `applyPushAppDelegate`.
 */
export declare function removePushAppDelegate(contents: string): string;
/**
 * `AppDelegate.swift` (iOS) for an app with push: rule 2 of PUSH.md, a push that wakes the app mounts no screen. Expo's template starts React Native's surface in
 * `application(_:didFinishLaunchingWithOptions:)`, which mounts the first screen, and iOS also runs that method when it launches the app in the background for a silent push,
 * where nobody can see the screen. The template's `factory.startReactNative(...)` call is wrapped in `SveltePushBackgroundLaunch.start` (SvelteCore, the library's pod),
 * which makes the same call in the same place in every launch the user makes, and in a launch in the background starts only the React host (`initializeReactHost`, which
 * is what the first `startReactNative` would have done before it made the surface) and makes the call at the first `didBecomeActive`. JavaScript, `init` and the push hooks
 * run meanwhile. The template's call is not touched, only wrapped, so that taking the wrapper away gives the template back: the patch is idempotent, and a prebuild replaces
 * what an older version wrote. Throws when the template has no such call, since a build that lost this silently would mount a screen in the background.
 */
export declare function applyPushAppDelegate(contents: string): string;
/**
 * Whether an earlier prebuild turned push on in this manifest: the module's `enabled` flag is there (its name is ours). It is how the plugin tells the notification permission it added from
 * the app's own, when push goes off (`removePushPermission`).
 */
export declare function hasPushFlag(application: AndroidConfig.Manifest.ManifestApplication): boolean;
/**
 * Takes out of the application element what `applyPushManifest` wrote, and nothing else: the module's own meta-data (its names are ours), the messaging service (by its class), and
 * Firebase's icon, color and channel only when they name what the capability wrote (the icon and color resources, the channel's id string; or, for the channel, the id as text beside the
 * module's own entry, as an earlier version wrote it). An app that set one of Firebase's defaults itself keeps it, whatever the capability says.
 */
export declare function removePushManifest(application: AndroidConfig.Manifest.ManifestApplication): void;
/**
 * The manifest entries push needs: the `enabled` flag that turns the native code on, the messaging service, Firebase's default icon, color and channel (the first two only when the app
 * gives them) and the module's channel, with its defaults, the texts as references to the string resources of `applyPushStrings` (`pushMetaData`). What an earlier prebuild wrote is taken
 * away first, so that a description, an icon or a color the config no longer has is not kept. `POST_NOTIFICATIONS` is a child of the manifest, not of the application: `applyPushPermission`.
 */
export declare function applyPushManifest(application: AndroidConfig.Manifest.ManifestApplication, android: NonNullable<PushSettings["android"]>): void;
/** Android 13 and later ask for the notification permission at run time (`requestPermission`), and the manifest has to declare it for the question to be asked. Added once. */
export declare function applyPushPermission(manifest: AndroidConfig.Manifest.AndroidManifest): void;
/**
 * Takes the notification permission out of the manifest of an app that turned push off, when it can tell that it is the capability's: an earlier prebuild turned push on (`hasPushFlag`,
 * read by the caller before `removePushManifest` takes the flag away) and the app's own config does not ask for the permission itself (`android.permissions`). A permission that something
 * else wanted anyway is asked for again by that something at the next prebuild; an app that wants it without push lists it in `android.permissions`.
 */
export declare function removePushPermission(manifest: AndroidConfig.Manifest.AndroidManifest, appPermissions: readonly string[] | undefined): void;
/** `android/app/build.gradle` without the dependency `applyPushGradle` wrote (a line that carries the comment, at whatever version an earlier plugin pinned): the template's own text again. */
export declare function removePushGradle(contents: string): string;
/**
 * `android/app/build.gradle` with Firebase Messaging in the app's `dependencies`: the first block at the left margin, which is the app module's (Expo's template has one, and the `buildscript`
 * and `android` blocks are different words). The same line, with its comment, is what `removePushGradle` finds, so a prebuild replaces what an older one wrote and the line is never there
 * twice. Written with parentheses and double quotes, as the template writes its own dependencies, which both Groovy and Kotlin read. Throws when there is no such block, since an app that
 * lost this silently would have a service in its manifest and no Firebase to run it.
 */
export declare function applyPushGradle(contents: string): string;
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
/** Deletes the icon an earlier prebuild copied (its name is ours), for an app whose config has none now. */
export declare function removePushIcon(platformProjectRoot: string): Promise<void>;
