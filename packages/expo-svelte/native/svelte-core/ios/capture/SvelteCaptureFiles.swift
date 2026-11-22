import Foundation

/// The files of react-native-view-shot's `tmpfile` result on iOS. The library writes them with React Native's `RCTTempFilePath` (`React/Base/RCTUtils.mm`)
/// into `NSTemporaryDirectory()/ReactNative` and promises that they last "until the app exits". React Native empties that directory only inside its own
/// `dispatch_once`, when a process makes its first temporary file, so the captures of a process that ended (swiped away, killed, crashed) stay on the phone
/// until the next process captures something, and for ever if it never does. The Android engine clears the same kind of leftovers when its module is created
/// (`CaptureFiles.sweep`); this is the iOS counterpart, called when the process starts (`SvelteCaptureSubscriber`). Plain Foundation, so that
/// `test/run.sh` can compile and check it without the app.
public enum SvelteCaptureFiles {
  /// The directory `RCTTempFilePath` writes to, and the only one view-shot's `releaseCapture` deletes from.
  public static func directory() -> URL {
    URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).appendingPathComponent("ReactNative", isDirectory: true)
  }

  /// Deletes what is in [directory] and was last written before [before]: what an earlier process left. The directory stays (React Native makes it again
  /// if it is missing, and does not mind it being there). A file this process made is newer than [before], which is the start of the process, so a capture
  /// that races the sweep is never deleted. Answers how many items it deleted; a directory that is not there has nothing to delete.
  @discardableResult
  public static func sweep(_ directory: URL, before: Date, fileManager: FileManager = .default) -> Int {
    guard fileManager.fileExists(atPath: directory.path) else { return 0 }
    let items: [URL]
    do {
      items = try fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey], options: [])
    } catch {
      NSLog("[SvelteCapture] could not list %@: %@", directory.path, String(describing: error))
      return 0
    }
    var deleted = 0
    for item in items {
      let written = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
      // A file whose time cannot be read is not known to be older than the process: it stays.
      guard let written, written < before else { continue }
      do {
        try fileManager.removeItem(at: item)
        deleted += 1
      } catch CocoaError.fileNoSuchFile {
        // React Native's own clean-up (its first temporary file of this process) got there first.
        continue
      } catch {
        NSLog("[SvelteCapture] could not delete %@: %@", item.path, String(describing: error))
      }
    }
    return deleted
  }
}
