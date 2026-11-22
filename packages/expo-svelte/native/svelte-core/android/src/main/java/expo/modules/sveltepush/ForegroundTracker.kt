package expo.modules.sveltepush

/**
 * Whether the app is in the foreground, from the Activities of this process that are started: one or more started Activities is a visible app. That is the signal and
 * the only one: the count of `onActivityStarted` and `onActivityStopped` of an `Application.ActivityLifecycleCallbacks` registered at `Application.onCreate`
 * (`PushRuntime`), so it is exact from the first Activity of a process that was started for a screen and zero in one that was started for a message.
 *
 * `ProcessLifecycleOwner` answers the same question and waits 700 ms before it says "stopped", but it is a library of its own that this module would have to add,
 * and it has the same blind spot this has to cover for itself: an Activity that is recreated (a rotation, a font scale change) is stopped before its replacement is
 * started. [graceMs] keeps the app in the foreground for that gap, and only for a stop that is a configuration change, never for the user leaving.
 */
class ForegroundTracker(private val now: () -> Long, private val graceMs: Long = 1_000) {
  private var started = 0
  private var graceUntil = Long.MIN_VALUE

  @Synchronized
  fun activityStarted() {
    started++
  }

  @Synchronized
  fun activityStopped(changingConfigurations: Boolean) {
    // A stop that was never counted as a start is an Activity that began before this tracker was installed: there is nothing to take off.
    if (started > 0) started--
    if (changingConfigurations) graceUntil = now() + graceMs
  }

  @Synchronized
  fun isForeground(): Boolean = started > 0 || now() < graceUntil
}
