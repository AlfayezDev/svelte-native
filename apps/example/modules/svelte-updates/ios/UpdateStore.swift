import Foundation

/// One downloaded update. `status` is "ready" or "failed"; a failed update keeps its record (so it is never fetched again) but not its files.
struct StoredUpdate {
  let id: String
  let createdAt: Int64
  let runtimeVersion: String
  var status: String
  let metadata: [String: Any]
  /// The update URL and request headers (channel) the update was fetched with; only an update fetched with the build's current ones launches.
  let url: String
  let headers: [String: String]
  let launchAssetKey: String
  let assets: [(key: String, fileExtension: String)]

  var json: [String: Any] {
    [
      "id": id, "createdAt": createdAt, "runtimeVersion": runtimeVersion, "status": status, "metadata": metadata,
      "url": url, "headers": headers, "launchAssetKey": launchAssetKey,
      "assets": assets.map { ["key": $0.key, "extension": $0.fileExtension] },
    ]
  }

  init(id: String, createdAt: Int64, runtimeVersion: String, status: String, metadata: [String: Any], url: String, headers: [String: String], launchAssetKey: String, assets: [(key: String, fileExtension: String)]) {
    self.id = id
    self.createdAt = createdAt
    self.runtimeVersion = runtimeVersion
    self.status = status
    self.metadata = metadata
    self.url = url
    self.headers = headers
    self.launchAssetKey = launchAssetKey
    self.assets = assets
  }

  init?(json: [String: Any]) {
    guard
      let id = json["id"] as? String, let createdAt = (json["createdAt"] as? NSNumber)?.int64Value,
      let runtimeVersion = json["runtimeVersion"] as? String, let status = json["status"] as? String,
      let metadata = json["metadata"] as? [String: Any], let url = json["url"] as? String,
      let headers = json["headers"] as? [String: String], let launchAssetKey = json["launchAssetKey"] as? String,
      let assets = json["assets"] as? [[String: String]]
    else { return nil }
    self.init(
      id: id, createdAt: createdAt, runtimeVersion: runtimeVersion, status: status, metadata: metadata, url: url, headers: headers,
      launchAssetKey: launchAssetKey, assets: assets.compactMap { asset in asset["key"].flatMap { key in asset["extension"].map { (key: key, fileExtension: $0) } } }
    )
  }
}

/// What the next start launches: an update, or (nil) the bundle embedded in the app.
struct Selection {
  let update: StoredUpdate?
  let embeddedCreatedAt: Int64
  let emergencyReason: String?
}

struct StoreError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

/// The on-disk store, `<Application Support>/svelte-updates`:
///
///     index.json                       clientId, buildTime, embedded override, launch marker, failed ids, server metadata, updates
///     updates/<update id>/<bundle>     the launch asset of a committed update
///     assets/<key><extension>          every other asset, shared between updates, written only after its hash matched
///
/// The same layout and rules as the Android store (`UpdateStore.kt`). Every public method takes the store lock; files are written
/// to a temporary name and renamed.
final class UpdateStore {
  static let bundleName = "main.jsbundle"
  private static let maxFailedIds = 5
  private static let maxFailedRecords = 20
  private static let orphanAge: TimeInterval = 60 * 60
  private static let safeId = try! NSRegularExpression(pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

  private let root: URL
  private let lock = NSLock()
  private let fileManager = FileManager.default
  private var indexURL: URL { root.appendingPathComponent("index.json") }

  init(root: URL) { self.root = root }

  private struct Index {
    var clientId: String
    var buildTime: Int64
    var embeddedCreatedAt: Int64?
    /// The update a start is launching, until its first commit is reported. A marker found at the next start is a failed launch.
    var pending: String?
    var failedIds: [String]
    var serverDefinedHeaders: [String: Any]?
    var manifestFilters: [String: Any]?
    var updates: [String: StoredUpdate]
  }

  private func read() -> Index {
    guard
      let data = try? Data(contentsOf: indexURL),
      let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let clientId = json["clientId"] as? String,
      let stored = json["updates"] as? [String: [String: Any]]
    else {
      // No index yet, or one that cannot be read: start empty. The files of lost updates are removed by the next clean-up.
      return Index(clientId: UUID().uuidString.lowercased(), buildTime: 0, embeddedCreatedAt: nil, pending: nil, failedIds: [], serverDefinedHeaders: nil, manifestFilters: nil, updates: [:])
    }
    var updates: [String: StoredUpdate] = [:]
    for (id, entry) in stored { if let update = StoredUpdate(json: entry) { updates[id] = update } }
    return Index(
      clientId: clientId,
      buildTime: (json["buildTime"] as? NSNumber)?.int64Value ?? 0,
      embeddedCreatedAt: (json["embeddedCreatedAt"] as? NSNumber)?.int64Value,
      pending: (json["pending"] as? String).flatMap { $0.isEmpty ? nil : $0 },
      failedIds: json["failedIds"] as? [String] ?? [],
      serverDefinedHeaders: json["serverDefinedHeaders"] as? [String: Any],
      manifestFilters: json["manifestFilters"] as? [String: Any],
      updates: updates
    )
  }

  private func write(_ index: Index) throws {
    var json: [String: Any] = [
      "version": 1, "clientId": index.clientId, "buildTime": index.buildTime, "failedIds": index.failedIds,
      "updates": index.updates.mapValues { $0.json },
    ]
    if let value = index.embeddedCreatedAt { json["embeddedCreatedAt"] = value }
    if let value = index.pending { json["pending"] = value }
    if let value = index.serverDefinedHeaders { json["serverDefinedHeaders"] = value }
    if let value = index.manifestFilters { json["manifestFilters"] = value }
    try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    let data = try JSONSerialization.data(withJSONObject: json)
    // Atomic: the data goes to a temporary file that replaces the index in one step.
    try data.write(to: indexURL, options: .atomic)
  }

  private var updatesDirectory: URL { root.appendingPathComponent("updates") }
  private var assetsDirectory: URL { root.appendingPathComponent("assets") }

  func bundleFile(_ update: StoredUpdate) -> URL { updatesDirectory.appendingPathComponent(update.id).appendingPathComponent(Self.bundleName) }
  func assetFile(key: String, fileExtension: String) -> URL { assetsDirectory.appendingPathComponent(key + fileExtension) }

  /// Ids name directories, so only the UUIDs the protocol uses are accepted.
  private func isSafe(id: String) -> Bool { Self.safeId.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil }

  func bundleDestination(updateId: String) throws -> URL {
    guard isSafe(id: updateId) else { throw StoreError("Unsafe update id: \(updateId)") }
    return updatesDirectory.appendingPathComponent(updateId).appendingPathComponent(Self.bundleName)
  }

  func clientId() throws -> String {
    lock.lock(); defer { lock.unlock() }
    let index = read()
    if !fileManager.fileExists(atPath: indexURL.path) { try write(index) }
    return index.clientId
  }

  /// Picks what this start launches: the newest ready update for the build's runtime version, update URL and channel that passes the
  /// server's filters and is newer than the embedded bundle; otherwise the embedded bundle. An update still marked as launching never
  /// reached its first commit, so it is marked failed first (`markFailure`; a reload within a run does not mark).
  func select(config: UpdatesConfig, buildTime: Int64, markFailure: Bool) throws -> Selection {
    lock.lock(); defer { lock.unlock() }
    var index = read()
    var changed = false
    // A new binary has a new embedded bundle; a rollback directive applied to the old one says nothing about it.
    if index.buildTime != buildTime {
      index.buildTime = buildTime
      index.embeddedCreatedAt = nil
      changed = true
    }
    var reason: String?
    if markFailure, let pending = index.pending {
      markFailed(&index, id: pending)
      reason = "Update \(pending) did not reach its first commit"
      changed = true
    }
    if index.pending != nil { index.pending = nil; changed = true }
    let embeddedCreatedAt = index.embeddedCreatedAt ?? buildTime
    let newest = index.updates.values
      .filter {
        $0.status == "ready" && $0.runtimeVersion == config.runtimeVersion && $0.url == config.updateUrl && $0.headers == config.requestHeaders
          && matchesFilters($0.metadata, index.manifestFilters) && fileManager.fileExists(atPath: bundleFile($0).path)
      }
      .max { $0.createdAt < $1.createdAt }
    let chosen = newest.flatMap { $0.createdAt > embeddedCreatedAt ? $0 : nil }
    if let chosen { index.pending = chosen.id; changed = true }
    if changed || !fileManager.fileExists(atPath: indexURL.path) { try write(index) }
    return Selection(update: chosen, embeddedCreatedAt: embeddedCreatedAt, emergencyReason: reason)
  }

  private func markFailed(_ index: inout Index, id: String) {
    index.updates[id]?.status = "failed"
    index.failedIds.removeAll { $0 == id }
    index.failedIds.append(id)
    while index.failedIds.count > Self.maxFailedIds { index.failedIds.removeFirst() }
  }

  /// Same rule as the protocol client: a filtered key that the update's metadata also has must agree (keys compared lowercase).
  private func matchesFilters(_ metadata: [String: Any], _ filters: [String: Any]?) -> Bool {
    guard let filters else { return true }
    let lowered = Dictionary(metadata.map { ($0.key.lowercased(), $0.value) }, uniquingKeysWith: { first, _ in first })
    for (key, expected) in filters {
      guard let own = lowered[key] else { continue }
      if !(own as AnyObject).isEqual(expected as AnyObject) { return false }
    }
    return true
  }

  func commit(_ update: StoredUpdate) throws {
    lock.lock(); defer { lock.unlock() }
    guard isSafe(id: update.id) else { throw StoreError("Unsafe update id: \(update.id)") }
    // Only an update whose every file is in place becomes launchable.
    guard fileManager.fileExists(atPath: bundleFile(update).path) else { throw StoreError("Update \(update.id) has no bundle") }
    for asset in update.assets where asset.key != update.launchAssetKey {
      guard fileManager.fileExists(atPath: assetFile(key: asset.key, fileExtension: asset.fileExtension).path) else {
        throw StoreError("Update \(update.id) is missing asset \(asset.key)\(asset.fileExtension)")
      }
    }
    var index = read()
    index.updates[update.id] = update
    try write(index)
  }

  /// A response that carried a header replaces what was stored for it; one without it leaves the stored value, as expo-updates does.
  func saveMetadata(serverDefinedHeaders: [String: Any]?, manifestFilters: [String: Any]?) throws {
    lock.lock(); defer { lock.unlock() }
    var index = read()
    if let serverDefinedHeaders { index.serverDefinedHeaders = serverDefinedHeaders }
    if let manifestFilters { index.manifestFilters = manifestFilters }
    try write(index)
  }

  func rollBackToEmbedded(commitTime: Int64) throws {
    lock.lock(); defer { lock.unlock() }
    var index = read()
    if commitTime > (index.embeddedCreatedAt ?? index.buildTime) { index.embeddedCreatedAt = commitTime }
    try write(index)
  }

  /// The index as the JavaScript client reads it: no file names, and the embedded bundle's effective commit time.
  func snapshot(buildTime: Int64) throws -> String {
    lock.lock(); defer { lock.unlock() }
    let index = read()
    let updates = index.updates.mapValues { update -> [String: Any] in
      ["id": update.id, "createdAt": update.createdAt, "runtimeVersion": update.runtimeVersion, "status": update.status, "metadata": update.metadata]
    }
    let serverDefinedHeaders: Any = index.serverDefinedHeaders ?? NSNull()
    let manifestFilters: Any = index.manifestFilters ?? NSNull()
    let json: [String: Any] = [
      "embeddedCreatedAt": index.embeddedCreatedAt ?? buildTime,
      "updates": updates,
      "failedIds": index.failedIds,
      "metadata": ["serverDefinedHeaders": serverDefinedHeaders, "manifestFilters": manifestFilters] as [String: Any],
    ]
    return String(decoding: try JSONSerialization.data(withJSONObject: json), as: UTF8.self)
  }

  /// The launch reached its first commit.
  func markLaunched(id: String) throws {
    lock.lock(); defer { lock.unlock() }
    var index = read()
    if index.pending == id {
      index.pending = nil
      try write(index)
    }
  }

  /// Removes what nothing will launch: failed updates' files, updates that are neither the launched one, newer than it, nor the
  /// newest older one (kept so a rollback is quick), directories the index does not know, and assets no kept update lists.
  func clean(launchedCreatedAt: Int64) throws {
    lock.lock(); defer { lock.unlock() }
    var index = read()
    let ready = index.updates.values.filter { $0.status == "ready" }
    let newestOlder = ready.filter { $0.createdAt < launchedCreatedAt }.max { $0.createdAt < $1.createdAt }
    let kept = ready.filter { $0.createdAt >= launchedCreatedAt || $0.id == newestOlder?.id }
    let keptIds = Set(kept.map(\.id))
    for update in ready where !keptIds.contains(update.id) { index.updates[update.id] = nil }
    let failed = index.updates.values.filter { $0.status == "failed" }.sorted { $0.createdAt < $1.createdAt }
    for update in failed.dropLast(Self.maxFailedRecords) { index.updates[update.id] = nil }
    try write(index)
    // Files the index does not know may belong to a download in progress, so they go only once they are old.
    let now = Date()
    func isStale(_ url: URL) -> Bool {
      let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? now
      return now.timeIntervalSince(modified) > Self.orphanAge
    }
    for directory in (try? fileManager.contentsOfDirectory(at: updatesDirectory, includingPropertiesForKeys: nil)) ?? [] {
      let known = index.updates[directory.lastPathComponent]
      if known?.status != "ready" && (known != nil || isStale(directory)) { try? fileManager.removeItem(at: directory) }
    }
    let referenced = Set(kept.flatMap { update in update.assets.map { $0.key + $0.fileExtension } })
    for file in (try? fileManager.contentsOfDirectory(at: assetsDirectory, includingPropertiesForKeys: nil)) ?? [] {
      if !referenced.contains(file.lastPathComponent) && isStale(file) { try? fileManager.removeItem(at: file) }
    }
  }
}
