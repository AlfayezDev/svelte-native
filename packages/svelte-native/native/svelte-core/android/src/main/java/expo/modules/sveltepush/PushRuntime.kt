package expo.modules.sveltepush

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import android.util.Log

/** The tag of every line this module logs, so that `adb logcat -s SveltePush` shows all of it. */
internal const val LOG_TAG = "SveltePush"

/**
 * What lives as long as the process does, which is longer than the Expo module: the events with their kept backlog, the waits of the message that is being delivered,
 * the tap rule and the foreground count. Four things reach it, and any of them may come first: the `Application` (a lifecycle listener of the package, at
 * `Application.onCreate`), the Firebase service (a message can start the process), an Activity (a tap) and the module (JavaScript, which Expo creates lazily). Each
 * of them calls [install], which does its work once, and only when push is on in this build (`PushManifest.enabled`): this code is in every app, so an app that left push off never
 * gets a listener, a ledger or a callback from it.
 */
internal object PushRuntime {
  val events = PushEvents(log = { Log.w(LOG_TAG, it) })
  val shows = ShowGate()
  val waits = BackgroundWaits()
  val foreground = ForegroundTracker({ SystemClock.elapsedRealtime() })

  @Volatile
  private var taps: PushTaps? = null

  /** The tap rule, or null before [install], and for ever in a build with push off. */
  fun tapsOrNull(): PushTaps? = taps

  /**
   * Registers the foreground count and builds the tap rule, once. The count has to start at `Application.onCreate` to be exact: a registration that comes later
   * (the module, for a build whose `Application` does not run Expo's lifecycle listeners) misses an Activity that is already started.
   */
  @Synchronized
  fun install(application: Application) {
    if (taps != null) return
    if (!PushManifest.enabled(application)) return
    // A tap that is read twice (the two readers of `readLaunchTap`) is the normal case on a cold start, so the ledger's refusal is a debug line, not a warning.
    taps = PushTaps(events, TapLedger(PreferencesTapStore(application)), { Log.d(LOG_TAG, it) })
    application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(activity: Activity) {
        foreground.activityStarted()
      }

      override fun onActivityStopped(activity: Activity) {
        foreground.activityStopped(activity.isChangingConfigurations)
      }

      // Inside `Activity.onCreate`, before React's delegate starts the surface: the earliest point at which a tap is known (see `readLaunchTap`).
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        readLaunchTap(activity, savedInstanceState)
      }

      override fun onActivityResumed(activity: Activity) {}

      override fun onActivityPaused(activity: Activity) {}

      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

      override fun onActivityDestroyed(activity: Activity) {}
    })
  }
}

/** The ledger of tapped messages in the app's private preferences: one string, the ids one to a line (a message id has no line break). */
private class PreferencesTapStore(context: Context) : TapStore {
  private val preferences = context.getSharedPreferences("svelte_push", Context.MODE_PRIVATE)

  override fun load(): List<String> = preferences.getString(KEY, null)?.split('\n')?.filter { it.isNotEmpty() } ?: emptyList()

  override fun save(ids: List<String>) {
    preferences.edit().putString(KEY, ids.joinToString("\n")).apply()
  }

  private companion object {
    const val KEY = "tapped"
  }
}
