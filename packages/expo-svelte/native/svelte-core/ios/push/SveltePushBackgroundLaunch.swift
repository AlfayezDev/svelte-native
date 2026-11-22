// Compiled only when push is on (`SVELTE_PUSH`, set by SvelteCore.podspec from the config plugin's `capabilities.push.ios`): an app without push has none of it in its binary.
#if SVELTE_PUSH
import UIKit

/// Rule 2 of PUSH.md on iOS: a push that wakes the app mounts no screen. Expo SDK 58's template starts React Native from the scene (`SceneDelegate`, `ExpoAppSceneDelegate`), which UIKit
/// connects for a launch the user makes and not for the launch iOS makes in the background for a silent push, so nobody can see a screen there and none is mounted. What a push needs
/// is JavaScript: the app's `init` and the push hooks. The config plugin's patch of `AppDelegate.swift` (`applyPushAppDelegate`) calls this function at the end of
/// `application(_:didFinishLaunchingWithOptions:)`.
///
/// - In a launch in the background, `host` is called now: React Native's runtime, which loads the bundle (`initializeReactHost`, what the first `startReactNative` does before it makes
///   the surface). When the user opens the app the scene connects and makes the surface by the template's own call, and React Native's root view factory reuses the host that is already
///   running (`createReactHostIfNeeded`), so the first screen mounts once, when the user is there to see it.
/// - In a launch in the foreground, which is every launch the user makes, nothing is done here: the scene starts React Native.
public enum SveltePushBackgroundLaunch {
  /// Called from `application(_:didFinishLaunchingWithOptions:)`, on the main thread. The state is read here and not later because it is only `background` while launching
  /// and a launch the user makes is `inactive`.
  public static func start(_ application: UIApplication, host: () -> Void) {
    guard application.applicationState == .background else { return }
    NSLog("[SveltePush] launched in the background: the React host starts now and the first screen waits until the user opens the app")
    host()
  }
}
#endif
