import ExpoModulesCore
import UIKit

/// The root router's navigation state across the death of the process on iOS (`native/svelte-core/SPEC.md`, "Navigation state
/// across recreation and process death"). Android keeps the state in the Activity's saved instance state, which the system holds for a process it
/// killed in the background and drops when the user removes the task. iOS has no such bundle, so the module does the same with a file and one
/// signal from the system. It stores and reports; what to do with it is decided in JavaScript (`packages/expo-svelte/src/navigation-restore.ts`,
/// host-tested), so that none of the policy is in code that cannot run on the machines the tests run on.
///
/// - `save(json, update)`: JavaScript hands over the latest state after every change (kept in memory), with the id of the OTA update its process runs
///   (null: the embedded bundle). When the app enters the background it is written to `Library/Application Support/svelte-navigation/state.json` with
///   the time and the build that saved it (`{ savedAt, json, attempts, build, update }`; `build` is `CFBundleVersion`), not above 100,000 bytes
///   (Android's bound), and the file is removed when the app comes back to the foreground: a process that dies in the foreground (a crash) restores
///   nothing, as on Android.
/// - `restore()`: at the next start of the process, once: `{ json, savedAt, attempts, systemKept, build, runningBuild, update }` or null. `attempts` counts
///   the times the file was handed over (this one included) without a start that finished; `systemKept` is the one thing only this side knows: whether
///   UIKit offered its own restoration state at this launch (`application(_:shouldRestoreSecureApplicationState:)`, or the connecting scene session's
///   `stateRestorationActivity` in an app with scenes, wired to `SvelteNavigationRestoration` by the config plugin's AppDelegate and SceneDelegate patches). The system keeps that state for a process it ended and deletes it when the user swipes the app away.
///   `build` and `update` are what the file says saved it and `runningBuild` the `CFBundleVersion` of this process; JavaScript compares them
///   (`freshNavigation`, the reason `updated`) and compares `update` with the one its own process runs. A launch in the background (a silent push, a
///   background fetch) is not the user coming back: it hands nothing over and consumes nothing, so the first launch in the foreground still finds the state.
/// - `restored(outcome, reason)`: JavaScript used the state or refused it (the router adopted it, or rejected it): the file is removed and `last.json`
///   records what happened (`outcome` `restored` or `dropped`, and why), for the QA harness to read after a run. A start with no file writes `last.json` in
///   the QA app only (`none`), so the product writes nothing on a cold start.
public final class SvelteNavigationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SvelteNavigation")

    // The latest state the root router wrote (JSON text) and the id of the OTA update its process runs (null: the embedded bundle). Called after every navigation change, on the JavaScript thread.
    Function("save") { (json: String, update: String?) in
      NavigationStore.shared.update(json, update: update)
    }

    // What the process before this one left, once: `{ json, savedAt (ms since the epoch), attempts, systemKept, build, runningBuild, update }`, or null (also in a launch in the background).
    Function("restore") { () -> [String: Any]? in
      NavigationStore.shared.takeRestored()
    }

    // The state was used (`restored`) or refused (`dropped`, with the reason): forget it.
    Function("restored") { (outcome: String, reason: String) -> Void in
      NavigationStore.shared.finish(outcome: outcome, reason: reason)
    }
  }
}

/// What the app delegate and the scene delegate hand to this module (the config plugin adds four methods to the app's `AppDelegate` and two to the `SceneDelegate`
/// of Expo SDK 58's template that call these, `applyAppDelegate` and `applySceneDelegate` in `packages/expo-svelte/src/expo.ts`). The system saves the application's
/// restorable state when the app enters the background and gives it back at the next launch only if the user did not remove the app from the app switcher; there is no view
/// controller to restore, so the archive carries a version mark and the signal is that the system kept the state: for an app with scenes (the SDK 58 template, which iOS 27
/// requires; UIKit calls none of the application delegate's restoration methods then) the scene session's `stateRestorationActivity`, for one without them `shouldRestore` /
/// `didDecode`.
public enum SvelteNavigationRestoration {
  /// `UISceneDelegate.stateRestorationActivity(for:)`: asked when the app enters the background. The system keeps the activity with the scene's session and hands it back
  /// at the next launch unless the user swiped the app away, which discards the session.
  public static func stateRestorationActivity() -> NSUserActivity? {
    NavigationStore.shared.observeLifecycle()
    let activity = NSUserActivity(activityType: NavigationStore.activityType)
    activity.addUserInfoEntries(from: [NavigationStore.archiveKey: NavigationStore.archiveVersion])
    return activity
  }

  /// `scene(_:willConnectTo:options:)`, before React Native starts: the session the system connected carries the activity the process before this one left, so the system kept the state.
  public static func sceneWillConnect(_ activity: NSUserActivity?) {
    if activity?.activityType == NavigationStore.activityType { NavigationStore.shared.noteSystemKeptState() }
  }

  /// `application(_:shouldSaveSecureApplicationState:)`.
  public static func shouldSave(_ coder: NSCoder) -> Bool {
    NavigationStore.shared.observeLifecycle()
    return true
  }

  /// `application(_:willEncodeRestorableStateWith:)`.
  public static func encode(_ coder: NSCoder) {
    coder.encode(NavigationStore.archiveVersion, forKey: NavigationStore.archiveKey)
  }

  /// `application(_:shouldRestoreSecureApplicationState:)`: UIKit has the state of a process the system ended. Called before `didFinishLaunching`.
  public static func shouldRestore(_ coder: NSCoder) -> Bool {
    NavigationStore.shared.noteSystemKeptState()
    return true
  }

  /// `application(_:didDecodeRestorableStateWith:)`.
  public static func didDecode(_ coder: NSCoder) {
    NavigationStore.shared.noteSystemKeptState()
  }
}

final class NavigationStore: @unchecked Sendable {
  static let shared = NavigationStore()

  static let archiveKey = "svelte.navigation"
  static let archiveVersion = 1
  /// The type of the activity a scene saves (`stateRestorationActivity`), whose presence at the next launch is the system's signal.
  static let activityType = "svelte.navigation"
  /// The largest state kept, in bytes: Android's bound (a Bundle travels through a Binder transaction), kept so that both platforms refuse the same states.
  static let limit = 100_000
  /// The QA app only: `-SvelteNavigationAssumeSystemKill YES` among the launch arguments hands the state over without the system's signal, to tell a fault
  /// of this module from the system's keeping of the state (the harness kills the app from outside; the system may or may not count that as its own kill).
  private static let qaBundleIdentifier = "io.rasheed.svelteqa"

  private let lock = NSLock()
  private let directory: URL
  private var latest: String?
  private var latestUpdate: String?
  private var systemKept = false
  private var handedOver = false
  private var handOver: HandOver?
  private var observing = false
  private var observers: [NSObjectProtocol] = []

  private struct HandOver {
    let savedAt: Double
    let bytes: Int
    let attempts: Int
  }

  private var stateURL: URL { directory.appendingPathComponent("state.json") }
  private var lastURL: URL { directory.appendingPathComponent("last.json") }

  private init() {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    directory = base.appendingPathComponent("svelte-navigation", isDirectory: true)
    observeLifecycle()
  }

  /// Writes the state when the app enters the background and removes it when the app comes back; idempotent.
  func observeLifecycle() {
    lock.lock()
    defer { lock.unlock() }
    guard !observing else { return }
    observing = true
    let center = NotificationCenter.default
    observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in self?.persist() })
    observers.append(center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { [weak self] _ in self?.clear() })
  }

  func update(_ json: String, update: String?) {
    lock.lock()
    latest = json
    latestUpdate = update
    lock.unlock()
  }

  func noteSystemKeptState() {
    lock.lock()
    systemKept = true
    lock.unlock()
  }

  /// The app entered the background: what the router last wrote, with the time, for a process the system may end.
  private func persist() {
    lock.lock()
    defer { lock.unlock() }
    guard let json = latest, json.utf8.count <= Self.limit else {
      removeState()
      return
    }
    // `build` and `update` say which code wrote the state: JavaScript refuses it in a build or an OTA update that is not this one (`freshNavigation`).
    var update: Any = NSNull()
    if let id = latestUpdate { update = id }
    write(["savedAt": Self.nowMilliseconds(), "json": json, "attempts": 0, "build": Self.build, "update": update], to: stateURL)
  }

  /// `restore()`: the state of the process before this one, once, with what JavaScript needs to judge it.
  func takeRestored() -> [String: Any]? {
    // Read before the lock: the main thread takes it too (the lifecycle observers), and this waits for the main thread.
    let background = Self.launchedInBackground()
    lock.lock()
    defer { lock.unlock() }
    guard !handedOver else { return nil }
    // A process the system started in the background (a silent push, a background fetch) is not the user coming back. Nothing is handed over, counted or
    // forgotten, so the first launch in the foreground finds the state as the system left it.
    if background { return nil }
    handedOver = true
    let existed = FileManager.default.fileExists(atPath: stateURL.path)
    guard let stored = read(), let json = stored["json"] as? String, let savedAt = stored["savedAt"] as? Double else {
      // Nothing kept is the ordinary cold start: it is written down in the QA app, for the harness, and in the product only when there was a file that could not be used.
      if existed {
        removeState()
        record(outcome: "none", reason: "the kept state could not be read", attempts: 0)
      } else if Self.isQaBundle {
        record(outcome: "none", reason: "no state was kept", attempts: 0)
      }
      return nil
    }
    let attempts = (stored["attempts"] as? Int ?? 0) + 1
    // Counted before JavaScript sees it: a start that dies on the way is the next start's second attempt. The rest of the file (the build, the update) stays as it was written.
    var counted = stored
    counted["attempts"] = attempts
    write(counted, to: stateURL)
    handOver = HandOver(savedAt: savedAt, bytes: json.utf8.count, attempts: attempts)
    var handed: [String: Any] = ["json": json, "savedAt": savedAt, "attempts": attempts, "systemKept": systemKept || Self.assumeSystemKill, "runningBuild": Self.build]
    if let build = stored["build"] as? String { handed["build"] = build }
    if let update = stored["update"] { handed["update"] = update }
    return handed
  }

  /// `restored(outcome, reason)`: the state is no longer needed, and what became of it is written down.
  func finish(outcome: String, reason: String) {
    lock.lock()
    defer { lock.unlock() }
    removeState()
    if let handOver = handOver {
      record(outcome: outcome, reason: reason, attempts: handOver.attempts, savedAt: handOver.savedAt, bytes: handOver.bytes)
      self.handOver = nil
    }
  }

  /// The app came back to the foreground (a process that dies there restores nothing): the file goes.
  func clear() {
    lock.lock()
    removeState()
    lock.unlock()
  }

  private static var isQaBundle: Bool { Bundle.main.bundleIdentifier == qaBundleIdentifier }

  private static var assumeSystemKill: Bool {
    isQaBundle && UserDefaults.standard.bool(forKey: "SvelteNavigationAssumeSystemKill")
  }

  /// The bundle version (`CFBundleVersion`) of the running app: the build that wrote a state is the build that may restore it.
  private static var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "" }

  /// Whether the system started this process in the background. UIKit answers on the main thread; the JavaScript thread waits for it for at most half a second
  /// (as the insets module does) and takes a main thread that does not answer for a foreground launch, the one that matters to the user.
  private static func launchedInBackground() -> Bool {
    if Thread.isMainThread { return UIApplication.shared.applicationState == .background }
    var background = false
    let done = DispatchSemaphore(value: 0)
    DispatchQueue.main.async {
      background = UIApplication.shared.applicationState == .background
      done.signal()
    }
    return done.wait(timeout: .now() + 0.5) == .success && background
  }

  private static func nowMilliseconds() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

  private func removeState() {
    try? FileManager.default.removeItem(at: stateURL)
  }

  private func read() -> [String: Any]? {
    guard let data = try? Data(contentsOf: stateURL) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  private func record(outcome: String, reason: String, attempts: Int, savedAt: Double? = nil, bytes: Int? = nil) {
    var entry: [String: Any] = ["at": Self.nowMilliseconds(), "outcome": outcome, "reason": reason, "attempts": attempts, "systemKept": systemKept || Self.assumeSystemKill]
    if let savedAt = savedAt { entry["savedAt"] = savedAt }
    if let bytes = bytes { entry["bytes"] = bytes }
    write(entry, to: lastURL)
  }

  private func write(_ object: [String: Any], to url: URL) {
    do {
      let fileManager = FileManager.default
      if !fileManager.fileExists(atPath: directory.path) {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var folder = directory
        try? folder.setResourceValues(values)
      }
      let data = try JSONSerialization.data(withJSONObject: object)
      try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    } catch {
      NSLog("%@", "[SvelteNavigation] could not write \(url.lastPathComponent): \(error)")
    }
  }
}
