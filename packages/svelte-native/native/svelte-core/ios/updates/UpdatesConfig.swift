import Foundation

/// The build's updates configuration, read from `Expo.plist`, which Expo's config plugin writes from `updates` and
/// `runtimeVersion` in the app config (the keys expo-updates reads), so `expo prebuild` and EAS Build need nothing from this module.
struct UpdatesConfig {
  let enabled: Bool
  let updateUrl: String?
  let runtimeVersion: String?
  let requestHeaders: [String: String]
  let checkOnLaunch: String
  let launchWaitMs: Int
  let hasEmbeddedUpdate: Bool

  private static let checkModes: Set<String> = ["ALWAYS", "NEVER", "WIFI_ONLY", "ERROR_RECOVERY_ONLY"]

  static func read() -> UpdatesConfig {
    let path = Bundle.main.path(forResource: "Expo", ofType: "plist")
    let plist = path.flatMap { NSDictionary(contentsOfFile: $0) as? [String: Any] } ?? [:]
    let url = (plist["EXUpdatesURL"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let runtimeVersion = (plist["EXUpdatesRuntimeVersion"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    // A debug build runs from Metro, so there is nothing to launch or fetch.
    #if DEBUG
    let debuggable = true
    #else
    let debuggable = false
    #endif
    let mode = plist["EXUpdatesCheckOnLaunch"] as? String
    return UpdatesConfig(
      enabled: (plist["EXUpdatesEnabled"] as? Bool ?? false) && url != nil && runtimeVersion != nil && !debuggable,
      updateUrl: url,
      runtimeVersion: runtimeVersion,
      requestHeaders: plist["EXUpdatesRequestHeaders"] as? [String: String] ?? [:],
      checkOnLaunch: mode.flatMap { checkModes.contains($0) ? $0 : nil } ?? "ALWAYS",
      launchWaitMs: plist["EXUpdatesLaunchWaitMs"] as? Int ?? 0,
      hasEmbeddedUpdate: plist["EXUpdatesHasEmbeddedUpdate"] as? Bool ?? true
    )
  }
}
