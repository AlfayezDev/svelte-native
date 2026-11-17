import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExpoConfig } from "expo/config";
import type { ExportedConfig } from "expo/config-plugins";
import { firebaseMessagingEvent, postNotificationsPermission, pushFirebaseDependency, pushInfoPlistFlag, pushMessagingService, pushMetaData, withCapabilities } from "../../src/capabilities.ts";
import { expoTemplateAppBuildGradle } from "../cli/support/app-delegate.ts";
import { createProject } from "../support/project.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Push's native code (PUSH.md) is part of the library's one native module, svelte-core, which is in every app: there is no package of its own for it. What makes an app one with push is what
// the config plugin writes (Firebase Messaging's dependency, the messaging service, the permission and the flags the native code asks first), and what keeps an app without push clean
// is that svelte-core depends on Firebase `compileOnly`, declares nothing of push in its own manifest and does nothing until the flag is there. This file pins those facts: the lists in
// expo-module.config.json, the Firebase dependency, the manifest, the single registration path, and the plugin's writing and taking away. What the native code does with the flag is the
// Kotlin host check (`native/svelte-core/android/src/test/push.sh`) and `tests/native-host/contracts/push-ios.test.ts`.
const root = resolve(import.meta.dirname, "../..");
const repository = resolve(root, "../..");
const core = join(root, "native/svelte-core");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const config = JSON.parse(read("expo-module.config.json")) as {
  platforms: string[];
  android: { projects: { name: string; path: string; modules: string[] }[] };
  apple: { podspecPath: string[]; swiftModuleName: string[]; modules: string[]; appDelegateSubscribers: string[] };
};

const filesUnder = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

describe("there is no package of its own for push", () => {
  test("the directory, the workspace's apps and the library's own manifest know nothing of `@alfayez/svelte-native-push`", () => {
    // A checkout from before the move may keep the directory with only its ignored node_modules: no package.json is no package.
    expect(existsSync(join(repository, "packages/svelte-native-push/package.json"))).toBe(false);
    for (const manifest of ["packages/svelte-native/package.json", "apps/example/package.json", "apps/qa/package.json", "package.json"]) {
      expect([manifest, readFileSync(join(repository, manifest), "utf8").includes("svelte-native-push")]).toEqual([manifest, false]);
    }
    expect(readFileSync(join(repository, "pnpm-lock.yaml"), "utf8")).not.toContain("svelte-native-push");
    expect(readFileSync(join(repository, ".gitignore"), "utf8")).not.toContain("svelte-native-push");
  });
});

describe("expo-module.config.json links push's module and subscriber in svelte-core's project and pod, and no project or pod of their own", () => {
  test("Android: SveltePushModule is one of the modules of the one svelte-core project", () => {
    expect(config.platforms).toEqual(["android", "apple"]);
    expect(config.android.projects.map((project) => project.name)).toEqual(["svelte-core"]);
    const [project] = config.android.projects;
    expect(project?.modules).toEqual([
      "expo.modules.svelteengine.SvelteEngineModule",
      "expo.modules.svelteupdates.SvelteUpdatesModule",
      "expo.modules.svelteblur.SvelteBlurModule",
      "expo.modules.sveltecore.SvelteFetchModule",
      "expo.modules.sveltecore.SvelteClipboardModule",
      "expo.modules.sveltepush.SveltePushModule",
      "expo.modules.sveltelocation.SvelteLocationModule",
    ]);
    const file = "native/svelte-core/android/src/main/java/expo/modules/sveltepush/SveltePushModule.kt";
    expect(read(file)).toMatch(/^class SveltePushModule : Module\(\)/m);
    expect(read(file)).toContain('Name("SveltePush")');
    expect(JSON.stringify(config)).not.toContain("svelte-push");
  });

  test("iOS: SveltePushModule and SveltePushAppDelegateSubscriber are in the SvelteCore pod's lists, and their Swift is a folder of the pod", () => {
    expect(config.apple.swiftModuleName).toEqual(["SvelteCore"]);
    expect(config.apple.podspecPath).toEqual(["native/svelte-core/ios/SvelteCore.podspec"]);
    expect(config.apple.modules).toEqual(["SvelteInsetsModule", "SvelteNavigationModule", "SvelteUpdatesModule", "SvelteBlurModule", "SvelteFetchModule", "SvelteClipboardModule", "SveltePushModule", "SvelteLocationModule"]);
    expect(config.apple.appDelegateSubscribers).toEqual(["SvelteCaptureSubscriber", "SveltePushAppDelegateSubscriber"]);
    expect(read("native/svelte-core/ios/push/SveltePushModule.swift")).toContain("public final class SveltePushModule: Module");
    expect(read("native/svelte-core/ios/push/SveltePushModule.swift")).toContain('Name("SveltePush")');
    expect(read("native/svelte-core/ios/push/SveltePushAppDelegateSubscriber.swift")).toContain("public final class SveltePushAppDelegateSubscriber: ExpoAppDelegateSubscriber");
    expect(read("native/svelte-core/ios/push/SveltePushBackgroundLaunch.swift")).toContain("public enum SveltePushBackgroundLaunch");
    // The pod compiles every Swift file under `ios/`, so the files are in a folder of it and the host check's own `main` is not.
    expect(read("native/svelte-core/ios/SvelteCore.podspec")).toContain("s.source_files = '**/*.{h,m,mm,cpp,swift}'");
    expect(existsSync(join(core, "ios/push/SveltePushMessageCheck.swift"))).toBe(false);
    expect(existsSync(join(core, "test/ios/SveltePushMessageCheck.swift"))).toBe(true);
  });

  test("Android: one Package registers push's two listeners, found by autolinking from its name and its import, and nothing else registers them", () => {
    // `expo-modules-autolinking` (`platforms/android/android.js`) scans the project for files named `*Package.kt` that import `expo.modules.core.interfaces.Package`.
    const packages = filesUnder(join(core, "android"))
      .filter((file) => /Package\.(kt|java)$/.test(file) && /\bimport\s+expo\.modules\.core\.(interfaces\.Package|BasePackage)\b/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(join(core, "android/src/main/java/").length))
      .sort();
    expect(packages).toEqual(["expo/modules/svelteupdates/SvelteUpdatesPackage.kt", "expo/modules/sveltepush/SveltePushPackage.kt"].sort());
    const source = read("native/svelte-core/android/src/main/java/expo/modules/sveltepush/SveltePushPackage.kt");
    expect(source).toContain("class SveltePushPackage : Package");
    // Gated: both lists are empty unless the flag the plugin writes is there.
    expect(source).toContain("if (!PushManifest.enabled(context)) return emptyList()");
    expect(source).toContain("if (!PushManifest.enabled(activityContext)) return emptyList()");
    const registering = filesUnder(join(core, "android/src/main")).filter((file) => file.endsWith(".kt") && /(ApplicationLifecycleListener|ReactActivityLifecycleListener) \{|createReactActivityLifecycleListeners|createApplicationLifecycleListeners/.test(readFileSync(file, "utf8")));
    expect(registering.map((file) => file.split("/").pop()).sort()).toEqual(["PushTapListener.kt", "SveltePushPackage.kt"]);
  });
});

describe("svelte-core's Android project depends on Firebase Messaging at compile time only, and declares nothing of push in a manifest", () => {
  const gradle = read("native/svelte-core/android/build.gradle");

  test("`compileOnly` at the exact version the plugin adds to the app, and no `implementation`, `api`, BOM or other Firebase line", () => {
    const [, version] = /^com\.google\.firebase:firebase-messaging:(\d+\.\d+\.\d+)$/.exec(pushFirebaseDependency) ?? [];
    expect(version).toBe("26.0.2");
    const lines = gradle.split("\n").filter((line) => /firebase|play-services/.test(line) && !line.trim().startsWith("//"));
    expect(lines.map((line) => line.trim())).toEqual([`compileOnly '${pushFirebaseDependency}'`]);
    expect(gradle).not.toMatch(/(implementation|api|runtimeOnly)[^\n]*(firebase|play-services)/);
    expect(gradle).not.toMatch(/firebase-bom|platform\(/);
  });

  test("the app's R8 is told not to stop on the Firebase classes of the two files that name them, which an app without push does not have", () => {
    expect(gradle).toContain('consumerProguardFiles "consumer-rules.pro"');
    expect(read("native/svelte-core/android/consumer-rules.pro")).toContain("-dontwarn com.google.firebase.messaging.**");
    const naming = filesUnder(join(core, "android/src/main"))
      .filter((file) => file.endsWith(".kt") && /^import com\.google\./m.test(readFileSync(file, "utf8")))
      .map((file) => file.split("/").pop())
      .sort();
    expect(naming).toEqual(["PushFirebase.kt", "SveltePushMessagingService.kt"]);
  });

  test("no manifest of the project declares a service, the notification permission or anything of Firebase: a service there would be in every app and take expo-notifications' or React Native Firebase's messages", () => {
    const manifests = filesUnder(join(core, "android")).filter((file) => file.endsWith("AndroidManifest.xml"));
    for (const manifest of manifests) {
      const text = readFileSync(manifest, "utf8");
      expect([manifest, /<service|firebase|MESSAGING_EVENT|POST_NOTIFICATIONS|SveltePush/i.test(text)]).toEqual([manifest, false]);
    }
    // The plugin declares them instead, with the class this project defines and Firebase's event.
    expect(pushMessagingService).toBe("expo.modules.sveltepush.SveltePushMessagingService");
    expect(read("native/svelte-core/android/src/main/java/expo/modules/sveltepush/SveltePushMessagingService.kt")).toMatch(/^class SveltePushMessagingService : FirebaseMessagingService\(\)/m);
    expect([firebaseMessagingEvent, postNotificationsPermission]).toEqual(["com.google.firebase.MESSAGING_EVENT", "android.permission.POST_NOTIFICATIONS"]);
  });

  test("it packs: the push sources, the consumer rules and the Swift are in `files`, and the host checks are not", () => {
    const packer = Bun.which("pnpm") ? ["pnpm", "pack", "--dry-run", "--json"] : ["npm", "pack", "--dry-run", "--json", "--ignore-scripts"];
    const run = Bun.spawnSync(packer, { cwd: root, stdout: "pipe", stderr: "pipe" });
    const parsed = JSON.parse(run.stdout.toString()) as { files: { path: string }[] } | { files: { path: string }[] }[];
    const listed = (Array.isArray(parsed) ? parsed[0] : parsed)?.files.map((file) => file.path) ?? [];
    for (const path of [
      "native/svelte-core/android/consumer-rules.pro",
      "native/svelte-core/android/src/main/java/expo/modules/sveltepush/SveltePushModule.kt",
      "native/svelte-core/android/src/main/java/expo/modules/sveltepush/SveltePushPackage.kt",
      "native/svelte-core/android/src/main/java/expo/modules/sveltepush/PushFirebase.kt",
      "native/svelte-core/ios/push/SveltePushModule.swift",
      "native/svelte-core/ios/push/SveltePushFlag.swift",
      "native/svelte-core/ios/push/SveltePushBackgroundLaunch.swift",
    ])
      expect([path, listed.includes(path)]).toEqual([path, true]);
    expect(listed.filter((path) => /sveltepush.*(PushCheck|push\.sh)|SveltePushMessageCheck|message\.sh/.test(path))).toEqual([]);
  });
});

describe("the config plugin makes an app one with push, and takes it away again", () => {
  const template = expoTemplateAppBuildGradle();
  const googleServices = JSON.stringify({ project_info: { project_id: "demo" }, client: [{ client_info: { android_client_info: { package_name: "io.e.a" } } }] });
  const push = { android: { googleServicesFile: "./google-services.json" }, ios: { mode: "production" as const } };
  const appConfig = (projectRoot: string): ExpoConfig => ({ name: "app", slug: "app", _internal: { projectRoot }, android: { package: "io.e.a" }, ios: { bundleIdentifier: "io.e.a" } });
  const run = async (exported: ExportedConfig, platform: "ios" | "android", mod: string, modResults: object) => {
    const apply = (exported.mods as Record<string, Record<string, (config: object) => Promise<{ modResults: any }>>>)[platform]?.[mod];
    if (apply === undefined) throw new Error(`the config has no ${platform} ${mod} mod`);
    return (await apply({ modRequest: { projectRoot: "", platformProjectRoot: "", platform, modName: mod, introspect: false }, modResults })).modResults;
  };
  /** The manifest of an app that has not had push: Expo's template names (the application, one permission of the app's own, one service of its own). */
  const bareManifest = () => ({
    manifest: {
      "uses-permission": [{ $: { "android:name": "android.permission.INTERNET" } }],
      application: [{ $: { "android:name": ".MainApplication" }, service: [{ $: { "android:name": "com.example.SyncService" } }], "meta-data": [{ $: { "android:name": "com.example.key", "android:value": "1" } }] }],
    },
  });

  test("on: the dependency, the service, the permission and the enabled flags are in the app; off, with the projects of the last prebuild: all of it is gone and the app's own is as it was", async () => {
    using project = createProject({ "package.json": JSON.stringify({ name: "app", dependencies: {} }), "google-services.json": googleServices, "ios/App/AppDelegate.swift": "", "android/app/build.gradle": "" }, "svelte-native-push-native-");
    const on = withCapabilities(appConfig(project.directory), { push }, { projectRoot: project.directory });
    const off = withCapabilities(appConfig(project.directory), { push: false }, { projectRoot: project.directory });

    const gradle = (await run(on, "android", "appBuildGradle", { language: "groovy", path: "build.gradle", contents: template })).contents as string;
    expect(gradle).toContain(`implementation("${pushFirebaseDependency}")`);
    expect(gradle.split("\n").filter((line) => line.includes("firebase-messaging"))).toHaveLength(1);
    const manifest = await run(on, "android", "manifest", bareManifest());
    const application = manifest.manifest.application[0];
    expect(application["meta-data"].find((item: any) => item.$["android:name"] === pushMetaData.enabled)?.$["android:value"]).toBe("true");
    expect(application.service.map((item: any) => item.$["android:name"])).toEqual(["com.example.SyncService", pushMessagingService]);
    expect(manifest.manifest["uses-permission"].map((item: any) => item.$["android:name"])).toEqual(["android.permission.INTERNET", postNotificationsPermission]);
    // Expo writes the config's own Info.plist keys, so the flag and the background mode are in the config, not in a mod.
    expect([on.ios?.infoPlist?.[pushInfoPlistFlag], on.ios?.infoPlist?.UIBackgroundModes]).toEqual([true, ["remote-notification"]]);
    const plist = { CFBundleName: "App", ...on.ios?.infoPlist };

    expect((await run(off, "android", "appBuildGradle", { language: "groovy", path: "build.gradle", contents: gradle })).contents).toBe(template);
    const gone = await run(off, "android", "manifest", manifest);
    expect(gone.manifest.application[0].service).toEqual([{ $: { "android:name": "com.example.SyncService" } }]);
    expect(gone.manifest.application[0]["meta-data"]).toEqual([{ $: { "android:name": "com.example.key", "android:value": "1" } }]);
    expect(gone.manifest["uses-permission"]).toEqual([{ $: { "android:name": "android.permission.INTERNET" } }]);
    expect(await run(off, "ios", "infoPlist", plist)).toEqual({ CFBundleName: "App", UIBackgroundModes: ["remote-notification"] });
  });
});
