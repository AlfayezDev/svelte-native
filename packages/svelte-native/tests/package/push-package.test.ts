import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pushPackage } from "../../src/capabilities.ts";
import { libraryVersion, peerRange } from "../support/versions.ts";

// `@alfayez/svelte-native-push` (packages/svelte-native-push, PUSH.md) is the native code of `capabilities.push`: an Expo module of its own that apps install from the
// same git tag as the library. It is source only, so what can drift is what ties it together: its version and peers against the library's, the module config against the
// classes it names, the manifest against the service class, and Firebase's version, which is pinned.
const root = resolve(import.meta.dirname, "../../../svelte-native-push");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const manifest = JSON.parse(read("package.json")) as {
  name: string;
  version: string;
  main?: string;
  exports?: unknown;
  scripts?: Record<string, string>;
  files: string[];
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
};
const config = JSON.parse(read("expo-module.config.json")) as {
  platforms: string[];
  android: { projects: { name: string; path: string; modules: string[] }[] };
  apple: { podspecPath: string[]; swiftModuleName: string[]; modules: string[]; appDelegateSubscribers: string[] };
};

describe("the package", () => {
  test("is released with the library: its name is the one the capability looks for, its version the library's, and the library, Expo and React Native are peers at the library's own ranges", () => {
    expect(manifest.name).toBe(pushPackage);
    expect(manifest.version).toBe(libraryVersion);
    expect(manifest.peerDependencies).toEqual({ "@alfayez/svelte-native": libraryVersion, expo: peerRange("expo"), "react-native": peerRange("react-native") });
  });

  test("has no JavaScript and nothing a git dependency refuses or a dependent cannot resolve", () => {
    expect([manifest.main, manifest.exports, manifest.dependencies]).toEqual([undefined, undefined, undefined]);
    for (const script of ["prepare", "prepack", "prepublish"]) expect(manifest.scripts?.[script]).toBeUndefined();
    for (const spec of Object.values(manifest.peerDependencies)) expect(/^(file|link|workspace|catalog):/.test(spec)).toBe(false);
    expect(read("LICENSE")).toBe(readFileSync(resolve(root, "../../LICENSE"), "utf8"));
  });

  test("packs its native code and the module config, and none of what a build leaves", () => {
    for (const entry of ["android", "ios", "expo-module.config.json", "README.md", "LICENSE"]) {
      expect([entry, manifest.files.includes(entry), existsSync(join(root, entry))]).toEqual([entry, true, true]);
    }
    for (const output of ["!android/build", "!android/.gradle", "!ios/build", "!ios/Pods"]) expect(manifest.files).toContain(output);
  });

  test("is linked by Expo's autolinking alone: React Native's is told there is nothing for it, or it links the same Gradle project and pod a second time", async () => {
    expect(manifest.files).toContain("react-native.config.js");
    const rn = (await import(join(root, "react-native.config.js"))) as { default?: { dependency?: { platforms?: Record<string, unknown> } } };
    expect(rn.default?.dependency?.platforms).toEqual({ android: null, ios: null });
  });
});

describe("expo-module.config.json", () => {
  test("links one Gradle project with the module, and one pod with the module and the app delegate subscriber", () => {
    expect(config.platforms).toEqual(["android", "apple"]);
    expect(config.android.projects).toEqual([{ name: "svelte-push", path: "android", modules: ["expo.modules.sveltepush.SveltePushModule"] }]);
    expect(config.apple).toEqual({ podspecPath: ["ios/SveltePush.podspec"], swiftModuleName: ["SveltePush"], modules: ["SveltePushModule"], appDelegateSubscribers: ["SveltePushAppDelegateSubscriber"] });
  });

  test("names classes and files that exist, and the module is `SveltePush` on both platforms", () => {
    const [project] = config.android.projects;
    expect(existsSync(join(root, project.path, "build.gradle"))).toBe(true);
    for (const module of project.modules) {
      const file = `${join(project.path, "src/main/java", ...module.split("."))}.kt`;
      expect([file, existsSync(join(root, file))]).toEqual([file, true]);
      expect(read(file)).toMatch(new RegExp(`^class ${module.split(".").pop()} : Module\\(\\)`, "m"));
      expect(read(file)).toContain('Name("SveltePush")');
    }
    const podspec = read(config.apple.podspecPath[0]);
    expect(podspec).toContain(`s.name           = '${config.apple.swiftModuleName[0]}'`);
    for (const [name, base] of [...config.apple.modules.map((name) => [name, "Module"]), ...config.apple.appDelegateSubscribers.map((name) => [name, "ExpoAppDelegateSubscriber"])]) {
      expect(read(`ios/${name}.swift`)).toContain(`public final class ${name}: ${base}`);
    }
    expect(read("ios/SveltePushModule.swift")).toContain('Name("SveltePush")');
  });
});

describe("the Android project", () => {
  test("declares the messaging service, which is not exported and receives Firebase's messages, and the notification permission, in the library's manifest", () => {
    const xml = read("android/src/main/AndroidManifest.xml");
    expect(xml).toContain('<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />');
    expect(xml).toMatch(/<service\s+android:name="expo\.modules\.sveltepush\.SveltePushMessagingService"\s+android:exported="false">\s*<intent-filter>\s*<action android:name="com\.google\.firebase\.MESSAGING_EVENT" \/>/);
    expect(read("android/src/main/java/expo/modules/sveltepush/SveltePushMessagingService.kt")).toMatch(/^class SveltePushMessagingService : FirebaseMessagingService\(\)/m);
    // The namespace is the Gradle project's, so the manifest carries no package attribute.
    expect(xml).not.toContain("package=");
  });

  test("pins Firebase Messaging to one exact version, and takes it from no other source", () => {
    const gradle = read("android/build.gradle");
    expect([...gradle.matchAll(/com\.google\.firebase:[\w-]+:([^'"\s]+)/g)].map((match) => match[1])).toEqual([expect.stringMatching(/^\d+\.\d+\.\d+$/)]);
    expect(gradle).toMatch(/implementation 'com\.google\.firebase:firebase-messaging:\d+\.\d+\.\d+'/);
    expect(gradle).toContain('namespace "expo.modules.sveltepush"');
    expect(gradle).not.toMatch(/firebase-bom|platform\(/);
  });
});
