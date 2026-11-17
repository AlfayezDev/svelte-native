import ExpoModulesCore

/// Receives what iOS tells the app delegate about push: the device token (or the failure to get one) and the silent pushes. This is the skeleton, which handles
/// nothing; phase 3 of the plan (iOS native) fills it, with the module becoming the notification center's delegate in `didFinishLaunching` (PUSH.md, "iOS").
public final class SveltePushAppDelegateSubscriber: ExpoAppDelegateSubscriber {}
