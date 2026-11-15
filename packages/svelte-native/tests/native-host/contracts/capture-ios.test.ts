import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The module that clears the leftovers of react-native-view-shot on iOS (SPEC.md, "Foreign views"). Swift cannot be compiled on the machines these tests run on without a
// toolchain, so how the sweep is wired is read from its sources, tied to the facts about the library and React Native that decide it (`upstream/view-shot-ios.test.ts`), and the sweep's
// own behaviour is run where `swiftc` exists. The device run (`native-qa foreign --platform ios --only capture`) is the proof.
const core = resolve(import.meta.dirname, "../../../native/svelte-core");
const files = readFileSync(resolve(core, "ios/capture/SvelteCaptureFiles.swift"), "utf8");
const subscriber = readFileSync(resolve(core, "ios/capture/SvelteCaptureSubscriber.swift"), "utf8");

describe("React Native clears tmp/ReactNative late, which is why the module sweeps at the start of the process", () => {
  test("the sweep's directory is the one both of them use", () => {
    expect(files).toContain('NSTemporaryDirectory()');
    expect(files).toContain('appendingPathComponent("ReactNative", isDirectory: true)');
  });
});

describe("the module that sweeps is a product module wired the way Expo autolinks it", () => {
  test("the package's config lists the subscriber that a Swift file defines, and the host check sits outside the pod", () => {
    const config = JSON.parse(readFileSync(resolve(core, "../../expo-module.config.json"), "utf8")) as { apple: { appDelegateSubscribers: string[] } };
    expect(config.apple.appDelegateSubscribers).toEqual(["SvelteCaptureSubscriber"]);
    expect(subscriber).toContain("public final class SvelteCaptureSubscriber: ExpoAppDelegateSubscriber");
    // The host check sits outside the pod's directory (ios/), so the app does not compile a second `main`.
    expect(existsSync(resolve(core, "ios/capture/SvelteCaptureFilesCheck.swift"))).toBe(false);
    expect(existsSync(resolve(core, "test/ios/SvelteCaptureFilesCheck.swift"))).toBe(true);
  });

  test("it sweeps in the delegate's launch call, off the main thread, with the moment of the call as the cut-off, so a capture of this process is never deleted", () => {
    expect(subscriber).toContain("didFinishLaunchingWithOptions");
    expect(subscriber).toContain("let started = Date()");
    expect(subscriber).toContain("DispatchQueue.global(qos: .utility).async");
    expect(subscriber).toContain("SvelteCaptureFiles.sweep(SvelteCaptureFiles.directory(), before: started)");
    expect(files).toContain("written < before");
  });

  test("the sweep is plain Foundation, so that the host check compiles it alone", () => {
    expect(files.split("\n").filter((line) => line.startsWith("import "))).toEqual(["import Foundation"]);
  });
});

// The file-level behaviour is checked by compiling and running the Swift (`test/run.sh`): on a Mac, or wherever a Swift toolchain is installed.
const hasSwift = spawnSync("swiftc", ["--version"], { encoding: "utf8" }).status === 0;
describe("the sweep's own behaviour", () => {
  test.skipIf(!hasSwift)("test/run.sh compiles SvelteCaptureFiles.swift with its check and every check passes", () => {
    const run = spawnSync("bash", [resolve(core, "test/ios/capture.sh")], { encoding: "utf8", timeout: 240_000 });
    expect(run.stderr).toContain("SvelteCaptureFilesCheck: 11 checks passed");
    expect(run.status).toBe(0);
  });
});
