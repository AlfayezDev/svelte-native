import Foundation

/// Whether push is on in this build. This code is part of SvelteCore, which is in every app, so everything it does starts from this answer: the config plugin writes the Info.plist
/// boolean `SveltePushEnabled` when `capabilities.push` names `ios` (`pushInfoPlistFlag` in `src/capabilities.ts`) and takes it away without. Off, the app delegate subscriber never
/// makes the center the notification center's delegate, never forwards a registration or a remote notification, and answers the system's fetch completion at once; the module attaches
/// nothing and its calls are refused; no other library's notifications are touched. It imports only Foundation, so that the host check compiles it alone.
enum SveltePushFlag {
  /// The Info.plist key the config plugin writes; the host check of the plugin (`tests/package/push-native.test.ts`) compares the two spellings.
  static let infoPlistKey = "SveltePushEnabled"

  /// Read once: the Info.plist of a build cannot change while it runs.
  static let isEnabled: Bool = isOn(Bundle.main.object(forInfoDictionaryKey: infoPlistKey))

  /// Only the boolean `true` is on: a text, a number or no entry is off.
  static func isOn(_ value: Any?) -> Bool {
    (value as? Bool) == true
  }
}
