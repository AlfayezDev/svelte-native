import Foundation

/// Whether location is on in this build. This code is part of SvelteCore, which is in every app, so everything it does starts from this answer: the config plugin writes the Info.plist
/// boolean `SvelteLocationEnabled` when `capabilities.location` is set (`locationInfoPlistFlag` in `src/capabilities.ts`) and takes it away without. Off, the module asks CoreLocation
/// nothing and starts nothing, and its calls are refused (`SvelteLocationDisabledException`); JavaScript reads the module's `enabled` constant before it calls. It imports only Foundation,
/// so that the host check compiles it alone.
enum SvelteLocationFlag {
  /// The Info.plist key the config plugin writes; the host check of the package (`tests/native-host/contracts/location-ios.test.ts`) compares the two spellings.
  static let infoPlistKey = "SvelteLocationEnabled"

  /// Read once: the Info.plist of a build cannot change while it runs.
  static let isEnabled: Bool = isOn(Bundle.main.object(forInfoDictionaryKey: infoPlistKey))

  /// Only the boolean `true` is on: a text, a number or no entry is off.
  static func isOn(_ value: Any?) -> Bool {
    (value as? Bool) == true
  }
}
