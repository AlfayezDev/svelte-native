package expo.modules.sveltepush

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Reads a tap from the intent an Activity was created with. It is called from two places, which both see every creation: `PushRuntime`'s `ActivityLifecycleCallbacks`,
 * whose `onActivityCreated` runs inside `Activity.onCreate` before React's delegate starts the surface, so a tap is the launch message before JavaScript can ask for it,
 * and [PushTapListener], Expo's own hook, which is the way a build that never ran the application listener still learns of a tap. Whichever comes second reads the
 * same message id, and `PushTaps`'s ledger lets it through once.
 *
 * None of these intents is a tap, though each Activity holds the intent of one in `getIntent()`: an Activity that is made again (a rotation, a font scale) keeps its
 * first intent, one that the system restores after it killed the process has the intent it was launched with (and `MainActivity` passes `null` to `super.onCreate`, so
 * `savedInstanceState` does not always say so), and one that is brought back from the recents carries `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`. The first and the last are
 * skipped here; the ledger catches the rest.
 */
internal fun readLaunchTap(activity: Activity, savedInstanceState: Bundle?) {
  if (savedInstanceState != null) return
  val intent = activity.intent ?: return
  if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
  readTap(intent)
}

/**
 * Reads a tap from an intent: the one this module's own notification starts, or the one Firebase's notification starts when the system showed it with the app in the
 * background (`PushMapping.fromExtras` tells them apart, and an intent that is neither is not a tap). What a tap becomes (the launch message, or an `opened` event) and
 * the guard against reading the same tap twice are `PushTaps`'s.
 */
@Suppress("DEPRECATION")
internal fun readTap(intent: Intent) {
  val extras = try {
    intent.extras
  } catch (error: RuntimeException) {
    // Extras of a class this process cannot load (another app's intent) fail to unparcel; such an intent is not ours.
    Log.w(LOG_TAG, "the extras of an intent could not be read, so it is not treated as a notification tap: $error")
    null
  } ?: return
  val message = PushMapping.fromExtras(extras.keySet().associateWith { extras.get(it) }) ?: return
  PushRuntime.tapsOrNull()?.tapped(message)
}

/**
 * The tap on a notification, from Expo's `ReactActivityLifecycleListener`: when the Activity is created (the app was not running, or not showing) and in `onNewIntent`
 * (the app is running and the Activity is at the top, which `FLAG_ACTIVITY_SINGLE_TOP` and the app's `singleTask` `MainActivity` give). Expo's `ReactActivityDelegateWrapper`
 * calls it for every listener the autolinked packages made, so nothing is added to the app's `MainActivity`; `SveltePushPackage` makes this one.
 */
class PushTapListener : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    PushRuntime.install(activity.application)
    readLaunchTap(activity, savedInstanceState)
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    if (intent != null) readTap(intent)
    return false
  }
}
