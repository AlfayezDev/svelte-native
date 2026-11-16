import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyAppDelegate } from "../../../src/expo.ts";

// Swift cannot be compiled here, so what ties the three pieces of the iOS restore together is read from their sources: JavaScript (`fabric/host.ts`)
// calls the module by the names it defines, the AppDelegate patch (`applyAppDelegate`) calls the enum it defines, and both modules are autolinked.
const core = resolve(import.meta.dirname, "../../../native/svelte-core");
const swift = readFileSync(resolve(core, "ios/navigation/SvelteNavigationModule.swift"), "utf8");
const host = readFileSync(resolve(import.meta.dirname, "../../../src/fabric/host.ts"), "utf8");
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
    expect(delegate).toContain("internal import SvelteCore");
    expect(swift.match(/public static func /g)).toHaveLength(4);
  });

  test("the module is listed for autolinking, and the AppDelegate imports the pod it is in", () => {
    const config = JSON.parse(readFileSync(resolve(core, "../../expo-module.config.json"), "utf8")) as { apple: { modules: string[] } };
    expect(config.apple.modules).toContain("SvelteNavigationModule");
    expect(swift).toContain("public final class SvelteNavigationModule: Module");
  });

  test("what restore() returns carries the keys JavaScript judges, and restored() the two strings it passes", () => {
    for (const key of ["json", "savedAt", "attempts", "systemKept"]) expect(swift).toContain(`"${key}": ${key === "systemKept" ? "systemKept ||" : key}`);
    expect(swift).toContain('Function("restored") { (outcome: String, reason: String)');
    expect(host).toContain('restored?.("dropped", droppedReasons[verdict.dropped])');
    expect(host).toContain("restored?.(outcome, reason)"); // the router's account of what it did with the state (navigationAdopted)
    expect(host).toContain('"the router adopted the saved state"');
    // The rules are JavaScript's: the module keeps no copy of the attempt limit, the window or the system's say.
    expect(code).not.toMatch(/attemptsAllowed|Allowed|expire|window|86_?400|dropped/i);
  });

  test("the build identity travels the way navigation-restore.ts reads it: save() takes the update id, restore() returns the build, the running build and the update", () => {
    expect(swift).toContain('Function("save") { (json: String, update: String?)');
    expect(host).toContain("save?: (json: string, update: string | null) => void");
    expect(host).toContain("?.save?.(json, runningUpdate())");
    for (const key of ["build", "runningBuild", "update"]) expect(swift).toContain(`"${key}"`);
    expect(swift).toContain('Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion")');
    // freshNavigation reads the same three names, and the running update is the one this process runs
    const restore = readFileSync(resolve(import.meta.dirname, "../../../src/navigation-restore.ts"), "utf8");
    for (const key of ["build", "runningBuild", "update"]) expect(restore).toContain(key);
    expect(host).toContain("freshNavigation(module.restore(), Date.now(), undefined, runningUpdate())");
  });

  test("a launch in the background hands nothing over and consumes nothing, and a cold start writes last.json in the QA app only", () => {
    const take = code.slice(code.indexOf("func takeRestored()"), code.indexOf("func finish("));
    expect(take).toContain("let background = Self.launchedInBackground()");
    expect(take.indexOf("let background")).toBeLessThan(take.indexOf("lock.lock()")); // read before the lock: the main thread takes it too
    expect(code).toContain("UIApplication.shared.applicationState == .background");
    // the background check comes before anything is marked handed over, counted or recorded
    expect(take.indexOf("if background { return nil }")).toBeGreaterThan(-1);
    expect(take.indexOf("if background { return nil }")).toBeLessThan(take.indexOf("handedOver = true"));
    expect(take.indexOf("if background { return nil }")).toBeLessThan(take.indexOf("record(outcome"));
    expect(take).toContain("Self.isQaBundle");
    expect(take).toMatch(/if existed \{[\s\S]*?\} else if Self\.isQaBundle \{/);
  });

  test("the bounds and the age of a state are the same on both sides of the module", () => {
    expect(swift).toContain("static let limit = 100_000"); // Android's NavigationState.LIMIT
    expect(readFileSync(resolve(core, "android/src/main/java/expo/modules/svelteengine/NavigationState.kt"), "utf8")).toContain("private const val LIMIT = 100_000");
    // The age is not judged in Swift: the module hands the time over and JavaScript decides (navigation-restore.ts).
    expect(code).not.toMatch(/expire|window/i);
  });
});
