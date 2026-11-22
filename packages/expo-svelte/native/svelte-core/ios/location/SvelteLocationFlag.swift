// The whole of this file is compiled only when the config plugin turned location on (`SVELTE_LOCATION`, which SvelteCore.podspec adds from `expoSvelte.location` in ios/Podfile.properties.json): an app
// that did not turn it on has no location code, and no reference to CoreLocation, in its binary (App Store Connect refuses a binary that uses the API without a usage text).
#if SVELTE_LOCATION

import Foundation

/// Whether location is on in this build, as the Info.plist says at run time: the config plugin writes the boolean `SvelteLocationEnabled` when `capabilities.location` is set
/// (`locationInfoPlistFlag` in `src/capabilities.ts`) and takes it away without. The compile condition `SVELTE_LOCATION` is what keeps the code out of an app that did not turn location on;
/// this is the module's own answer, the constant `enabled` JavaScript reads before it calls (a build that compiled the code in and lost the flag is off, not half on). It imports only
/// Foundation, so that the host check compiles it alone.
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

#endif
