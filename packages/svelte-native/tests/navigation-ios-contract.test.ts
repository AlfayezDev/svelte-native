import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyAppDelegate } from "../src/expo.ts";

// Swift cannot be compiled here, so what ties the three pieces of the iOS restore together is read from their sources: JavaScript (`fabric/host.ts`)
// calls the module by the names it defines, the AppDelegate patch (`applyAppDelegate`) calls the enum it defines, and both modules are autolinked.
const modules = resolve(import.meta.dirname, "../../../apps/platform/modules/svelte-navigation-ios");
const swift = readFileSync(resolve(modules, "ios/SvelteNavigationModule.swift"), "utf8");
const host = readFileSync(resolve(import.meta.dirname, "../src/fabric/host.ts"), "utf8");
/** The Swift without its comments: the policy is in JavaScript, and the comments are free to say so. */
const code = swift.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
const delegate = applyAppDelegate("import Expo\nclass AppDelegate {\n  var reactNativeFactory: RCTReactNativeFactory?\n}\n");

describe("the iOS navigation module's sources agree with each other", () => {
  test("JavaScript calls the module by the name and the functions the Swift module defines", () => {
    expect(swift).toContain('Name("SvelteNavigation")');
    expect(host).toContain('requireOptionalNativeModule<NavigationHost>("SvelteNavigation")');
    for (const name of ["save", "restore", "restored"]) {
      expect(swift).toContain(`Function("${name}")`);
      expect(host).toContain(`${name}?:`);
    }
  });

  test("the AppDelegate patch calls the four functions the Swift enum defines, with the arity it defines them with", () => {
    const enumBody = swift.slice(swift.indexOf("public enum SvelteNavigationRestoration"), swift.indexOf("final class NavigationStore"));
    for (const name of ["shouldSave", "encode", "shouldRestore", "didDecode"]) {
      expect(enumBody).toMatch(new RegExp(`public static func ${name}\\(_ coder: NSCoder\\)`));
      expect(delegate).toContain(`SvelteNavigationRestoration.${name}(coder)`);
    }
    expect(delegate).toContain("import SvelteNavigation");
    expect(swift.match(/public static func /g)).toHaveLength(4);
  });

  test("the pod's module is the one the Swift file imports as, and the module is listed for autolinking", () => {
    const podspec = readFileSync(resolve(modules, "ios/SvelteNavigation.podspec"), "utf8");
    expect(podspec).toContain("s.name           = 'SvelteNavigation'");
    expect(podspec).toContain("'DEFINES_MODULE' => 'YES'");
    expect(JSON.parse(readFileSync(resolve(modules, "expo-module.config.json"), "utf8"))).toEqual({ platforms: ["apple"], apple: { modules: ["SvelteNavigationModule"] } });
    expect(swift).toContain("public final class SvelteNavigationModule: Module");
  });

  test("what restore() returns carries the keys JavaScript judges, and restored() the two strings it passes", () => {
    for (const key of ["json", "savedAt", "attempts", "systemKept"]) expect(swift).toContain(`"${key}": ${key === "systemKept" ? "systemKept ||" : key}`);
    expect(swift).toContain('Function("restored") { (outcome: String, reason: String)');
    expect(host).toContain('restored?.("dropped", droppedReasons[verdict.dropped])');
    expect(host).toContain('restored?.("restored",');
    // The rules are JavaScript's: the module keeps no copy of the attempt limit, the window or the system's say.
    expect(code).not.toMatch(/attemptsAllowed|Allowed|expire|window|86_?400|dropped/i);
  });

  test("the bounds and the age of a state are the same on both sides of the module", () => {
    expect(swift).toContain("static let limit = 100_000"); // Android's NavigationState.LIMIT
    expect(readFileSync(resolve(modules, "../svelte-engine/android/src/main/java/expo/modules/svelteengine/NavigationState.kt"), "utf8")).toContain("private const val LIMIT = 100_000");
    // The age is not judged in Swift: the module hands the time over and JavaScript decides (navigation-restore.ts).
    expect(code).not.toMatch(/expire|window/i);
  });
});
