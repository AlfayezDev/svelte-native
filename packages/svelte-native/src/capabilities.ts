/**
 * The capabilities an app turns on in the config plugin (`capabilities: { location, push }`): the web APIs that need a permission of the system, and with it a native
 * library and the app's own words or identifiers. A capability is off until the config says why the app uses it, and the plugin refuses the two half-made states of a capability whose
 * library is a package of its own (`location`; `push` has none, below), each of which an app would only find out about on a device or in review:
 *
 * - on, without its library installed: the build would have no native module, and the API would read as `undefined`;
 * - its library installed, but off: Expo would apply the library's own plugin with its default text ("Allow $(PRODUCT_NAME) to …"), which says nothing of why,
 *   and App Review rejects that. A library that is linked is in the binary, and Apple and Google ask about the permissions it declares whether or not it is called.
 *
 * An app that lists the library's own plugin in `plugins` (with its texts) has configured it there, and one that leaves the library out of autolinking
 * (`autolinkingExclude`) does not link it: neither needs the capability.
 *
 * `location` is expo-location: `navigator.geolocation` and `navigator.permissions` use its native module (`geolocation.ts`).
 *
 * `push` is push notifications (PUSH.md): Firebase Messaging on Android, APNs on iOS. Its native code is part of the library's one native module (svelte-core), which is in every
 * app, so what makes an app one with push is what this plugin writes, and nothing else: on Android Firebase Messaging's dependency, the messaging service, the notification permission and
 * the flag `expo.modules.sveltepush.enabled` that the native code asks before it does anything; on iOS the `SveltePushEnabled` Info.plist flag, the entitlement and the background mode. An
 * app without them has no Firebase in its build, no service to take another library's messages, and native code that does nothing. The plugin does what the plugin of any push library does,
 * from the identifiers in the config, and refuses what would ship a secret or make a second push library of the app. A prebuild that keeps the native projects (no `--clean`) keeps what the
 * last one wrote, so where push is off (or a platform is not named) the plugin takes away what is certainly its own: the flags, the Gradle dependency, the service, the `AppDelegate`
 * wrapper, the manifest's entries and the resources under its names, and the notification permission when the app's config does not ask for it itself. It leaves what it cannot tell from
 * the app's own: the entitlement, the background mode, the Google services file and the Gradle plugin.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { ExpoConfig } from "expo/config";
// `.js` spelled out, as in `remote/plugin.ts`: Node's own module loader, which loads this file from its source in `tests/cli/remote-plugin.test.ts` ("loading"), resolves no `expo/config-plugins` without it.
// The `with*` functions are plain exports of that CommonJS module, which Node's loader names. `AndroidConfig` is not: Expo defines it with a getter, which the CommonJS lexer of Node before 24
// does not see ("Named export 'AndroidConfig' not found"), so its values come from the default import, which is the module's exports in every loader (Node, Bun, the bundle); its types stay a named import.
import type { AndroidConfig } from "expo/config-plugins.js";
import configPlugins, { withAndroidColors, withAndroidManifest, withAppBuildGradle, withAppDelegate, withDangerousMod, withInfoPlist, withPodfileProperties, withStringsXml } from "expo/config-plugins.js";
import { apsEnvironmentEntitlement, checkPushConfig, findPushSecret, googleServicesPackages, otherPushLibraries, pushIsOn, pushSecretMessage, remoteNotificationMode } from "./push/config.ts";

const { AndroidConfig: expoAndroid } = configPlugins;

// Defined in `push/config.ts` now, which the doctor loads without Expo; it stays importable from here.
export { findPushSecret };

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
    channel?: { id?: string; name: string; description?: string };
  };
  ios?: {
    /** The `aps-environment` entitlement: `development` for a build signed for development, `production` for TestFlight and the App Store. The token carries it, and the sender picks the APNs endpoint with it. */
    mode: "development" | "production";
  };
};

/** `false` (or leaving it out) is off. */
export type Capabilities = { location?: LocationCapability | false; push?: PushCapability | false };

export class CapabilityConfigError extends Error {
  override name = "CapabilityConfigError";
}

/** The props of expo-location's config plugin a location capability makes: its texts, and nothing of the background unless it is asked for. */
export function locationPluginProps(location: LocationCapability): Record<string, string | boolean> {
  const { whenInUse, background, motion } = typeof location === "string" ? { whenInUse: location, background: undefined, motion: undefined } : location;
  if (typeof whenInUse !== "string" || whenInUse.trim() === "")
    throw new CapabilityConfigError("capabilities.location needs the reason the app uses the location, as the user will read it: `capabilities: { location: \"Shows the stores near you.\" }`");
  for (const [key, text] of [["background", background], ["motion", motion]] as const)
    if (text !== undefined && (typeof text !== "string" || text.trim() === ""))
      throw new CapabilityConfigError(`capabilities.location.${key} needs the reason, as the user will read it`);
  return {
    locationWhenInUsePermission: whenInUse,
    locationAlwaysAndWhenInUsePermission: background ?? false,
    locationAlwaysPermission: background ?? false,
    isIosBackgroundLocationEnabled: background !== undefined,
    isAndroidBackgroundLocationEnabled: background !== undefined,
    ...(motion === undefined ? {} : { motionUsagePermission: motion }),
  };
}

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  expo?: { autolinking?: { exclude?: string[]; android?: { exclude?: string[] }; ios?: { exclude?: string[] } } };
};

/**
 * The app's own dependencies, by name, minus what its `package.json` leaves out of autolinking (`expo.autolinking.exclude`, for both platforms or one): what
 * autolinking links. (A package that only another one depends on is linked too where the package manager hoists it to the app's `node_modules`; pnpm does not.)
 */
function linkedDependencies(projectRoot: string): { linked: Set<string>; excluded: Set<string> } {
  let manifest: Manifest = {};
  try {
    manifest = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as Manifest;
  } catch {
    // No package.json: nothing is linked.
  }
  const autolinking = manifest.expo?.autolinking;
  const excluded = new Set([...(autolinking?.exclude ?? []), ...(autolinking?.android?.exclude ?? []), ...(autolinking?.ios?.exclude ?? [])]);
  const linked = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})].filter((name) => !excluded.has(name)));
  return { linked, excluded };
}

/** Whether the config's `plugins` names the package's plugin, alone (`"expo-location"`) or with its props (`["expo-location", { … }]`). */
function listsPlugin(config: { plugins?: unknown[] }, name: string): boolean {
  return (config.plugins ?? []).some((entry) => (Array.isArray(entry) ? entry[0] : entry) === name);
}

type Plugin = (config: ExpoConfig, props: Record<string, string | boolean>) => ExpoConfig;

type CapabilityOptions = {
  /** The app's directory. Default: the config's, else the working directory. */
  projectRoot?: string;
  /** Finds a library's config plugin from the app (tests pass their own). */
  load?: (request: string) => unknown;
  /** The packages `autolinkingExclude` leaves out of the build: one of them is not linked, so it needs no capability. */
  excluded?: readonly string[];
};

/** What every capability reads: where the app is, how to find a library's plugin, and what its build links. */
type Context = {
  projectRoot: string;
  load: (request: string) => unknown;
  /** The app's dependencies that autolinking links: its `package.json`'s, less every package left out of autolinking. */
  linked: Set<string>;
  /** The packages left out of autolinking, by `autolinkingExclude` and by the `package.json`, installed or not. */
  excluded: Set<string>;
};

/**
 * Applies the capabilities to the config: each one on gets what its library needs (`location`: its library's plugin with the app's texts; `push`: the entries of
 * the platforms' projects). Throws a `CapabilityConfigError` for a capability without its library, for a library without its capability, and for a config that
 * cannot be built as it stands.
 */
export function withCapabilities(config: ExpoConfig, capabilities: Capabilities | undefined, options: CapabilityOptions = {}): ExpoConfig {
  const projectRoot = options.projectRoot ?? config._internal?.projectRoot ?? process.cwd();
  const load = options.load ?? ((request: string) => createRequire(join(projectRoot, "package.json"))(request));
  const dependencies = linkedDependencies(projectRoot);
  const excluded = new Set([...(options.excluded ?? []), ...dependencies.excluded]);
  const linked = new Set([...dependencies.linked].filter((name) => !excluded.has(name)));
  const context: Context = { projectRoot, load, linked, excluded };
  return withPush(withLocation(config, capabilities?.location, context), capabilities?.push, context);
}

function withLocation(config: ExpoConfig, location: Capabilities["location"], context: Context): ExpoConfig {
  const on = location !== undefined && location !== null && location !== false;
  const excluded = context.excluded.has("expo-location");
  const installed = context.linked.has("expo-location");
  // An app that lists expo-location's own plugin gave its texts there. Both would be two answers to one question, and only one would apply (Expo runs a
  // library's plugin once): the second, silently ignored.
  if (listsPlugin(config, "expo-location")) {
    if (on)
      throw new CapabilityConfigError("The app config sets capabilities.location and also lists expo-location's own plugin: keep one. capabilities.location gives expo-location its texts; its own plugin entry takes all of its options.");
    return config;
  }
  if (!on) {
    if (installed)
      throw new CapabilityConfigError(
        "expo-location is installed, but the location capability is off. Say why the app uses the location (the text iOS shows when it asks) in the @alfayez/svelte-native plugin: " +
          "`plugins: [[\"@alfayez/svelte-native\", { capabilities: { location: \"Shows the stores near you.\" } }]]`, or uninstall expo-location.",
      );
    return config;
  }
  // Left out of autolinking, expo-location is not in the build, and its plugin would do nothing (`leaveOutOfAutoPlugins` has marked it applied).
  if (excluded)
    throw new CapabilityConfigError("capabilities.location is on, but expo-location is left out of autolinking (`autolinkingExclude`, or `expo.autolinking.exclude` in package.json): take it out of that list, or turn the capability off.");
  const props = locationPluginProps(location as LocationCapability);
  try {
    context.load("expo-location/package.json");
  } catch {
    throw new CapabilityConfigError("capabilities.location needs expo-location, which is not installed: `npx expo install expo-location`, then prebuild again.");
  }
  let plugin: unknown;
  try {
    plugin = context.load("expo-location/app.plugin.js");
  } catch (error) {
    throw new CapabilityConfigError(`expo-location's config plugin (expo-location/app.plugin.js) failed to load: ${error instanceof Error ? error.message : String(error)}`);
  }
  const apply = ((plugin as { default?: unknown }).default ?? plugin) as Plugin;
  if (typeof apply !== "function") throw new CapabilityConfigError("expo-location's config plugin (expo-location/app.plugin.js) is not a function: is the installed expo-location the one this Expo SDK uses?");
  return apply(config, props);
}

/** Where the notifications go when the app names no channel, and what the user reads in the app's notification settings. */
export const defaultPushChannel = { id: "default", name: "Notifications" } as const;

/**
 * What the plugin writes into the Android manifest, which is how the native code reads it (PUSH.md): `enabled` is the flag that turns the native code on (svelte-core is in every app; without
 * `<meta-data … android:value="true" />` the module, the package's listeners and the Application callbacks do nothing); the next three are Firebase's own, read when it shows a
 * notification itself (the app in the background); the channel's id, name and description are the module's, for the channel it creates, and always written
 * (defaults for what the app leaves out). The icon and the color are references to resources of the app (`android:resource`) and the channel's texts are references
 * to string resources (`android:value="@string/…"`, `pushResources`): a text written into `android:value` itself is read by the resource compiler, which takes a text that
 * looks like a number (`007`), a boolean (`true`), a color (`#fff`) or a reference (`@null`, `?what`) for one, and the native code would read another text back. A
 * reference to a string resource reads back as the string, character for character; the native code reads them with `Bundle.get(name)?.toString()`.
 */
export const pushMetaData = {
  enabled: "expo.modules.sveltepush.enabled",
  icon: "com.google.firebase.messaging.default_notification_icon",
  color: "com.google.firebase.messaging.default_notification_color",
  firebaseChannel: "com.google.firebase.messaging.default_notification_channel_id",
  channelId: "expo.modules.sveltepush.channel_id",
  channelName: "expo.modules.sveltepush.channel_name",
  channelDescription: "expo.modules.sveltepush.channel_description",
} as const;

/**
 * The resources the capability writes into the Android project, by fixed names so that the manifest and the files agree and a later prebuild finds what an earlier one
 * wrote: the icon's file in `res/drawable` (without its extension), the color's name in `res/values/colors.xml`, and the three texts of the channel in `res/values/strings.xml`.
 */
export const pushResources = {
  icon: "svelte_push_icon",
  color: "svelte_push_color",
  channelId: "svelte_push_channel_id",
  channelName: "svelte_push_channel_name",
  channelDescription: "svelte_push_channel_description",
} as const;

/**
 * The dependency of the app that makes Firebase Messaging part of its build: the plugin adds it to `android/app/build.gradle` for `capabilities.push.android` and takes it away without. Svelte-core
 * depends on the same version `compileOnly` (`native/svelte-core/android/build.gradle`; `tests/package/push-native.test.ts` compares the two), because that project is in every app and Firebase
 * must be in none that has no push. An exact version: a message is delivered by this library's service, and an app should get the one the library was exercised on.
 */
export const pushFirebaseDependency = "com.google.firebase:firebase-messaging:26.0.2";

/** The messaging service of the native code, which the plugin declares in the app's manifest: svelte-core's own manifest declares none, since a service there would be in every app. */
export const pushMessagingService = "expo.modules.sveltepush.SveltePushMessagingService";

/** Firebase's action for a message, and the permission Android 13 asks for at run time. */
export const firebaseMessagingEvent = "com.google.firebase.MESSAGING_EVENT";
export const postNotificationsPermission = "android.permission.POST_NOTIFICATIONS";

/** The Info.plist flag (a boolean) that turns the native code on, on iOS: svelte-core's `SveltePushEnabled` check. Written when `capabilities.push.ios` is set, and taken away without. */
export const pushInfoPlistFlag = "SveltePushEnabled";
/**
 * The key of `ios/Podfile.properties.json` that compiles push's iOS code into SvelteCore (`SVELTE_PUSH`, read by `SvelteCore.podspec`). Off, none of it is compiled: App Store Connect
 * warns about a binary that registers for remote notifications without the `aps-environment` entitlement, whether or not it ever calls the API.
 */
export const pushPodfileProperty = "svelteNative.push";

/** What `capabilities.push` says once it has been checked. */
export type PushSettings = {
  android?: { googleServicesFile: string; icon?: string; color?: string; channel: { id: string; name: string; description?: string } };
  ios?: { mode: "development" | "production" };
};

const secretError = (secret: { where: string; what: string }) => new CapabilityConfigError(pushSecretMessage(secret));

/** Why a file cannot be read: it is not there, or what the system said. */
const unreadable = (error: unknown): string => ((error as NodeJS.ErrnoException).code === "ENOENT" ? "does not exist" : `cannot be read: ${error instanceof Error ? error.message : String(error)}`);

/** Reads the Google services file and refuses one that is not the app's: a secret, a file that is not there or not JSON, and a Firebase project that has no Android app of this package. */
function checkGoogleServicesFile(file: string, appPackage: string, projectRoot: string): void {
  const name = `capabilities.push.android.googleServicesFile ("${file}")`;
  const path = resolve(projectRoot, file);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new CapabilityConfigError(`${name} ${unreadable(error)} (looked for ${path}): download google-services.json from the Firebase console (Project settings, your Android app) and save it there, or point googleServicesFile at it.`);
  }
  const secret = findPushSecret(text, `the file of ${name}`);
  if (secret) throw secretError(secret);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CapabilityConfigError(`${name} is not JSON (${error instanceof Error ? error.message : String(error)}): download google-services.json from the Firebase console again.`);
  }
  const packages = googleServicesPackages(parsed);
  if (!packages.includes(appPackage))
    throw new CapabilityConfigError(
      `${name} has no client for the app's package "${appPackage}" (${packages.length === 0 ? "it has no Android client" : `it has ${packages.map((item) => `"${item}"`).join(", ")}`}): ` +
        "add an Android app with that package to the Firebase project and download google-services.json again, or fix android.package.",
    );
}

/** Refuses an icon that is not there, with the name of its option: the copy at prebuild would stop on a missing file with a bare ENOENT. (That it is a PNG is `checkPushConfig`'s.) */
function checkIconFile(icon: string, projectRoot: string): void {
  const name = `capabilities.push.android.icon ("${icon}")`;
  const path = resolve(projectRoot, icon);
  let isFile: boolean;
  try {
    isFile = statSync(path).isFile();
  } catch (error) {
    throw new CapabilityConfigError(`${name} ${unreadable(error)} (looked for ${path}): point it at the PNG of the notification's small icon.`);
  }
  if (!isFile) throw new CapabilityConfigError(`${name} is not a file (${path}): point it at the PNG of the notification's small icon.`);
}

/**
 * Checks `capabilities.push` (already known not to be off, and to hold no secret) and returns what it says. The shape is `checkPushConfig`'s, the one the doctor checks too; this reads
 * the Google services file and the icon, from the app's directory, so that a file that is not there stops the prebuild here, with its path, and not in a Gradle log. Throws a
 * `CapabilityConfigError`.
 */
export function pushSettings(push: unknown, appPackage: string | undefined, projectRoot: string): PushSettings {
  const checked = checkPushConfig(push);
  if ("problem" in checked) throw new CapabilityConfigError(checked.problem);
  const { android, ios } = checked.config;
  const settings: PushSettings = {};
  if (android) {
    if (!appPackage) throw new CapabilityConfigError("capabilities.push.android needs android.package in the Expo config: the Google services file is checked against it, and Firebase delivers to that package.");
    checkGoogleServicesFile(android.googleServicesFile, appPackage, projectRoot);
    if (android.icon !== undefined) checkIconFile(android.icon, projectRoot);
    const { id, name, description } = android.channel ?? {};
    settings.android = {
      googleServicesFile: android.googleServicesFile,
      ...(android.icon === undefined ? {} : { icon: android.icon }),
      ...(android.color === undefined ? {} : { color: android.color }),
      channel: { id: id ?? defaultPushChannel.id, name: name ?? defaultPushChannel.name, ...(description === undefined ? {} : { description }) },
    };
  }
  if (ios) settings.ios = ios;
  return settings;
}

const holdBegin = "    // Svelte native: push, the first screen of a launch in the background (generated, do not edit)";
const holdOpen = "      surface: { [self] in";
const holdClose = "      })";
const holdEnd = "    // Svelte native: end of the first screen of a launch in the background";
// `internal`, as `applyAppDelegate` writes its own import (of the same module, SvelteCore, which holds `SveltePushBackgroundLaunch` now, under a comment of its own): Expo's generated
// ExpoModulesProvider imports every module as `internal import`, and a plain import of the same module in the app target is ambiguous.
const holdImportComment = "// Svelte native: push, the first screen of a launch in the background (generated, do not edit)";
const holdImport = `internal import SvelteCore ${holdImportComment}`;
const escapeText = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The head and the tail of the wrapper, each with the newline before it, so that taking both away leaves the template's call where it was. */
const holdHead = new RegExp(`\\n${escapeText(holdBegin)}\\n[\\s\\S]*?${escapeText(holdOpen)}(?=\\n)`);
const holdTail = new RegExp(`\\n${escapeText(holdClose)}\\n${escapeText(holdEnd)}(?=\\n)`);
// The import of an earlier version of the capability named the module of the separate package (`SveltePush`): an AppDelegate it wrote is cleaned the same way, or it would stop the build.
const holdImportLine = new RegExp(`^internal import (?:SvelteCore|SveltePush) ${escapeText(holdImportComment)}\\n`, "m");

/**
 * `AppDelegate.swift` without what `applyPushAppDelegate` wrote (the wrapper of the template's call, and the import of the module that holds it): the template's own text again. A file that has
 * none of it is returned as it is, so this is the whole of what an app that turned push off needs, and the first half of `applyPushAppDelegate`.
 */
export function removePushAppDelegate(contents: string): string {
  return contents.replace(holdHead, "").replace(holdTail, "").replace(holdImportLine, "");
}

/**
 * `AppDelegate.swift` (iOS) for an app with push: rule 2 of PUSH.md, a push that wakes the app mounts no screen. Expo's template starts React Native's surface in
 * `application(_:didFinishLaunchingWithOptions:)`, which mounts the first screen, and iOS also runs that method when it launches the app in the background for a silent push,
 * where nobody can see the screen. The template's `factory.startReactNative(...)` call is wrapped in `SveltePushBackgroundLaunch.start` (SvelteCore, the library's pod),
 * which makes the same call in the same place in every launch the user makes, and in a launch in the background starts only the React host (`initializeReactHost`, which
 * is what the first `startReactNative` would have done before it made the surface) and makes the call at the first `didBecomeActive`. JavaScript, `init` and the push hooks
 * run meanwhile. The template's call is not touched, only wrapped, so that taking the wrapper away gives the template back: the patch is idempotent, and a prebuild replaces
 * what an older version wrote. Throws when the template has no such call, since a build that lost this silently would mount a screen in the background.
 */
export function applyPushAppDelegate(contents: string): string {
  const stripped = removePushAppDelegate(contents);
  const imports = [...stripped.matchAll(/^(?:(?:internal|public|package|private|fileprivate) |@_exported |@preconcurrency )*import [\w.]+[ \t]*$/gm)];
  const lastImport = imports.at(-1);
  const call = /^[ \t]*factory\.startReactNative\([^)]*\)[ \t]*$/m.exec(stripped);
  const launching = /_ application: UIApplication,\s*didFinishLaunchingWithOptions launchOptions: \[UIApplication\.LaunchOptionsKey: Any\]\?/.test(stripped);
  if (!lastImport || !call || !launching || !/withModuleName: "[^"]+",\s*in: window,\s*launchOptions: launchOptions\)/.test(call[0])) {
    throw new Error(
      "Svelte native could not find the imports and `factory.startReactNative(withModuleName: …, in: window, launchOptions: launchOptions)` in application(_:didFinishLaunchingWithOptions:) of AppDelegate.swift. " +
        "Push needs the call to keep a launch in the background (a silent push) from mounting the first screen.",
    );
  }
  const head = [
    holdBegin,
    "    SveltePushBackgroundLaunch.start(",
    "      application,",
    "      host: {",
    // `-initializeReactHostWithLaunchOptions:bundleConfiguration:devMenuConfiguration:` reaches Swift as `initializeReactHost(launchOptions:…)`
    // (the compiler of Xcode 26.5 says so; `withLaunchOptions:` does not compile).
    "        factory.rootViewFactory.initializeReactHost(",
    "          launchOptions: launchOptions,",
    "          bundleConfiguration: factory.bundleConfiguration,",
    "          devMenuConfiguration: factory.devMenuConfiguration ?? RCTDevMenuConfiguration.default())",
    "      },",
    holdOpen,
    "",
  ].join("\n");
  const tail = ["", holdClose, holdEnd].join("\n");
  const callEnd = call.index + call[0].length;
  const importEnd = lastImport.index + lastImport[0].length;
  return `${stripped.slice(0, importEnd)}\n${holdImport}${stripped.slice(importEnd, call.index)}${head}${call[0]}${tail}${stripped.slice(callEnd)}`;
}

/**
 * The iOS side: the `aps-environment` entitlement, `remote-notification` among the background modes (silent pushes wake the app), added once to the modes the
 * app has, and the Info.plist flag `SveltePushEnabled` (`pushInfoPlistFlag`) that turns the native code on: svelte-core is in every app, and without the flag it never becomes the
 * notification center's delegate and never forwards a remote notification. All three are written into the config's `ios` object, where Expo's Info.plist and entitlements mods read
 * them, and where `eas build` reads the entitlement to enable the Push Notifications capability of the app id. The `AppDelegate` is patched so that a push that wakes the app mounts
 * no screen (`applyPushAppDelegate`).
 */
function withPushIos(config: ExpoConfig, mode: "development" | "production"): ExpoConfig {
  const existing = config.ios?.entitlements?.[apsEnvironmentEntitlement];
  if (existing !== undefined && existing !== mode)
    throw new CapabilityConfigError(
      `The app config sets ios.entitlements["aps-environment"] ("${String(existing)}") and capabilities.push.ios.mode is "${mode}": keep one. capabilities.push.ios.mode writes the entitlement.`,
    );
  const existingModes = config.ios?.infoPlist?.UIBackgroundModes;
  const modes: string[] = Array.isArray(existingModes) ? existingModes : [];
  config = {
    ...config,
    ios: {
      ...config.ios,
      entitlements: { ...config.ios?.entitlements, [apsEnvironmentEntitlement]: mode },
      infoPlist: { ...config.ios?.infoPlist, [pushInfoPlistFlag]: true, UIBackgroundModes: modes.includes(remoteNotificationMode) ? modes : [...modes, remoteNotificationMode] },
    },
  };
  config = withPodfileProperties(config, (config) => {
    config.modResults[pushPodfileProperty] = "true";
    return config;
  });
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== "swift") throw new Error("Svelte native requires Expo's Swift AppDelegate");
    config.modResults.contents = applyPushAppDelegate(config.modResults.contents);
    return config;
  });
}

/** A `<meta-data>` of the application element, replacing the one of that name (it holds a `value` or a `resource`, not both). */
function setMetaData(application: AndroidConfig.Manifest.ManifestApplication, name: string, attribute: "value" | "resource", content: string): void {
  const others = (application["meta-data"] ?? []).filter((item) => item.$["android:name"] !== name);
  application["meta-data"] = [...others, { $: { "android:name": name, [`android:${attribute}`]: content } }];
}

/**
 * Whether an earlier prebuild turned push on in this manifest: the module's `enabled` flag is there (its name is ours). It is how the plugin tells the notification permission it added from
 * the app's own, when push goes off (`removePushPermission`).
 */
export function hasPushFlag(application: AndroidConfig.Manifest.ManifestApplication): boolean {
  return (application["meta-data"] ?? []).some((item) => item.$["android:name"] === pushMetaData.enabled);
}

/**
 * The messaging service: not exported, with Firebase's `MESSAGING_EVENT` filter. Firebase's own service has the same filter at priority -500, so this one, at the default 0, is the app's
 * receiver of every message. It is the plugin's to declare and svelte-core's manifest has none: a service in svelte-core's would be in every app, and take the messages of `expo-notifications`
 * or React Native Firebase there.
 */
function pushService(): NonNullable<AndroidConfig.Manifest.ManifestApplication["service"]>[number] {
  return { $: { "android:name": pushMessagingService, "android:exported": "false" }, "intent-filter": [{ action: [{ $: { "android:name": firebaseMessagingEvent } }] }] };
}

/**
 * Takes out of the application element what `applyPushManifest` wrote, and nothing else: the module's own meta-data (its names are ours), the messaging service (by its class), and
 * Firebase's icon, color and channel only when they name what the capability wrote (the icon and color resources, the channel's id string; or, for the channel, the id as text beside the
 * module's own entry, as an earlier version wrote it). An app that set one of Firebase's defaults itself keeps it, whatever the capability says.
 */
export function removePushManifest(application: AndroidConfig.Manifest.ManifestApplication): void {
  if (application.service !== undefined) application.service = application.service.filter((item) => item.$["android:name"] !== pushMessagingService);
  const items = application["meta-data"];
  if (items === undefined) return;
  const content = (item: { $: Record<string, string | undefined> }) => item.$["android:value"] ?? item.$["android:resource"];
  const channelId = items.map((item) => (item.$["android:name"] === pushMetaData.channelId ? content(item) : undefined)).find((value) => value !== undefined);
  const ours = (item: (typeof items)[number]): boolean => {
    switch (item.$["android:name"]) {
      case pushMetaData.enabled:
      case pushMetaData.channelId:
      case pushMetaData.channelName:
      case pushMetaData.channelDescription:
        return true;
      case pushMetaData.icon:
        return content(item) === `@drawable/${pushResources.icon}`;
      case pushMetaData.color:
        return content(item) === `@color/${pushResources.color}`;
      case pushMetaData.firebaseChannel:
        return content(item) === `@string/${pushResources.channelId}` || (channelId !== undefined && content(item) === channelId);
      default:
        return false;
    }
  };
  application["meta-data"] = items.filter((item) => !ours(item));
}

/**
 * The manifest entries push needs: the `enabled` flag that turns the native code on, the messaging service, Firebase's default icon, color and channel (the first two only when the app
 * gives them) and the module's channel, with its defaults, the texts as references to the string resources of `applyPushStrings` (`pushMetaData`). What an earlier prebuild wrote is taken
 * away first, so that a description, an icon or a color the config no longer has is not kept. `POST_NOTIFICATIONS` is a child of the manifest, not of the application: `applyPushPermission`.
 */
export function applyPushManifest(application: AndroidConfig.Manifest.ManifestApplication, android: NonNullable<PushSettings["android"]>): void {
  removePushManifest(application);
  setMetaData(application, pushMetaData.enabled, "value", "true");
  application.service = [...(application.service ?? []), pushService()];
  if (android.icon !== undefined) setMetaData(application, pushMetaData.icon, "resource", `@drawable/${pushResources.icon}`);
  if (android.color !== undefined) setMetaData(application, pushMetaData.color, "resource", `@color/${pushResources.color}`);
  // Without it a notification the system shows (the app in the background) goes to Firebase's own "Miscellaneous" channel, not to the app's.
  setMetaData(application, pushMetaData.firebaseChannel, "value", `@string/${pushResources.channelId}`);
  setMetaData(application, pushMetaData.channelId, "value", `@string/${pushResources.channelId}`);
  setMetaData(application, pushMetaData.channelName, "value", `@string/${pushResources.channelName}`);
  if (android.channel.description !== undefined) setMetaData(application, pushMetaData.channelDescription, "value", `@string/${pushResources.channelDescription}`);
}

/** The permission names an app's `android.permissions` may spell the notification permission with: Expo adds the `android.permission.` prefix to the short one. */
const postNotificationsNames = [postNotificationsPermission, postNotificationsPermission.replace("android.permission.", "")];

/** Android 13 and later ask for the notification permission at run time (`requestPermission`), and the manifest has to declare it for the question to be asked. Added once. */
export function applyPushPermission(manifest: AndroidConfig.Manifest.AndroidManifest): void {
  expoAndroid.Permissions.ensurePermissions(manifest, [postNotificationsPermission]);
}

/**
 * Takes the notification permission out of the manifest of an app that turned push off, when it can tell that it is the capability's: an earlier prebuild turned push on (`hasPushFlag`,
 * read by the caller before `removePushManifest` takes the flag away) and the app's own config does not ask for the permission itself (`android.permissions`). A permission that something
 * else wanted anyway is asked for again by that something at the next prebuild; an app that wants it without push lists it in `android.permissions`.
 */
export function removePushPermission(manifest: AndroidConfig.Manifest.AndroidManifest, appPermissions: readonly string[] | undefined): void {
  if (appPermissions?.some((name) => postNotificationsNames.includes(name))) return;
  expoAndroid.Permissions.removePermissions(manifest, [postNotificationsPermission]);
}

const gradleComment = "// Svelte native: push, Firebase Messaging (generated, do not edit)";
const gradleLine = `    implementation("${pushFirebaseDependency}") ${gradleComment}`;
const gradleLines = new RegExp(`^[ \\t]*implementation\\([^\\n]*\\) ${escapeText(gradleComment)}\\n`, "gm");

/** `android/app/build.gradle` without the dependency `applyPushGradle` wrote (a line that carries the comment, at whatever version an earlier plugin pinned): the template's own text again. */
export function removePushGradle(contents: string): string {
  return contents.replace(gradleLines, "");
}

/**
 * `android/app/build.gradle` with Firebase Messaging in the app's `dependencies`: the first block at the left margin, which is the app module's (Expo's template has one, and the `buildscript`
 * and `android` blocks are different words). The same line, with its comment, is what `removePushGradle` finds, so a prebuild replaces what an older one wrote and the line is never there
 * twice. Written with parentheses and double quotes, as the template writes its own dependencies, which both Groovy and Kotlin read. Throws when there is no such block, since an app that
 * lost this silently would have a service in its manifest and no Firebase to run it.
 */
export function applyPushGradle(contents: string): string {
  const stripped = removePushGradle(contents);
  const block = /^dependencies \{[ \t]*\n/m.exec(stripped);
  if (!block) {
    throw new Error(
      "Svelte native could not find the `dependencies {` block of android/app/build.gradle. Push needs it to add Firebase Messaging to the app: the library's messaging service is compiled against Firebase and runs on the app's copy of it.",
    );
  }
  const end = block.index + block[0].length;
  return `${stripped.slice(0, end)}${gradleLine}\n${stripped.slice(end)}`;
}

/**
 * `text` as the content of a `<string>` of `res/values/strings.xml` that the resource compiler (aapt2) reads back as exactly `text`: in double quotes (so that its spaces are kept, not trimmed
 * and collapsed), with `\` and `"` escaped, a line break and a tab as their escapes, any other control character as `\uXXXX`, and a leading `@` or `?` escaped (it would be a reference). The
 * string is written with `formatted="false"` (`applyPushStrings`), so a `%` in the text is a `%`. (The XML's own escaping of `&` and `<` is the writer's.)
 */
export function androidStringText(text: string): string {
  const escaped = text
    .replace(/[\\"]/g, "\\$&")
    .replace(/^[@?]/, "\\$&")
    .replace(/\p{Cc}/gu, (char) => (char === "\n" ? "\\n" : char === "\t" ? "\\t" : `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`));
  return `"${escaped}"`;
}

const channelStringNames = [pushResources.channelId, pushResources.channelName, pushResources.channelDescription];

/** Takes the channel's string resources out of `strings.xml`: the names are ours. */
export function removePushStrings(strings: AndroidConfig.Resources.ResourceXML): AndroidConfig.Resources.ResourceXML {
  for (const name of channelStringNames) expoAndroid.Strings.removeStringItem(name, strings);
  return strings;
}

/**
 * The channel's id, name and description as string resources, which the manifest's meta-data refer to (`pushMetaData`): a text in a resource reaches the native code exactly as the config has it
 * (`androidStringText`), where the same text in `android:value` would be read by the resource compiler for a number, a boolean, a color or a reference. They are `translatable="false"`, which also
 * keeps Expo from escaping and unescaping them a second time (it does so for the strings it reads and writes), and `formatted="false"`.
 */
export function applyPushStrings(strings: AndroidConfig.Resources.ResourceXML, channel: NonNullable<PushSettings["android"]>["channel"]): AndroidConfig.Resources.ResourceXML {
  removePushStrings(strings);
  const entries: [string, string | undefined][] = [[pushResources.channelId, channel.id], [pushResources.channelName, channel.name], [pushResources.channelDescription, channel.description]];
  const items = entries.flatMap(([name, text]): AndroidConfig.Resources.ResourceItemXML[] => {
    if (text === undefined) return [];
    const attributes = { name, translatable: "false", formatted: "false" };
    return [{ $: attributes, _: androidStringText(text) }];
  });
  return expoAndroid.Strings.setStringItem(items, strings);
}

/** Copies the notification icon into the Android project's `res/drawable`, under the fixed name the manifest names. */
export async function copyPushIcon(source: string, platformProjectRoot: string): Promise<void> {
  const directory = join(platformProjectRoot, "app/src/main/res/drawable");
  await mkdir(directory, { recursive: true });
  await copyFile(source, join(directory, `${pushResources.icon}.png`));
}

/** Deletes the icon an earlier prebuild copied (its name is ours), for an app whose config has none now. */
export async function removePushIcon(platformProjectRoot: string): Promise<void> {
  await rm(join(platformProjectRoot, "app/src/main/res/drawable", `${pushResources.icon}.png`), { force: true });
}

/**
 * The Android side. Expo's own prebuild does the Firebase configuration when `android.googleServicesFile` is set (`AndroidConfig.GoogleServices`: it copies the file to
 * `android/app/google-services.json` and applies the `com.google.gms.google-services` Gradle plugin), so the capability sets that and writes the rest: Firebase Messaging's dependency in
 * `android/app/build.gradle` (`applyPushGradle`), the manifest's entries (the `enabled` flag, the messaging service, the meta-data) and the notification permission, the channel's strings, the
 * color and the icon file. Without `android` (the capability is off, or the config names no Android side) it writes nothing and takes away what an earlier prebuild wrote: the dependency,
 * the service, the flag and the permission it can tell is its own, and the rest, which is all under names that are ours. Not `android.googleServicesFile`, the copy of the file and the Gradle
 * plugin: nothing in the project says whose they are, and with no Firebase library left they do no harm.
 */
function withPushAndroid(config: ExpoConfig, android: NonNullable<PushSettings["android"]> | undefined, projectRoot: string): ExpoConfig {
  if (android) {
    const existing = config.android?.googleServicesFile;
    if (existing !== undefined && resolve(projectRoot, existing) !== resolve(projectRoot, android.googleServicesFile))
      throw new CapabilityConfigError(
        `The app config sets android.googleServicesFile ("${existing}") and capabilities.push.android.googleServicesFile is "${android.googleServicesFile}": keep one. capabilities.push.android.googleServicesFile sets android.googleServicesFile.`,
      );
    config = { ...config, android: { ...config.android, googleServicesFile: android.googleServicesFile } };
  }
  config = withAndroidManifest(config, (config) => {
    if (android) {
      applyPushManifest(expoAndroid.Manifest.getMainApplicationOrThrow(config.modResults), android);
      applyPushPermission(config.modResults);
    } else {
      const application = expoAndroid.Manifest.getMainApplication(config.modResults);
      if (application) {
        // The flag is what says the capability was on, so it is read before it is taken away.
        const wasOn = hasPushFlag(application);
        removePushManifest(application);
        if (wasOn) removePushPermission(config.modResults, config.android?.permissions);
      }
    }
    return config;
  });
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = android ? applyPushGradle(config.modResults.contents) : removePushGradle(config.modResults.contents);
    return config;
  });
  config = withStringsXml(config, (config) => {
    config.modResults = android ? applyPushStrings(config.modResults, android.channel) : removePushStrings(config.modResults);
    return config;
  });
  config = withAndroidColors(config, (config) => {
    // Sets the color, or takes the one of an earlier prebuild away when the config has none.
    config.modResults = expoAndroid.Colors.assignColorValue(config.modResults, { name: pushResources.color, value: android?.color });
    return config;
  });
  const icon = android?.icon;
  return withDangerousMod(config, ["android", async (config) => {
    if (icon === undefined) await removePushIcon(config.modRequest.platformProjectRoot);
    else await copyPushIcon(resolve(config.modRequest.projectRoot, icon), config.modRequest.platformProjectRoot);
    return config;
  }]);
}

/**
 * Takes what the capability wrote out of an app that has no push on iOS (the capability is off, or names no iOS side), when it has an iOS project at all: the `SveltePushEnabled` flag in
 * `Info.plist` (the native code is in the app either way, and must do nothing without it) and the push wrapper of `AppDelegate.swift` (`removePushAppDelegate`; an app built with the
 * separate package of an earlier version would otherwise stop on "No such module 'SveltePush'" once it is uninstalled). The entitlement and the background mode stay: they are in
 * `Info.plist` and the entitlements file with nothing that says the capability wrote them, and the app's own config or another library's plugin may be the one that wants them.
 */
function withoutPushIos(config: ExpoConfig, context: Context): ExpoConfig {
  if (!existsSync(join(context.projectRoot, "ios"))) return config;
  config = withInfoPlist(config, (config) => {
    delete config.modResults[pushInfoPlistFlag];
    return config;
  });
  config = withPodfileProperties(config, (config) => {
    delete config.modResults[pushPodfileProperty];
    return config;
  });
  return withAppDelegate(config, (config) => {
    if (config.modResults.language === "swift") config.modResults.contents = removePushAppDelegate(config.modResults.contents);
    return config;
  });
}

/** What `withPushAndroid` takes away for an app that has no push on Android, when it has an Android project at all (a project that does not exist has nothing of an earlier prebuild). */
function withoutPushAndroid(config: ExpoConfig, context: Context): ExpoConfig {
  return existsSync(join(context.projectRoot, "android")) ? withPushAndroid(config, undefined, context.projectRoot) : config;
}

function withPush(config: ExpoConfig, push: Capabilities["push"], context: Context): ExpoConfig {
  if (!pushIsOn(push)) {
    // The native code is in the app either way (it is part of the library's one native module), and does nothing without what the plugin writes. A prebuild that keeps the native projects
    // finds what the earlier one wrote and takes it away.
    return withoutPushAndroid(withoutPushIos(config, context), context);
  }
  const secret = findPushSecret(push, "capabilities.push");
  if (secret) throw secretError(secret);
  const other = otherPushLibraries.find((name) => context.linked.has(name));
  if (other !== undefined)
    throw new CapabilityConfigError(
      `capabilities.push is on, and ${other} is installed: an app has one push library (Android delivers a message to one FirebaseMessagingService, iOS has one notification center delegate). ` +
        `Uninstall ${other}, or turn the push capability off.`,
    );
  const settings = pushSettings(push, config.android?.package, context.projectRoot);
  config = settings.ios ? withPushIos(config, settings.ios.mode) : withoutPushIos(config, context);
  return settings.android ? withPushAndroid(config, settings.android, context.projectRoot) : withoutPushAndroid(config, context);
}
