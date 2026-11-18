import Foundation

// Host check of what the iOS side of location says without CoreLocation: the words JavaScript sends for the accuracy, the payload of a position (what iOS marks invalid with a negative number is left
// out), the permission's state from `CLAuthorizationStatus`, the refusals, the options of a call, the age of a position, the registry of watches, and what turns the native code on
// (`SvelteLocationFlag`, from the Info.plist). Plain Foundation, no app and no phone: `location.sh` compiles it with the two Swift files as the program's `main.swift`.

var checks = 0
func expect<T: Equatable>(_ what: String, _ actual: T, _ wanted: T) {
  checks += 1
  if actual != wanted {
    FileHandle.standardError.write(Data("FAIL \(what): wanted \(wanted), got \(actual)\n".utf8))
    exit(1)
  }
}

/// The `coords` of a fix's payload, as numbers: a member that is not a number reads as NaN, which equals nothing, so a wrong type fails the comparison.
func coords(_ fix: SvelteLocationFix) -> [String: Double] {
  let raw = fix.payload()["coords"] as? [String: Any] ?? [:]
  return raw.mapValues { ($0 as? Double) ?? Double.nan }
}

// The accuracy: the two words of the contract.
expect("balanced", SvelteLocationAccuracy.parse("balanced"), .balanced)
expect("high", SvelteLocationAccuracy.parse("high"), .high)
for other in ["Balanced", "highest", "", "3"] { expect("\(other) is not an accuracy", SvelteLocationAccuracy.parse(other) == nil, true) }
expect("a number is not an accuracy", SvelteLocationAccuracy.parse(3) == nil, true)
expect("nothing is not an accuracy", SvelteLocationAccuracy.parse(nil) == nil, true)
expect("the words are the two JavaScript has", [SvelteLocationAccuracy.balanced.rawValue, SvelteLocationAccuracy.high.rawValue], ["balanced", "high"])

// A position iOS knows everything of.
let full = SvelteLocationFix(latitude: 24.7136, longitude: 46.6753, altitude: 612.5, horizontalAccuracy: 5, verticalAccuracy: 3, course: 90, speed: 1.5, timestamp: 1_800_000_000.1234)
expect("a full fix is valid", full.isValid, true)
expect(
  "a full fix, as JavaScript reads it",
  coords(full),
  ["latitude": 24.7136, "longitude": 46.6753, "altitude": 612.5, "accuracy": 5, "altitudeAccuracy": 3, "heading": 90, "speed": 1.5]
)
expect("the payload has coords and the timestamp, and nothing else", Set(full.payload().keys), Set(["coords", "timestamp"]))
expect("the timestamp is milliseconds, whole", full.payload()["timestamp"] as? Double, 1_800_000_000_123)

// iOS says -1 for what it does not know: left out, so that JavaScript reads undefined.
let partial = SvelteLocationFix(latitude: 1, longitude: 2, altitude: 0, horizontalAccuracy: 65, verticalAccuracy: -1, course: -1, speed: -1, timestamp: 1_800_000_000)
expect("a fix with no altitude, direction or speed", coords(partial), ["latitude": 1, "longitude": 2, "accuracy": 65])
expect("no member of it is a negative number", coords(partial).values.allSatisfy { $0 >= 0 }, true)
let still = SvelteLocationFix(latitude: 1, longitude: 2, altitude: 3, horizontalAccuracy: 5, verticalAccuracy: 2, course: -1, speed: 0, timestamp: 1_800_000_000)
expect("a speed of 0 is a speed, a direction of -1 is none", coords(still), ["latitude": 1, "longitude": 2, "accuracy": 5, "altitude": 3, "altitudeAccuracy": 2, "speed": 0])
let north = SvelteLocationFix(latitude: 1, longitude: 2, altitude: 0, horizontalAccuracy: 5, verticalAccuracy: -1, course: 0, speed: 4, timestamp: 1)
expect("a course of 0 is north, and is kept", coords(north)["heading"], 0)
let nothing = SvelteLocationFix(latitude: 1, longitude: 2, altitude: .nan, horizontalAccuracy: 5, verticalAccuracy: 2, course: .nan, speed: .infinity, timestamp: 1)
expect("a value that is not a number is none", coords(nothing), ["latitude": 1, "longitude": 2, "accuracy": 5])

// A fix that is not a place.
expect("a negative horizontal accuracy is no fix", SvelteLocationFix(latitude: 1, longitude: 2, altitude: 0, horizontalAccuracy: -1, verticalAccuracy: -1, course: -1, speed: -1, timestamp: 1).isValid, false)
expect("NaN coordinates are no fix", SvelteLocationFix(latitude: .nan, longitude: 2, altitude: 0, horizontalAccuracy: 5, verticalAccuracy: -1, course: -1, speed: -1, timestamp: 1).isValid, false)
expect("an accuracy of 0 is valid", SvelteLocationFix(latitude: 1, longitude: 2, altitude: 0, horizontalAccuracy: 0, verticalAccuracy: -1, course: -1, speed: -1, timestamp: 1).isValid, true)

// The permission, from CLAuthorizationStatus' raw values: 0 not determined, 1 restricted, 2 denied, 3 authorized always, 4 authorized when in use.
expect("not determined", SvelteLocationPermission.from(authorization: 0), SvelteLocationPermission(status: "undetermined", canAskAgain: true))
expect("restricted: denied, and not to be asked", SvelteLocationPermission.from(authorization: 1), SvelteLocationPermission(status: "denied", canAskAgain: false))
expect("denied: iOS never asks twice", SvelteLocationPermission.from(authorization: 2), SvelteLocationPermission(status: "denied", canAskAgain: false))
expect("always is granted", SvelteLocationPermission.from(authorization: 3), SvelteLocationPermission(status: "granted", canAskAgain: true))
expect("when in use is granted", SvelteLocationPermission.from(authorization: 4), SvelteLocationPermission(status: "granted", canAskAgain: true))
expect("a state iOS adds later is not a grant", SvelteLocationPermission.from(authorization: 9).granted, false)
let refusal = SvelteLocationPermission.from(authorization: 2).payload()
expect("what JavaScript reads", [refusal["status"] as? String, "\(refusal["granted"] as? Bool ?? true)", "\(refusal["canAskAgain"] as? Bool ?? true)"], ["denied", "false", "false"])
let grant = SvelteLocationPermission.from(authorization: 4).payload()
expect("what JavaScript reads of a grant", [grant["status"] as? String, "\(grant["granted"] as? Bool ?? false)", "\(grant["canAskAgain"] as? Bool ?? false)"], ["granted", "true", "true"])
expect("and nothing else", Set(grant.keys), Set(["status", "granted", "canAskAgain"]))

// The refusals: the codes are the module's, the same as on Android, and CoreLocation's `denied` is the one JavaScript reads as PERMISSION_DENIED.
expect("the unauthorized code", SvelteLocationFailure.unauthorized.code, "ERR_LOCATION_UNAUTHORIZED")
expect("the unavailable code", SvelteLocationFailure.unavailable("x").code, "ERR_LOCATION_UNAVAILABLE")
expect("the arguments code", SvelteLocationFailure.arguments("x").code, "ERR_LOCATION_ARGUMENTS")
expect("CoreLocation's denied", SvelteLocationFailure.coreLocation(domain: "kCLErrorDomain", code: 1, message: "The operation couldn't be completed."), SvelteLocationFailure.unauthorized)
expect("CoreLocation's network error", SvelteLocationFailure.coreLocation(domain: "kCLErrorDomain", code: 2, message: "The operation couldn't be completed. (kCLErrorDomain error 2.)"), SvelteLocationFailure.unavailable("The operation couldn't be completed. (kCLErrorDomain error 2.)"))
expect("a denied of another domain is not a refused permission", SvelteLocationFailure.coreLocation(domain: "NSURLErrorDomain", code: 1, message: "x").code, "ERR_LOCATION_UNAVAILABLE")
expect("an error with no words has some", SvelteLocationFailure.coreLocation(domain: "kCLErrorDomain", code: 2, message: "").message, "Current location is unavailable")
expect("locationUnknown passes by itself", SvelteLocationFailure.isTransient(domain: "kCLErrorDomain", code: 0), true)
expect("denied does not", SvelteLocationFailure.isTransient(domain: "kCLErrorDomain", code: 1), false)
expect("another domain's 0 does not", SvelteLocationFailure.isTransient(domain: "NSPOSIXErrorDomain", code: 0), false)

// The options of a call: numbers arrive as doubles or as integers.
expect("maxAge as a double", SvelteLocationOptions.maxAge(["maxAge": 120_000.0]), 120_000)
expect("maxAge as an integer", SvelteLocationOptions.maxAge(["maxAge": 5000]), 5000)
expect("maxAge as large as JavaScript's largest (2^32 - 1)", SvelteLocationOptions.maxAge(["maxAge": 4_294_967_295.0]), 4_294_967_295)
expect("no maxAge is no limit", SvelteLocationOptions.maxAge([:]) == nil, true)
expect("a negative maxAge is 0", SvelteLocationOptions.maxAge(["maxAge": -5.0]), 0)
expect("a maxAge that is not a number is none", SvelteLocationOptions.maxAge(["maxAge": "soon"]) == nil, true)
expect("NaN is none", SvelteLocationOptions.maxAge(["maxAge": Double.nan]) == nil, true)
expect("distanceInterval defaults to every position", SvelteLocationOptions.distance([:]), 0)
expect("distanceInterval in meters", SvelteLocationOptions.distance(["distanceInterval": 25.0]), 25)
expect("a negative distanceInterval is 0", SvelteLocationOptions.distance(["distanceInterval": -1]), 0)

// The age of a position.
let now = 1_800_000_000.0
expect("no limit: any age", SvelteLocationAge.isYoung(timestamp: now - 86_400, now: now, maxAgeMs: nil), true)
expect("inside the limit", SvelteLocationAge.isYoung(timestamp: now - 4.999, now: now, maxAgeMs: 5000), true)
expect("exactly at the limit", SvelteLocationAge.isYoung(timestamp: now - 5, now: now, maxAgeMs: 5000), true)
expect("past the limit", SvelteLocationAge.isYoung(timestamp: now - 5.001, now: now, maxAgeMs: 5000), false)
expect("limit 0: only this instant", SvelteLocationAge.isYoung(timestamp: now, now: now, maxAgeMs: 0), true)
expect("limit 0: a moment ago is old", SvelteLocationAge.isYoung(timestamp: now - 0.001, now: now, maxAgeMs: 0), false)
expect("a position from the future is young", SvelteLocationAge.isYoung(timestamp: now + 60, now: now, maxAgeMs: 1000), true)

// The registry of watches.
final class Token {
  let name: String
  init(_ name: String) { self.name = name }
}
let registry = SvelteLocationWatches<Token>()
let first = Token("first"), second = Token("second"), again = Token("again")
expect("a watch starts", registry.add(1, first) == nil, true)
expect("a second one", registry.add(2, second) == nil, true)
expect("the same id again replaces the watch and hands the old one back", registry.add(1, again) === first, true)
expect("two run", registry.count, 2)
expect("which are there", [registry.contains(1), registry.contains(2), registry.contains(3)], [true, true, false])
expect("a watch is stopped by its id", registry.remove(2) === second, true)
expect("an id that does not run has nothing to stop", registry.remove(2) == nil, true)
expect("one runs", registry.count, 1)
let c = Token("c"), d = Token("d"), e = Token("e")
_ = registry.add(3, c)
_ = registry.add(4, d)
_ = registry.add(5, e)
expect("every handle comes back, in the order they started (the replaced id keeps its place)", registry.removeAll().map { $0.name }, ["again", "c", "d", "e"])
expect("and the registry is empty", registry.count, 0)
expect("clearing it again has nothing", registry.removeAll().count, 0)

// What turns the native code on: only the boolean true.
expect("the Info.plist key", SvelteLocationFlag.infoPlistKey, "SvelteLocationEnabled")
expect("the flag is on", SvelteLocationFlag.isOn(true), true)
expect("no entry is off", SvelteLocationFlag.isOn(nil), false)
expect("false is off", SvelteLocationFlag.isOn(false), false)
expect("a text is not the boolean", SvelteLocationFlag.isOn("true"), false)
expect("a number is not the boolean", SvelteLocationFlag.isOn(1), false)
expect("this program has no such Info.plist entry", SvelteLocationFlag.isEnabled, false)

print("location: \(checks) checks passed")
