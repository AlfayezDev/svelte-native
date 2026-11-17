import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyPushAppDelegate } from "../../../src/capabilities.ts";
import { FOREGROUND_TIMEOUT_MS } from "../../../src/push/client.ts";
import { expoTemplateAppDelegate } from "../../cli/support/app-delegate.ts";

// The iOS half of push (`packages/svelte-native-push/ios`, PUSH.md). Swift is not compiled on the machines these tests run on, so what ties the pieces together is read from their
// sources: the module defines the functions and events the JavaScript client declares and calls (`src/push/client.ts`), the payloads it builds have the keys of the shared types
// (`src/push/types.ts`), the app delegate subscriber forwards the callbacks Expo's app delegate sends it (`upstream/push-ios.test.ts` pins those), and the AppDelegate patch
// calls the helper by the name and labels it defines. What the mapping and the environment do is run where `swiftc` exists (`test/ios/message.sh`); the simulator and the phone
// are the proof of the rest (`xcrun simctl push`, PUSH.md "Testing").
const push = resolve(import.meta.dirname, "../../../../svelte-native-push");
const read = (path: string) => readFileSync(resolve(push, path), "utf8");
const mod = read("ios/SveltePushModule.swift");
const center = read("ios/SveltePushCenter.swift");
const subscriber = read("ios/SveltePushAppDelegateSubscriber.swift");
const background = read("ios/SveltePushBackgroundLaunch.swift");
const message = read("ios/SveltePushMessage.swift");
const environment = read("ios/SveltePushEnvironment.swift");
const client = readFileSync(resolve(import.meta.dirname, "../../../src/push/client.ts"), "utf8");
const types = readFileSync(resolve(import.meta.dirname, "../../../src/push/types.ts"), "utf8");

/** The text between `start` and the first `end` after it. */
const between = (text: string, start: string, end: string): string => {
  const from = text.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  return text.slice(from, text.indexOf(end, from));
};
/** The member names of a TypeScript object type, read from its source: `name(` or `name?:` or `name:` at the type's own indentation. */
const members = (block: string): string[] => [...block.matchAll(/^ {2}(\w+)[?(:]/gm)].map((match) => match[1] as string);

const nativeModule = between(client, "export type NativePushModule = {", "\n};");
const nativeEvents = between(client, "export type NativePushEvents = {", "\n};");

describe("the module defines what the JavaScript client declares and calls", () => {
  test("every function of NativePushModule, as the contract has it: takeLaunchMessage and backgroundDone synchronous, the rest asynchronous", () => {
    const names = members(nativeModule).filter((name) => name !== "addListener");
    expect(names).toEqual(["permission", "requestPermission", "register", "unregister", "show", "takeLaunchMessage", "backgroundDone"]);
    for (const name of names) {
      const synchronous = name === "takeLaunchMessage" || name === "backgroundDone";
      // `Function(` is also the end of `AsyncFunction(`, so the synchronous kind is the one not preceded by a letter.
      expect(mod).toMatch(new RegExp(synchronous ? `(?<![A-Za-z])Function\\("${name}"\\)` : `AsyncFunction\\("${name}"\\)`));
      expect(mod).not.toMatch(new RegExp(synchronous ? `AsyncFunction\\("${name}"\\)` : `(?<![A-Za-z])Function\\("${name}"\\)`));
    }
    expect(mod).toContain('Name("SveltePush")');
    expect(nativeModule).toContain("takeLaunchMessage(): PushMessage | null;");
    expect(mod).toContain("Function(\"takeLaunchMessage\") { () -> [String: Any]? in");
  });

  test("the four events of NativePushEvents, each with its own observer: events are held until JavaScript listens for that name", () => {
    const events = members(nativeEvents);
    expect(events).toEqual(["token", "message", "opened", "background"]);
    expect(mod).toContain(`Events(${events.map((name) => `"${name}"`).join(", ")})`);
    for (const name of events) {
      expect(mod).toContain(`OnStartObserving("${name}") { SveltePushCenter.shared.startObserving("${name}") }`);
      expect(mod).toContain(`OnStopObserving("${name}") { SveltePushCenter.shared.stopObserving("${name}") }`);
    }
    // The events the center sends are the same four, and none else.
    expect([...new Set([...center.matchAll(/emit\("(\w+)"/g)].map((match) => match[1]))].sort()).toEqual([...events].sort());
  });

  test("show takes the message and the three booleans, and finds the notification it holds by the message's id", () => {
    expect(nativeModule).toContain("show(message: PushMessage, presentation: Required<PushPresentation>): Promise<void>;");
    expect(mod).toContain("AsyncFunction(\"show\") { (message: [String: Any], presentation: SveltePushPresentation) in");
    expect(mod).toContain('message["id"] as? String');
    expect(mod).toMatch(/struct SveltePushPresentation: Record \{\n {2}@Field var banner: Bool = true\n {2}@Field var sound: Bool = true\n {2}@Field var badge: Bool = true\n\}/);
    expect(center).toContain("if banner { options.formUnion([.banner, .list]) }");
  });

  test("the token it resolves with has the keys of PushToken, as APNs's", () => {
    const keys = members(between(types, "export type PushToken = {", "\n};"));
    expect(keys).toEqual(["provider", "token", "environment", "app"]);
    const written = between(center, "let token: [String: Any] = [", "]\n");
    expect([...written.matchAll(/"(\w+)":/g)].map((match) => match[1])).toEqual(keys);
    expect(written).toContain('"provider": "apns"');
    expect(written).toContain('"environment": SveltePushEnvironment.current');
    expect(written).toContain('"app": Bundle.main.bundleIdentifier');
    expect(center).toContain('String(format: "%02hhx", $0)');
  });

  test("the message it sends has the keys of PushMessage, and a title, body or link the payload lacks is left out", () => {
    const keys = members(between(types, "export type PushMessage = {", "\n};"));
    expect(keys).toEqual(["id", "title", "body", "url", "data", "provider"]);
    const payload = between(message, "var payload: [String: Any] {", "\n  }");
    expect([...payload.matchAll(/"(\w+)":|result\["(\w+)"\]/g)].map((match) => match[1] ?? match[2]).sort()).toEqual([...keys].sort());
    expect(payload).toContain('"provider": "apns"');
    for (const optional of ["title", "body", "url"]) expect(payload).toContain(`if let ${optional} { result["${optional}"] = ${optional} }`);
  });
});

describe("the delegate and its timing", () => {
  test("the notification center's delegate is set by the app delegate subscriber in didFinishLaunching, through the center that outlives the module, and never by the module", () => {
    expect(subscriber).toContain("didFinishLaunchingWithOptions");
    expect(subscriber).toMatch(/didFinishLaunchingWithOptions[^{]*\{\n\s+SveltePushCenter\.shared\.install\(\)\n\s+return true/);
    expect(center).toContain("center.delegate = self");
    expect(center).toContain("final class SveltePushCenter: NSObject, UNUserNotificationCenterDelegate");
    expect(mod).not.toContain("delegate =");
    expect(mod).not.toContain("UNUserNotificationCenter.current().delegate");
  });

  test("willPresent holds the completion for one second and shows in full after it, which is longer than the 900 ms JavaScript has", () => {
    expect(center).toContain("static let presentationWait: TimeInterval = 1");
    expect(FOREGROUND_TIMEOUT_MS).toBeLessThan(1000);
    expect(center).toContain("static let shownInFull: UNNotificationPresentationOptions = [.banner, .list, .sound, .badge]");
    // Answering and the timer race for one completion, which is taken out under a lock, so it is called once.
    expect(center).toContain("presentation?.finish(Self.options(banner: banner, sound: sound, badge: badge))");
    expect(center).toContain("self?.presentationTimedOut(message.id, presentation)");
  });

  test("a tap is the launch message until JavaScript has taken it once, and an opened event after that; the completion handler is called at once; a repeated tap is dropped", () => {
    const didReceive = between(center, "didReceive response: UNNotificationResponse", "/// `takeLaunchMessage()`");
    expect(didReceive).toContain("defer { completionHandler() }");
    expect(didReceive).toContain("UNNotificationDefaultActionIdentifier");
    expect(didReceive).toContain("recentTaps.contains(tap)");
    expect(didReceive).toContain("guard launchTaken else");
    expect(didReceive).toContain('emit("opened", message.payload)');
    expect(between(center, "func takeLaunchMessage()", "\n  }")).toContain("launchTaken = true");
  });

  test("a silent push in the background is a background event whose fetch completion is called by backgroundDone, or at 25 seconds; in the foreground it is a message", () => {
    expect(center).toContain("static let backgroundLimit: TimeInterval = 25");
    const silent = between(center, "func didReceiveRemoteNotification(", "/// `backgroundDone(id)`");
    expect(silent).toContain('emit("background", ["id": id, "message": message.payload])');
    expect(silent).toContain("self?.finishBackground(id, .failed");
    expect(silent).toContain("if applicationState == .active");
    expect(silent).toContain('emit("message", message.payload)');
    expect(between(center, "func backgroundDone(", "\n  }")).toContain("finishBackground(id, .newData, reason: nil)");
  });

  test("the subscriber forwards the registration, its failure and the silent pushes, with the app's state", () => {
    expect(subscriber).toContain("didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data");
    expect(subscriber).toContain("SveltePushCenter.shared.didRegister(deviceToken: deviceToken)");
    expect(subscriber).toContain("didFailToRegisterForRemoteNotificationsWithError error: any Error");
    expect(subscriber).toContain("SveltePushCenter.shared.didFailToRegister(error)");
    expect(subscriber).toContain("fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void");
    expect(subscriber).toContain("SveltePushCenter.shared.didReceiveRemoteNotification(userInfo, applicationState: application.applicationState, completion: completionHandler)");
  });
});

describe("a push that wakes the app mounts no screen (rule 2)", () => {
  test("the AppDelegate patch calls the helper by the name and the labels the Swift defines, with the closures it takes", () => {
    expect(background).toContain("public enum SveltePushBackgroundLaunch {");
    expect(background).toContain("public static func start(_ application: UIApplication, host: () -> Void, surface: @escaping () -> Void)");
    const patched = applyPushAppDelegate(expoTemplateAppDelegate());
    expect(patched).toContain("SveltePushBackgroundLaunch.start(\n      application,\n      host: {");
    expect(patched).toContain("      },\n      surface: { [self] in\n");
    expect(patched).toContain("internal import SveltePush //");
  });

  test("a launch in the foreground makes the call at once, and one in the background starts the host and waits for the first didBecomeActive, once", () => {
    expect(background).toContain("guard application.applicationState == .background else {\n      surface()\n      return\n    }");
    expect(background).toContain("host()");
    expect(background.indexOf("host()")).toBeLessThan(background.indexOf("addObserver(forName: UIApplication.didBecomeActiveNotification"));
    expect(background).toContain("NotificationCenter.default.removeObserver(token)");
    expect(background.split("surface()").length - 1).toBe(2);
  });

  test("the helper lives in the push pod, which the AppDelegate imports only for an app with push", () => {
    expect(background.split("\n").filter((line) => line.startsWith("import "))).toEqual(["import UIKit"]);
    const config = JSON.parse(read("expo-module.config.json")) as { apple: { swiftModuleName: string[] } };
    expect(config.apple.swiftModuleName).toEqual(["SveltePush"]);
  });
});

describe("the mapping and the environment are plain Foundation, so that the host check compiles them alone", () => {
  test("only Foundation is imported, and the check sits outside the pod's directory so the app does not compile a second main", () => {
    for (const file of [message, environment]) expect(file.split("\n").filter((line) => line.startsWith("import "))).toEqual(expect.arrayContaining(["import Foundation"]));
    for (const file of [message, environment]) expect(file).not.toMatch(/^import (?!Foundation|CoreFoundation)/m);
    expect(existsSync(resolve(push, "ios/SveltePushMessageCheck.swift"))).toBe(false);
    expect(existsSync(resolve(push, "test/ios/SveltePushMessageCheck.swift"))).toBe(true);
    expect(read("package.json")).toContain('"!ios/build"');
    expect((JSON.parse(read("package.json")) as { files: string[] }).files).not.toContain("test");
  });

  test("the id of a message is the system's, or one made for a message the system gave none", () => {
    expect(message).toContain("id: nonEmpty(id) ?? UUID().uuidString");
    expect(center).toContain("SveltePushPayload.message(from: request.content.userInfo, id: request.identifier)");
    expect(center).toContain("SveltePushPayload.message(from: userInfo)");
  });

  test("the environment is the profile's entitlement, with development on a simulator and production on a device that has no profile", () => {
    expect(environment).toContain('Bundle.main.path(forResource: "embedded", ofType: "mobileprovision")');
    expect(environment).toMatch(/#if targetEnvironment\(simulator\)\n\s+return "development"\n#else\n\s+return "production"\n#endif/);
    expect(environment).toContain('entitlements["aps-environment"] as? String');
  });
});

// The mapping and the environment run where a Swift toolchain exists: a Mac with the command line tools.
const hasSwift = spawnSync("swiftc", ["--version"], { encoding: "utf8" }).status === 0;
describe("the mapping and the environment's own behaviour", () => {
  test.skipIf(!hasSwift)("test/ios/message.sh compiles the two files with their check and every check passes", () => {
    const run = spawnSync("bash", [resolve(push, "test/ios/message.sh")], { encoding: "utf8", timeout: 240_000 });
    expect(run.stderr).toContain("SveltePushMessageCheck: 29 checks passed");
    expect(run.status).toBe(0);
  });
});
