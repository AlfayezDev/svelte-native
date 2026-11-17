// The `capabilities` option of the Expo config plugin (`src/capabilities.ts`): a capability gives its library's plugin the app's texts (`location`) or writes the
// entries its native code needs (`push`: svelte-core's, which is in every app, so what the plugin writes is what turns it on), and the half-made states (on without the library,
// the library without the capability, the capability and the library's own plugin entry both) stop the prebuild.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExpoConfig } from "expo/config";
import { AndroidConfig, compileModsAsync, withPlugins, XML, type ExportedConfig } from "expo/config-plugins";
import { CapabilityConfigError, type PushCapability, androidStringText, applyPushAppDelegate, applyPushGradle, applyPushManifest, applyPushPermission, applyPushStrings, copyPushIcon, defaultPushChannel, findPushSecret, locationPluginProps, postNotificationsPermission, pushFirebaseDependency, pushInfoPlistFlag, pushMessagingService, pushMetaData, pushResources, pushSettings, hasPushFlag, removePushAppDelegate, removePushGradle, removePushPermission, removePushIcon, removePushManifest, removePushStrings, withCapabilities } from "../../src/capabilities.ts";
import expoPlugin, { applyAppDelegate } from "../../src/expo.ts";
import { createProject } from "../support/project.ts";
import { expoTemplateAppBuildGradle, expoTemplateAppDelegate } from "./support/app-delegate.ts";
import { findHostJars } from "../support/host-tools.ts";
import { peerRange } from "../support/versions.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** An app whose package.json lists `dependencies`, in a directory that is removed when the test's block ends. */
const app = (dependencies: Record<string, string>, manifest: Record<string, unknown> = {}) => {
  const project = createProject({ "package.json": JSON.stringify({ name: "app", dependencies, ...manifest }) }, "svelte-native-capabilities-");
  return { root: project.directory, [Symbol.dispose]: () => project.remove() };
};
const expoLocation = { "expo-location": peerRange("expo-location") };

const thrown = (call: () => unknown): Error => { try { call(); } catch (error) { return error as Error; } throw new Error("did not throw"); };

/** A stand-in for expo-location's config plugin: records the props it was applied with. */
function fakePlugin() {
  const applied: Record<string, unknown>[] = [];
  const plugin = (config: any, props: Record<string, unknown>) => { applied.push(props); return { ...config, applied: true }; };
  return { applied, load: (request: string) => (request === "expo-location/package.json" ? { name: "expo-location" } : (expect(request).toBe("expo-location/app.plugin.js"), plugin)) };
}

describe("capabilities.location", () => {
  test("a string is the while-in-use text; nothing of the background unless it is asked for", () => {
    expect(locationPluginProps("Shows the stores near you.")).toEqual({
      locationWhenInUsePermission: "Shows the stores near you.",
      locationAlwaysAndWhenInUsePermission: false,
      locationAlwaysPermission: false,
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
    });
    expect(locationPluginProps({ whenInUse: "Shows the stores near you.", background: "Tells you when you reach the store." })).toEqual({
      locationWhenInUsePermission: "Shows the stores near you.",
      locationAlwaysAndWhenInUsePermission: "Tells you when you reach the store.",
      locationAlwaysPermission: "Tells you when you reach the store.",
      isIosBackgroundLocationEnabled: true,
      isAndroidBackgroundLocationEnabled: true,
    });
  });

  test("an empty text is refused: it is what the user reads when the app asks", () => {
    for (const location of ["", "  ", { whenInUse: "" }, { whenInUse: "ok", background: " " }, { whenInUse: "ok", motion: "" }] as any[]) expect(thrown(() => locationPluginProps(location))).toBeInstanceOf(CapabilityConfigError);
  });

  test("a motion text is passed as expo-location's NSMotionUsageDescription; without one, expo-location writes its own", () => {
    expect(locationPluginProps({ whenInUse: "Shows the stores near you.", motion: "Counts your steps." }).motionUsagePermission).toBe("Counts your steps.");
    expect("motionUsagePermission" in locationPluginProps("Shows the stores near you.")).toBe(false);
  });

  test("on, while expo-location is left out of autolinking: refused, since its plugin would silently do nothing", () => {
    using project = app(expoLocation);
    expect(thrown(() => withCapabilities({ name: "app" }, { location: "Shows the stores near you." }, { projectRoot: project.root, load: fakePlugin().load, excluded: ["expo-location"] })).message)
      .toContain("expo-location is left out of autolinking");
    using inManifest = app(expoLocation, { expo: { autolinking: { ios: { exclude: ["expo-location"] } } } });
    expect(thrown(() => withCapabilities({ name: "app" }, { location: "Shows the stores near you." }, { projectRoot: inManifest.root, load: fakePlugin().load })).message).toContain("left out of autolinking");
    // Off, the package.json's exclusion is honored like the plugin's: nothing to say.
    const config = { name: "app" };
    expect(withCapabilities(config, { location: false }, { projectRoot: inManifest.root })).toBe(config);
  });

  test("an expo-location whose plugin fails to load is reported as that, not as missing", () => {
    using project = app(expoLocation);
    const load = (request: string) => { if (request.endsWith("package.json")) return {}; throw new Error("Cannot find module '@expo/image-utils'"); };
    expect(thrown(() => withCapabilities({ name: "app" }, { location: "Shows the stores near you." }, { projectRoot: project.root, load })).message).toBe("expo-location's config plugin (expo-location/app.plugin.js) failed to load: Cannot find module '@expo/image-utils'");
  });

  test("on, with expo-location installed: its plugin is applied with the texts", () => {
    using project = app(expoLocation);
    const { applied, load } = fakePlugin();
    const result = withCapabilities({ name: "app" }, { location: "Shows the stores near you." }, { projectRoot: project.root, load }) as any;
    expect(result.applied).toBe(true);
    expect(applied).toEqual([locationPluginProps("Shows the stores near you.")]);
  });

  test("on, without expo-location: the prebuild stops and says what to install", () => {
    using project = app({});
    const error = thrown(() => withCapabilities({ name: "app" }, { location: "Shows the stores near you." }, { projectRoot: project.root, load: () => { throw new Error("Cannot find module"); } }));
    expect([error.name, error.message]).toEqual(["CapabilityConfigError", "capabilities.location needs expo-location, which is not installed: `npx expo install expo-location`, then prebuild again."]);
  });

  test("expo-location installed, the capability off: the prebuild stops instead of shipping Expo's default text", () => {
    using project = app(expoLocation);
    const error = thrown(() => withCapabilities({ name: "app" }, undefined, { projectRoot: project.root, load: fakePlugin().load }));
    expect(error).toBeInstanceOf(CapabilityConfigError);
    expect(error.message).toContain("expo-location is installed, but the location capability is off");
    expect(error.message).toContain('capabilities: { location: "Shows the stores near you." }');
    expect(thrown(() => withCapabilities({ name: "app" }, {}, { projectRoot: project.root })).message).toContain("the location capability is off");
    expect(thrown(() => withCapabilities({ name: "app" }, { location: false }, { projectRoot: project.root })).message).toContain("the location capability is off");
  });

  test("off, and expo-location not installed or left out of autolinking: nothing changes", () => {
    using bare = app({ expo: peerRange("expo") });
    const config = { name: "app" };
    expect(withCapabilities(config, undefined, { projectRoot: bare.root })).toBe(config);
    using excluded = app(expoLocation);
    expect(withCapabilities(config, undefined, { projectRoot: excluded.root, excluded: ["expo-location"] })).toBe(config);
  });

  test("expo-location's own plugin entry configures it: no capability is needed, and both at once are refused", () => {
    using project = app(expoLocation);
    for (const entry of ["expo-location", ["expo-location", { locationWhenInUsePermission: "Shows the stores near you." }]]) {
      const config = { name: "app", plugins: [entry] };
      expect(withCapabilities(config, undefined, { projectRoot: project.root })).toBe(config);
      const error = thrown(() => withCapabilities(config, { location: "Shows the stores near you." }, { projectRoot: project.root, load: fakePlugin().load }));
      expect([error.name, error.message.startsWith("The app config sets capabilities.location and also lists expo-location's own plugin")]).toEqual(["CapabilityConfigError", true]);
    }
  });

  test("the real expo-location plugin writes the texts into Info.plist, and none for the background unless asked", async () => {
    using project = app(expoLocation);
    // The optional peer, installed with the library's development dependencies.
    const library = createRequire(resolve(import.meta.dirname, "../../package.json"));
    const { compileModsAsync } = library("expo/config-plugins") as typeof import("expo/config-plugins");
    const plist = async (location: any) => {
      const base = { name: "app", slug: "app", _internal: { projectRoot: project.root }, ios: { infoPlist: { NSLocationAlwaysUsageDescription: "stale" } } };
      const config = withCapabilities(base as any, { location }, { projectRoot: project.root, load: (request) => library(request) }) as any;
      // Expo's run-once record: the auto plugin Expo applies for an installed expo-location now does nothing.
      expect(Object.keys(config._internal.pluginHistory ?? {})).toContain("expo-location");
      const compiled = await compileModsAsync(config, { projectRoot: project.root, introspect: true, platforms: ["ios"], assertMissingModProviders: false });
      return (compiled.ios?.infoPlist ?? {}) as Record<string, unknown>;
    };
    const plain = await plist("Shows the stores near you.");
    expect(plain.NSLocationWhenInUseUsageDescription).toBe("Shows the stores near you.");
    expect(["NSLocationAlwaysAndWhenInUseUsageDescription" in plain, "NSLocationAlwaysUsageDescription" in plain, "UIBackgroundModes" in plain]).toEqual([false, false, false]);
    // CoreMotion is linked with expo-location: the motion key is always there, expo-location's text unless the app gives one.
    expect(String(plain.NSMotionUsageDescription)).toContain("motion activity");
    const full = await plist({ whenInUse: "Shows the stores near you.", background: "Tells you when you reach the store.", motion: "Counts your steps." });
    expect([full.NSLocationAlwaysAndWhenInUseUsageDescription, full.NSMotionUsageDescription, full.UIBackgroundModes]).toEqual(["Tells you when you reach the store.", "Counts your steps.", ["location"]]);
  });
});

/** An app with a Google services file for `io.e.a` and an icon (and the `dependencies` it is given: push has no package of its own), in a directory that is removed when the test's block ends. */
const pushApp = (dependencies: Record<string, string> = {}, files: Record<string, string> = {}, manifest: Record<string, unknown> = {}) => {
  const project = createProject(
    { "package.json": JSON.stringify({ name: "app", dependencies, ...manifest }), "google-services.json": googleServices("io.e.a"), "assets/notify.png": "not really a png", ...files },
    "svelte-native-capabilities-",
  );
  return { root: project.directory, write: project.write, [Symbol.dispose]: () => project.remove() };
};
/** A `google-services.json` with a client for each of the packages: what Firebase writes, less what the plugin does not read. */
const googleServices = (...packages: string[]) =>
  JSON.stringify({ project_info: { project_id: "demo" }, client: packages.map((name) => ({ client_info: { mobilesdk_app_id: "1:1:android:1", android_client_info: { package_name: name } } })), configuration_version: "1" });
const fullPush = { android: { googleServicesFile: "./google-services.json", icon: "./assets/notify.png", color: "#0a7f5a", channel: { name: "Updates", description: "Order updates" } }, ios: { mode: "production" as const } };

const appConfig = (root: string, extra: Partial<ExpoConfig> = {}): ExpoConfig => ({ name: "app", slug: "app", _internal: { projectRoot: root }, android: { package: "io.e.a" }, ios: { bundleIdentifier: "io.e.a" }, ...extra });
/** The config after the capability, for a `push` that may be as wrong as an app's config can be (a JavaScript config is not type-checked). */
const withPush = (project: { root: string }, push: unknown, config: ExpoConfig = appConfig(project.root), options: { excluded?: string[] } = {}): ExportedConfig =>
  withCapabilities(config, { push: push as PushCapability }, { projectRoot: project.root, ...options });
const mods = (config: ExportedConfig) => config.mods as Record<string, Record<string, (config: object) => Promise<unknown>>>;

/** What Expo's mods make of the config's Android and iOS parts, without writing files (its introspection): the manifest, `colors.xml`, `strings.xml`, `Info.plist` and the entitlements. */
async function compile(config: ExportedConfig) {
  const compiled = await compileModsAsync(config, { projectRoot: String(config._internal?.projectRoot), introspect: true, platforms: ["android", "ios"], assertMissingModProviders: false });
  const results = compiled._internal?.modResults;
  return {
    manifest: results.android.manifest.manifest as { application: AndroidConfig.Manifest.ManifestApplication[] },
    colors: results.android.colors as AndroidConfig.Resources.ResourceXML,
    strings: results.android.strings as AndroidConfig.Resources.ResourceXML,
    infoPlist: compiled.ios?.infoPlist,
    entitlements: compiled.ios?.entitlements,
  };
}
/** The `<string>` entries of a `strings.xml` as written (`name` to its content), without the attributes: the plugin's own are `translatable="false" formatted="false"`. */
const stringResources = (strings: AndroidConfig.Resources.ResourceXML) => Object.fromEntries((strings.resources.string ?? []).map((item) => [item.$.name, item._]));
const metaData = (manifest: { application?: AndroidConfig.Manifest.ManifestApplication[] }) =>
  Object.fromEntries((manifest.application?.[0]?.["meta-data"] ?? []).map((item) => [item.$["android:name"], item.$["android:value"] ?? item.$["android:resource"]]));

describe("capabilities.push", () => {
  test("iOS: the aps-environment entitlement from the mode, and remote-notification among the background modes", async () => {
    using project = pushApp();
    for (const mode of ["production", "development"] as const) {
      const { entitlements, infoPlist } = await compile(withPush(project, { ios: { mode } }));
      expect([mode, entitlements, infoPlist?.UIBackgroundModes]).toEqual([mode, { "aps-environment": mode }, ["remote-notification"]]);
    }
  });

  test("iOS: the app's other background modes and entitlements stay, and remote-notification is there once", async () => {
    using project = pushApp();
    const ios = (infoPlist: object, entitlements: object = {}) => appConfig(project.root, { ios: { bundleIdentifier: "io.e.a", infoPlist, entitlements } });
    const kept = await compile(withPush(project, { ios: { mode: "production" } }, ios({ UIBackgroundModes: ["fetch", "audio"] }, { "com.apple.developer.associated-domains": ["applinks:app.example"] })));
    expect(kept.infoPlist?.UIBackgroundModes).toEqual(["fetch", "audio", "remote-notification"]);
    expect(kept.entitlements).toEqual({ "com.apple.developer.associated-domains": ["applinks:app.example"], "aps-environment": "production" });
    expect((await compile(withPush(project, { ios: { mode: "production" } }, ios({ UIBackgroundModes: ["remote-notification", "fetch"] })))).infoPlist?.UIBackgroundModes).toEqual(["remote-notification", "fetch"]);
  });

  test("iOS: the app's own aps-environment of the same value is one answer, another value is two", () => {
    using project = pushApp();
    const ios = (entitlements: object) => appConfig(project.root, { ios: { bundleIdentifier: "io.e.a", entitlements } });
    expect(withPush(project, { ios: { mode: "production" } }, ios({ "aps-environment": "production" })).ios?.entitlements).toEqual({ "aps-environment": "production" });
    const error = thrown(() => withPush(project, { ios: { mode: "development" } }, ios({ "aps-environment": "production" })));
    expect([error.name, error.message]).toEqual(["CapabilityConfigError", 'The app config sets ios.entitlements["aps-environment"] ("production") and capabilities.push.ios.mode is "development": keep one. capabilities.push.ios.mode writes the entitlement.']);
  });

  test("Android: android.googleServicesFile is set, and Expo's own prebuild step copies it and applies the Google services Gradle plugin", () => {
    using project = pushApp();
    const config = withPush(project, { android: { googleServicesFile: "./google-services.json" } });
    expect(config.android).toEqual({ package: "io.e.a", googleServicesFile: "./google-services.json" });
    // What `@expo/prebuild-config` runs on every prebuild (`AndroidConfig.GoogleServices`: the class path, the plugin, the copy of the file) reads that key; the capability's own Gradle mod is Firebase Messaging's dependency alone.
    expect(AndroidConfig.GoogleServices.getGoogleServicesFilePath(config)).toBe("./google-services.json");
    expect(AndroidConfig.GoogleServices.setClassPath(config, "buildscript {\n  dependencies {\n  }\n}")).toContain("classpath 'com.google.gms:google-services:");
    expect(AndroidConfig.GoogleServices.applyPlugin(config, "android {}\n")).toContain("apply plugin: 'com.google.gms.google-services'");
    expect(Object.keys(mods(config).android).filter((mod) => /gradle/i.test(mod))).toEqual(["appBuildGradle"]);
  });

  test("Android: the app's own android.googleServicesFile of the same file is one answer, another file is two", () => {
    using project = pushApp({}, { "other.json": googleServices("io.e.a") });
    const android = (googleServicesFile: string) => appConfig(project.root, { android: { package: "io.e.a", googleServicesFile } });
    expect(withPush(project, { android: { googleServicesFile: "google-services.json" } }, android("./google-services.json")).android?.googleServicesFile).toBe("google-services.json");
    const error = thrown(() => withPush(project, { android: { googleServicesFile: "./other.json" } }, android("./google-services.json")));
    expect([error.name, error.message]).toEqual([
      "CapabilityConfigError",
      'The app config sets android.googleServicesFile ("./google-services.json") and capabilities.push.android.googleServicesFile is "./other.json": keep one. capabilities.push.android.googleServicesFile sets android.googleServicesFile.',
    ]);
  });

  test("Android: the manifest names the icon and color resources (Firebase's defaults) and the channel, whose texts are string resources", async () => {
    using project = pushApp();
    const { manifest, strings } = await compile(withPush(project, fullPush));
    // The texts are references (`android:value="@string/…"`), not the texts: the resource compiler would read a text that looks like a number, a color or a reference for one.
    expect(metaData(manifest)).toEqual({
      "expo.modules.sveltepush.enabled": "true",
      "com.google.firebase.messaging.default_notification_icon": "@drawable/svelte_push_icon",
      "com.google.firebase.messaging.default_notification_color": "@color/svelte_push_color",
      "com.google.firebase.messaging.default_notification_channel_id": "@string/svelte_push_channel_id",
      "expo.modules.sveltepush.channel_id": "@string/svelte_push_channel_id",
      "expo.modules.sveltepush.channel_name": "@string/svelte_push_channel_name",
      "expo.modules.sveltepush.channel_description": "@string/svelte_push_channel_description",
    });
    expect(stringResources(strings)).toEqual({ svelte_push_channel_id: '"default"', svelte_push_channel_name: '"Updates"', svelte_push_channel_description: '"Order updates"' });
    // A channel with its own id.
    const orders = withPush(project, { android: { googleServicesFile: "./google-services.json", channel: { id: "orders", name: "Orders" } } });
    const own = await compile(orders);
    expect(metaData(own.manifest)).toEqual({
      [pushMetaData.enabled]: "true", [pushMetaData.firebaseChannel]: "@string/svelte_push_channel_id", [pushMetaData.channelId]: "@string/svelte_push_channel_id", [pushMetaData.channelName]: "@string/svelte_push_channel_name",
    });
    expect(stringResources(own.strings)).toEqual({ svelte_push_channel_id: '"orders"', svelte_push_channel_name: '"Orders"' });
  });

  test("Android: with only the file, no icon or color is named and the channel is the default one", async () => {
    using project = pushApp();
    const { manifest, strings } = await compile(withPush(project, { android: { googleServicesFile: "./google-services.json" } }));
    expect(metaData(manifest)).toEqual({
      [pushMetaData.enabled]: "true",
      [pushMetaData.firebaseChannel]: "@string/svelte_push_channel_id",
      [pushMetaData.channelId]: "@string/svelte_push_channel_id",
      [pushMetaData.channelName]: "@string/svelte_push_channel_name",
    });
    expect(stringResources(strings)).toEqual({ svelte_push_channel_id: `"${defaultPushChannel.id}"`, svelte_push_channel_name: `"${defaultPushChannel.name}"` });
    expect(defaultPushChannel).toEqual({ id: "default", name: "Notifications" });
  });

  test("Android: an entry of the same name that the manifest already has is replaced (one entry, one attribute), and its others stay", () => {
    const application: AndroidConfig.Manifest.ManifestApplication = { $: { "android:name": ".MainApplication" }, "meta-data": [{ $: { "android:name": pushMetaData.icon, "android:value": "@mipmap/old" } }, { $: { "android:name": "com.example.key", "android:value": "1" } }] };
    applyPushManifest(application, { googleServicesFile: "g.json", icon: "i.png", channel: { id: "default", name: "Updates" } });
    const entries = Object.fromEntries((application["meta-data"] ?? []).map((item) => [item.$["android:name"], item.$]));
    expect(entries[pushMetaData.icon]).toEqual({ "android:name": pushMetaData.icon, "android:resource": "@drawable/svelte_push_icon" });
    expect(entries["com.example.key"]).toEqual({ "android:name": "com.example.key", "android:value": "1" });
    expect((application["meta-data"] ?? []).filter((item) => item.$["android:name"] === pushMetaData.icon)).toHaveLength(1);
    // An application with no entries at all gets its own.
    const bare: AndroidConfig.Manifest.ManifestApplication = { $: { "android:name": ".MainApplication" } };
    applyPushManifest(bare, { googleServicesFile: "g.json", color: "#fff", channel: { id: "default", name: "Updates" } });
    expect((bare["meta-data"] ?? []).map((item) => item.$["android:name"])).toEqual([pushMetaData.enabled, pushMetaData.color, pushMetaData.firebaseChannel, pushMetaData.channelId, pushMetaData.channelName]);
  });

  test("Android: the color becomes a color resource, and without one colors.xml is not touched", async () => {
    using project = pushApp();
    const { colors } = await compile(withPush(project, fullPush));
    expect(colors.resources.color).toEqual([{ $: { name: "svelte_push_color" }, _: "#0a7f5a" }]);
    const bare = await compile(withPush(project, { android: { googleServicesFile: "./google-services.json" } }));
    expect(JSON.stringify(bare.colors)).not.toContain("svelte_push_color");
  });

  test("Android: the icon is copied into res/drawable under its fixed name by a dangerous mod, and a config without one takes the earlier prebuild's copy away", async () => {
    using project = pushApp({}, { "assets/notify.png": "the icon's bytes" });
    const target = mkdtempSync(join(tmpdir(), "svelte-native-push-icon-"));
    const icon = join(target, "app/src/main/res/drawable/svelte_push_icon.png");
    const runDangerous = async (config: ExportedConfig) => mods(config).android.dangerous({ ...config, modRequest: { projectRoot: project.root, platformProjectRoot: target, platform: "android", modName: "dangerous", introspect: false }, modResults: {} });
    try {
      await runDangerous(withPush(project, fullPush));
      expect(readFileSync(icon, "utf8")).toBe("the icon's bytes");
      expect(pushResources.icon).toBe("svelte_push_icon");
      // A later prebuild copies over the file of the earlier one.
      project.write("assets/notify.png", "a new icon");
      await copyPushIcon(join(project.root, "assets/notify.png"), target);
      expect(readFileSync(icon, "utf8")).toBe("a new icon");
      // A config that has no icon any more takes the copy away (the name is the capability's), and one that never had any finds nothing to take.
      await runDangerous(withPush(project, { android: { googleServicesFile: "./google-services.json" } }));
      expect(existsSync(icon)).toBe(false);
      await removePushIcon(target);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("a platform that is not named is not touched", () => {
    using project = pushApp();
    const androidOnly = withPush(project, { android: { googleServicesFile: "./google-services.json" } });
    expect(androidOnly.ios).toEqual({ bundleIdentifier: "io.e.a" });
    expect(Object.keys(androidOnly.mods ?? {})).toEqual(["android"]);
    const iosOnly = withPush(project, { ios: { mode: "development" } });
    expect(iosOnly.android).toEqual({ package: "io.e.a" });
    // The one iOS mod is the AppDelegate patch (the first screen of a launch in the background); the Info.plist (the flag and the background mode) and the entitlements are the config's own keys.
    expect(Object.keys(mods(iosOnly))).toEqual(["ios"]);
    expect(Object.keys(mods(iosOnly).ios)).toEqual(["appDelegate"]);
  });

  test("the Expo plugin passes the capability on: its entries land in the config, with no library to install and nothing to leave out of autolinking", () => {
    using project = pushApp();
    const config = withPlugins(appConfig(project.root), [[expoPlugin, { capabilities: { push: fullPush } }]]);
    expect([config.android?.googleServicesFile, config.ios?.entitlements, config.ios?.infoPlist?.UIBackgroundModes]).toEqual(["./google-services.json", { "aps-environment": "production" }, ["remote-notification"]]);
    expect(config.ios?.infoPlist?.[pushInfoPlistFlag]).toBe(true);
  });

  test("off, with no native project to clean: nothing changes, whatever the app depends on", () => {
    const config = appConfig("");
    using bare = pushApp({ expo: peerRange("expo") });
    for (const push of [undefined, false] as const) expect(withCapabilities(config, { push }, { projectRoot: bare.root })).toBe(config);
    expect(withCapabilities(config, undefined, { projectRoot: bare.root })).toBe(config);
    // The package of an earlier version is not looked for: an app that still lists it is neither refused nor changed.
    using old = pushApp({ "@alfayez/svelte-native-push": "0.4.0-rc.8" });
    expect(withCapabilities(config, { push: false }, { projectRoot: old.root })).toBe(config);
    expect(withCapabilities(config, undefined, { projectRoot: old.root })).toBe(config);
  });
});

describe("capabilities.push on Android: Firebase Messaging, the service, the permission and the flag are the plugin's, because svelte-core is in every app", () => {
  const gradle = expoTemplateAppBuildGradle();
  const line = `    implementation("${pushFirebaseDependency}") // Svelte native: push, Firebase Messaging (generated, do not edit)\n`;

  test("the dependency is Firebase Messaging at the exact version svelte-core compiles against, and nothing else (no BOM)", () => {
    expect(pushFirebaseDependency).toMatch(/^com\.google\.firebase:firebase-messaging:\d+\.\d+\.\d+$/);
    expect(pushFirebaseDependency).toBe("com.google.firebase:firebase-messaging:26.0.2");
  });

  test("it goes first into the dependencies block of the template's app build.gradle, which is otherwise as it was", () => {
    const once = applyPushGradle(gradle);
    expect(once).toContain(`\ndependencies {\n${line}    // The version of react-native is set by the React Native Gradle Plugin\n`);
    expect(once.replace(line, "")).toBe(gradle);
    expect(once.split("\n").filter((text) => text.includes("firebase-messaging"))).toHaveLength(1);
  });

  test("applying it again changes nothing, a line of an older version is replaced and not kept beside it, and taking it away gives the template back", () => {
    const once = applyPushGradle(gradle);
    expect(applyPushGradle(once)).toBe(once);
    const older = once.replace(pushFirebaseDependency, "com.google.firebase:firebase-messaging:25.0.0");
    expect(older).not.toBe(once);
    expect(applyPushGradle(older)).toBe(once);
    expect(removePushGradle(once)).toBe(gradle);
    expect(removePushGradle(older)).toBe(gradle);
    expect(removePushGradle(gradle)).toBe(gradle);
  });

  test("only the line that carries the plugin's comment is taken away: the app's own Firebase dependency, at its own version, stays", () => {
    const mine = gradle.replace("dependencies {\n", 'dependencies {\n    implementation("com.google.firebase:firebase-messaging:24.1.0")\n    implementation platform("com.google.firebase:firebase-bom:33.0.0")\n');
    expect(removePushGradle(applyPushGradle(mine))).toBe(mine);
  });

  test("a file with no dependencies block at the left margin stops the prebuild, and says what it looked for", () => {
    const error = thrown(() => applyPushGradle("android {\n  dependencies {\n  }\n}\n"));
    expect(error.message).toStartWith("Svelte native could not find the `dependencies {` block of android/app/build.gradle.");
  });

  test("the plugin's Gradle mod writes it for an app with push on Android, and takes it away for one without", async () => {
    using project = pushApp();
    const run = (config: ExportedConfig, contents: string) =>
      (mods(config).android.appBuildGradle as (config: object) => Promise<{ modResults: { contents: string } }>)({ modRequest: {}, modResults: { language: "groovy", path: "build.gradle", contents } });
    const on = withPush(project, { android: { googleServicesFile: "./google-services.json" } });
    expect((await run(on, gradle)).modResults.contents).toBe(applyPushGradle(gradle));
    // Push on for iOS alone is no push on Android: the mod that exists (only where there is a project to clean) takes the line away.
    using withProject = pushApp({}, { "android/app/build.gradle": "" });
    const iosOnly = withPush(withProject, { ios: { mode: "production" } });
    expect((await run(iosOnly, applyPushGradle(gradle))).modResults.contents).toBe(gradle);
    expect(withPush(project, { ios: { mode: "production" } }).mods?.android).toBeUndefined();
  });

  test("the manifest has the enabled flag, the messaging service (not exported, with Firebase's event) and POST_NOTIFICATIONS, each once, beside what the app has", async () => {
    using project = pushApp();
    const { manifest } = await compile(withPush(project, { android: { googleServicesFile: "./google-services.json" } }));
    const application = manifest.application[0] as AndroidConfig.Manifest.ManifestApplication;
    expect(metaData(manifest)[pushMetaData.enabled]).toBe("true");
    expect(pushMetaData.enabled).toBe("expo.modules.sveltepush.enabled");
    expect(application.service).toEqual([
      { $: { "android:name": "expo.modules.sveltepush.SveltePushMessagingService", "android:exported": "false" }, "intent-filter": [{ action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }] }] },
    ]);
    // The service takes Firebase's event at the default priority, which beats Firebase's own service (-500): there is no `android:priority` to lower it.
    expect(JSON.stringify(application.service)).not.toContain("priority");
    const permissions = ((manifest as unknown as { "uses-permission"?: { $: Record<string, string> }[] })["uses-permission"] ?? []).map((item) => item.$["android:name"]);
    expect(permissions.filter((name) => name === "android.permission.POST_NOTIFICATIONS")).toHaveLength(1);
    expect(pushMessagingService).toBe("expo.modules.sveltepush.SveltePushMessagingService");
  });

  test("an app that already has the permission (its own config, or the template's) is not given a second", () => {
    const manifest = { manifest: { "uses-permission": [{ $: { "android:name": postNotificationsPermission } }], application: [] } } as unknown as AndroidConfig.Manifest.AndroidManifest;
    applyPushPermission(manifest);
    applyPushPermission(manifest);
    expect(manifest.manifest["uses-permission"]).toHaveLength(1);
    const bare = { manifest: { application: [] } } as unknown as AndroidConfig.Manifest.AndroidManifest;
    applyPushPermission(bare);
    expect(bare.manifest["uses-permission"]).toEqual([{ $: { "android:name": postNotificationsPermission } }]);
    removePushPermission(bare, undefined);
    expect(bare.manifest["uses-permission"]).toEqual([]);
    removePushPermission(bare, undefined);
  });

  test("the flag is how the plugin tells its permission from the app's: it is there only after push was on", () => {
    expect(hasPushFlag({ $: { "android:name": ".MainApplication" }, "meta-data": [{ $: { "android:name": pushMetaData.enabled, "android:value": "true" } }] })).toBe(true);
    expect(hasPushFlag({ $: { "android:name": ".MainApplication" }, "meta-data": [{ $: { "android:name": pushMetaData.channelId, "android:value": "x" } }] })).toBe(false);
    expect(hasPushFlag({ $: { "android:name": ".MainApplication" } })).toBe(false);
  });
});

describe("capabilities.push on iOS: a push that wakes the app mounts no screen", () => {
  const template = expoTemplateAppDelegate();
  /** The call the wrapper holds, as Expo's template writes it. */
  const call = '    factory.startReactNative(\n      withModuleName: "main",\n      in: window,\n      launchOptions: launchOptions)';

  test("the template's startReactNative call is wrapped and not changed: it runs in its place in a launch in the foreground, and when the app is active in one in the background", () => {
    const once = applyPushAppDelegate(template);
    // The call stands between the helper's two halves, character for character.
    expect(once).toContain(`      surface: { [self] in\n${call}\n      })\n    // Svelte native: end of the first screen of a launch in the background\n`);
    // The host is what the first startReactNative would start before it made the surface: the factory's own root view factory, with the bundle and dev menu the factory would pass.
    expect(once).toContain("factory.rootViewFactory.initializeReactHost(\n          launchOptions: launchOptions,\n          bundleConfiguration: factory.bundleConfiguration,\n          devMenuConfiguration: factory.devMenuConfiguration ?? RCTDevMenuConfiguration.default())");
    expect(once).toContain("SveltePushBackgroundLaunch.start(\n      application,\n      host: {");
    // After the window is made, before the template's last line, inside the `#if` that guards them both, and with the import of the module that holds the helper.
    expect(once.indexOf("window = UIWindow(frame: UIScreen.main.bounds)")).toBeLessThan(once.indexOf("SveltePushBackgroundLaunch.start("));
    expect(once.indexOf("end of the first screen of a launch in the background")).toBeLessThan(once.indexOf("#endif"));
    expect(once.indexOf("#endif")).toBeLessThan(once.indexOf("return super.application(application, didFinishLaunchingWithOptions: launchOptions)"));
    // `SveltePushBackgroundLaunch` is in the SvelteCore pod now, and the import is `internal` as the navigation patch's own import of the same module is (Expo's generated provider imports
    // every module that way, and a plain import of the same module in the app target is ambiguous): one line, with a comment that tells it from the navigation patch's.
    expect(once).toMatch(/^internal import SvelteCore \/\/ Svelte native: push, the first screen of a launch in the background \(generated, do not edit\)$/m);
    expect(once.match(/^.*import .*$/gm)?.filter((line) => line.includes("SveltePush") || /import SvelteCore/.test(line))).toEqual(["internal import SvelteCore // Svelte native: push, the first screen of a launch in the background (generated, do not edit)"]);
    expect(once.indexOf("import SvelteCore")).toBeGreaterThan(once.indexOf("import ReactAppDependencyProvider"));
    expect(once.indexOf("import SvelteCore")).toBeLessThan(once.indexOf("@main"));
  });

  test("taking the wrapper away gives the template back, and applying again changes nothing", () => {
    const once = applyPushAppDelegate(template);
    expect(once.replace(/\n {4}\/\/ Svelte native: push, the first screen[\s\S]*?surface: \{ \[self\] in(?=\n)/, "").replace(/\n {6}\}\)\n {4}\/\/ Svelte native: end of the first screen of a launch in the background(?=\n)/, "").replace(/^internal import SvelteCore .*push.*\n/m, "")).toBe(template);
    expect(applyPushAppDelegate(once)).toBe(once);
    expect(once.match(/import SvelteCore/g)).toHaveLength(1);
    expect(once.match(/SveltePushBackgroundLaunch\.start\(/g)).toHaveLength(1);
    expect(once.match(/factory\.startReactNative\(/g)).toHaveLength(1);
  });

  test("what an older version wrote is replaced and not kept beside the new wrapper", () => {
    const once = applyPushAppDelegate(template);
    const older = once.replace("bundleConfiguration: factory.bundleConfiguration,", "bundleConfiguration: RCTBundleConfiguration.default(),");
    expect(older).not.toBe(once);
    expect(applyPushAppDelegate(older)).toBe(once);
  });

  test("an AppDelegate that the separate package's version of the plugin patched is cleaned and patched again: its import of the module `SveltePush` goes, SvelteCore's takes its place", () => {
    const once = applyPushAppDelegate(template);
    const earlier = once.replace("internal import SvelteCore // Svelte native: push,", "internal import SveltePush // Svelte native: push,");
    expect(earlier).toContain("internal import SveltePush // Svelte native: push,");
    expect(applyPushAppDelegate(earlier)).toBe(once);
    expect(removePushAppDelegate(earlier)).toBe(template);
  });

  test("it goes with the navigation patch, in either order, and each leaves the other's text alone", () => {
    const navigationFirst = applyPushAppDelegate(applyAppDelegate(template));
    const pushFirst = applyAppDelegate(applyPushAppDelegate(template));
    expect(navigationFirst).toContain("SvelteNavigationRestoration.shouldSave(coder)");
    expect(navigationFirst).toContain("SveltePushBackgroundLaunch.start(");
    // The two blocks sit in different places (the property section, the launch), so the order the mods run in does not matter.
    expect(applyPushAppDelegate(navigationFirst)).toBe(navigationFirst);
    expect(applyAppDelegate(pushFirst)).toBe(pushFirst);
    expect(navigationFirst.replace(/^internal import Svelte(?:Core|Push) .*\n/gm, "").replace(/\n {2}\/\/ Svelte native: navigation state restoration[\s\S]*?end of navigation state restoration/, "").replace(/\n {4}\/\/ Svelte native: push, the first screen[\s\S]*?surface: \{ \[self\] in(?=\n)/, "").replace(/\n {6}\}\)\n {4}\/\/ Svelte native: end of the first screen of a launch in the background(?=\n)/, "")).toBe(template);
    expect(pushFirst.split("\n").length).toBe(navigationFirst.split("\n").length);
  });

  test("a template without the call, or with a call it was not written for, stops the prebuild and says what it looked for", () => {
    for (const changed of [
      template.replace("factory.startReactNative(", "factory.start("),
      template.replace("launchOptions: launchOptions)\n#endif", "launchOptions: nil)\n#endif"),
      template.replace('withModuleName: "main",', "withModuleName: moduleName(),"),
      template.replace("_ application: UIApplication,\n    didFinishLaunchingWithOptions", "_ app: UIApplication,\n    didFinishLaunchingWithOptions"),
      "import UIKit\n@main class AppDelegate: UIResponder {}",
    ]) {
      const error = thrown(() => applyPushAppDelegate(changed));
      expect(error.message).toStartWith("Svelte native could not find the imports and `factory.startReactNative(withModuleName: …, in: window, launchOptions: launchOptions)` in application(_:didFinishLaunchingWithOptions:) of AppDelegate.swift.");
      expect(error.message).toContain("Push needs the call");
    }
  });

  test("the plugin applies it to the AppDelegate of an app with push on iOS, and to no other: a Kotlin or Objective-C delegate stops, and an app without push on iOS has no such mod", async () => {
    using project = pushApp();
    const run = (config: ExportedConfig, modResults: object) => (mods(config).ios.appDelegate as (config: object) => Promise<{ modResults: { contents: string } }>)({ modRequest: {}, modResults });
    const patched = await run(withPush(project, { ios: { mode: "production" } }), { language: "swift", path: "AppDelegate.swift", contents: template });
    expect(patched.modResults.contents).toBe(applyPushAppDelegate(template));
    const refused = await run(withPush(project, { ios: { mode: "production" } }), { language: "objc", path: "AppDelegate.mm", contents: "" }).catch((error: Error) => error);
    expect((refused as Error).message).toBe("Svelte native requires Expo's Swift AppDelegate");
    expect(withPush(project, { android: { googleServicesFile: "./google-services.json" } }).mods?.ios).toBeUndefined();
  });
});

describe("capabilities.push: the channel's texts reach the native code exactly", () => {
  /** Texts the resource compiler would take for something else in `android:value`: a number, a float, a boolean, a color, a reference, or a reference that does not resolve. */
  const misread = ["007", "0x10", "1e3", "true", "False", "#fff", "@null", "@empty", "@string/nothere", "?what", "@+id/x", " 12"];

  test("the text is quoted and escaped as an Android string resource: whitespace kept, a leading @ or ? escaped, control characters as \\uXXXX", () => {
    const cases: [string, string][] = [
      ["Updates", '"Updates"'],
      ["@mentions", '"\\@mentions"'],
      ["?what", '"\\?what"'],
      ["007", '"007"'],
      ['say "hi"', '"say \\"hi\\""'],
      ["C:\\path", '"C:\\\\path"'],
      ["line1\nline2\tx", '"line1\\nline2\\tx"'],
      ["bell\u0007", '"bell\\u0007"'],
      ["  padded  ", '"  padded  "'],
      ["Don't miss 50% off", '"Don\'t miss 50% off"'],
      ["a@b?c", '"a@b?c"'],
    ];
    for (const [text, content] of cases) expect([text, androidStringText(text)]).toEqual([text, content]);
  });

  test("a text the resource compiler would misread is in strings.xml, and the manifest holds only references to it", async () => {
    using project = pushApp();
    for (const text of misread) {
      const { manifest, strings } = await compile(withPush(project, { android: { googleServicesFile: "./google-services.json", channel: { id: text, name: text, description: text } } }));
      expect(Object.entries(metaData(manifest)).filter(([name]) => name !== pushMetaData.enabled).every(([, value]) => /^@string\//.test(String(value))), text).toBe(true);
      expect(metaData(manifest)[pushMetaData.enabled]).toBe("true");
      expect(stringResources(strings), text).toEqual({ svelte_push_channel_id: androidStringText(text), svelte_push_channel_name: androidStringText(text), svelte_push_channel_description: androidStringText(text) });
    }
  });

  test("the strings are written as they are read back: translatable=\"false\" keeps Expo from escaping them again, formatted=\"false\" makes a % a %", async () => {
    using project = pushApp();
    const { strings } = await compile(withPush(project, { android: { googleServicesFile: "./google-services.json", channel: { name: "50% off", description: 'say "hi"' } } }));
    expect((strings.resources.string ?? []).map((item) => item.$)).toEqual([
      { name: "svelte_push_channel_id", translatable: "false", formatted: "false" },
      { name: "svelte_push_channel_name", translatable: "false", formatted: "false" },
      { name: "svelte_push_channel_description", translatable: "false", formatted: "false" },
    ]);
    // Expo writes the strings of the app that are not translatable as they are: the escaping above is the whole of it.
    const written = XML.format({ resources: { string: [{ $: { name: "x", translatable: "false" }, _: androidStringText('say "hi"') }] } });
    expect(written).toContain('>"say \\"hi\\""</string>');
  });

  test("what an earlier prebuild wrote is replaced, and a description or icon the config no longer has is taken away", () => {
    const earlier = { googleServicesFile: "g.json", icon: "i.png", color: "#fff", channel: { id: "orders", name: "Orders", description: "Order updates" } };
    const application: AndroidConfig.Manifest.ManifestApplication = { $: { "android:name": ".MainApplication" }, "meta-data": [{ $: { "android:name": "com.example.key", "android:value": "1" } }] };
    const strings: AndroidConfig.Resources.ResourceXML = { resources: { string: [{ $: { name: "app_name" }, _: "App" }] } };
    applyPushManifest(application, earlier);
    applyPushStrings(strings, earlier.channel);
    expect(Object.keys(metaData({ application: [application] }))).toContain(pushMetaData.channelDescription);
    // The config drops the description, the icon and the color, and renames the channel.
    const now = { googleServicesFile: "g.json", channel: { id: "orders", name: "Orders and news" } };
    applyPushManifest(application, now);
    applyPushStrings(strings, now.channel);
    expect(metaData({ application: [application] })).toEqual({
      "com.example.key": "1",
      [pushMetaData.enabled]: "true",
      [pushMetaData.firebaseChannel]: "@string/svelte_push_channel_id",
      [pushMetaData.channelId]: "@string/svelte_push_channel_id",
      [pushMetaData.channelName]: "@string/svelte_push_channel_name",
    });
    expect(stringResources(strings)).toEqual({ app_name: "App", svelte_push_channel_id: '"orders"', svelte_push_channel_name: '"Orders and news"' });
    // Twice is once: an entry of each name.
    applyPushManifest(application, now);
    applyPushStrings(strings, now.channel);
    expect((application["meta-data"] ?? []).length).toBe(5);
    expect((application.service ?? []).length).toBe(1);
    expect((strings.resources.string ?? []).length).toBe(3);
  });
});

describe("capabilities.push off: what an earlier prebuild wrote is taken away, and only that", () => {
  const template = expoTemplateAppDelegate();
  const ours: NonNullable<AndroidConfig.Manifest.ManifestApplication["meta-data"]> = [
    { $: { "android:name": pushMetaData.enabled, "android:value": "true" } },
    { $: { "android:name": pushMetaData.icon, "android:resource": "@drawable/svelte_push_icon" } },
    { $: { "android:name": pushMetaData.color, "android:resource": "@color/svelte_push_color" } },
    { $: { "android:name": pushMetaData.firebaseChannel, "android:value": "@string/svelte_push_channel_id" } },
    { $: { "android:name": pushMetaData.channelId, "android:value": "@string/svelte_push_channel_id" } },
    { $: { "android:name": pushMetaData.channelName, "android:value": "@string/svelte_push_channel_name" } },
    { $: { "android:name": pushMetaData.channelDescription, "android:value": "@string/svelte_push_channel_description" } },
  ];
  const own = [{ $: { "android:name": "com.example.key", "android:value": "1" } }];
  /** The channel's three string resources, as an earlier prebuild left them. */
  const channelStringsOf = (text: string) => [pushResources.channelId, pushResources.channelName, pushResources.channelDescription].map((name) => ({ $: { name, translatable: "false", formatted: "false" }, _: androidStringText(text) }));
  /** An app that turned the capability off, with the native projects of its last prebuild (`ios/`, `android/`). */
  const uninstalled = (files: Record<string, string> = {}) => pushApp({}, { "ios/App/AppDelegate.swift": "", "android/app/build.gradle": "", ...files });
  const off = (project: { root: string }, push: unknown = false, options: { excluded?: string[] } = {}) => withCapabilities(appConfig(project.root), { push: push as PushCapability }, { projectRoot: project.root, ...options });
  /** Runs one mod of the config on `modResults`, with `extra` beside them (what Expo's mod runner adds to the config the mod receives: the app's own `android` and `ios` keys). */
  const run = async (config: ExportedConfig, platform: "ios" | "android", mod: string, modResults: object, extra: object = {}) => {
    const apply = mods(config)[platform]?.[mod] as ((config: object) => Promise<{ modResults: any }>) | undefined;
    if (apply === undefined) throw new Error(`the config has no ${platform} ${mod} mod`);
    return (await apply({ ...extra, modRequest: { projectRoot: "", platformProjectRoot: "", platform, modName: mod, introspect: false }, modResults })).modResults;
  };
  const entries = (result: any) => result.manifest.application[0]["meta-data"];
  const mainApplication = (items?: object[], more: object = {}) => ({ manifest: { application: [{ $: { "android:name": ".MainApplication" }, ...(items === undefined ? {} : { "meta-data": items }), ...more }] } });
  const service = { $: { "android:name": pushMessagingService, "android:exported": "false" }, "intent-filter": [{ action: [{ $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } }] }] };
  const permission = (name: string) => ({ $: { "android:name": name } });

  test("the AppDelegate loses the wrapper and its import, and is the template's again; the navigation patch beside it stays", async () => {
    using project = uninstalled();
    const config = off(project);
    expect(removePushAppDelegate(applyPushAppDelegate(template))).toBe(template);
    expect(removePushAppDelegate(template)).toBe(template);
    const withNavigation = applyAppDelegate(applyPushAppDelegate(template));
    expect(removePushAppDelegate(withNavigation)).toBe(applyAppDelegate(template));
    expect((await run(config, "ios", "appDelegate", { language: "swift", path: "AppDelegate.swift", contents: withNavigation })).contents).toBe(applyAppDelegate(template));
    expect((await run(config, "ios", "appDelegate", { language: "swift", path: "AppDelegate.swift", contents: template })).contents).toBe(template);
    // A delegate in another language never had the wrapper, and an app that has one is not stopped for a capability it does not use.
    expect((await run(config, "ios", "appDelegate", { language: "objc", path: "AppDelegate.mm", contents: "x" })).contents).toBe("x");
  });

  test("the entitlement and the background mode are not touched: nothing in the project says that the capability wrote them", () => {
    using project = uninstalled();
    const mine = appConfig(project.root, { ios: { bundleIdentifier: "io.e.a", entitlements: { "aps-environment": "production" }, infoPlist: { UIBackgroundModes: ["remote-notification", "fetch"] } } });
    const config = withCapabilities(mine, { push: false }, { projectRoot: project.root });
    expect(config.ios).toEqual(mine.ios);
    expect(Object.keys(mods(config).ios ?? {})).toEqual(["infoPlist", "appDelegate"]);
  });

  test("Info.plist loses the flag that turns the native code on, and keeps every other key, the background mode among them", async () => {
    using project = uninstalled();
    const config = off(project);
    const plist = await run(config, "ios", "infoPlist", { CFBundleName: "App", UIBackgroundModes: ["remote-notification"], [pushInfoPlistFlag]: true });
    expect(plist).toEqual({ CFBundleName: "App", UIBackgroundModes: ["remote-notification"] });
    expect(await run(config, "ios", "infoPlist", { CFBundleName: "App" })).toEqual({ CFBundleName: "App" });
    // The flag is on while the capability is on for iOS, in the config's own Info.plist keys (Expo writes them), and only then.
    expect(pushInfoPlistFlag).toBe("SveltePushEnabled");
    expect(withPush(project, { ios: { mode: "production" } }).ios?.infoPlist?.[pushInfoPlistFlag]).toBe(true);
    expect(withPush(project, { android: { googleServicesFile: "./google-services.json" } }).ios?.infoPlist).toBeUndefined();
  });

  test("the manifest loses the entries of the capability, and keeps the app's own, Firebase's defaults among them when they name something else", async () => {
    using project = uninstalled();
    const config = off(project);
    expect(entries(await run(config, "android", "manifest", mainApplication([...ours, ...own])))).toEqual(own);
    const kept = [
      ...own,
      { $: { "android:name": pushMetaData.icon, "android:resource": "@mipmap/ic_notification" } },
      { $: { "android:name": pushMetaData.color, "android:resource": "@color/brand" } },
      { $: { "android:name": pushMetaData.firebaseChannel, "android:value": "alerts" } },
    ];
    expect(entries(await run(config, "android", "manifest", mainApplication(kept)))).toEqual(kept);
    expect(entries(await run(config, "android", "manifest", mainApplication()))).toBeUndefined();
    // The id as text, as an earlier version wrote Firebase's channel beside the module's own entry: ours too.
    const literal = [{ $: { "android:name": pushMetaData.firebaseChannel, "android:value": "orders" } }, { $: { "android:name": pushMetaData.channelId, "android:value": "orders" } }];
    expect(entries(await run(config, "android", "manifest", mainApplication(literal)))).toEqual([]);
    // A manifest without the main application is left alone, and does not stop the prebuild.
    expect((await run(config, "android", "manifest", { manifest: {} })).manifest).toEqual({});
    const application: AndroidConfig.Manifest.ManifestApplication = { $: { "android:name": ".MainApplication" } };
    removePushManifest(application);
    expect(application["meta-data"]).toBeUndefined();
  });

  test("the messaging service goes by its class, with the other services of the app; the app's own service for Firebase's event is another", async () => {
    using project = uninstalled();
    const config = off(project);
    const others = [{ $: { "android:name": "com.example.SyncService" } }, { $: { "android:name": "com.example.OwnMessaging", "android:exported": "false" }, "intent-filter": service["intent-filter"] }];
    const result = await run(config, "android", "manifest", mainApplication([...ours, ...own], { service: [service, ...others] }));
    expect(result.manifest.application[0].service).toEqual(others);
    expect(entries(result)).toEqual(own);
    // No service of ours: the others are as they were (and an application with none has none).
    expect((await run(config, "android", "manifest", mainApplication(own, { service: others }))).manifest.application[0].service).toEqual(others);
    expect((await run(config, "android", "manifest", mainApplication(own))).manifest.application[0].service).toBeUndefined();
  });

  test("POST_NOTIFICATIONS goes when the flag shows an earlier prebuild turned push on and the app's config does not ask for it itself; otherwise it stays", async () => {
    using project = uninstalled();
    const named = postNotificationsPermission;
    const manifestWith = (items: object[] | undefined, permissions: string[]) => ({ manifest: { "uses-permission": permissions.map(permission), application: [{ $: { "android:name": ".MainApplication" }, ...(items === undefined ? {} : { "meta-data": items }) }] } });
    const names = (result: any) => (result.manifest["uses-permission"] ?? []).map((item: any) => item.$["android:name"]);
    const config = off(project);
    // Ours: the flag was there, the config is silent about the permission.
    expect(names(await run(config, "android", "manifest", manifestWith(ours, ["android.permission.INTERNET", named])))).toEqual(["android.permission.INTERNET"]);
    // Not shown to be ours: no flag (an earlier prebuild did not turn push on), so the app's own permission stays.
    expect(names(await run(config, "android", "manifest", manifestWith(own, ["android.permission.INTERNET", named])))).toEqual(["android.permission.INTERNET", named]);
    expect(names(await run(config, "android", "manifest", manifestWith(undefined, [named])))).toEqual([named]);
    // The app's own config asks for it (the full name or Expo's short one): it stays, with the flag gone.
    for (const mine of [named, "POST_NOTIFICATIONS"]) {
      const asked = withCapabilities(appConfig(project.root, { android: { package: "io.e.a", permissions: [mine] } }), { push: false }, { projectRoot: project.root });
      const result = await run(asked, "android", "manifest", manifestWith(ours, [named]), { android: asked.android });
      expect([mine, names(result), entries(result)]).toEqual([mine, [named], []]);
    }
  });

  test("strings.xml and colors.xml lose the capability's names and keep the others; the icon's file goes", async () => {
    using project = uninstalled();
    const config = off(project);
    const strings = await run(config, "android", "strings", { resources: { string: [{ $: { name: "app_name" }, _: "App" }, ...channelStringsOf("x")] } });
    expect(stringResources(strings)).toEqual({ app_name: "App" });
    const colors = await run(config, "android", "colors", { resources: { color: [{ $: { name: "colorPrimary" }, _: "#023c69" }, { $: { name: "svelte_push_color" }, _: "#fff" }] } });
    expect(colors.resources.color).toEqual([{ $: { name: "colorPrimary" }, _: "#023c69" }]);
    expect(removePushStrings({ resources: {} })).toEqual({ resources: {} });
    const target = mkdtempSync(join(tmpdir(), "svelte-native-push-off-"));
    try {
      mkdirSync(join(target, "app/src/main/res/drawable"), { recursive: true });
      writeFileSync(join(target, "app/src/main/res/drawable/svelte_push_icon.png"), "an icon");
      writeFileSync(join(target, "app/src/main/res/drawable/other.png"), "the app's");
      await mods(config).android.dangerous({ ...config, modRequest: { projectRoot: project.root, platformProjectRoot: target, platform: "android", modName: "dangerous", introspect: false }, modResults: {} });
      expect([existsSync(join(target, "app/src/main/res/drawable/svelte_push_icon.png")), existsSync(join(target, "app/src/main/res/drawable/other.png"))]).toEqual([false, true]);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  test("the Google services file and the Gradle plugin are not touched: the config's android.googleServicesFile stays whatever it was, and the one Gradle mod takes only Firebase Messaging's line away", async () => {
    using project = uninstalled();
    const mine = appConfig(project.root, { android: { package: "io.e.a", googleServicesFile: "./mine.json" } });
    const config = withCapabilities(mine, { push: false }, { projectRoot: project.root });
    expect(config.android).toEqual(mine.android);
    expect(Object.keys(mods(config).android).filter((mod) => /gradle/i.test(mod))).toEqual(["appBuildGradle"]);
    const gradle = "apply plugin: 'com.google.gms.google-services'\n\ndependencies {\n    implementation(\"com.facebook.react:react-android\")\n}\n";
    expect((await run(config, "android", "appBuildGradle", { language: "groovy", contents: applyPushGradle(gradle) })).contents).toBe(gradle);
    expect((await run(config, "android", "appBuildGradle", { language: "groovy", contents: gradle })).contents).toBe(gradle);
  });

  test("an app that has no native project has nothing to take away: the config is returned as it is, and a project of one platform is cleaned for that platform alone", () => {
    using project = pushApp({}, {});
    const config = appConfig(project.root);
    expect(withCapabilities(config, { push: false }, { projectRoot: project.root })).toBe(config);
    expect(withCapabilities(config, undefined, { projectRoot: project.root })).toBe(config);
    using iosOnly = pushApp({}, { "ios/App/AppDelegate.swift": "" });
    expect(Object.keys(off(iosOnly).mods ?? {})).toEqual(["ios"]);
    using androidOnly = pushApp({}, { "android/app/build.gradle": "" });
    expect(Object.keys(off(androidOnly).mods ?? {})).toEqual(["android"]);
    expect(Object.keys(mods(off(androidOnly)).android).sort()).toEqual(["appBuildGradle", "colors", "dangerous", "manifest", "strings"]);
  });

  test("the separate package of an earlier version, still installed, is neither refused nor looked for: the capability off cleans the project as it does without it", () => {
    using project = pushApp({ "@alfayez/svelte-native-push": "0.4.0-rc.8" }, { "ios/App/AppDelegate.swift": "" });
    expect(Object.keys(off(project).mods ?? {})).toEqual(["ios"]);
  });

  test("push on for one platform takes away what an earlier prebuild wrote for the other, and writes the one that is named", async () => {
    using project = pushApp({}, { "ios/App/AppDelegate.swift": "", "android/app/build.gradle": "" });
    const androidOnly = withPush(project, { android: { googleServicesFile: "./google-services.json" } });
    expect(Object.keys(mods(androidOnly).ios)).toEqual(["infoPlist", "appDelegate"]);
    expect((await run(androidOnly, "ios", "infoPlist", { [pushInfoPlistFlag]: true, CFBundleName: "App" })).CFBundleName).toBe("App");
    expect((await run(androidOnly, "ios", "appDelegate", { language: "swift", path: "AppDelegate.swift", contents: applyPushAppDelegate(template) })).contents).toBe(template);
    const iosOnly = withPush(project, { ios: { mode: "production" } });
    expect(Object.keys(mods(iosOnly).android).sort()).toEqual(["appBuildGradle", "colors", "dangerous", "manifest", "strings"]);
    expect(entries(await run(iosOnly, "android", "manifest", mainApplication([...ours, ...own])))).toEqual(own);
    expect((await run(iosOnly, "ios", "appDelegate", { language: "swift", path: "AppDelegate.swift", contents: template })).contents).toBe(applyPushAppDelegate(template));
  });
});

describe("capabilities.push refusals", () => {
  const refused = (call: () => unknown): string => {
    const error = thrown(call);
    expect(error).toBeInstanceOf(CapabilityConfigError);
    return error.message;
  };

  test("another push library beside it: one push library per app", () => {
    for (const other of ["expo-notifications", "@react-native-firebase/messaging"]) {
      using project = pushApp({ [other]: "1.0.0" });
      const message = refused(() => withPush(project, fullPush));
      expect(message).toContain(`capabilities.push is on, and ${other} is installed: an app has one push library`);
      expect(message).toContain(`Uninstall ${other}, or turn the push capability off`);
      // Left out of autolinking, the other library is not in the build.
      expect(withPush(project, fullPush, undefined, { excluded: [other] }).android?.googleServicesFile).toBe("./google-services.json");
    }
    using off = pushApp({ "expo-notifications": "1.0.0" });
    const config = appConfig(off.root);
    expect(withCapabilities(config, undefined, { projectRoot: off.root })).toBe(config);
  });

  test("a Google services file that is not there, is not JSON, or has no client for the app's package", () => {
    using project = pushApp({}, { "bad.json": "{ nope", "other.json": googleServices("io.e.other", "io.e.third"), "empty.json": "{}", "array.json": "[]" });
    const android = (googleServicesFile: string) => ({ android: { googleServicesFile } });
    const missing = refused(() => withPush(project, android("./missing/google-services.json")));
    expect(missing).toStartWith('capabilities.push.android.googleServicesFile ("./missing/google-services.json") does not exist (looked for ');
    expect(missing).toContain(join(project.root, "missing/google-services.json"));
    expect(missing).toContain("download google-services.json from the Firebase console (Project settings, your Android app)");
    expect(refused(() => withPush(project, android(".")))).toContain("cannot be read: EISDIR");
    expect(refused(() => withPush(project, android("./bad.json")))).toStartWith('capabilities.push.android.googleServicesFile ("./bad.json") is not JSON (');
    expect(refused(() => withPush(project, android("./other.json")))).toBe(
      'capabilities.push.android.googleServicesFile ("./other.json") has no client for the app\'s package "io.e.a" (it has "io.e.other", "io.e.third"): ' +
        "add an Android app with that package to the Firebase project and download google-services.json again, or fix android.package.",
    );
    for (const file of ["./empty.json", "./array.json"]) expect(refused(() => withPush(project, android(file)))).toContain('has no client for the app\'s package "io.e.a" (it has no Android client)');
    // The package is the app's android.package, and the file may list others beside it.
    using several = pushApp({}, { "google-services.json": googleServices("io.e.other", "io.e.a") });
    expect(withPush(several, android("./google-services.json")).android?.googleServicesFile).toBe("./google-services.json");
    const noPackage = appConfig(project.root, { android: {} });
    expect(refused(() => withPush(project, android("./google-services.json"), noPackage))).toContain("capabilities.push.android needs android.package in the Expo config");
  });

  test("a server secret in the config: a service account, a private key, a PEM key, a .p8 path", () => {
    using project = pushApp();
    const pem = "-----BEGIN PRIVATE KEY-----\nTOPSECRETKEYBODY\n-----END PRIVATE KEY-----\n";
    const serviceAccount = { type: "service_account", project_id: "demo", private_key: pem, client_email: "sender@demo.iam.gserviceaccount.com" };
    const cases: [unknown, string][] = [
      [{ ...fullPush, serviceAccount }, "capabilities.push.serviceAccount is a service account key"],
      [{ ...fullPush, fcm: { type: "service_account" } }, "capabilities.push.fcm is a service account key"],
      [{ ...fullPush, android: { ...fullPush.android, privateKey: "abc" } }, "capabilities.push.android.privateKey is a private key"],
      [{ ...fullPush, android: { ...fullPush.android, channel: { name: "Updates", private_key: "abc" } } }, "capabilities.push.android.channel.private_key is a private key"],
      [{ ...fullPush, key: pem }, "capabilities.push.key is a PEM private key"],
      [{ ...fullPush, key: "-----BEGIN EC PRIVATE KEY-----\nTOPSECRETKEYBODY" }, "capabilities.push.key is a PEM private key"],
      [{ ...fullPush, android: { ...fullPush.android, color: pem } }, "capabilities.push.android.color is a PEM private key"],
      [{ ...fullPush, text: JSON.stringify(serviceAccount) }, "capabilities.push.text is a service account key"],
      [{ ...fullPush, text: '{"private_key": "TOPSECRETKEYBODY"}' }, "capabilities.push.text is a service account key"],
      [{ ...fullPush, list: [{ nested: pem }] }, "capabilities.push.list[0].nested is a PEM private key"],
      [{ ...fullPush, ios: { mode: "production", key: "./AuthKey_ABC123DEFG.p8" } }, "capabilities.push.ios.key is the path of a .p8 file (an APNs key)"],
      [{ android: { googleServicesFile: "./AuthKey_ABC123DEFG.P8" } }, "capabilities.push.android.googleServicesFile is the path of a .p8 file (an APNs key)"],
    ];
    for (const [push, start] of cases) {
      const message = refused(() => withPush(project, push));
      expect([start, message.startsWith(start)]).toEqual([start, true]);
      expect(message).toContain("a key that can send to every user must never be in the app or its build. Keep it in the server's environment");
      expect(message).not.toContain("TOPSECRETKEYBODY");
    }
    // A secret is refused before anything else is looked at: not even the other push libraries.
    using other = pushApp({ "expo-notifications": "1.0.0" });
    expect(refused(() => withPush(other, { ...fullPush, serviceAccount }))).toContain("is a service account key");
  });

  test("a server secret in the Google services file the config points at", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nTOPSECRETKEYBODY\n-----END PRIVATE KEY-----\n";
    const files = {
      "service-account.json": JSON.stringify({ type: "service_account", project_id: "demo", private_key: pem, client_email: "sender@demo.iam.gserviceaccount.com" }),
      "key.pem": pem,
      "client-with-key.json": JSON.stringify({ client: [{ client_info: { android_client_info: { package_name: "io.e.a" } } }], private_key: "abc" }),
    };
    using project = pushApp({}, files);
    for (const [file, what] of [["service-account.json", "a service account key"], ["key.pem", "a PEM private key"], ["client-with-key.json", "a service account key"]]) {
      const message = refused(() => withPush(project, { android: { googleServicesFile: `./${file}` } }));
      expect(message).toStartWith(`the file of capabilities.push.android.googleServicesFile ("./${file}") is ${what}: a key that can send to every user must never be in the app or its build.`);
      expect(message).not.toContain("TOPSECRETKEYBODY");
    }
    expect(findPushSecret(googleServices("io.e.a"), "the file")).toBeUndefined();
    expect(findPushSecret({ android: { googleServicesFile: "./google-services.json", icon: "./assets/notify.png", color: "#0a7f5a" }, ios: { mode: "production" } }, "push")).toBeUndefined();
  });

  test("android with no googleServicesFile, and an iOS mode that is not an aps-environment", () => {
    using project = pushApp();
    for (const android of [{}, { icon: "./assets/notify.png" }, { googleServicesFile: "" }, { googleServicesFile: " " }, { googleServicesFile: 3 }]) {
      const message = refused(() => withPush(project, { android }));
      expect(message).toStartWith("capabilities.push.android needs googleServicesFile, the path of the Firebase project's google-services.json (Firebase console, Project settings, your Android app)");
      expect(message).toContain("Leave `android` out for an app that has no push on Android.");
    }
    for (const ios of [{}, { mode: "staging" }, { mode: "Production" }, { mode: true }]) {
      expect(refused(() => withPush(project, { ios }))).toStartWith('capabilities.push.ios.mode must be "development" or "production": it is the aps-environment entitlement');
    }
    expect(refused(() => withPush(project, { ios: "production" }))).toStartWith("capabilities.push.ios takes an object");
    expect(refused(() => withPush(project, { android: "./google-services.json" }))).toStartWith("capabilities.push.android takes an object");
  });

  test("a push that names no platform, or is not an object", () => {
    using project = pushApp();
    expect(refused(() => withPush(project, {}))).toStartWith("capabilities.push names no platform");
    for (const push of [true, "on", 1, []]) expect(refused(() => withPush(project, push))).toStartWith("capabilities.push takes an object");
  });

  test("an icon that is not a PNG or not there, a color that is not hex, a channel with no name", () => {
    using project = pushApp({}, { "assets/icon.jpg": "jpg", "assets/dir.png/keep": "" });
    const android = (more: object) => ({ android: { googleServicesFile: "./google-services.json", ...more } });
    expect(refused(() => withPush(project, android({ icon: "./assets/icon.jpg" })))).toBe('capabilities.push.android.icon ("./assets/icon.jpg") must be a PNG file: the notification\'s small icon, white on a transparent background.');
    expect(refused(() => withPush(project, android({ icon: "./assets/gone.png" })))).toStartWith('capabilities.push.android.icon ("./assets/gone.png") does not exist (looked for ');
    expect(refused(() => withPush(project, android({ icon: "./assets/dir.png" })))).toStartWith('capabilities.push.android.icon ("./assets/dir.png") is not a file');
    expect(refused(() => withPush(project, android({ icon: "" })))).toBe("capabilities.push.android.icon must be a text that is not empty.");
    for (const color of ["green", "0a7f5a", "#0a7f5", "#xyz", "#0a7f5a00ff"]) expect(refused(() => withPush(project, android({ color })))).toBe(`capabilities.push.android.color ("${color}") must be a hex color such as "#0a7f5a": the notification's accent color.`);
    expect(refused(() => withPush(project, android({ color: 7 })))).toBe("capabilities.push.android.color must be a text that is not empty.");
    for (const color of ["#fff", "#FFFA", "#0a7f5a", "#800a7f5a"]) expect(pushSettings({ android: { googleServicesFile: "./google-services.json", color } }, "io.e.a", project.root).android?.color).toBe(color);
    for (const channel of [{}, { name: "" }, { id: "orders" }, { name: 3 }]) expect(refused(() => withPush(project, android({ channel })))).toStartWith("capabilities.push.android.channel needs a name, as the user will read it");
    expect(refused(() => withPush(project, android({ channel: { name: "Updates", id: "" } })))).toBe("capabilities.push.android.channel.id must be a text that is not empty.");
    expect(refused(() => withPush(project, android({ channel: { name: "Updates", description: " " } })))).toBe("capabilities.push.android.channel.description must be a text that is not empty.");
    expect(refused(() => withPush(project, android({ channel: "Updates" })))).toStartWith("capabilities.push.android.channel takes an object");
  });
});

/** aapt2, the resource compiler the Gradle build runs, from the newest build-tools of the Android SDK (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, else `~/Android/sdk`), or null. */
function findAapt2(): string | null {
  const tools = join(process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), "Android/sdk"), "build-tools");
  const versions = existsSync(tools) ? readdirSync(tools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
  return versions.map((version) => join(tools, version, "aapt2")).find(existsSync) ?? null;
}
const aapt2 = findAapt2();
const androidJar = findHostJars().androidJar;

// What the plugin writes, run through aapt2 as a build would: the channel's texts come out of the compiled resources exactly as the config has them, and the manifest's meta-data are
// references to them. Skipped without an Android SDK that has build-tools and a platform (the Kotlin and C++ host checks skip the same way).
describe.skipIf(aapt2 === null || androidJar === null)("capabilities.push: aapt2 reads the channel's texts back as the config has them", () => {
  const texts = [
    "Updates", "@mentions", "@null", "@empty", "@string/nothere", "@+id/x", "?what", "?", "007", "0x10", "1e3", "true", "False", "#fff", "#general", " 12", "nan",
    "Don't miss", 'say "hi"', "back\\slash", "\\n not a newline", "\\u0041 not an A", "50% off %s %d", "%", "a  b", " lead", "trail ", "  both  ", "tab\there", "line1\nline2", "bell\u0007",
    "<b>bold</b> & more", "&amp; as typed", "é 日本語", "{0} {name}", "end?", "x@y",
  ];

  /** Compiles the resources and the manifest the plugin writes for `channel` with aapt2; the strings of the compiled table by resource name, and the meta-data's values by name. */
  async function build(project: { root: string }, channel: { id: string; name: string; description: string }) {
    const { manifest, strings } = await compile(withPush(project, { android: { googleServicesFile: "./google-services.json", channel } }));
    const directory = mkdtempSync(join(tmpdir(), "svelte-native-push-aapt2-"));
    try {
      mkdirSync(join(directory, "res/values"), { recursive: true });
      writeFileSync(join(directory, "res/values/strings.xml"), XML.format(strings));
      const entries = (manifest.application[0]?.["meta-data"] ?? []).map((item) => `<meta-data android:name="${item.$["android:name"]}" android:value="${item.$["android:value"]}"/>`).join("");
      writeFileSync(join(directory, "AndroidManifest.xml"), `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="io.e.a"><application>${entries}</application></manifest>`);
      const aapt = (...args: string[]) => {
        const done = Bun.spawnSync([aapt2 as string, ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
        if (done.exitCode !== 0) throw new Error(`aapt2 ${args.join(" ")}: ${done.stderr.toString()}`);
        return done.stdout.toString();
      };
      aapt("compile", "--dir", "res", "-o", "res.zip");
      aapt("link", "-I", androidJar as string, "--manifest", "AndroidManifest.xml", "-o", "out.apk", "res.zip");
      // `dump strings`: the table's string pool; a string with a line break is several lines, so it is cut at the pool's own `String #n :` markers.
      const pool = aapt("dump", "strings", "out.apk").split(/^String #\d+ : /m).slice(1).map((text) => text.replace(/\n$/, ""));
      // `dump resources` names each id (`resource 0x7f010000 string/svelte_push_channel_name`); the manifest's references are to those ids.
      const ids = Object.fromEntries([...aapt("dump", "resources", "out.apk").matchAll(/resource (0x[0-9a-f]+) string\/(\w+)/g)].map((match) => [match[1], match[2]]));
      const tree = aapt("dump", "xmltree", "--file", "AndroidManifest.xml", "out.apk");
      const values = [...tree.matchAll(/android:name\(0x01010003\)="([^"]+)"[^\n]*\n\s+A: [^\n]*android:value\(0x01010024\)=(.*)/g)].map((match) => [match[1], match[2]] as const);
      return { pool, referenced: Object.fromEntries(values.map(([name, value]) => [name, /^@(0x[0-9a-f]+)$/.exec(value ?? "")?.[1]]).map(([name, id]) => [name, id === undefined ? undefined : ids[id]])), tree };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  test("every text: the compiled string is the text, and the manifest's entries are references to the strings, never the text", async () => {
    using project = pushApp();
    const wrong: string[] = [];
    for (let at = 0; at < texts.length; at += 3) {
      const [id = "default", name = "Notifications", description = "d"] = texts.slice(at, at + 3);
      const { pool, referenced } = await build(project, { id, name, description });
      for (const text of [id, name, description]) if (!pool.includes(text)) wrong.push(JSON.stringify(text));
      expect(referenced).toEqual({
        [pushMetaData.firebaseChannel]: "svelte_push_channel_id",
        [pushMetaData.channelId]: "svelte_push_channel_id",
        [pushMetaData.channelName]: "svelte_push_channel_name",
        [pushMetaData.channelDescription]: "svelte_push_channel_description",
      });
    }
    expect(wrong).toEqual([]);
  });

  test("the control: the same texts written into android:value are misread or refused by the resource compiler (what the strings are for)", () => {
    const directory = mkdtempSync(join(tmpdir(), "svelte-native-push-aapt2-"));
    try {
      const link = (text: string) => {
        writeFileSync(join(directory, "AndroidManifest.xml"), `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="io.e.a"><application><meta-data android:name="t" android:value="${text}"/></application></manifest>`);
        const linked = Bun.spawnSync([aapt2 as string, "link", "-I", androidJar as string, "--manifest", "AndroidManifest.xml", "-o", "out.apk"], { cwd: directory, stdout: "pipe", stderr: "pipe" });
        if (linked.exitCode !== 0) return "refused";
        const tree = Bun.spawnSync([aapt2 as string, "dump", "xmltree", "--file", "AndroidManifest.xml", "out.apk"], { cwd: directory, stdout: "pipe" }).stdout.toString();
        return /android:value\(0x01010024\)="/.test(tree) ? "string" : "not a string";
      };
      expect(["Updates", "@mentions"].map(link)).toEqual(["string", "string"]);
      for (const text of ["007", "0x10", "1e3", "true", "#fff", "@null", "?what", "@string/nothere"]) expect([text, link(text)]).not.toEqual([text, "string"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
