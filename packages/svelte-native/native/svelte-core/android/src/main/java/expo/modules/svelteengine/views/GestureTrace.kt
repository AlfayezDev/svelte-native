package expo.modules.svelteengine.views

import android.util.Log

/**
 * A per-event trace of how a touch is arbitrated between the engine's own views (the stack's edge swipe, a sheet's drag, a scroll
 * view) and react-native-gesture-handler (SPEC.md, "Gestures", "Android arbitration"). Off by default; `adb shell setprop
 * log.tag.SvelteGesture VERBOSE` turns it on for the next touch (read once per DOWN, so it can be flipped while the app runs) and
 * `adb logcat -s SvelteGesture` shows it. Costs one boolean read per event when off.
 */
internal object GestureTrace {
  const val TAG = "SvelteGesture"
  @JvmField var on = false

  /** Called at every DOWN. */
  fun refresh() { on = Log.isLoggable(TAG, Log.VERBOSE) }

  inline fun log(message: () -> String) { if (on) Log.i(TAG, message()) }
}
