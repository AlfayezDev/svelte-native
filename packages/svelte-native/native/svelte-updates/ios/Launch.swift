import ExpoModulesCore
import Foundation

/// What this process launched (or will launch after a reload), and the configuration it was chosen under.
struct LaunchState {
  let config: UpdatesConfig
  let store: UpdateStore?
  let updateId: String?
  let bundlePath: String?
  /// The launched update's `createdAt`, or the embedded bundle's effective commit time.
  let createdAt: Int64
  /// Asset key to `file://` URI of the launched update's downloaded files that exist on disk.
  let localAssets: [String: String]
  let clientId: String
}

/// The launch decision, made once per process before the React host reads its bundle URL (`SvelteUpdatesReactDelegateHandler`) and
/// shared with the module's constants. A reload makes a new decision with the updates committed since.
enum Launch {
  private static let lock = NSLock()
  private static var current: LaunchState?

  static func get() -> LaunchState {
    lock.lock(); defer { lock.unlock() }
    if let current { return current }
    let state = decide(markFailure: true)
    current = state
    return state
  }

  static func relaunch() -> LaunchState {
    lock.lock(); defer { lock.unlock() }
    let state = decide(markFailure: false)
    current = state
    return state
  }

  /// When the embedded bundle was built: the modification time of `main.jsbundle`, which Xcode writes into the app during the build.
  /// The store compares it with each update's `createdAt` to decide whether an update is newer than the bundle inside the app.
  static func embeddedBuildTime() -> Int64 {
    let url = Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    let modified = url.flatMap { try? $0.resourceValues(forKeys: [.contentModificationDateKey]) }?.contentModificationDate
    return Int64((modified ?? Date(timeIntervalSince1970: 0)).timeIntervalSince1970 * 1000)
  }

  private static func decide(markFailure: Bool) -> LaunchState {
    let config = UpdatesConfig.read()
    let buildTime = embeddedBuildTime()
    guard config.enabled else {
      return LaunchState(config: config, store: nil, updateId: nil, bundlePath: nil, createdAt: buildTime, localAssets: [:], clientId: "")
    }
    do {
      let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      let store = UpdateStore(root: support.appendingPathComponent("svelte-updates"))
      let selection = try store.select(config: config, buildTime: buildTime, markFailure: markFailure)
      if let reason = selection.emergencyReason { NSLog("[SvelteUpdates] %@; launching the previous update or the embedded bundle", reason) }
      let update = selection.update
      if let update { NSLog("[SvelteUpdates] Launching update %@ (created %lld)", update.id, update.createdAt) } else { NSLog("[SvelteUpdates] Launching the embedded bundle (built %lld)", selection.embeddedCreatedAt) }
      var localAssets: [String: String] = [:]
      for asset in update?.assets ?? [] where asset.key != update?.launchAssetKey {
        let file = store.assetFile(key: asset.key, fileExtension: asset.fileExtension)
        if FileManager.default.fileExists(atPath: file.path) { localAssets[asset.key] = file.absoluteString }
      }
      return LaunchState(
        config: config,
        store: store,
        updateId: update?.id,
        bundlePath: update.map { store.bundleFile($0).path },
        createdAt: update?.createdAt ?? selection.embeddedCreatedAt,
        localAssets: localAssets,
        clientId: try store.clientId()
      )
    } catch {
      // A store that cannot be opened must not stop the app: run the embedded bundle.
      NSLog("[SvelteUpdates] the update store is unavailable (%@); launching the embedded bundle", String(describing: error))
      return LaunchState(config: config, store: nil, updateId: nil, bundlePath: nil, createdAt: buildTime, localAssets: [:], clientId: "")
    }
  }
}

/// Gives the React host the bundle to load. `ExpoReactDelegate.bundleURL()` asks each handler, in the factory's root view and host
/// bundle lookups, and the first non-nil answer wins; nil leaves the app's own bundle URL (the embedded `main.jsbundle`).
public final class SvelteUpdatesReactDelegateHandler: ExpoReactDelegateHandler {
  public override func bundleURL(reactDelegate: ExpoReactDelegate) -> URL? {
    guard let path = Launch.get().bundlePath else { return nil }
    return URL(fileURLWithPath: path)
  }
}
