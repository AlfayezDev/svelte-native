// The `capabilities` option of the Expo config plugin (`src/capabilities.ts`): a capability gives its library's plugin the app's texts (`location`) or writes the
// entries its library needs (`push`), and the half-made states (on without the library, the library without the capability, the capability and the library's own
// plugin entry both) stop the prebuild.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExpoConfig } from "expo/config";
import { AndroidConfig, compileModsAsync, withPlugins, type ExportedConfig } from "expo/config-plugins";
import { CapabilityConfigError, type PushCapability, applyPushAppDelegate, applyPushManifest, copyPushIcon, defaultPushChannel, findPushSecret, locationPluginProps, pushMetaData, pushPackage, pushResources, pushSettings, withCapabilities } from "../../src/capabilities.ts";
import expoPlugin, { applyAppDelegate } from "../../src/expo.ts";
import { createProject } from "../support/project.ts";
import { expoTemplateAppDelegate } from "./support/app-delegate.ts";
import { libraryVersion, peerRange } from "../support/versions.ts";

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

/** An app with the push package installed (unless `dependencies` says otherwise), a Google services file for `io.e.a` and an icon, in a directory that is removed when the test's block ends. */
const pushApp = (dependencies: Record<string, string> = { [pushPackage]: libraryVersion }, files: Record<string, string> = {}, manifest: Record<string, unknown> = {}) => {
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

/** What Expo's mods make of the config's Android and iOS parts, without writing files (its introspection): the manifest, `colors.xml`, `Info.plist` and the entitlements. */
async function compile(config: ExportedConfig) {
  const compiled = await compileModsAsync(config, { projectRoot: String(config._internal?.projectRoot), introspect: true, platforms: ["android", "ios"], assertMissingModProviders: false });
  const results = compiled._internal?.modResults;
  return { manifest: results.android.manifest.manifest as { application: AndroidConfig.Manifest.ManifestApplication[] }, colors: results.android.colors as AndroidConfig.Resources.ResourceXML, infoPlist: compiled.ios?.infoPlist, entitlements: compiled.ios?.entitlements };
}
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
    // What `@expo/prebuild-config` runs on every prebuild (`AndroidConfig.GoogleServices`: the class path, the plugin, the copy of the file) reads that key; the capability writes no Gradle of its own.
    expect(AndroidConfig.GoogleServices.getGoogleServicesFilePath(config)).toBe("./google-services.json");
    expect(AndroidConfig.GoogleServices.setClassPath(config, "buildscript {\n  dependencies {\n  }\n}")).toContain("classpath 'com.google.gms:google-services:");
    expect(AndroidConfig.GoogleServices.applyPlugin(config, "android {}\n")).toContain("apply plugin: 'com.google.gms.google-services'");
    expect(Object.keys(mods(config).android).filter((mod) => /gradle/i.test(mod))).toEqual([]);
  });

  test("Android: the app's own android.googleServicesFile of the same file is one answer, another file is two", () => {
    using project = pushApp({ [pushPackage]: libraryVersion }, { "other.json": googleServices("io.e.a") });
    const android = (googleServicesFile: string) => appConfig(project.root, { android: { package: "io.e.a", googleServicesFile } });
    expect(withPush(project, { android: { googleServicesFile: "google-services.json" } }, android("./google-services.json")).android?.googleServicesFile).toBe("google-services.json");
    const error = thrown(() => withPush(project, { android: { googleServicesFile: "./other.json" } }, android("./google-services.json")));
    expect([error.name, error.message]).toEqual([
      "CapabilityConfigError",
      'The app config sets android.googleServicesFile ("./google-services.json") and capabilities.push.android.googleServicesFile is "./other.json": keep one. capabilities.push.android.googleServicesFile sets android.googleServicesFile.',
    ]);
  });

  test("Android: the manifest names the icon and color resources (Firebase's defaults) and the channel", async () => {
    using project = pushApp();
    const { manifest } = await compile(withPush(project, fullPush));
    expect(metaData(manifest)).toEqual({
      "com.google.firebase.messaging.default_notification_icon": "@drawable/svelte_push_icon",
      "com.google.firebase.messaging.default_notification_color": "@color/svelte_push_color",
      "com.google.firebase.messaging.default_notification_channel_id": "default",
      "expo.modules.sveltepush.channel_id": "default",
      "expo.modules.sveltepush.channel_name": "Updates",
      "expo.modules.sveltepush.channel_description": "Order updates",
    });
    // A channel with its own id.
    const orders = withPush(project, { android: { googleServicesFile: "./google-services.json", channel: { id: "orders", name: "Orders" } } });
    expect(metaData((await compile(orders)).manifest)).toEqual({
      [pushMetaData.firebaseChannel]: "orders", [pushMetaData.channelId]: "orders", [pushMetaData.channelName]: "Orders",
    });
  });

  test("Android: with only the file, no icon or color is named and the channel is the default one", async () => {
    using project = pushApp();
    expect(metaData((await compile(withPush(project, { android: { googleServicesFile: "./google-services.json" } }))).manifest)).toEqual({
      [pushMetaData.firebaseChannel]: defaultPushChannel.id,
      [pushMetaData.channelId]: defaultPushChannel.id,
      [pushMetaData.channelName]: defaultPushChannel.name,
    });
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
    expect((bare["meta-data"] ?? []).map((item) => item.$["android:name"])).toEqual([pushMetaData.color, pushMetaData.firebaseChannel, pushMetaData.channelId, pushMetaData.channelName]);
  });

  test("Android: the color becomes a color resource, and without one colors.xml is not touched", async () => {
    using project = pushApp();
    const { colors } = await compile(withPush(project, fullPush));
    expect(colors.resources.color).toEqual([{ $: { name: "svelte_push_color" }, _: "#0a7f5a" }]);
    const bare = await compile(withPush(project, { android: { googleServicesFile: "./google-services.json" } }));
    expect(JSON.stringify(bare.colors)).not.toContain("svelte_push_color");
  });

  test("Android: the icon is copied into res/drawable under its fixed name by a dangerous mod, and there is none without an icon", async () => {
    using project = pushApp({ [pushPackage]: libraryVersion }, { "assets/notify.png": "the icon's bytes" });
    const target = mkdtempSync(join(tmpdir(), "svelte-native-push-icon-"));
    try {
      const config = withPush(project, fullPush);
      await mods(config).android.dangerous({ ...config, modRequest: { projectRoot: project.root, platformProjectRoot: target, platform: "android", modName: "dangerous", introspect: false }, modResults: {} });
      expect(readFileSync(join(target, "app/src/main/res/drawable/svelte_push_icon.png"), "utf8")).toBe("the icon's bytes");
      expect(pushResources.icon).toBe("svelte_push_icon");
      // A later prebuild copies over the file of the earlier one.
      project.write("assets/notify.png", "a new icon");
      await copyPushIcon(join(project.root, "assets/notify.png"), target);
      expect(readFileSync(join(target, "app/src/main/res/drawable/svelte_push_icon.png"), "utf8")).toBe("a new icon");
      expect(mods(withPush(project, { android: { googleServicesFile: "./google-services.json" } })).android.dangerous).toBeUndefined();
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
    // The one iOS mod is the AppDelegate patch (the first screen of a launch in the background); the Info.plist and the entitlements are the config's own keys.
    expect(Object.keys(mods(iosOnly))).toEqual(["ios"]);
    expect(Object.keys(mods(iosOnly).ios)).toEqual(["appDelegate"]);
  });

  test("the Expo plugin passes the capability on: its entries land in the config, and a package left out of autolinking stops it", () => {
    using project = pushApp();
    const config = withPlugins(appConfig(project.root), [[expoPlugin, { capabilities: { push: fullPush } }]]);
    expect([config.android?.googleServicesFile, config.ios?.entitlements, config.ios?.infoPlist?.UIBackgroundModes]).toEqual(["./google-services.json", { "aps-environment": "production" }, ["remote-notification"]]);
    const error = thrown(() => withPlugins(appConfig(project.root), [[expoPlugin, { capabilities: { push: fullPush }, autolinkingExclude: [pushPackage] }]]));
    expect(error.message).toContain("left out of autolinking");
  });

  test("off, and the package not installed or left out of autolinking: nothing changes", () => {
    const config = appConfig("");
    using bare = pushApp({ expo: peerRange("expo") });
    for (const push of [undefined, false] as const) expect(withCapabilities(config, { push }, { projectRoot: bare.root })).toBe(config);
    expect(withCapabilities(config, undefined, { projectRoot: bare.root })).toBe(config);
    using excluded = pushApp({ [pushPackage]: libraryVersion });
    expect(withCapabilities(config, undefined, { projectRoot: excluded.root, excluded: [pushPackage] })).toBe(config);
    using inManifest = pushApp({ [pushPackage]: libraryVersion }, {}, { expo: { autolinking: { android: { exclude: [pushPackage] } } } });
    expect(withCapabilities(config, { push: false }, { projectRoot: inManifest.root })).toBe(config);
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
    expect(once).toMatch(/^internal import SveltePush \/\/ Svelte native: push, /m);
    expect(once.indexOf("import SveltePush")).toBeGreaterThan(once.indexOf("import ReactAppDependencyProvider"));
    expect(once.indexOf("import SveltePush")).toBeLessThan(once.indexOf("@main"));
  });

  test("taking the wrapper away gives the template back, and applying again changes nothing", () => {
    const once = applyPushAppDelegate(template);
    expect(once.replace(/\n {4}\/\/ Svelte native: push, the first screen[\s\S]*?surface: \{ \[self\] in(?=\n)/, "").replace(/\n {6}\}\)\n {4}\/\/ Svelte native: end of the first screen of a launch in the background(?=\n)/, "").replace(/^internal import SveltePush.*\n/m, "")).toBe(template);
    expect(applyPushAppDelegate(once)).toBe(once);
    expect(once.match(/import SveltePush/g)).toHaveLength(1);
    expect(once.match(/SveltePushBackgroundLaunch\.start\(/g)).toHaveLength(1);
    expect(once.match(/factory\.startReactNative\(/g)).toHaveLength(1);
  });

  test("what an older version wrote is replaced and not kept beside the new wrapper", () => {
    const once = applyPushAppDelegate(template);
    const older = once.replace("bundleConfiguration: factory.bundleConfiguration,", "bundleConfiguration: RCTBundleConfiguration.default(),");
    expect(older).not.toBe(once);
    expect(applyPushAppDelegate(older)).toBe(once);
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

describe("capabilities.push refusals", () => {
  const refused = (call: () => unknown): string => {
    const error = thrown(call);
    expect(error).toBeInstanceOf(CapabilityConfigError);
    return error.message;
  };

  test("on without @alfayez/svelte-native-push: the prebuild stops and says how to install it", () => {
    using project = pushApp({ expo: peerRange("expo") });
    const error = thrown(() => withPush(project, fullPush));
    expect([error.name, error.message]).toEqual([
      "CapabilityConfigError",
      "capabilities.push needs @alfayez/svelte-native-push, which is not installed: add it from the same repository and tag as @alfayez/svelte-native (the same specifier, ending in `&path:packages/svelte-native-push`), then prebuild again.",
    ]);
  });

  test("on, while the package is left out of autolinking: refused, since its Firebase file and entitlement would be for nothing", () => {
    using project = pushApp();
    expect(refused(() => withPush(project, fullPush, undefined, { excluded: [pushPackage] }))).toContain("@alfayez/svelte-native-push is left out of autolinking");
    using inManifest = pushApp({ [pushPackage]: libraryVersion }, {}, { expo: { autolinking: { exclude: [pushPackage] } } });
    expect(refused(() => withPush(inManifest, fullPush))).toContain("left out of autolinking");
    using notInstalled = pushApp({}, {}, { expo: { autolinking: { ios: { exclude: [pushPackage] } } } });
    expect(refused(() => withPush(notInstalled, fullPush))).toContain("left out of autolinking");
  });

  test("the package installed, the capability off: the prebuild stops instead of linking Firebase without its file", () => {
    using project = pushApp();
    for (const push of [undefined, false] as const) {
      const message = refused(() => withCapabilities(appConfig(project.root), { push }, { projectRoot: project.root }));
      expect(message).toContain("@alfayez/svelte-native-push is installed, but the push capability is off");
      expect(message).toContain('push: { android: { googleServicesFile: "./google-services.json" }, ios: { mode: "production" } }');
      expect(message).toContain("or uninstall @alfayez/svelte-native-push");
    }
    expect(refused(() => withCapabilities(appConfig(project.root), {}, { projectRoot: project.root }))).toContain("the push capability is off");
    expect(refused(() => withCapabilities(appConfig(project.root), undefined, { projectRoot: project.root }))).toContain("the push capability is off");
  });

  test("another push library beside it: one push library per app", () => {
    for (const other of ["expo-notifications", "@react-native-firebase/messaging"]) {
      using project = pushApp({ [pushPackage]: libraryVersion, [other]: "1.0.0" });
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
    using project = pushApp({ [pushPackage]: libraryVersion }, { "bad.json": "{ nope", "other.json": googleServices("io.e.other", "io.e.third"), "empty.json": "{}", "array.json": "[]" });
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
    using several = pushApp({ [pushPackage]: libraryVersion }, { "google-services.json": googleServices("io.e.other", "io.e.a") });
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
    // It is found before the package is: a secret never waits for a missing library.
    using bare = pushApp({});
    expect(refused(() => withPush(bare, { ...fullPush, serviceAccount }))).toContain("is a service account key");
  });

  test("a server secret in the Google services file the config points at", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nTOPSECRETKEYBODY\n-----END PRIVATE KEY-----\n";
    const files = {
      "service-account.json": JSON.stringify({ type: "service_account", project_id: "demo", private_key: pem, client_email: "sender@demo.iam.gserviceaccount.com" }),
      "key.pem": pem,
      "client-with-key.json": JSON.stringify({ client: [{ client_info: { android_client_info: { package_name: "io.e.a" } } }], private_key: "abc" }),
    };
    using project = pushApp({ [pushPackage]: libraryVersion }, files);
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
    using project = pushApp({ [pushPackage]: libraryVersion }, { "assets/icon.jpg": "jpg", "assets/dir.png/keep": "" });
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
