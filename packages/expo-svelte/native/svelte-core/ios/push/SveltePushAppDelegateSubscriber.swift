// Compiled only when push is on (`SVELTE_PUSH`, set by SvelteCore.podspec from the config plugin's `capabilities.push.ios`): an app without push has none of it in its binary.
#if SVELTE_PUSH
import ExpoModulesCore
import UIKit

/// Receives what iOS tells the app delegate about push, and passes it to `SveltePushCenter`: the device token (or the failure to get one) and the silent pushes. It also makes
/// the center the notification center's delegate when launching finishes (PUSH.md, "iOS").
///
/// It is in every app, because SvelteCore is, so each callback asks `SveltePushFlag` first and does nothing in a build where the config plugin did not turn push on: the center is not
/// the notification center's delegate (an app with `expo-notifications` or React Native Firebase keeps its own), nothing is forwarded, and no completion handler is held.
///
/// Apple asks for the delegate to be set no later than the end of `didFinishLaunching`, since the response of the notification whose tap launched the app is delivered to it. The
/// app delegate calls its subscribers from the end of its own `didFinishLaunching`, so this is in time, and does not depend on JavaScript, which is started earlier but in its own time.
public final class SveltePushAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    guard SveltePushFlag.isEnabled else { return true }
    SveltePushCenter.shared.install()
    return true
  }

  public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    guard SveltePushFlag.isEnabled else { return }
    SveltePushCenter.shared.didRegister(deviceToken: deviceToken)
  }

  public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
    guard SveltePushFlag.isEnabled else { return }
    SveltePushCenter.shared.didFailToRegister(error)
  }

  /// A push with `content-available`, or any remote notification while the app is in the foreground. Expo's app delegate gives each subscriber its own completion handler
  /// and calls the system's once every subscriber has answered, with the best result among them: without push this one answers `noData` at once, which is the least of them, so
  /// it neither holds the system's completion nor changes what the app's other subscribers decide.
  public func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    guard SveltePushFlag.isEnabled else {
      completionHandler(.noData)
      return
    }
    SveltePushCenter.shared.didReceiveRemoteNotification(userInfo, applicationState: application.applicationState, completion: completionHandler)
  }
}
#else
import ExpoModulesCore

/// Push is off in this build: a subscriber that forwards nothing, because Expo's generated provider names it.
public final class SveltePushAppDelegateSubscriber: ExpoAppDelegateSubscriber {}
#endif
