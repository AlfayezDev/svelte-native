import Foundation

/// Which Apple Push Notification service the build's device tokens belong to: the `aps-environment` entitlement the app was signed with, `development` or `production`. The
/// sender picks the sandbox or the production endpoint by it (`PushToken.environment`), and a token sent to the wrong one is refused as a bad device token.
enum SveltePushEnvironment {
  /// The environment of this build, read once. At run time the entitlement is in the provisioning profile that came with the app (`embedded.mobileprovision`, whose
  /// `Entitlements` are what the app was signed with); Apple offers no call for the signed entitlements themselves.
  ///
  /// A build with no profile has two origins. On the simulator nothing is signed with a profile, and it delivers payloads from `xcrun simctl push` as a development
  /// build would, so it is `development`. On a device it can only be a build that came through the App Store or TestFlight, whose profile Apple removes, and those
  /// always use the production service.
  static let current: String = {
    guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") else {
      return SveltePushEnvironment.fallback
    }
    do {
      let profile = try Data(contentsOf: URL(fileURLWithPath: path))
      if let environment = SveltePushEnvironment.apsEnvironment(inProfile: profile) {
        return environment
      }
    } catch {
      NSLog("[SveltePush] the provisioning profile of this build could not be read: %@", String(describing: error))
    }
    NSLog("[SveltePush] the aps-environment of this build could not be read from its provisioning profile; assuming %@", SveltePushEnvironment.fallback)
    return SveltePushEnvironment.fallback
  }()

  /// What a build without a readable profile is taken to be: see `current`.
  private static var fallback: String {
#if targetEnvironment(simulator)
    return "development"
#else
    return "production"
#endif
  }

  /// The `aps-environment` of a provisioning profile, or nil, with the reason logged, when it has none. A profile is a signed message (CMS) around a property list; the list is
  /// stored in the clear, so it is found by its XML header and its closing tag and read as any property list, without verifying a signature that the system has already checked.
  static func apsEnvironment(inProfile profile: Data) -> String? {
    guard
      let start = profile.range(of: Data("<?xml".utf8)),
      let end = profile.range(of: Data("</plist>".utf8), in: start.lowerBound..<profile.endIndex)
    else {
      NSLog("[SveltePush] the provisioning profile of this build holds no property list")
      return nil
    }
    let list = Data(profile[start.lowerBound..<end.upperBound])
    let object: Any
    do {
      object = try PropertyListSerialization.propertyList(from: list, options: [], format: nil)
    } catch {
      NSLog("[SveltePush] the property list of the provisioning profile could not be read: %@", String(describing: error))
      return nil
    }
    guard
      let entitlements = (object as? [String: Any])?["Entitlements"] as? [String: Any],
      let environment = entitlements["aps-environment"] as? String,
      environment == "development" || environment == "production"
    else {
      NSLog("[SveltePush] the provisioning profile of this build grants no aps-environment")
      return nil
    }
    return environment
  }
}
