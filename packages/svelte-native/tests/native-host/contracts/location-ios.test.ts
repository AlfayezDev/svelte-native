import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { locationInfoPlistFlag } from "../../../src/capabilities.ts";

// The iOS half of location (`native/svelte-core/ios/location`, a folder of the SvelteCore pod; SPEC.md, "Location"). Swift is not compiled on the machines these tests run on, so what ties the pieces
// together is read from their sources: the module defines the functions and events the JavaScript client declares and calls (`src/geolocation.ts`), the payloads it builds have the keys of the
// shared types, the refusals carry the codes the client and the Android module use, CoreLocation is the only framework (no CoreMotion), and what turns it on is the Info.plist flag the config plugin writes.
// What the payloads, the permission's mapping and the registry do is run where `swiftc` exists (`native/svelte-core/test/ios/location.sh`); the phone is the proof of the rest.
const core = resolve(import.meta.dirname, "../../../native/svelte-core");
const read = (path: string) => readFileSync(resolve(core, path), "utf8");
const mod = read("ios/location/SvelteLocationModule.swift");
const requests = read("ios/location/SvelteLocationRequests.swift");
const payload = read("ios/location/SvelteLocationPayload.swift");
const flag = read("ios/location/SvelteLocationFlag.swift");
const client = readFileSync(resolve(import.meta.dirname, "../../../src/geolocation.ts"), "utf8");
const android = (name: string) => readFileSync(resolve(core, "android/src/main/java/expo/modules/sveltelocation", `${name}.kt`), "utf8");

/** The text between `start` and the first `end` after it. */
const between = (text: string, start: string, end: string): string => {
  const from = text.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  return text.slice(from, text.indexOf(end, from));
};
/** The member names of a TypeScript object type, read from its source: `name(` or `name?:` or `name:` at the type's own indentation. */
const members = (block: string): string[] => [...block.matchAll(/^ {2}(?:readonly )?(\w+)[?(:<]/gm)].map((match) => match[1] as string);

const nativeModule = between(client, "export type NativeLocationModule = {", "\n};");
const nativeEvents = between(client, "export type NativeLocationEvents = {", "\n};");

describe("the module defines what the JavaScript client declares and calls", () => {
  test("every function of NativeLocationModule, asynchronous and on the main queue, where CLLocationManager is made and delivers", () => {
    const calls = members(nativeModule).filter((name) => name !== "addListener" && name !== "enabled");
    expect(calls).toEqual(["permission", "requestPermission", "currentPosition", "lastKnownPosition", "startWatch", "stopWatch"]);
    for (const name of calls) {
      const definition = between(mod, `AsyncFunction("${name}")`, "}.runOnQueue(.main)");
      expect(definition).toContain("guard SvelteLocationFlag.isEnabled else { return promise.reject(SvelteLocationDisabledException()) }");
    }
    // No synchronous function, and each asynchronous one is on the main queue.
    expect(mod).not.toMatch(/(?<![A-Za-z])Function\("/);
    expect(mod.match(/\.runOnQueue\(\.main\)/g)).toHaveLength(calls.length);
    expect(mod).toContain('Name("SvelteLocation")');
    expect(nativeModule).toContain("readonly enabled: boolean;");
    expect(mod).toContain('Constant("enabled") { SvelteLocationFlag.isEnabled }');
  });

  test("the call's arguments are the ones the client sends: an options object with the accuracy word, a watch id first, the distance interval in meters", () => {
    expect(nativeModule).toContain("currentPosition(options: { accuracy: Accuracy }): Promise<NativeLocation>;");
    expect(nativeModule).toContain("lastKnownPosition(options: { maxAge?: number }): Promise<NativeLocation | null>;");
    expect(nativeModule).toContain("startWatch(watchId: number, options: { accuracy: Accuracy; distanceInterval: number }): Promise<void>;");
    expect(nativeModule).toContain("stopWatch(watchId: number): Promise<void>;");
    expect(mod).toContain('AsyncFunction("currentPosition") { (options: [String: Any], promise: Promise) in');
    expect(mod).toContain('AsyncFunction("lastKnownPosition") { (options: [String: Any], promise: Promise) in');
    expect(mod).toContain('AsyncFunction("startWatch") { (watchId: Int, options: [String: Any], promise: Promise) in');
    expect(mod).toContain('AsyncFunction("stopWatch") { (watchId: Int, promise: Promise) in');
    expect(mod).toContain('SvelteLocationOptions.maxAge(options)');
    expect(mod).toContain('SvelteLocationOptions.distance(options)');
    expect(payload).toContain('number(options["maxAge"])');
    expect(payload).toContain('number(options["distanceInterval"])');
  });

  test("the two events of NativeLocationEvents, with the payload keys the client reads", () => {
    const events = members(nativeEvents);
    expect(events).toEqual(["locationChanged", "locationError"]);
    expect(mod).toContain(`Events(${events.map((name) => `"${name}"`).join(", ")})`);
    expect(nativeEvents).toContain("locationChanged: { watchId: number; location: NativeLocation };");
    expect(nativeEvents).toContain("locationError: { watchId: number; reason: string };");
    expect(mod).toContain('self?.sendEvent("locationChanged", ["watchId": id, "location": fix.payload()])');
    expect(mod).toContain('self?.sendEvent("locationError", ["watchId": id, "reason": reason])');
    // The events are named plainly, with no namespace of another library: this module's events are its own.
    expect(mod).not.toContain("Expo.");
  });

  test("the accuracy words are the client's, and CoreLocation's accuracies are the ones the old module used for them", () => {
    const words = (/export type Accuracy = ([^;]+);/.exec(client)?.[1] ?? "").split("|").map((word) => word.trim().replaceAll('"', ""));
    expect(words).toEqual(["balanced", "high"]);
    expect([...payload.matchAll(/^\s+case (\w+)\n/gm)].map((match) => match[1])).toEqual(words);
    expect(requests).toContain("case .balanced: return kCLLocationAccuracyHundredMeters");
    expect(requests).toContain("case .high: return kCLLocationAccuracyNearestTenMeters");
  });
});

describe("the payloads, the refusals and the permission have the shapes the client reads", () => {
  test("a position has the keys of NativeLocation, and a member iOS marks invalid is left out", () => {
    const coords = members(between(client, "type NativeCoords = {", "\n};"));
    expect(coords).toEqual(["latitude", "longitude", "altitude", "accuracy", "altitudeAccuracy", "heading", "speed"]);
    const written = between(payload, "func payload() -> [String: Any] {", "\n  }");
    expect([...new Set([...written.matchAll(/(?:coords\["(\w+)"\]|"(latitude|longitude)":)/g)].flatMap((match) => [match[1] ?? match[2]]))].sort()).toEqual([...coords].sort());
    expect(written).toContain('"timestamp": (timestamp * 1000).rounded()');
    for (const optional of ["accuracy", "altitude", "heading", "speed"]) expect(written).toContain(`coords["${optional}"] =`);
    expect(written).toContain("if horizontalAccuracy >= 0");
    expect(written).toContain("if verticalAccuracy >= 0, altitude.isFinite");
    expect(written).toContain("if course >= 0, course.isFinite");
    expect(written).toContain("if speed >= 0, speed.isFinite");
    // A fix CoreLocation says is not valid is not reported.
    expect(requests).toContain("if fix.isValid { return fix }");
    expect(payload).toContain("horizontalAccuracy >= 0 && latitude.isFinite && longitude.isFinite");
  });

  test("the permission has the keys of NativePermission, from CLAuthorizationStatus' raw values", () => {
    expect(members(between(client, "type NativePermission = {", "};").replace(/;\s/g, ";\n  ").replace("{ ", "{\n  "))).toEqual(["status", "granted", "canAskAgain"]);
    expect(payload).toContain('["status": status, "granted": granted, "canAskAgain": canAskAgain]');
    expect(payload).toContain('case 0: return SvelteLocationPermission(status: "undetermined", canAskAgain: true)');
    expect(payload).toContain('case 3, 4: return SvelteLocationPermission(status: "granted", canAskAgain: true)');
    // iOS asks while the app is in use, and never twice.
    expect(requests).toContain("requestWhenInUseAuthorization()");
    expect(requests).not.toContain("requestAlwaysAuthorization");
    expect(requests).toContain("func locationManagerDidChangeAuthorization(_ manager: CLLocationManager)");
    expect(requests).toContain('if state.status == "undetermined" { return }');
  });

  test("the codes are the Android module's, and the one the client reads as a refused permission is CoreLocation's denied", () => {
    const codes = [...payload.matchAll(/code: "(ERR_LOCATION_\w+)"/g)].map((match) => match[1]);
    expect(codes.sort()).toEqual(["ERR_LOCATION_ARGUMENTS", "ERR_LOCATION_UNAUTHORIZED", "ERR_LOCATION_UNAVAILABLE"]);
    const kotlin = android("LocationRules");
    for (const code of codes) expect(kotlin).toContain(`"${code}"`);
    expect(mod).toContain('code: "ERR_LOCATION_DISABLED"');
    expect(kotlin).toContain('const val DISABLED = "ERR_LOCATION_DISABLED"');
    expect(client).toContain('code === "ERR_LOCATION_UNAUTHORIZED"');
    expect(payload).toContain('static let coreLocationDomain = "kCLErrorDomain"');
    expect(payload).toContain("static let coreLocationDenied = 1");
    // The refusal keeps its own code: `reject(_: Error)` would make it an unexpected exception.
    expect(mod).toContain("promise.reject(failure.code, failure.message)");
  });

  test("a permission that is not granted refuses a position and a watch before CoreLocation is asked, and the last known position needs the permission too", () => {
    for (const call of ["currentPosition", "lastKnownPosition", "startWatch"]) expect(between(mod, `AsyncFunction("${call}")`, "}.runOnQueue(.main)")).toContain("guard self.location().permission().granted else { return self.refuse(promise, .unauthorized) }");
  });
});

describe("CoreLocation is the only framework, and each request and watch has its own manager", () => {
  test("no CoreMotion, and the plain files import only Foundation (the pod compiles every Swift file under ios/, so the check with a main sits outside it)", () => {
    for (const file of [mod, requests, payload, flag]) expect(file).not.toMatch(/^import CoreMotion|CMMotion\w*\(|CMPedometer\(/m);
    expect(requests.split("\n").filter((line) => line.startsWith("import "))).toEqual(["import CoreLocation", "import Foundation"]);
    expect(mod.split("\n").filter((line) => line.startsWith("import "))).toEqual(["import ExpoModulesCore", "import Foundation"]);
    for (const file of [payload, flag]) expect(file.split("\n").filter((line) => line.startsWith("import "))).toEqual(["import Foundation"]);
    expect(existsSync(resolve(core, "ios/location/SvelteLocationCheck.swift"))).toBe(false);
    expect(existsSync(resolve(core, "test/ios/SvelteLocationCheck.swift"))).toBe(true);
    expect((JSON.parse(readFileSync(resolve(core, "../../package.json"), "utf8")) as { files: string[] }).files).toContain("!native/**/test");
  });

  test("a position request and a watch each make a manager, a watch is foreground only and does not pause, and the last known position is the system's, not a start", () => {
    expect(requests).toContain("final class SvelteLocationOneShot: NSObject, CLLocationManagerDelegate");
    expect(requests).toContain("final class SvelteLocationWatch: NSObject, CLLocationManagerDelegate");
    expect(requests.match(/private let manager = CLLocationManager\(\)/g)).toHaveLength(2);
    expect(requests).toContain("manager.requestLocation()");
    expect(requests).toContain("manager.startUpdatingLocation()");
    expect(requests).toContain("manager.pausesLocationUpdatesAutomatically = false");
    expect(requests).not.toContain("allowsBackgroundLocationUpdates = true");
    expect(requests).toContain("guard let location = CLLocationManager().location else { return nil }");
    // A transient `locationUnknown` is not an error of a watch, as the manager keeps trying.
    expect(requests).toContain("if SvelteLocationFailure.isTransient(domain: bridged.domain, code: bridged.code) { return }");
  });

  test("the module ends every watch and every request still awaited when it goes", () => {
    expect(mod).toMatch(/OnDestroy \{\n\s+DispatchQueue\.main\.async \{\n\s+self\.center\?\.stopAll\(\)\n\s+self\.center = nil/);
    expect(requests).toContain("for watch in watches.removeAll() { watch.stop() }");
    expect(requests).toContain("for shot in oneShots.values { shot.cancel() }");
  });
});

describe("the module is listed for autolinking, and turned on by the flag the config plugin writes", () => {
  test("SvelteLocationModule is in the pod's module list, and its class is where the pod's folder says", () => {
    const config = JSON.parse(readFileSync(resolve(core, "../../expo-module.config.json"), "utf8")) as { apple: { modules: string[]; swiftModuleName: string[] } };
    expect(config.apple.modules).toContain("SvelteLocationModule");
    expect(config.apple.swiftModuleName).toEqual(["SvelteCore"]);
    expect(mod).toContain("public final class SvelteLocationModule: Module");
  });

  test("the flag is the Info.plist boolean the plugin writes, and only the boolean true is on; every call asks it first, and nothing starts with the module", () => {
    expect(flag).toContain(`static let infoPlistKey = "${locationInfoPlistFlag}"`);
    expect(flag).toContain("(value as? Bool) == true");
    expect(mod).not.toContain("OnCreate");
    expect(mod.match(/guard SvelteLocationFlag\.isEnabled else/g)).toHaveLength(6);
    expect(mod).toContain('description: "Location is off in this build: turn it on with capabilities.location in the @alfayez/svelte-native config plugin');
  });
});

// The payloads, the permission and the registry run where a Swift toolchain exists: a Mac with the command line tools.
const hasSwift = spawnSync("swiftc", ["--version"], { encoding: "utf8" }).status === 0;
describe("the payloads, the permission and the registry's own behaviour", () => {
  test.skipIf(!hasSwift)("test/ios/location.sh compiles the two plain files with their check and every check passes", () => {
    const run = spawnSync("bash", [resolve(core, "test/ios/location.sh")], { encoding: "utf8", timeout: 240_000 });
    expect(run.stdout).toContain("location: 75 checks passed");
    expect(run.status).toBe(0);
  });
});
