import ExpoModulesCore
import Foundation

/// What a call of the module answers in a build with location off (`SvelteLocationFlag`): SvelteCore is in every app, and JavaScript reads the module's `enabled` constant before it calls.
final class SvelteLocationDisabledException: Exception, @unchecked Sendable {
  init() {
    super.init(
      name: "SvelteLocationDisabled",
      description: "Location is off in this build: turn it on with capabilities.location in the @alfayez/svelte-native config plugin, and build again (the module's `enabled` constant says which)",
      code: "ERR_LOCATION_DISABLED"
    )
  }

  override var debugDescription: String { reason }
}

/// The module behind `navigator.geolocation` and `navigator.permissions` (`src/geolocation.ts`; the contract is SPEC.md's "Location"): the permission, the current position, the last known one,
/// and watches by the id JavaScript gives them, with the events `locationChanged` and `locationError`. It is a thin front for `SvelteLocationCenter` (`CLLocationManager`, no other framework:
/// nothing of CoreMotion); the payloads, the permission's mapping and the registry of watches are `SvelteLocationPayload.swift`'s, checked on the host.
///
/// The module is in every app, since it is part of SvelteCore, and the constant `enabled` says whether location is on in this build (the config plugin's `capabilities.location`, as the Info.plist
/// flag `SvelteLocationEnabled`). Off, it asks CoreLocation nothing and starts nothing; every call rejects with `ERR_LOCATION_DISABLED`. JavaScript does not call any of them.
///
/// Every call runs on the main queue, where the managers are made and deliver. `OnDestroy` ends every watch and every position still awaited, so that nothing keeps the GPS on for a JavaScript
/// that is gone. A user who allowed the approximate location only (iOS 14 and later) has a permission that is granted: the positions come with a larger radius.
public final class SvelteLocationModule: Module {
  private var center: SvelteLocationCenter?

  /// Made on the first call that needs it, on the main thread, once location is known to be on.
  private func location() -> SvelteLocationCenter {
    if let center { return center }
    let made = SvelteLocationCenter(
      onFix: { [weak self] id, fix in self?.sendEvent("locationChanged", ["watchId": id, "location": fix.payload()]) },
      onError: { [weak self] id, reason in self?.sendEvent("locationError", ["watchId": id, "reason": reason]) }
    )
    center = made
    return made
  }

  /// The refusal as JavaScript reads it: the promise is rejected with the failure's own code (`ERR_LOCATION_UNAUTHORIZED` is a refused permission), which `reject(_: Error)` would not keep.
  private func refuse(_ promise: Promise, _ failure: SvelteLocationFailure) {
    promise.reject(failure.code, failure.message)
  }

  /// Resolves with a value of a type only `Any?` knows (a dictionary of the payload, or nil for a position there is none of), where `Promise`'s generic `resolve` would have to choose.
  private func answer(_ promise: Promise, _ value: Any?) {
    promise.resolve(value)
  }

  public func definition() -> ModuleDefinition {
    Name("SvelteLocation")

    // Whether location is on in this build: the one thing JavaScript may ask of an app that has none.
    Constant("enabled") { SvelteLocationFlag.isEnabled }

    Events("locationChanged", "locationError")

    OnDestroy {
      DispatchQueue.main.async {
        self.center?.stopAll()
        self.center = nil
      }
    }

    // The system's state without asking: "undetermined", "denied" (iOS never asks twice, so `canAskAgain` is false) or "granted".
    AsyncFunction("permission") { (promise: Promise) in
      guard SvelteLocationFlag.isEnabled else { return promise.reject(SvelteLocationDisabledException()) }
      self.answer(promise, self.location().permission().payload())
    }.runOnQueue(.main)

    // Asks for the permission while the app is in use, and answers with the state after the user has. A user who has answered before is not asked again by iOS, and gets that answer.
    AsyncFunction("requestPermission") { (promise: Promise) in
      guard SvelteLocationFlag.isEnabled else { return promise.reject(SvelteLocationDisabledException()) }
      self.location().requestPermission { self.answer(promise, $0.payload()) }
    }.runOnQueue(.main)

    AsyncFunction("currentPosition") { (options: [String: Any], promise: Promise) in
      guard SvelteLocationFlag.isEnabled else { return promise.reject(SvelteLocationDisabledException()) }
      guard let accuracy = SvelteLocationAccuracy.parse(options["accuracy"]) else {
        return self.refuse(promise, SvelteLocationFailure.arguments("currentPosition takes { accuracy: \"balanced\" | \"high\" }"))
      }
      guard self.location().permission().granted else { return self.refuse(promise, .unauthorized) }
      self.location().currentPosition(accuracy: accuracy) { result in
        switch result {
        case .success(let fix): self.answer(promise, fix.payload())
        case .failure(let failure): self.refuse(promise, failure)
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("lastKnownPosition") { (options: [String: Any], promise: Promise) in
      guard SvelteLocationFlag.isEnabled else { return promise.reject(SvelteLocationDisabledException()) }
      guard self.location().permission().granted else { return self.refuse(promise, .unauthorized) }
      self.answer(promise, self.location().lastKnownPosition(maxAgeMs: SvelteLocationOptions.maxAge(options))?.payload())
    }.runOnQueue(.main)

    AsyncFunction("startWatch") { (watchId: Int, options: [String: Any], promise: Promise) in
      guard SvelteLocationFlag.isEnabled else { return promise.reject(SvelteLocationDisabledException()) }
      guard let accuracy = SvelteLocationAccuracy.parse(options["accuracy"]) else {
        return self.refuse(promise, SvelteLocationFailure.arguments("startWatch takes { accuracy: \"balanced\" | \"high\", distanceInterval?: meters }"))
      }
      guard self.location().permission().granted else { return self.refuse(promise, .unauthorized) }
      self.location().startWatch(id: watchId, accuracy: accuracy, distanceInterval: SvelteLocationOptions.distance(options))
      promise.resolve()
    }.runOnQueue(.main)

    AsyncFunction("stopWatch") { (watchId: Int, promise: Promise) in
      guard SvelteLocationFlag.isEnabled else { return promise.reject(SvelteLocationDisabledException()) }
      self.location().stopWatch(id: watchId)
      promise.resolve()
    }.runOnQueue(.main)
  }
}
