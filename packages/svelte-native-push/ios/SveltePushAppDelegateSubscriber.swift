import ExpoModulesCore
import UIKit

/// Receives what iOS tells the app delegate about push, and passes it to `SveltePushCenter`: the device token (or the failure to get one) and the silent pushes. It also makes
/// the center the notification center's delegate when launching finishes (PUSH.md, "iOS").
///
/// Apple asks for the delegate to be set no later than the end of `didFinishLaunching`, since the response of the notification whose tap launched the app is delivered to it. The
/// app delegate calls its subscribers from the end of its own `didFinishLaunching`, so this is in time, and does not depend on JavaScript, which is started earlier but in its own time.
public final class SveltePushAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    SveltePushCenter.shared.install()
    return true
  }

  public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    SveltePushCenter.shared.didRegister(deviceToken: deviceToken)
  }

  public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
    SveltePushCenter.shared.didFailToRegister(error)
  }

  /// A push with `content-available`, or any remote notification while the app is in the foreground. Expo's app delegate gives each subscriber its own completion handler
  /// and calls the system's once every subscriber has answered, with the best result among them.
  public func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    SveltePushCenter.shared.didReceiveRemoteNotification(userInfo, applicationState: application.applicationState, completion: completionHandler)
  }
}
