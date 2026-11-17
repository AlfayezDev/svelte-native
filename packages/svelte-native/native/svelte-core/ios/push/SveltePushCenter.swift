import ExpoModulesCore
import UIKit
import UserNotifications

/// Everything iOS tells the process about push lives here, in one object that exists for the life of the process, and not in `SveltePushModule`. The module is made when
/// JavaScript first asks for it and is made again by a reload, but a notification that launched the app, a silent push and the device token all arrive at the app delegate
/// before there is JavaScript to hear them, or while the old one is going away. This object holds them until a module is listening (PUSH.md, "The native module's contract").
///
/// It is the `UNUserNotificationCenter` delegate, installed by `SveltePushAppDelegateSubscriber` in `didFinishLaunching`: Apple asks for the delegate to be set no later than
/// the end of that method, and it is to that delegate that the system delivers the response of the notification whose tap launched the app. The subscriber also forwards
/// the registration and the silent pushes here, and the module's functions call in.
///
/// State is read and written from the main thread (UIKit's callbacks), the JavaScript thread (`takeLaunchMessage`, `backgroundDone`) and the module's queue, so it is behind one lock.
/// Nothing is called while the lock is held except `sendEvent`, which only schedules onto the JavaScript thread.
final class SveltePushCenter: NSObject, UNUserNotificationCenterDelegate {
  static let shared = SveltePushCenter()

  /// How long `willPresent` waits for JavaScript's `show` before it presents the notification in full. JavaScript answers within 900 ms (`FOREGROUND_TIMEOUT_MS`), so this
  /// is the one second PUSH.md gives, and the iOS limit for the completion handler is far above it.
  static let presentationWait: TimeInterval = 1

  /// How long a silent push is held for `background`'s hook. iOS gives a background launch about 30 seconds to call the fetch completion; the margin is for the process to wind down.
  static let backgroundLimit: TimeInterval = 25

  /// How long `register` waits for Apple before it rejects. Without it a registration that never answers (a simulator that does not deliver tokens, a profile without the push
  /// entitlement, no network) would leave `push.subscribe` waiting for good.
  static let registrationLimit: TimeInterval = 30

  /// The most events kept for one name while JavaScript is not listening, so that a listener that never comes does not make the process grow.
  private static let heldEventLimit = 50

  /// How many taps are remembered to tell a tap the system delivers twice from a second tap.
  private static let recentTapLimit = 16

  private struct Registration {
    let id: UUID
    let promise: Promise
  }

  /// A notification that `willPresent` is holding for JavaScript's answer. The system's completion handler may be called once, and the answer and the timer race for it.
  private final class Presentation {
    private let lock = NSLock()
    private var completion: ((UNNotificationPresentationOptions) -> Void)?

    init(_ completion: @escaping (UNNotificationPresentationOptions) -> Void) {
      self.completion = completion
    }

    /// Presents the notification as `options` say, on the main queue; false when an earlier call already did.
    @discardableResult
    func finish(_ options: UNNotificationPresentationOptions) -> Bool {
      let completion = lock.withLock { () -> ((UNNotificationPresentationOptions) -> Void)? in
        let taken = self.completion
        self.completion = nil
        return taken
      }
      guard let completion else { return false }
      DispatchQueue.main.async { completion(options) }
      return true
    }
  }

  private let lock = NSLock()
  private weak var module: SveltePushModule?
  private var observed: Set<String> = []
  private var heldEvents: [String: [[String: Any]]] = [:]
  private var registrations: [Registration] = []
  private var presentations: [String: Presentation] = [:]
  private var launchMessage: [String: Any]?
  private var launchTaken = false
  private var recentTaps: [String] = []
  private var backgroundCompletions: [String: (UIBackgroundFetchResult) -> Void] = [:]

  private override init() {
    super.init()
  }

  // MARK: - The module

  /// A module made by an app context is the one that sends the events. A reload makes a new module while the old one is still going away, so the newest wins, and it
  /// starts with no listeners: the old module's `detach` finds another module attached and leaves `observed` alone, so what the old JavaScript listened to would otherwise
  /// stand for the new one, whose events would go to nobody (a `background` event dropped that way holds the system's completion for 25 s). The new JavaScript adds its
  /// own listeners, which delivers what is held meanwhile.
  func attach(_ module: SveltePushModule) {
    lock.withLock {
      self.module = module
      observed.removeAll()
    }
  }

  /// Forgets the module that is going away, and the listeners it had: the next module's JavaScript adds its own, which delivers what has been held meanwhile.
  func detach(_ module: SveltePushModule) {
    lock.withLock {
      guard self.module === module else { return }
      self.module = nil
      observed.removeAll()
    }
  }

  /// JavaScript added its first listener for `event`: what came before it is delivered now, in order. Expo's emitter has added the listener before it calls this, so the
  /// events, which reach JavaScript later on its own thread, find it.
  func startObserving(_ event: String) {
    lock.withLock {
      observed.insert(event)
      guard let module, let events = heldEvents.removeValue(forKey: event) else { return }
      for body in events { module.sendEvent(event, body) }
    }
  }

  func stopObserving(_ event: String) {
    lock.withLock { _ = observed.remove(event) }
  }

  /// Sends an event to JavaScript, or holds it until JavaScript listens for it. A new device token replaces the one held, since only the last one is any use.
  private func emit(_ event: String, _ body: [String: Any]) {
    lock.withLock {
      if observed.contains(event), let module {
        module.sendEvent(event, body)
        return
      }
      var events = event == "token" ? [] : heldEvents[event, default: []]
      events.append(body)
      if events.count > Self.heldEventLimit {
        NSLog("[SveltePush] %ld '%@' events are waiting for JavaScript; the oldest is dropped", events.count, event)
        events.removeFirst(events.count - Self.heldEventLimit)
      }
      heldEvents[event] = events
    }
  }

  // MARK: - The notification center

  /// Becomes the notification center's delegate. There is one delegate, and so one push library in an app (the config plugin refuses a second one it knows of); one that
  /// is replaced is named in the log, since the library that set it would otherwise stop receiving taps without a word.
  func install() {
    // SvelteCore is in every app: a build that did not turn push on keeps the notification center's delegate for whoever set it (the subscriber asks too; this is the last guard).
    guard SveltePushFlag.isEnabled else { return }
    let center = UNUserNotificationCenter.current()
    if let current = center.delegate, current !== self {
      NSLog("[SveltePush] replacing the notification center delegate %@: an app has one push library", String(describing: type(of: current)))
    }
    center.delegate = self
  }

  /// A notification arrived with the app in the foreground. JavaScript's `foreground` hook decides how it shows, and `show` passes the answer on; the notification waits
  /// for it for `presentationWait` and then shows in full.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    let request = notification.request
    let message = SveltePushPayload.message(from: request.content.userInfo, id: request.identifier)
    let presentation = Presentation(completionHandler)
    let replaced = lock.withLock { presentations.updateValue(presentation, forKey: message.id) }
    // Two notifications can share an id (a collapse id replaces the earlier one): the earlier is shown as it is, because `show` can answer for one only.
    if let replaced, replaced.finish(Self.shownInFull) {
      NSLog("[SveltePush] a notification with id %@ arrived while the last one with that id was waiting for JavaScript; the last one is shown in full", message.id)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.presentationWait) { [weak self] in
      self?.presentationTimedOut(message.id, presentation)
    }
    emit("message", message.payload)
  }

  /// JavaScript's answer to a `message` event. An id that is not held (the wait ran out, the notification was already answered, or the message was a data message with
  /// nothing to show) is not an error: the answer is idempotent, as the contract says.
  func show(id: String?, banner: Bool, sound: Bool, badge: Bool) {
    guard let id else {
      NSLog("[SveltePush] show was called with a message that has no id; nothing was shown")
      return
    }
    let presentation = lock.withLock { presentations.removeValue(forKey: id) }
    presentation?.finish(Self.options(banner: banner, sound: sound, badge: badge))
  }

  private func presentationTimedOut(_ id: String, _ presentation: Presentation) {
    lock.withLock {
      if presentations[id] === presentation { presentations[id] = nil }
    }
    if presentation.finish(Self.shownInFull) {
      NSLog("[SveltePush] JavaScript did not answer for notification %@ within %.0f s; it is shown in full", id, Self.presentationWait)
    }
  }

  /// A notification was tapped. Until JavaScript has called `takeLaunchMessage` the tap is the message that launched the process, and from then on it is an `opened` event:
  /// the router reads the launch message when it mounts, which is later than the process starts, and a process that began without a screen (a silent push) mounts it later still.
  /// The completion handler is called at once, whatever JavaScript does with the tap.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    defer { completionHandler() }
    guard response.actionIdentifier == UNNotificationDefaultActionIdentifier else {
      NSLog("[SveltePush] the action %@ of a notification was ignored: only a tap on the notification itself is handled", response.actionIdentifier)
      return
    }
    let request = response.notification.request
    let message = SveltePushPayload.message(from: request.content.userInfo, id: request.identifier)
    // The system can deliver a response again (when the delegate is set again, for one), so a response is told by the notification and the time it arrived.
    let tap = "\(request.identifier)|\(response.notification.date.timeIntervalSince1970)"
    enum Outcome { case repeated, launch(replacing: Bool), opened }
    let outcome = lock.withLock { () -> Outcome in
      if recentTaps.contains(tap) { return .repeated }
      recentTaps.append(tap)
      if recentTaps.count > Self.recentTapLimit { recentTaps.removeFirst() }
      guard launchTaken else {
        let replacing = launchMessage != nil
        launchMessage = message.payload
        return .launch(replacing: replacing)
      }
      return .opened
    }
    switch outcome {
    case .repeated:
      return
    case .launch(let replacing):
      if replacing { NSLog("[SveltePush] a second notification was tapped before JavaScript read the first one's link; the first is dropped") }
    case .opened:
      emit("opened", message.payload)
    }
  }

  /// `takeLaunchMessage()`: the message whose tap launched the process, once. The call also ends the time when a tap is the launch message.
  func takeLaunchMessage() -> [String: Any]? {
    lock.withLock { () -> [String: Any]? in
      launchTaken = true
      let taken = launchMessage
      launchMessage = nil
      return taken
    }
  }

  // MARK: - The device token

  /// Asks iOS for a device token and settles `promise` with it, or with the failure, or after `registrationLimit`. Several calls share the answer.
  /// Must run on the main thread, where UIKit wants the registration.
  func register(_ promise: Promise) {
    let id = UUID()
    lock.withLock { registrations.append(Registration(id: id, promise: promise)) }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.registrationLimit) { [weak self] in
      self?.registrationTimedOut(id)
    }
    UIApplication.shared.registerForRemoteNotifications()
  }

  private func registrationTimedOut(_ id: UUID) {
    let expired = lock.withLock { () -> Registration? in
      guard let index = registrations.firstIndex(where: { $0.id == id }) else { return nil }
      return registrations.remove(at: index)
    }
    expired?.promise.reject(
      "ERR_SVELTE_PUSH_REGISTRATION",
      "Apple did not answer the registration for remote notifications within \(Int(Self.registrationLimit)) seconds. Check the device's network, that the app is signed with the "
        + "Push Notifications entitlement (a Personal Team cannot sign it), and that this is not a simulator that does not deliver device tokens."
    )
  }

  /// The delegate callback of `registerForRemoteNotifications`. It settles the `register` calls that are waiting. With none waiting it is iOS giving the app a token on
  /// its own (a changed one, or a registration that answered after its call gave up), which JavaScript hears as `token`.
  func didRegister(deviceToken: Data) {
    let hex = deviceToken.map { String(format: "%02hhx", $0) }.joined()
    let token: [String: Any] = [
      "provider": "apns",
      "token": hex,
      "environment": SveltePushEnvironment.current,
      "app": Bundle.main.bundleIdentifier ?? "",
    ]
    let waiting = lock.withLock { () -> [Registration] in
      let taken = registrations
      registrations = []
      return taken
    }
    guard !waiting.isEmpty else {
      emit("token", token)
      return
    }
    // Typed `Any?` so that the promise resolves with the dictionary as it is, whatever overload of `resolve` the compiler would otherwise choose for a dictionary.
    let value: Any? = token
    for registration in waiting { registration.promise.resolve(value) }
  }

  func didFailToRegister(_ error: Error) {
    let waiting = lock.withLock { () -> [Registration] in
      let taken = registrations
      registrations = []
      return taken
    }
    guard !waiting.isEmpty else {
      NSLog("[SveltePush] registering for remote notifications failed: %@", error.localizedDescription)
      return
    }
    for registration in waiting {
      registration.promise.reject("ERR_SVELTE_PUSH_REGISTRATION", "Registering for remote notifications failed: \(error.localizedDescription)")
    }
  }

  // MARK: - Silent pushes

  /// `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`. With the app in the background (or not running: iOS has started it for this push) the message
  /// goes to the `background` hook, and the fetch completion waits for `backgroundDone` for `backgroundLimit`. With the app in the foreground iOS calls this for every
  /// remote notification, the ones that show an alert too: those are `willPresent`'s, and a data message is a `message` for the foreground hook and `push.on("message")`
  /// (Android's service does the same, with no `background` while the app is in the foreground).
  func didReceiveRemoteNotification(_ userInfo: [AnyHashable: Any], applicationState: UIApplication.State, completion: @escaping (UIBackgroundFetchResult) -> Void) {
    let message = SveltePushPayload.message(from: userInfo)
    if applicationState == .active {
      let shownByWillPresent = SveltePushPayload.hasAlert(userInfo)
      if !shownByWillPresent { emit("message", message.payload) }
      completion(shownByWillPresent ? .noData : .newData)
      return
    }
    let id = UUID().uuidString
    lock.withLock { backgroundCompletions[id] = completion }
    emit("background", ["id": id, "message": message.payload])
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.backgroundLimit) { [weak self] in
      self?.finishBackground(id, .failed, reason: "JavaScript did not finish within \(Int(Self.backgroundLimit)) s")
    }
  }

  /// `backgroundDone(id)`: the hook settled, so the system may suspend the process, and the push counts as having fetched data.
  func backgroundDone(_ id: String) {
    finishBackground(id, .newData, reason: nil)
  }

  private func finishBackground(_ id: String, _ result: UIBackgroundFetchResult, reason: String?) {
    // Taken out under the lock, so that the answer and the timer cannot both call it, and called on the main queue as the system's callbacks are.
    let completion = lock.withLock { backgroundCompletions.removeValue(forKey: id) }
    guard let completion else { return }
    if let reason { NSLog("[SveltePush] the background message %@ was released: %@", id, reason) }
    DispatchQueue.main.async { completion(result) }
  }

  // MARK: - What the system's words mean

  /// A notification shown in full: what the system does when the app does not decide.
  static let shownInFull: UNNotificationPresentationOptions = [.banner, .list, .sound, .badge]

  /// The presentation JavaScript chose: `banner` is the banner and the entry in Notification Center, which iOS offers apart.
  static func options(banner: Bool, sound: Bool, badge: Bool) -> UNNotificationPresentationOptions {
    var options: UNNotificationPresentationOptions = []
    if banner { options.formUnion([.banner, .list]) }
    if sound { options.insert(.sound) }
    if badge { options.insert(.badge) }
    return options
  }

  /// The permission as the module names it. Provisional and ephemeral authorizations deliver notifications, so they are granted; a status this code does not know is
  /// not claimed to be granted.
  static func permission(of status: UNAuthorizationStatus) -> String {
    switch status {
    case .authorized, .provisional, .ephemeral: return "granted"
    case .notDetermined: return "prompt"
    case .denied: return "denied"
    @unknown default: return "denied"
    }
  }
}
