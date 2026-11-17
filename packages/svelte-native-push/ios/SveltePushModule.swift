import ExpoModulesCore

/// The module behind `@alfayez/svelte-native/push` (PUSH.md, "The native module's contract"): the permission, the APNs device token, showing a notification, the
/// message a tap launched the process with, and the events. This is the skeleton, which only registers the module so that the package installs, autolinks and
/// compiles; phase 3 of the plan (iOS native) fills it.
public final class SveltePushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SveltePush")
  }
}
