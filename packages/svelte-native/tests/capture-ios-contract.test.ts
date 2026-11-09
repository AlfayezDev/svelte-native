import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

// react-native-view-shot on iOS (SPEC.md, "Foreign views"). Swift and Objective-C++ cannot be compiled on the machines these tests run on, so what the
// JavaScript wrapper and the lab assume about the platform is read from the sources of the library and of React Native that decide it, and the sources
// of the module that clears the leftovers are tied to them. The device run (`native-qa foreign --platform ios --only capture`) is the proof; these keep a
// library or React Native update from changing the facts under the wrapper unseen.
const require = createRequire(import.meta.url);
const library = dirname(require.resolve("react-native-view-shot/package.json"));
const reactNative = dirname(require.resolve("react-native/package.json"));
const sweepModule = resolve(import.meta.dirname, "../native/svelte-capture-ios");
const viewShot = readFileSync(resolve(library, "ios/RNViewShot.mm"), "utf8");
const tempFilePath = (() => {
  const source = readFileSync(resolve(reactNative, "React/Base/RCTUtils.mm"), "utf8");
  return source.slice(source.indexOf("RCT_EXTERN NSString *__nullable RCTTempFilePath(NSString *extension, NSError **error)"));
})();
const files = readFileSync(resolve(sweepModule, "ios/SvelteCaptureFiles.swift"), "utf8");
const subscriber = readFileSync(resolve(sweepModule, "ios/SvelteCaptureSubscriber.swift"), "utf8");

describe("what the library's iOS module answers, which the wrapper passes on untouched", () => {
  test("a tmpfile result is the plain path React Native made, not a URI; releaseCapture deletes only a path inside tmp/ReactNative", () => {
    expect(viewShot).toContain("NSString *path = RCTTempFilePath(format, &error);");
    expect(viewShot).toContain("res = path;");
    // No scheme anywhere in the module: a `file://` prefix would be a different string from the one `releaseCapture` compares.
    expect(viewShot).not.toContain("file://");
    const release = viewShot.slice(viewShot.indexOf("RCT_EXPORT_METHOD(releaseCapture"), viewShot.indexOf("RCT_EXPORT_METHOD(captureRef"));
    expect(release).toContain('[NSTemporaryDirectory() stringByAppendingPathComponent:@"ReactNative"]');
    expect(release).toContain("[uri hasPrefix:directory]");
    expect(release).toContain("[fileManager removeItemAtPath:uri error:NULL]");
  });

  test("width and height are points drawn at the screen's scale, so the image is that many times larger on a 2x or 3x phone", () => {
    expect(viewShot).toContain("CGSize size = [RCTConvert CGSize:options];");
    expect(viewShot).toContain("rendererFormat.scale = 0;");
    expect(viewShot).toContain("[[UIGraphicsImageRenderer alloc] initWithSize:size format:rendererFormat]");
  });
});

describe("React Native clears tmp/ReactNative late, which is why the module sweeps at the start of the process", () => {
  test("the directory is emptied only inside the dispatch_once of the first temporary file", () => {
    const once = tempFilePath.slice(tempFilePath.indexOf("dispatch_once(&onceToken, ^{"), tempFilePath.indexOf("// Append a unique filename"));
    expect(once).toContain('directory = [NSTemporaryDirectory() stringByAppendingPathComponent:@"ReactNative"];');
    expect(once).toContain("[fileManager removeItemAtPath:directory error:NULL];");
    // Nothing outside the block removes anything: until a process makes a file, the files of the one before stay.
    expect(tempFilePath.slice(tempFilePath.indexOf("// Append a unique filename"), tempFilePath.indexOf("// Append a unique filename") + 400)).not.toContain("removeItem");
  });

  test("the sweep's directory is the one both of them use", () => {
    expect(files).toContain('NSTemporaryDirectory()');
    expect(files).toContain('appendingPathComponent("ReactNative", isDirectory: true)');
  });
});

describe("the module that sweeps is a product module wired the way Expo autolinks it", () => {
  test("the package's config lists a subscriber that a Swift file defines and its pod, and its pod is the one the Swift files are in", () => {
    const config = JSON.parse(readFileSync(resolve(sweepModule, "../../expo-module.config.json"), "utf8")) as { apple: { appDelegateSubscribers: string[]; podspecPath: string[]; swiftModuleName: string[] } };
    expect(config.apple.appDelegateSubscribers).toEqual(["SvelteCaptureSubscriber"]);
    expect(config.apple.podspecPath).toContain("native/svelte-capture-ios/ios/SvelteCapture.podspec");
    expect(config.apple.swiftModuleName).toContain("SvelteCapture");
    expect(subscriber).toContain("public final class SvelteCaptureSubscriber: ExpoAppDelegateSubscriber");
    const podspec = readFileSync(resolve(sweepModule, "ios/SvelteCapture.podspec"), "utf8");
    expect(podspec).toContain("s.name           = 'SvelteCapture'");
    expect(podspec).toContain("'DEFINES_MODULE' => 'YES'");
    expect(podspec).toContain("s.source_files = '**/*.swift'");
    // The host check sits outside the pod's source glob, so the app does not compile a second `main`.
    expect(existsSync(resolve(sweepModule, "ios/SvelteCaptureFilesCheck.swift"))).toBe(false);
    expect(existsSync(resolve(sweepModule, "test/SvelteCaptureFilesCheck.swift"))).toBe(true);
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
    const run = spawnSync("bash", [resolve(sweepModule, "test/run.sh")], { encoding: "utf8", timeout: 240_000 });
    expect(run.stderr).toContain("SvelteCaptureFilesCheck: 11 checks passed");
    expect(run.status).toBe(0);
  });
});
