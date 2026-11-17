import UIKit

/// Rule 2 of PUSH.md on iOS: a push that wakes the app mounts no screen. When iOS launches the app in the background for a silent push, Expo's `AppDelegate` would create
/// the window and start React Native's surface at once, and the surface starts the first screen's JavaScript (`AppRegistry.runApplication`), so a screen would mount that
/// nobody can see. The config plugin's patch of `AppDelegate.swift` (`applyPushAppDelegate`) wraps the template's `startReactNative` call in this function instead.
///
/// - In a launch in the foreground, which is every launch the user makes, `surface` is called here and now: the template's own call, in its own place, with nothing between.
/// - In a launch in the background, `host` is called now and `surface` at the first moment the app becomes active. The host is React Native's runtime, which loads the bundle:
///   the app's `init` runs, and so do the push hooks, which is all a message that arrives needs. The surface is what mounts the first screen, and it is made only when the
///   user opens the app, by the same call as before; React Native's root view factory reuses the host that is already running (`createReactHostIfNeeded`).
public enum SveltePushBackgroundLaunch {
  /// Called from `application(_:didFinishLaunchingWithOptions:)`, on the main thread. The state is read here and not later because it is only `background` while launching
  /// and a launch the user makes is `inactive`.
  public static func start(_ application: UIApplication, host: () -> Void, surface: @escaping () -> Void) {
    guard application.applicationState == .background else {
      surface()
      return
    }
    NSLog("[SveltePush] launched in the background: the React host starts now and the first screen waits until the app becomes active")
    host()
    // One notification: the observer takes itself away, so that the screen is not started again by the next time the app comes back to the foreground. The token is held in
    // an object and not in a variable, because the block that removes it is made before the center has given it back.
    let observation = Observation()
    observation.token = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
      if let token = observation.token { NotificationCenter.default.removeObserver(token) }
      surface()
    }
  }

  private final class Observation {
    var token: NSObjectProtocol?
  }
}
