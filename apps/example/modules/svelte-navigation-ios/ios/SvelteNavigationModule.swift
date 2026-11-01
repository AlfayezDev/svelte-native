import ExpoModulesCore
import UIKit

/// The root router's navigation state across the death of the process on iOS (`apps/platform/modules/svelte-engine/SPEC.md`, "Navigation state
/// across recreation and process death"). Android keeps the state in the Activity's saved instance state, which the system holds for a process it
/// killed in the background and drops when the user removes the task. iOS has no such bundle, so the module does the same with a file and one
/// signal from the system. It stores and reports; what to do with it is decided in JavaScript (`packages/svelte-native/src/navigation-restore.ts`,
/// host-tested), so that none of the policy is in code that cannot run on the machines the tests run on.
///
/// - `save(json)`: JavaScript hands over the latest state after every change (kept in memory). When the app enters the background it is written
///   to `Library/Application Support/svelte-navigation/state.json` with the time (`{ savedAt, json, attempts }`), not above 100,000 bytes (Android's
///   bound), and the file is removed when the app comes back to the foreground: a process that dies in the foreground (a crash) restores nothing,
///   as on Android.
/// - `restore()`: at the next start of the process, once: `{ json, savedAt, attempts, systemKept }` or null. `attempts` counts the times the file was
///   handed over (this one included) without a start that finished; `systemKept` is the one thing only this side knows: whether UIKit offered its
///   own restoration state at this launch (`application(_:shouldRestoreSecureApplicationState:)`, wired to `SvelteNavigationRestoration` by the config
///   plugin's AppDelegate patch). The system keeps that state for a process it ended and deletes it when the user swipes the app away.
/// - `restored(outcome, reason)`: JavaScript used the state or refused it: the file is removed and `last.json` records what happened (`outcome`
///   `restored` or `dropped`, and why), for the QA harness to read after a run.
public final class SvelteNavigationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SvelteNavigation")

    // The latest state the root router wrote (JSON text). Called after every navigation change, on the JavaScript thread.
    Function("save") { (json: String) in
      NavigationStore.shared.update(json)
    }

    // What the process before this one left, once: `{ json, savedAt (ms since the epoch), attempts, systemKept }`, or null.
    Function("restore") { () -> [String: Any]? in
      NavigationStore.shared.takeRestored()
    }

    // The state was used (`restored`) or refused (`dropped`, with the reason): forget it.
    Function("restored") { (outcome: String, reason: String) -> Void in
      NavigationStore.shared.finish(outcome: outcome, reason: reason)
    }
  }
}

/// What the app delegate hands to this module (the config plugin adds four methods to the app's `AppDelegate` that call these, `applyAppDelegate` in
/// `packages/svelte-native/src/expo.ts`). The system saves the application's restorable state when the app enters the background and gives it back
/// at the next launch only if the user did not remove the app from the app switcher; there is no view controller to restore, so the archive carries a
/// version mark and `shouldRestore` / `didDecode` are the signal: the system kept the state.
public enum SvelteNavigationRestoration {
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
  /// The largest state kept, in bytes: Android's bound (a Bundle travels through a Binder transaction), kept so that both platforms refuse the same states.
  static let limit = 100_000
  /// The QA app only: `-SvelteNavigationAssumeSystemKill YES` among the launch arguments hands the state over without the system's signal, to tell a fault
  /// of this module from the system's keeping of the state (the harness kills the app from outside; the system may or may not count that as its own kill).
  private static let qaBundleIdentifier = "io.rasheed.svelteqa"

  private let lock = NSLock()
  private let directory: URL
  private var latest: String?
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

  func update(_ json: String) {
    lock.lock()
    latest = json
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
    write(["savedAt": Self.nowMilliseconds(), "json": json, "attempts": 0], to: stateURL)
  }

  /// `restore()`: the state of the process before this one, once, with what JavaScript needs to judge it.
  func takeRestored() -> [String: Any]? {
    lock.lock()
    defer { lock.unlock() }
    guard !handedOver else { return nil }
    handedOver = true
    guard let stored = read(), let json = stored["json"] as? String, let savedAt = stored["savedAt"] as? Double else {
      record(outcome: "none", reason: "no state was kept", attempts: 0)
      return nil
    }
    let attempts = (stored["attempts"] as? Int ?? 0) + 1
    // Counted before JavaScript sees it: a start that dies on the way is the next start's second attempt.
    write(["savedAt": savedAt, "json": json, "attempts": attempts], to: stateURL)
    handOver = HandOver(savedAt: savedAt, bytes: json.utf8.count, attempts: attempts)
    return ["json": json, "savedAt": savedAt, "attempts": attempts, "systemKept": systemKept || Self.assumeSystemKill]
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

  private static var assumeSystemKill: Bool {
    Bundle.main.bundleIdentifier == qaBundleIdentifier && UserDefaults.standard.bool(forKey: "SvelteNavigationAssumeSystemKill")
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
