package expo.modules.sveltepush

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The module behind `@alfayez/svelte-native/push` (PUSH.md, "The native module's contract"): the permission, the token, showing a notification, the message a tap
 * launched the process with, and the events. This is the skeleton, which only registers the module so that the package installs, autolinks and compiles; phase 2
 * of the plan (Android native) fills it.
 */
class SveltePushModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SveltePush")
  }
}
