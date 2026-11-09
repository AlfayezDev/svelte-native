import Foundation

// Host check of what the process start deletes (`SvelteCaptureFiles`): the files an earlier process left in `tmp/ReactNative`, and only those. Plain
// Foundation, no app and no phone: `run.sh` compiles it with `ios/SvelteCaptureFiles.swift` as the program's `main.swift`.

var checks = 0
func expect<T: Equatable>(_ what: String, _ actual: T, _ wanted: T) {
  checks += 1
  if actual != wanted {
    FileHandle.standardError.write(Data("FAIL \(what): wanted \(wanted), got \(actual)\n".utf8))
    exit(1)
  }
}

let manager = FileManager.default
let root = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("svelte-capture-check-\(UUID().uuidString)", isDirectory: true)
defer { try? manager.removeItem(at: root) }
let reactNative = root.appendingPathComponent("ReactNative", isDirectory: true)
try manager.createDirectory(at: reactNative, withIntermediateDirectories: true)

let started = Date()
func make(_ name: String, written: Date) throws -> URL {
  let url = reactNative.appendingPathComponent(name)
  try Data("x".utf8).write(to: url)
  try manager.setAttributes([.modificationDate: written], ofItemAtPath: url.path)
  return url
}
func names() throws -> [String] { try manager.contentsOfDirectory(atPath: reactNative.path).sorted() }

// What an earlier process left (a PNG and a JPEG, as view-shot names them) is deleted; what this process made after it started stays.
_ = try make("1076DBE2-FA49-43A2-8EFC-669E2C82FCD8.png", written: started.addingTimeInterval(-3600))
_ = try make("B313D4AE-4A22-4F92-A9C7-F1134B6ACA4D.jpg", written: started.addingTimeInterval(-5))
_ = try make("6BC0BC2A-BFE5-4145-8C40-95074FDAA39E.png", written: started.addingTimeInterval(2))
expect("it counts the files of earlier processes", SvelteCaptureFiles.sweep(reactNative, before: started), 2)
expect("a file made after the process started is left alone", try names(), ["6BC0BC2A-BFE5-4145-8C40-95074FDAA39E.png"])
expect("the directory itself stays", manager.fileExists(atPath: reactNative.path), true)
expect("a second sweep has nothing left to delete", SvelteCaptureFiles.sweep(reactNative, before: started), 0)

// Whatever else React Native's temporary files put there goes as well (React Native empties the whole directory itself): a folder with a file in it too.
let folder = reactNative.appendingPathComponent("nested", isDirectory: true)
try manager.createDirectory(at: folder, withIntermediateDirectories: true)
try Data("y".utf8).write(to: folder.appendingPathComponent("inner.png"))
try manager.setAttributes([.modificationDate: started.addingTimeInterval(-60)], ofItemAtPath: folder.path)
expect("an old folder is deleted with what is in it", SvelteCaptureFiles.sweep(reactNative, before: started), 1)
expect("only the newer file remains", try names(), ["6BC0BC2A-BFE5-4145-8C40-95074FDAA39E.png"])

// A directory that is not there, and a path that is a file, have nothing to delete and do not throw.
expect("a missing directory has nothing to delete", SvelteCaptureFiles.sweep(root.appendingPathComponent("none", isDirectory: true), before: started), 0)
expect("a file where the directory should be has nothing to delete", SvelteCaptureFiles.sweep(reactNative.appendingPathComponent("6BC0BC2A-BFE5-4145-8C40-95074FDAA39E.png"), before: started), 0)
expect("and it was left alone", try names(), ["6BC0BC2A-BFE5-4145-8C40-95074FDAA39E.png"])

// The directory is the one React Native's RCTTempFilePath and view-shot's releaseCapture use.
let directory = SvelteCaptureFiles.directory()
expect("the directory is ReactNative inside the temporary directory", directory.path, URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("ReactNative", isDirectory: true).path)
expect("and its last component is ReactNative", directory.lastPathComponent, "ReactNative")

FileHandle.standardError.write(Data("SvelteCaptureFilesCheck: \(checks) checks passed\n".utf8))
