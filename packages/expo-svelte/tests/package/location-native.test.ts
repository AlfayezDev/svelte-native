import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExpoConfig } from "expo/config";
import type { ExportedConfig } from "expo/config-plugins";
import { locationAndroidPermissions, locationCompileCondition, locationInfoPlistFlag, locationMetaData, locationPodfileProperty, withCapabilities } from "../../src/capabilities.ts";
import { createProject } from "../support/project.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Location's native code (SPEC.md, "Location") is part of the library's one native module, svelte-core, which is in every app: there is no library of its own for it, and none to install. What makes an
// app one with location is what the config plugin writes (the permissions and the flags the native code asks first); what keeps the library free of other libraries is that nothing here depends on
// expo-location or on a Google library. This file pins those facts: the lists in expo-module.config.json, the dependencies, the manifests, the registration path, what packs, and the plugin's writing and
// taking away. What the native code does with the flag is the Kotlin host check (`native/svelte-core/android/src/test/location.sh`), `native/svelte-core/test/ios/location.sh` and
// `tests/native-host/contracts/location-ios.test.ts`.
const root = resolve(import.meta.dirname, "../..");
const repository = resolve(root, "../..");
const core = join(root, "native/svelte-core");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const config = JSON.parse(read("expo-module.config.json")) as {
  platforms: string[];
  android: { projects: { name: string; path: string; modules: string[] }[] };
  apple: { podspecPath: string[]; swiftModuleName: string[]; modules: string[]; appDelegateSubscribers: string[]; reactDelegateHandlers: string[] };
};

const filesUnder = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

describe("expo-module.config.json links location's module in svelte-core's project and pod, and no project or pod of their own", () => {
  test("Android: the module lists of the one svelte-core project", () => {
    expect(config.platforms).toEqual(["android", "apple"]);
    expect(config.android.projects.map((project) => project.name)).toEqual(["svelte-core"]);
    expect(config.android.projects[0]?.modules).toEqual([
      "expo.modules.svelteengine.SvelteEngineModule",
      "expo.modules.svelteupdates.SvelteUpdatesModule",
      "expo.modules.svelteblur.SvelteBlurModule",
      "expo.modules.sveltecore.SvelteFetchModule",
      "expo.modules.sveltecore.SvelteClipboardModule",
      "expo.modules.sveltepush.SveltePushModule",
      "expo.modules.sveltelocation.SvelteLocationModule",
    ]);
    const module = read("native/svelte-core/android/src/main/java/expo/modules/sveltelocation/SvelteLocationModule.kt");
    expect(module).toMatch(/^class SvelteLocationModule : Module\(\)/m);
    expect(module).toContain('Name("SvelteLocation")');
    expect(JSON.stringify(config)).not.toMatch(/svelte-location|SvelteLocation[^M]/);
  });

  test("iOS: SvelteLocationModule is in the SvelteCore pod's list, and its Swift is a folder of the pod; the pod has no subscriber of location's", () => {
    expect(config.apple.swiftModuleName).toEqual(["SvelteCore"]);
    expect(config.apple.podspecPath).toEqual(["native/svelte-core/ios/SvelteCore.podspec"]);
    expect(config.apple.modules).toEqual(["SvelteInsetsModule", "SvelteNavigationModule", "SvelteUpdatesModule", "SvelteBlurModule", "SvelteFetchModule", "SvelteClipboardModule", "SveltePushModule", "SvelteLocationModule"]);
    expect(config.apple.appDelegateSubscribers).toEqual(["SvelteCaptureSubscriber", "SveltePushAppDelegateSubscriber"]);
    expect(read("native/svelte-core/ios/location/SvelteLocationModule.swift")).toContain("public final class SvelteLocationModule: Module");
    expect(read("native/svelte-core/ios/location/SvelteLocationModule.swift")).toContain('Name("SvelteLocation")');
    expect(read("native/svelte-core/ios/SvelteCore.podspec")).toContain("s.source_files = '**/*.{h,m,mm,cpp,swift}'");
    // The pod compiles every Swift file under `ios/`: the host check's own `main` is outside it.
    expect(existsSync(join(core, "ios/location/SvelteLocationCheck.swift"))).toBe(false);
    expect(existsSync(join(core, "test/ios/SvelteLocationCheck.swift"))).toBe(true);
  });

  test("Android: location registers no Package and no lifecycle listener: it needs nothing before JavaScript asks, so an app without it gets nothing from it at start-up", () => {
    const directory = join(core, "android/src/main/java/expo/modules/sveltelocation");
    expect(readdirSync(directory).filter((name) => /Package\.(kt|java)$/.test(name))).toEqual([]);
    for (const file of filesUnder(directory)) expect([file, /ApplicationLifecycleListener|ReactActivityLifecycleListener|createApplicationLifecycleListeners/.test(readFileSync(file, "utf8"))]).toEqual([file, false]);
    expect(read("native/svelte-core/android/src/main/java/expo/modules/sveltelocation/SvelteLocationModule.kt")).not.toContain("OnCreate");
  });
});

describe("no other library is part of location: expo-location is no dependency of the library or the example app, and no Google library is in svelte-core", () => {
  /** Every group of a manifest that can name a dependency. */
  const groups = ["dependencies", "devDependencies", "peerDependencies", "peerDependenciesMeta", "optionalDependencies"] as const;
  const manifests = ["packages/expo-svelte/package.json", "apps/example/package.json"];

  test("package.json of the library and of the example app name it in no group", () => {
    for (const manifest of manifests) {
      const parsed = JSON.parse(readFileSync(join(repository, manifest), "utf8")) as Record<string, Record<string, unknown> | undefined>;
      for (const group of groups) expect([manifest, group, Object.keys(parsed[group] ?? {}).includes("expo-location")]).toEqual([manifest, group, false]);
      expect([manifest, readFileSync(join(repository, manifest), "utf8").includes("expo-location")]).toEqual([manifest, false]);
    }
  });

  test("the lockfile's importers for them list it neither (the QA app's smoke variant installs it as a stand-in for a real app's library list, and that one does)", () => {
    const lock = readFileSync(join(repository, "pnpm-lock.yaml"), "utf8");
    /** An importer's block: from its name at two spaces of indentation to the next line at two spaces or none. */
    const block = (name: string) => {
      const start = lock.indexOf(`\n  ${name}:\n`);
      expect(start).toBeGreaterThanOrEqual(0);
      const rest = lock.slice(start + 1);
      const end = rest.slice(1).search(/\n {0,2}\S/);
      return rest.slice(0, end < 0 ? rest.length : end + 1);
    };
    expect(block("packages/expo-svelte")).not.toContain("expo-location");
    expect(block("apps/example")).not.toContain("expo-location");
    expect(block("apps/qa")).toContain("expo-location:");
  });

  test("nothing the library ships requires expo-location or names its native module: the module is the library's own, SvelteLocation", () => {
    const shipped = [...filesUnder(join(root, "src")), ...filesUnder(join(core, "android/src/main")), ...filesUnder(join(core, "ios"))].filter((file) => /\.(ts|svelte|kt|java|swift|mm|m|h)$/.test(file));
    for (const file of shipped) {
      const text = readFileSync(file, "utf8");
      expect([file, /require\(["']expo-location["']\)|from ["']expo-location["']|requireNativeModule\(["']ExpoLocation["']\)|requireOptionalNativeModule\(["']ExpoLocation["']\)|expo\.modules\.location\./.test(text)]).toEqual([file, false]);
    }
    expect(read("src/geolocation.ts")).toContain('requireOptionalNativeModule?.<NativeLocationModule>("SvelteLocation")');
  });

  test("svelte-core's Android project depends on no Google library for it: the platform's LocationManager through androidx.core, which the project already has", () => {
    const gradle = read("native/svelte-core/android/build.gradle");
    const lines = gradle.split("\n").filter((line) => !line.trim().startsWith("//"));
    expect(lines.filter((line) => /play-services|gms|android\.gms|firebase-location|fused/i.test(line))).toEqual([]);
    expect(lines.some((line) => line.includes('implementation "androidx.core:core-ktx:'))).toBe(true);
    const sources = filesUnder(join(core, "android/src/main/java/expo/modules/sveltelocation")).map((file) => readFileSync(file, "utf8")).join("\n");
    expect(sources).not.toMatch(/^import com\.google\./m);
    expect(sources).toContain("androidx.core.location.LocationManagerCompat");
  });

  test("no manifest of the project declares a location permission or location's flag: they are the plugin's, because svelte-core is in every app", () => {
    for (const manifest of filesUnder(join(core, "android")).filter((file) => file.endsWith("AndroidManifest.xml"))) {
      expect([manifest, /LOCATION|sveltelocation/i.test(readFileSync(manifest, "utf8"))]).toEqual([manifest, false]);
    }
    expect(locationAndroidPermissions).toEqual(["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"]);
    expect(locationMetaData.enabled).toBe("expo.modules.sveltelocation.enabled");
  });
});

describe("the iOS code is compiled in only for an app that turned location on: App Store Connect refuses a binary that uses CoreLocation without the usage text", () => {
  const podspec = read("native/svelte-core/ios/SvelteCore.podspec");
  /** The podspec's code, without its comments. */
  const code = podspec.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

  test("the podspec reads ios/Podfile.properties.json (an absent or unreadable file is no properties) and turns the property the plugin writes into the compile condition, beside $(inherited)", () => {
    expect(code).toContain("JSON.parse(File.read(File.join(Pod::Config.instance.installation_root, 'Podfile.properties.json')))");
    expect(code).toMatch(/rescue StandardError\n\s+\{\}/);
    // One map of property to condition, a line each (push adds its own beside this one), and the condition is on only for the string "true".
    expect(code).toContain(`'${locationPodfileProperty}' => '${locationCompileCondition}',`);
    expect(code).toContain("}.select { |key, _| podfile_properties[key] == 'true' }.values");
    expect(code).toContain("'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => (['$(inherited)'] + compile_conditions).join(' ')");
    // The conditions are the pod's own (`pod_target_xcconfig`), not the app's.
    expect(code.indexOf("'SWIFT_ACTIVE_COMPILATION_CONDITIONS'")).toBeGreaterThan(code.indexOf("s.pod_target_xcconfig = {"));
  });

  test("the podspec links no location framework: Swift links CoreLocation from the import, and only where the code is compiled in", () => {
    expect(code).not.toMatch(/CoreLocation|CoreMotion|s\.frameworks|s\.weak_frameworks|OTHER_LDFLAGS/);
  });

  test("every Swift file of the module is `#if SVELTE_LOCATION` and references CoreLocation nowhere outside it, comments aside; the one module file has a stub for the other branch", () => {
    const folder = join(core, "ios/location");
    const swift = readdirSync(folder).filter((name) => name.endsWith(".swift")).sort();
    expect(swift).toEqual(["SvelteLocationFlag.swift", "SvelteLocationModule.swift", "SvelteLocationPayload.swift", "SvelteLocationRequests.swift"]);
    /** The code of a file, its comments out. */
    const codeOf = (text: string) => text.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    /** What is not inside `#if SVELTE_LOCATION ... #else` (or `#endif`): the lines the binary has whatever the app turned on. */
    const outside = (text: string) => {
      const lines = codeOf(text).split("\n");
      const kept: string[] = [];
      let inside = false;
      for (const line of lines) {
        const directive = line.trim();
        if (directive === `#if ${locationCompileCondition}`) inside = true;
        else if (inside && (directive === "#else" || directive === "#endif")) inside = false;
        else if (!inside) kept.push(line);
      }
      return kept.join("\n");
    };
    for (const name of swift) {
      const text = readFileSync(join(folder, name), "utf8");
      expect([name, text.includes(`#if ${locationCompileCondition}`)]).toEqual([name, true]);
      // No CoreLocation module, no CL type or constant (CLLocationManager, CLLocation, CLAuthorizationStatus, kCLErrorDomain, kCLLocationAccuracy...), no CoreMotion, outside the condition.
      expect([name, /CoreLocation|CoreMotion|\bCL[A-Z]\w*|\bkCL\w*/.test(outside(text))]).toEqual([name, false]);
      // The condition is balanced: every `#if` has its `#endif`.
      expect([name, codeOf(text).split("\n").filter((line) => line.trim().startsWith("#if ")).length, codeOf(text).split("\n").filter((line) => line.trim() === "#endif").length]).toEqual([name, 1, 1]);
    }
    // The three plain-and-CoreLocation files are wholly inside it, imports included; the module file has `import ExpoModulesCore` outside it and a stub in `#else`.
    for (const name of ["SvelteLocationFlag.swift", "SvelteLocationPayload.swift", "SvelteLocationRequests.swift"]) {
      const lines = codeOf(readFileSync(join(folder, name), "utf8")).split("\n").filter((line) => line.trim() !== "");
      expect([name, lines[0], lines[lines.length - 1]]).toEqual([name, `#if ${locationCompileCondition}`, "#endif"]);
    }
    const module = readFileSync(join(folder, "SvelteLocationModule.swift"), "utf8");
    expect(outside(module)).toContain("import ExpoModulesCore");
    expect(outside(module)).toContain("final class SvelteLocationDisabledException: Exception");
    expect(module).toContain("#else");
    const stub = module.slice(module.indexOf("#else"), module.lastIndexOf("#endif"));
    expect(stub).toContain("public final class SvelteLocationModule: Module");
    expect(stub).toContain('Name("SvelteLocation")');
    expect(stub).toContain('Constant("enabled") { false }');
    expect(stub).toContain('Events("locationChanged", "locationError")');
    // Every call of the contract is there, and refuses.
    const calls = ["permission", "requestPermission", "currentPosition", "lastKnownPosition", "startWatch", "stopWatch"];
    for (const call of calls) expect(stub).toMatch(new RegExp(`AsyncFunction\\("${call}"\\)[^\\n]*\\n\\s+promise\\.reject\\(SvelteLocationDisabledException\\(\\)\\)`));
    expect(stub.match(/AsyncFunction\(/g)).toHaveLength(calls.length);
    expect(stub).not.toMatch(/SvelteLocation(Center|Fix|Flag|Permission|Asker|OneShot|Watch)/);
  });

  test("the module is in the module list whatever the build: Expo's generated provider names it, so the stub keeps it registrable", () => {
    expect(config.apple.modules).toContain("SvelteLocationModule");
  });
});

describe("it packs", () => {
  test("the Kotlin and Swift sources are in `files`, and the host checks are not", () => {
    const packer = Bun.which("pnpm") ? ["pnpm", "pack", "--dry-run", "--json"] : ["npm", "pack", "--dry-run", "--json", "--ignore-scripts"];
    const run = Bun.spawnSync(packer, { cwd: root, stdout: "pipe", stderr: "pipe" });
    const parsed = JSON.parse(run.stdout.toString()) as { files: { path: string }[] } | { files: { path: string }[] }[];
    const listed = (Array.isArray(parsed) ? parsed[0] : parsed)?.files.map((file) => file.path) ?? [];
    for (const path of [
      "native/svelte-core/android/src/main/java/expo/modules/sveltelocation/SvelteLocationModule.kt",
      "native/svelte-core/android/src/main/java/expo/modules/sveltelocation/LocationSource.kt",
      "native/svelte-core/android/src/main/java/expo/modules/sveltelocation/LocationRules.kt",
      "native/svelte-core/android/src/main/java/expo/modules/sveltelocation/LocationManifest.kt",
      "native/svelte-core/ios/location/SvelteLocationModule.swift",
      "native/svelte-core/ios/location/SvelteLocationRequests.swift",
      "native/svelte-core/ios/location/SvelteLocationPayload.swift",
      "native/svelte-core/ios/location/SvelteLocationFlag.swift",
    ])
      expect([path, listed.includes(path)]).toEqual([path, true]);
    expect(listed.filter((path) => /sveltelocation.*(LocationCheck|location\.sh)|SvelteLocationCheck|test\/ios\/location\.sh/.test(path))).toEqual([]);
  });
});

describe("the config plugin makes an app one with location, and takes it away again", () => {
  const appConfig = (projectRoot: string): ExpoConfig => ({ name: "app", slug: "app", _internal: { projectRoot }, android: { package: "io.e.a" }, ios: { bundleIdentifier: "io.e.a" } });
  const run = async (exported: ExportedConfig, platform: "ios" | "android", mod: string, modResults: object, extra: object = {}) => {
    const apply = (exported.mods as Record<string, Record<string, (config: object) => Promise<{ modResults: any }>>>)[platform]?.[mod];
    if (apply === undefined) throw new Error(`the config has no ${platform} ${mod} mod`);
    return (await apply({ ...extra, modRequest: { projectRoot: "", platformProjectRoot: "", platform, modName: mod, introspect: false }, modResults })).modResults;
  };
  /** The manifest of an app that has not had location: Expo's template names (the application, one permission of the app's own, one meta-data of its own). */
  const bareManifest = () => ({
    manifest: {
      "uses-permission": [{ $: { "android:name": "android.permission.INTERNET" } }],
      application: [{ $: { "android:name": ".MainApplication" }, "meta-data": [{ $: { "android:name": "com.example.key", "android:value": "1" } }] }],
    },
  });

  test("on: the flags, the permissions and the usage text are in the app; off, with the projects of the last prebuild: the flags and the permissions are gone and the app's own is as it was", async () => {
    using project = createProject({ "package.json": JSON.stringify({ name: "app", dependencies: {} }), "ios/App/AppDelegate.swift": "", "android/app/build.gradle": "" }, "expo-svelte-location-native-");
    const on = withCapabilities(appConfig(project.directory), { location: "Shows the stores near you." }, { projectRoot: project.directory });
    const off = withCapabilities(appConfig(project.directory), { location: false }, { projectRoot: project.directory });

    const manifest = await run(on, "android", "manifest", bareManifest());
    const application = manifest.manifest.application[0];
    expect(application["meta-data"].find((item: any) => item.$["android:name"] === locationMetaData.enabled)?.$["android:value"]).toBe("true");
    expect(manifest.manifest["uses-permission"].map((item: any) => item.$["android:name"])).toEqual(["android.permission.INTERNET", ...locationAndroidPermissions]);
    // Expo writes the config's own Info.plist keys, so the flag and the text are in the config, not in a mod.
    expect([on.ios?.infoPlist?.[locationInfoPlistFlag], on.ios?.infoPlist?.NSLocationWhenInUseUsageDescription]).toEqual([true, "Shows the stores near you."]);
    const plist = { CFBundleName: "App", ...on.ios?.infoPlist };

    const gone = await run(off, "android", "manifest", manifest);
    expect(gone.manifest.application[0]["meta-data"]).toEqual([{ $: { "android:name": "com.example.key", "android:value": "1" } }]);
    expect(gone.manifest["uses-permission"]).toEqual([{ $: { "android:name": "android.permission.INTERNET" } }]);
    // The flag goes; the usage text stays (nothing in the project says whose it is).
    expect(await run(off, "ios", "infoPlist", plist)).toEqual({ CFBundleName: "App", NSLocationWhenInUseUsageDescription: "Shows the stores near you." });
    // What compiles the iOS code in: the Podfile property, written when location is on and taken away when it is off, beside Expo's own.
    const properties = await run(on, "ios", "podfileProperties", { "expo.jsEngine": "hermes" });
    expect(properties).toEqual({ "expo.jsEngine": "hermes", [locationPodfileProperty]: "true" });
    expect(await run(off, "ios", "podfileProperties", properties)).toEqual({ "expo.jsEngine": "hermes" });
  });
});
