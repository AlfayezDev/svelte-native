import ExpoModulesCore
import UIKit

/// Clears the `tmpfile` captures an earlier process left in `tmp/ReactNative` when this one starts, before the JavaScript host exists, off the main thread
/// (`SvelteCaptureFiles`). The cut-off is the moment the delegate is called: nothing this process captures can be older.
public final class SvelteCaptureSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let started = Date()
    DispatchQueue.global(qos: .utility).async {
      let deleted = SvelteCaptureFiles.sweep(SvelteCaptureFiles.directory(), before: started)
      if deleted > 0 { NSLog("[SvelteCapture] deleted %ld leftover capture file(s) of an earlier process", deleted) }
    }
    return true
  }
}
