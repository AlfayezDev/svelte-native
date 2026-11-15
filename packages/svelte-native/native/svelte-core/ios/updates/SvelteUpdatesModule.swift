import ExpoModulesCore
import React

/// The native half of the updates API (`packages/svelte-native/src/updates`): the store and the launcher. The protocol (what to ask
/// the server, what counts as a newer update) runs in JavaScript; this module hands it the stored state, makes the requests and
/// downloads, and records the outcome. Same contract as the Android module; see the "Updates" section of `svelte-core/SPEC.md`.
public final class SvelteUpdatesModule: Module {
  // Network and disk work stays off the JavaScript thread and off the shared module queue.
  private let workers = DispatchQueue(label: "svelte.updates.workers", qos: .utility, attributes: .concurrent)

  private func state() -> LaunchState { Launch.get() }

  private func store() throws -> UpdateStore {
    guard let store = state().store else { throw StoreError("SvelteUpdates is not enabled in this build") }
    return store
  }

  private func background(_ promise: Promise, _ work: @escaping () throws -> Any?) {
    workers.async {
      do {
        promise.resolve(try work())
      } catch {
        promise.reject("ERR_SVELTE_UPDATES", String(describing: error))
      }
    }
  }

  private func object(_ json: String) throws -> [String: Any] {
    guard let value = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { throw StoreError("Expected a JSON object") }
    return value
  }

  public func definition() -> ModuleDefinition {
    Name("SvelteUpdates")

    Constant("isEnabled") { self.state().config.enabled }
    Constant("platform") { "ios" }
    Constant("updateId") { self.state().updateId }
    Constant("runtimeVersion") { self.state().config.runtimeVersion }
    Constant("updateUrl") { self.state().config.updateUrl }
    Constant("requestHeaders") { self.state().config.requestHeaders }
    Constant("checkOnLaunch") { self.state().config.checkOnLaunch }
    Constant("launchWaitMs") { self.state().config.launchWaitMs }
    Constant("hasEmbeddedUpdate") { self.state().config.hasEmbeddedUpdate }
    Constant("isEmbeddedLaunch") { self.state().updateId == nil }
    Constant("createdAt") { Double(self.state().createdAt) }
    Constant("localAssets") { self.state().localAssets }
    Constant("clientId") { self.state().clientId }

    // The manifest request: a GET with the given headers; any status is an answer.
    AsyncFunction("request") { (url: String, headers: [String: String], promise: Promise) in
      self.background(promise) {
        let response = try Http.get(url, headers: headers)
        return ["status": response.status, "headers": response.headers, "body": response.body] as [String: Any]
      }
    }

    // Downloads one asset of an update. The launch asset becomes the update's bundle; the rest join the shared asset directory.
    AsyncFunction("downloadAsset") { (download: [String: Any], promise: Promise) in
      self.background(promise) {
        let store = try self.store()
        guard
          let key = download["key"] as? String, let fileExtension = download["extension"] as? String,
          let expected = download["hash"] as? String, let url = download["url"] as? String
        else { throw StoreError("Malformed asset download") }
        let name = try NSRegularExpression(pattern: "^[A-Za-z0-9._-]{1,128}$")
        let suffix = try NSRegularExpression(pattern: "^(\\.[A-Za-z0-9]{1,16})?$")
        guard
          name.firstMatch(in: key, range: NSRange(key.startIndex..., in: key)) != nil,
          suffix.firstMatch(in: fileExtension, range: NSRange(fileExtension.startIndex..., in: fileExtension)) != nil
        else { throw StoreError("Unsafe asset name: \(key)\(fileExtension)") }
        let launch = download["launch"] as? Bool ?? false
        let destination: URL
        if launch {
          destination = try store.bundleDestination(updateId: download["updateId"] as? String ?? "")
        } else {
          destination = store.assetFile(key: key, fileExtension: fileExtension)
        }
        // An asset already in place is kept only if it hashes to the manifest's; one that does not is downloaded again (see `Http.ensure`).
        let hash = try Http.ensure(url, headers: download["headers"] as? [String: String] ?? [:], to: destination, expectedHash: expected, reuse: !launch) { actual in
          NSLog("[SvelteUpdates] Asset %@%@ in the store has SHA-256 %@, not the manifest's %@; downloading it again", key, fileExtension, actual, expected)
        }
        return ["key": key, "hash": hash]
      }
    }

    // Makes a fully downloaded update launchable on the next start.
    AsyncFunction("commitUpdate") { (updateJson: String, promise: Promise) in
      self.background(promise) {
        let json = try self.object(updateJson)
        let config = self.state().config
        guard
          let id = json["id"] as? String, let createdAt = (json["createdAt"] as? NSNumber)?.int64Value,
          let runtimeVersion = json["runtimeVersion"] as? String, let metadata = json["metadata"] as? [String: Any],
          let launchAssetKey = json["launchAssetKey"] as? String, let assets = json["assets"] as? [[String: String]]
        else { throw StoreError("Malformed update") }
        try self.store().commit(StoredUpdate(
          id: id, createdAt: createdAt, runtimeVersion: runtimeVersion, status: "ready", metadata: metadata,
          url: config.updateUrl ?? "", headers: config.requestHeaders, launchAssetKey: launchAssetKey,
          assets: assets.compactMap { asset in asset["key"].flatMap { key in asset["extension"].map { (key: key, fileExtension: $0) } } }
        ))
        return nil
      }
    }

    AsyncFunction("saveMetadata") { (metadataJson: String, promise: Promise) in
      self.background(promise) {
        let json = try self.object(metadataJson)
        try self.store().saveMetadata(serverDefinedHeaders: json["serverDefinedHeaders"] as? [String: Any], manifestFilters: json["manifestFilters"] as? [String: Any])
        return nil
      }
    }

    AsyncFunction("readStore") { (promise: Promise) in
      self.background(promise) { try self.store().snapshot(buildTime: Launch.embeddedBuildTime()) }
    }

    AsyncFunction("rollBackToEmbedded") { (commitTime: Double, promise: Promise) in
      self.background(promise) {
        try self.store().rollBackToEmbedded(commitTime: Int64(commitTime))
        return nil
      }
    }

    // The first commit happened: the launch did not fail, and clean-up can run.
    AsyncFunction("markLaunched") { (promise: Promise) in
      self.background(promise) {
        let launched = self.state()
        if let id = launched.updateId { try launched.store?.markLaunched(id: id) }
        try launched.store?.clean(launchedCreatedAt: launched.createdAt)
        return nil
      }
    }

    // Selects the launch bundle again (an update committed since the start now wins) and restarts the React host with it.
    AsyncFunction("reload") { (promise: Promise) in
      self.background(promise) {
        _ = Launch.relaunch()
        DispatchQueue.main.async { RCTTriggerReloadCommandListeners("SvelteUpdates reload") }
        return nil
      }
    }
  }
}
