import ExpoModulesCore
import UIKit
import UserNotifications

/// How the foreground hook says to show a notification (`show`'s second argument): JavaScript fills in every member.
struct SveltePushPresentation: Record {
  @Field var banner: Bool = true
  @Field var sound: Bool = true
  @Field var badge: Bool = true
}

/// The module behind `@alfayez/svelte-native/push` (PUSH.md, "The native module's contract"): the permission, the APNs device token, showing a notification, the message a
/// tap launched the process with, and the events. It is a thin front for `SveltePushCenter`, which outlives it and holds what iOS delivers before JavaScript listens.
///
/// Events are held until JavaScript adds a listener for that event name, and delivered when it does (`OnStartObserving`), which is how a message that started the process
/// reaches the hooks. The module has the four events of the contract: `token`, `message`, `opened` and `background`.
public final class SveltePushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SveltePush")

    Events("token", "message", "opened", "background")

    OnCreate {
      SveltePushCenter.shared.attach(self)
    }

    OnDestroy {
      SveltePushCenter.shared.detach(self)
    }

    // One per event, as JavaScript adds its listeners one by one: the events of one name are delivered when its own listener is there.
    OnStartObserving("token") { SveltePushCenter.shared.startObserving("token") }
    OnStartObserving("message") { SveltePushCenter.shared.startObserving("message") }
    OnStartObserving("opened") { SveltePushCenter.shared.startObserving("opened") }
    OnStartObserving("background") { SveltePushCenter.shared.startObserving("background") }
    OnStopObserving("token") { SveltePushCenter.shared.stopObserving("token") }
    OnStopObserving("message") { SveltePushCenter.shared.stopObserving("message") }
    OnStopObserving("opened") { SveltePushCenter.shared.stopObserving("opened") }
    OnStopObserving("background") { SveltePushCenter.shared.stopObserving("background") }

    // The system's state without asking: `notDetermined` is "prompt", `denied` is "denied", and the three authorizations that deliver notifications are "granted".
    AsyncFunction("permission") { (promise: Promise) in
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        promise.resolve(SveltePushCenter.permission(of: settings.authorizationStatus))
      }
    }

    // Asks for alert, sound and badge, and answers with the state after the user has. A user who has answered before is not asked again by iOS, and gets that answer.
    AsyncFunction("requestPermission") { (promise: Promise) in
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
        if let error {
          promise.reject("ERR_SVELTE_PUSH_PERMISSION", "The notification permission could not be requested: \(error.localizedDescription)")
          return
        }
        UNUserNotificationCenter.current().getNotificationSettings { settings in
          promise.resolve(SveltePushCenter.permission(of: settings.authorizationStatus))
        }
      }
    }

    // Registers with APNs and resolves with `{ provider, token, environment, app }` when the app delegate gets the token. UIKit wants the call on the main thread.
    AsyncFunction("register") { (promise: Promise) in
      SveltePushCenter.shared.register(promise)
    }.runOnQueue(.main)

    AsyncFunction("unregister") { () in
      UIApplication.shared.unregisterForRemoteNotifications()
    }.runOnQueue(.main)

    // The foreground hook's answer for a `message` event: the notification waiting in `willPresent` is shown as the three booleans say. Answering twice, or late, does nothing.
    AsyncFunction("show") { (message: [String: Any], presentation: SveltePushPresentation) in
      SveltePushCenter.shared.show(id: message["id"] as? String, banner: presentation.banner, sound: presentation.sound, badge: presentation.badge)
    }

    // The message whose tap launched the process, once, and null after that and when no tap did. Synchronous, because the router waits for it.
    Function("takeLaunchMessage") { () -> [String: Any]? in
      SveltePushCenter.shared.takeLaunchMessage()
    }

    // The background hook settled: the silent push that woke the process may be completed.
    Function("backgroundDone") { (id: String) in
      SveltePushCenter.shared.backgroundDone(id)
    }
  }
}
