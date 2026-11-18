// Compiled only when push is on (`SVELTE_PUSH`, set by SvelteCore.podspec from the config plugin's `capabilities.push.ios`): an app without push has none of it in its binary.
#if SVELTE_PUSH
import ExpoModulesCore
import UIKit
import UserNotifications

/// How the foreground hook says to show a notification (`show`'s second argument): JavaScript fills in every member.
struct SveltePushPresentation: Record {
  @Field var banner: Bool = true
  @Field var sound: Bool = true
  @Field var badge: Bool = true
}

/// What a call of the module answers in a build with push off (`SveltePushFlag`): SvelteCore is in every app, and JavaScript reads the module's `enabled` constant before it calls.
final class SveltePushDisabledException: Exception, @unchecked Sendable {
  init() {
    super.init(
      name: "SveltePushDisabled",
      description: "Push is off in this build: turn it on with capabilities.push.ios in the @alfayez/svelte-native config plugin, and build again (the module's `enabled` constant says which)",
      code: "ERR_SVELTE_PUSH_DISABLED"
    )
  }

  override var debugDescription: String { reason }
}

/// The module behind `@alfayez/svelte-native/push` (PUSH.md, "The native module's contract"): the permission, the APNs device token, showing a notification, the message a
/// tap launched the process with, and the events. It is a thin front for `SveltePushCenter`, which outlives it and holds what iOS delivers before JavaScript listens.
///
/// The module is in every app, since it is part of SvelteCore, and the constant `enabled` says whether push is on in this build (the config plugin's `capabilities.push.ios`, as the
/// Info.plist flag `SveltePushEnabled`). Off, it attaches nothing and listens for nothing; its asynchronous calls reject with `ERR_SVELTE_PUSH_DISABLED`, `takeLaunchMessage` answers
/// `nil` and `backgroundDone` does nothing. JavaScript does not call any of them.
///
/// Events are held until JavaScript adds a listener for that event name, and delivered when it does (`OnStartObserving`), which is how a message that started the process
/// reaches the hooks. The module has the four events of the contract: `token`, `message`, `opened` and `background`.
public final class SveltePushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SveltePush")

    // Whether push is on in this build: the one thing JavaScript may ask of an app that has none.
    Constant("enabled") { SveltePushFlag.isEnabled }

    Events("token", "message", "opened", "background")

    OnCreate {
      if SveltePushFlag.isEnabled { SveltePushCenter.shared.attach(self) }
    }

    OnDestroy {
      if SveltePushFlag.isEnabled { SveltePushCenter.shared.detach(self) }
    }

    // One per event, as JavaScript adds its listeners one by one: the events of one name are delivered when its own listener is there.
    OnStartObserving("token") { if SveltePushFlag.isEnabled { SveltePushCenter.shared.startObserving("token") } }
    OnStartObserving("message") { if SveltePushFlag.isEnabled { SveltePushCenter.shared.startObserving("message") } }
    OnStartObserving("opened") { if SveltePushFlag.isEnabled { SveltePushCenter.shared.startObserving("opened") } }
    OnStartObserving("background") { if SveltePushFlag.isEnabled { SveltePushCenter.shared.startObserving("background") } }
    OnStopObserving("token") { if SveltePushFlag.isEnabled { SveltePushCenter.shared.stopObserving("token") } }
    OnStopObserving("message") { if SveltePushFlag.isEnabled { SveltePushCenter.shared.stopObserving("message") } }
    OnStopObserving("opened") { if SveltePushFlag.isEnabled { SveltePushCenter.shared.stopObserving("opened") } }
    OnStopObserving("background") { if SveltePushFlag.isEnabled { SveltePushCenter.shared.stopObserving("background") } }

    // The system's state without asking: `notDetermined` is "prompt", `denied` is "denied", and the three authorizations that deliver notifications are "granted".
    AsyncFunction("permission") { (promise: Promise) in
      guard SveltePushFlag.isEnabled else { return promise.reject(SveltePushDisabledException()) }
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        promise.resolve(SveltePushCenter.permission(of: settings.authorizationStatus))
      }
    }

    // Asks for alert, sound and badge, and answers with the state after the user has. A user who has answered before is not asked again by iOS, and gets that answer.
    AsyncFunction("requestPermission") { (promise: Promise) in
      guard SveltePushFlag.isEnabled else { return promise.reject(SveltePushDisabledException()) }
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
      guard SveltePushFlag.isEnabled else { return promise.reject(SveltePushDisabledException()) }
      SveltePushCenter.shared.register(promise)
    }.runOnQueue(.main)

    AsyncFunction("unregister") { () throws in
      guard SveltePushFlag.isEnabled else { throw SveltePushDisabledException() }
      UIApplication.shared.unregisterForRemoteNotifications()
    }.runOnQueue(.main)

    // The foreground hook's answer for a `message` event: the notification waiting in `willPresent` is shown as the three booleans say. Answering twice, or late, does nothing.
    AsyncFunction("show") { (message: [String: Any], presentation: SveltePushPresentation) throws in
      guard SveltePushFlag.isEnabled else { throw SveltePushDisabledException() }
      SveltePushCenter.shared.show(id: message["id"] as? String, banner: presentation.banner, sound: presentation.sound, badge: presentation.badge)
    }

    // The message whose tap launched the process, once, and null after that and when no tap did. Synchronous, because the router waits for it.
    Function("takeLaunchMessage") { () -> [String: Any]? in
      guard SveltePushFlag.isEnabled else { return nil }
      return SveltePushCenter.shared.takeLaunchMessage()
    }

    // The background hook settled: the silent push that woke the process may be completed.
    Function("backgroundDone") { (id: String) in
      guard SveltePushFlag.isEnabled else { return }
      SveltePushCenter.shared.backgroundDone(id)
    }
  }
}
#else
import ExpoModulesCore

/// Push is off in this build, so none of its code is compiled and the app's binary references no push API (App Store Connect warns about a binary that registers for remote
/// notifications without the `aps-environment` entitlement). The module stays, because Expo's generated module provider names it: `enabled` is false, and JavaScript calls
/// nothing else.
public final class SveltePushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SveltePush")
    Constant("enabled") { false }
  }
}
#endif
