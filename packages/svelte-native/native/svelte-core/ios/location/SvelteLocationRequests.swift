import CoreLocation
import Foundation

// What the module asks of CoreLocation. Everything here runs on the main thread: a `CLLocationManager` delivers to the run loop of the thread that made it, and the module runs its calls on the main
// queue. Each position request and each watch has a manager of its own, so that one's accuracy and distance filter never change another's, and a stopped watch takes nothing else with it.
// A manager's delegate is weak, so each of these objects is kept by whoever started it until it is done.

extension SvelteLocationAccuracy {
  /// What each word asks of CoreLocation: `balanced` is the radius of a city block, which Wi-Fi and the cell network give; `high` asks for the GPS.
  var coreLocation: CLLocationAccuracy {
    switch self {
    case .balanced: return kCLLocationAccuracyHundredMeters
    case .high: return kCLLocationAccuracyNearestTenMeters
    }
  }
}

extension SvelteLocationFix {
  init(_ location: CLLocation) {
    self.init(
      latitude: location.coordinate.latitude,
      longitude: location.coordinate.longitude,
      altitude: location.altitude,
      horizontalAccuracy: location.horizontalAccuracy,
      verticalAccuracy: location.verticalAccuracy,
      course: location.course,
      speed: location.speed,
      timestamp: location.timestamp.timeIntervalSince1970
    )
  }

  /// The newest valid fix of a batch the manager delivered: the last one, where the device is now (what came while the app was not looking is older).
  static func newest(of locations: [CLLocation]) -> SvelteLocationFix? {
    for location in locations.reversed() {
      let fix = SvelteLocationFix(location)
      if fix.isValid { return fix }
    }
    return nil
  }
}

extension SvelteLocationFailure {
  init(_ error: Error) {
    let bridged = error as NSError
    self = SvelteLocationFailure.coreLocation(domain: bridged.domain, code: bridged.code, message: bridged.localizedDescription)
  }
}

/// The question of the permission: one `CLLocationManager` asks `requestWhenInUseAuthorization` and every caller that came meanwhile gets the answer. iOS shows its dialog once; a user who answered before
/// (or a restriction) gets that answer at once, and no dialog.
final class SvelteLocationAsker: NSObject, CLLocationManagerDelegate {
  private var manager: CLLocationManager?
  private var waiting: [(SvelteLocationPermission) -> Void] = []

  /// The state, without asking.
  static func state() -> SvelteLocationPermission {
    SvelteLocationPermission.from(authorization: CLLocationManager().authorizationStatus.rawValue)
  }

  func ask(_ done: @escaping (SvelteLocationPermission) -> Void) {
    let current = SvelteLocationAsker.state()
    if current.status != "undetermined" {
      done(current)
      return
    }
    waiting.append(done)
    if manager == nil {
      let asking = CLLocationManager()
      manager = asking
      asking.delegate = self
      asking.requestWhenInUseAuthorization()
    }
  }

  /// Also called once as the delegate is set, with the state as it was: not an answer until it is not "undetermined".
  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard manager === self.manager else { return }
    let state = SvelteLocationPermission.from(authorization: manager.authorizationStatus.rawValue)
    if state.status == "undetermined" { return }
    let callbacks = waiting
    waiting = []
    self.manager = nil
    manager.delegate = nil
    for callback in callbacks { callback(state) }
  }
}

/// One position, from `requestLocation`: the manager makes a single fix at the accuracy it was given and reports it, or why it could not.
final class SvelteLocationOneShot: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var completion: ((Result<SvelteLocationFix, SvelteLocationFailure>) -> Void)?

  func start(accuracy: SvelteLocationAccuracy, completion: @escaping (Result<SvelteLocationFix, SvelteLocationFailure>) -> Void) {
    self.completion = completion
    manager.delegate = self
    manager.desiredAccuracy = accuracy.coreLocation
    manager.requestLocation()
  }

  /// Ends the request and answers nothing (the module is going).
  func cancel() {
    manager.stopUpdatingLocation()
    manager.delegate = nil
    completion = nil
  }

  private func finish(_ result: Result<SvelteLocationFix, SvelteLocationFailure>) {
    let done = completion
    completion = nil
    manager.delegate = nil
    done?(result)
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    if let fix = SvelteLocationFix.newest(of: locations) {
      finish(.success(fix))
    } else {
      finish(.failure(.unavailable("Current location is unavailable")))
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    finish(.failure(SvelteLocationFailure(error)))
  }
}

/// One watch: `startUpdatingLocation` at the accuracy and distance filter it was given, with every position reported, and the errors that are not the passing `locationUnknown`.
final class SvelteLocationWatch: NSObject, CLLocationManagerDelegate {
  let id: Int
  private let manager = CLLocationManager()
  private let onFix: (Int, SvelteLocationFix) -> Void
  private let onError: (Int, String) -> Void

  init(id: Int, onFix: @escaping (Int, SvelteLocationFix) -> Void, onError: @escaping (Int, String) -> Void) {
    self.id = id
    self.onFix = onFix
    self.onError = onError
  }

  func start(accuracy: SvelteLocationAccuracy, distanceInterval: Double) {
    manager.delegate = self
    manager.desiredAccuracy = accuracy.coreLocation
    manager.distanceFilter = distanceInterval > 0 ? distanceInterval : kCLDistanceFilterNone
    // Foreground only (no background mode is asked for), and no pausing: a watch reports every position, as a browser's does, even from a device that stands still.
    manager.pausesLocationUpdatesAutomatically = false
    manager.startUpdatingLocation()
  }

  func stop() {
    manager.stopUpdatingLocation()
    manager.delegate = nil
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let fix = SvelteLocationFix.newest(of: locations) else { return }
    onFix(id, fix)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    let bridged = error as NSError
    // `locationUnknown` passes by itself (the manager keeps trying); it is common on a simulator with no location set.
    if SvelteLocationFailure.isTransient(domain: bridged.domain, code: bridged.code) { return }
    onError(id, bridged.localizedDescription)
  }
}

/// What the module holds: the question of the permission, the positions that are awaited and the watches that run, and what ends them all.
final class SvelteLocationCenter {
  private let asker = SvelteLocationAsker()
  private var oneShots: [ObjectIdentifier: SvelteLocationOneShot] = [:]
  private let watches = SvelteLocationWatches<SvelteLocationWatch>()
  private let onFix: (Int, SvelteLocationFix) -> Void
  private let onError: (Int, String) -> Void

  init(onFix: @escaping (Int, SvelteLocationFix) -> Void, onError: @escaping (Int, String) -> Void) {
    self.onFix = onFix
    self.onError = onError
  }

  func permission() -> SvelteLocationPermission {
    SvelteLocationAsker.state()
  }

  func requestPermission(_ done: @escaping (SvelteLocationPermission) -> Void) {
    asker.ask(done)
  }

  func currentPosition(accuracy: SvelteLocationAccuracy, done: @escaping (Result<SvelteLocationFix, SvelteLocationFailure>) -> Void) {
    let shot = SvelteLocationOneShot()
    let key = ObjectIdentifier(shot)
    oneShots[key] = shot
    shot.start(accuracy: accuracy) { [weak self] result in
      self?.oneShots[key] = nil
      done(result)
    }
  }

  /// The last position the system has, when it is no older than `maxAgeMs`; nil when there is none.
  func lastKnownPosition(maxAgeMs: Double?) -> SvelteLocationFix? {
    guard let location = CLLocationManager().location else { return nil }
    let fix = SvelteLocationFix(location)
    guard fix.isValid, SvelteLocationAge.isYoung(timestamp: fix.timestamp, now: Date().timeIntervalSince1970, maxAgeMs: maxAgeMs) else { return nil }
    return fix
  }

  func startWatch(id: Int, accuracy: SvelteLocationAccuracy, distanceInterval: Double) {
    let watch = SvelteLocationWatch(id: id, onFix: onFix, onError: onError)
    watches.add(id, watch)?.stop()
    watch.start(accuracy: accuracy, distanceInterval: distanceInterval)
  }

  func stopWatch(id: Int) {
    watches.remove(id)?.stop()
  }

  /// Ends every watch and every request that waits for a position, and answers none of them: the module is going.
  func stopAll() {
    for watch in watches.removeAll() { watch.stop() }
    for shot in oneShots.values { shot.cancel() }
    oneShots.removeAll()
  }
}
