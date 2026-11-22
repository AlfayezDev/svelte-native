import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { libraryPath } from "../support/paths.ts";

// react-native-view-shot on iOS (SPEC.md, "Foreign views"): what the JavaScript wrapper and the lab assume about the platform is read from the Objective-C++ sources of the library and of
// React Native that decide it, which cannot be compiled on the machines these tests run on. They keep a library or React Native update from changing the facts under the wrapper unseen;
// the module that clears the leftovers is `native-host/contracts/capture-ios.test.ts`.
const require = createRequire(import.meta.url);
const library = libraryPath("react-native-view-shot");
const reactNative = dirname(require.resolve("react-native/package.json"));
const viewShot = readFileSync(resolve(library, "ios/RNViewShot.mm"), "utf8");
const tempFilePath = (() => {
  const source = readFileSync(resolve(reactNative, "React/Base/RCTUtils.mm"), "utf8");
  return source.slice(source.indexOf("RCT_EXTERN NSString *__nullable RCTTempFilePath(NSString *extension, NSError **error)"));
})();

describe("what the library's iOS module answers, which the wrapper passes on untouched", () => {
  test("a tmpfile result is the plain path React Native made, not a URI; releaseCapture deletes only a file directly inside tmp/ReactNative", () => {
    expect(viewShot).toContain("NSString *path = RCTTempFilePath(format, &error);");
    expect(viewShot).toContain("res = path;");
    // No scheme anywhere in the module: a `file://` prefix would be a different string from the one `releaseCapture` compares.
    expect(viewShot).not.toContain("file://");
    const release = viewShot.slice(viewShot.indexOf("RCT_EXPORT_METHOD(releaseCapture"), viewShot.indexOf("RCT_EXPORT_METHOD(captureRef"));
    expect(release).toContain('[NSTemporaryDirectory() stringByAppendingPathComponent:@"ReactNative"]');
    // view-shot 6 deletes only a regular file that is a direct child of the directory, through a descriptor of the directory (no symbolic link is followed).
    expect(release).toContain('NSString *prefix = [directory stringByAppendingString:@"/"];');
    expect(release).toContain("[uri hasPrefix:prefix]");
    expect(release).toContain("unlinkat(directoryFD, fileName, 0)");
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
});
