// The whole of this file is compiled only when the config plugin turned location on (`SVELTE_LOCATION`, which SvelteCore.podspec adds from `expoSvelte.location` in ios/Podfile.properties.json): an app
// that did not turn it on has no location code, and no reference to CoreLocation, in its binary (App Store Connect refuses a binary that uses the API without a usage text).
#if SVELTE_LOCATION

import Foundation

// What the module decides and says without CoreLocation: the words JavaScript sends for the accuracy, the payload of a position, the permission's state, the refusals, the age of a
// position, the options of a call, and the registry of watches. Foundation only, so that the host check (`test/ios/location.sh`) compiles this file with a plain `swiftc`, on any Mac.

/// How precise a request asks to be: the one word JavaScript sends (`Accuracy` in `src/geolocation.ts`). `SvelteLocationRequests.swift` says what each asks of CoreLocation.
enum SvelteLocationAccuracy: String {
  /// About a city block: Wi-Fi and the cell network are enough (`kCLLocationAccuracyHundredMeters`).
  case balanced
  /// The GPS (`kCLLocationAccuracyNearestTenMeters`; `enableHighAccuracy` on the web).
  case high

  static func parse(_ value: Any?) -> SvelteLocationAccuracy? {
    guard let word = value as? String else { return nil }
    return SvelteLocationAccuracy(rawValue: word)
  }
}

/// A position as CoreLocation reports it, before it is a payload: plain numbers, so that this file needs no CoreLocation (`SvelteLocationRequests.swift` makes one from a `CLLocation`).
struct SvelteLocationFix: Equatable {
  var latitude: Double
  var longitude: Double
  var altitude: Double
  /// The radius of the fix, in meters; negative when the latitude and longitude are not valid.
  var horizontalAccuracy: Double
  /// The accuracy of the altitude, in meters; negative when the altitude is not valid.
  var verticalAccuracy: Double
  /// Degrees from true north; negative when the direction is not valid.
  var course: Double
  /// Meters per second; negative when the speed is not valid.
  var speed: Double
  /// Seconds since the epoch.
  var timestamp: Double

  /// iOS says a fix is not valid with a negative horizontal accuracy; a fix that is not a place is not one either.
  var isValid: Bool {
    horizontalAccuracy >= 0 && latitude.isFinite && longitude.isFinite
  }

  /// `NativeLocation` in `src/geolocation.ts`: `coords` with `latitude` and `longitude`, and what iOS has of `altitude` with its `altitudeAccuracy`, `accuracy`, `heading` and `speed`,
  /// and the `timestamp` in milliseconds since the epoch. What iOS marks invalid with a negative number (-1) is left out, so JavaScript reads `undefined`.
  func payload() -> [String: Any] {
    var coords: [String: Any] = ["latitude": latitude, "longitude": longitude]
    if horizontalAccuracy >= 0 { coords["accuracy"] = horizontalAccuracy }
    // An altitude is the platform's own only with a vertical accuracy.
    if verticalAccuracy >= 0, altitude.isFinite {
      coords["altitude"] = altitude
      coords["altitudeAccuracy"] = verticalAccuracy
    }
    if course >= 0, course.isFinite { coords["heading"] = course }
    if speed >= 0, speed.isFinite { coords["speed"] = speed }
    return ["coords": coords, "timestamp": (timestamp * 1000).rounded()]
  }
}

/// The permission as JavaScript reads it (`NativePermission` in `src/geolocation.ts`): `status`, `granted` and `canAskAgain`.
struct SvelteLocationPermission: Equatable {
  var status: String
  var canAskAgain: Bool

  var granted: Bool { status == "granted" }

  /// From `CLAuthorizationStatus.rawValue`: 0 not determined, 1 restricted, 2 denied, 3 authorized always, 4 authorized when in use. Either grant is a grant (a user who allowed the
  /// approximate location only is not refused: iOS still gives positions, with a larger radius). iOS never asks twice, so a refusal, and a restriction (parental controls), cannot be asked again.
  static func from(authorization raw: Int32) -> SvelteLocationPermission {
    switch raw {
    case 0: return SvelteLocationPermission(status: "undetermined", canAskAgain: true)
    case 3, 4: return SvelteLocationPermission(status: "granted", canAskAgain: true)
    default: return SvelteLocationPermission(status: "denied", canAskAgain: false)
    }
  }

  func payload() -> [String: Any] {
    ["status": status, "granted": granted, "canAskAgain": canAskAgain]
  }
}

/// A refusal JavaScript is told about: the `code` of the rejected promise (`src/geolocation.ts` reads `ERR_LOCATION_UNAUTHORIZED` as `PERMISSION_DENIED`, the rest as `POSITION_UNAVAILABLE`)
/// and what the app may show. The same codes as on Android (`LocationFailures`).
struct SvelteLocationFailure: Equatable, Error {
  var code: String
  var message: String

  static let unauthorized = SvelteLocationFailure(code: "ERR_LOCATION_UNAUTHORIZED", message: "Not authorized to use location services")

  static func unavailable(_ message: String) -> SvelteLocationFailure {
    SvelteLocationFailure(code: "ERR_LOCATION_UNAVAILABLE", message: message)
  }

  static func arguments(_ message: String) -> SvelteLocationFailure {
    SvelteLocationFailure(code: "ERR_LOCATION_ARGUMENTS", message: message)
  }

  static let coreLocationDomain = "kCLErrorDomain"

  /// CoreLocation's `denied` (1): the user refused, or location services are off for the app.
  static let coreLocationDenied = 1

  /// CoreLocation's `locationUnknown` (0): no position right now, and the manager keeps trying. A watch does not report it.
  static let coreLocationUnknown = 0

  /// What a CoreLocation error is for JavaScript: a refusal of the permission, or a position that could not be had, with the system's own words.
  static func coreLocation(domain: String, code: Int, message: String) -> SvelteLocationFailure {
    if domain == coreLocationDomain && code == coreLocationDenied { return unauthorized }
    return unavailable(message.isEmpty ? "Current location is unavailable" : message)
  }

  /// Whether a CoreLocation error is the one that passes by itself.
  static func isTransient(domain: String, code: Int) -> Bool {
    domain == coreLocationDomain && code == coreLocationUnknown
  }
}

/// The options of a call, as JavaScript sends them: its numbers arrive as doubles or as integers, and anything else is no number.
enum SvelteLocationOptions {
  static func number(_ value: Any?) -> Double? {
    if let double = value as? Double { return double.isNaN ? nil : double }
    if let integer = value as? Int { return Double(integer) }
    return nil
  }

  /// `{ maxAge }` of a `lastKnownPosition`, in milliseconds: none is no limit, and a negative one is 0 (only a position from this instant is young enough).
  static func maxAge(_ options: [String: Any]) -> Double? {
    guard let age = number(options["maxAge"]) else { return nil }
    return max(0, age)
  }

  /// `{ distanceInterval }` of a watch, in meters: none is 0, every position.
  static func distance(_ options: [String: Any]) -> Double {
    max(0, number(options["distanceInterval"]) ?? 0)
  }
}

enum SvelteLocationAge {
  /// Whether a position taken at `timestamp` (seconds since the epoch) is young enough for `maxAgeMs` (none: any age). A position from the future (the clock was set back) is young.
  static func isYoung(timestamp: Double, now: Double, maxAgeMs: Double?) -> Bool {
    guard let maxAgeMs else { return true }
    return (now - timestamp) * 1000 <= maxAgeMs
  }
}

/// The watches that run, by the id JavaScript gave them: one registry for the module, so that stopping a watch, replacing one with the same id (a JavaScript that started again and counts
/// from 1 once more) and stopping them all when the module goes are each one place. The handle is what stops it; this class never calls it, the caller does with what comes back.
final class SvelteLocationWatches<Handle: AnyObject> {
  private var handles: [Int: Handle] = [:]
  private var order: [Int] = []
  private let lock = NSLock()

  /// Registers the watch; the handle it replaces, if the id had one, is returned for the caller to stop.
  func add(_ id: Int, _ handle: Handle) -> Handle? {
    lock.lock()
    defer { lock.unlock() }
    let replaced = handles[id]
    if replaced == nil { order.append(id) }
    handles[id] = handle
    return replaced
  }

  /// Takes the watch out, and returns its handle, or nil for an id that does not run.
  func remove(_ id: Int) -> Handle? {
    lock.lock()
    defer { lock.unlock() }
    guard let handle = handles.removeValue(forKey: id) else { return nil }
    order.removeAll { $0 == id }
    return handle
  }

  func contains(_ id: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return handles[id] != nil
  }

  var count: Int {
    lock.lock()
    defer { lock.unlock() }
    return handles.count
  }

  /// Every handle, in the order they were added, and the registry empty.
  func removeAll() -> [Handle] {
    lock.lock()
    defer { lock.unlock() }
    let all = order.compactMap { handles[$0] }
    handles.removeAll()
    order.removeAll()
    return all
  }
}

#endif
