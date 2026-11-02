package expo.modules.svelteengine

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.util.Log
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader

/**
 * Keeps the host's start-up threads on the big cores until the first screen is mounted, and loads the native libraries the start
 * needs on threads of their own while the Application is still being set up.
 *
 * Why the pin: on a phone with a little/big split (the Galaxy A16: 2 x Cortex-A76 and 6 x Cortex-A55) the scheduler places a thread
 * that has just started on a little core unless a big one is idle, and both big cores are busy whenever the system has work
 * of its own at the launch (system_server's heap GC, the launching shell). About one launch in four then runs its start-up
 * at half the speed (JavaScript 172 ms against 92 ms, first frame 100 to 190 ms later), whatever the bundle does (SPEC,
 * "Boot on the phone"). A thread that is allowed only the big cores waits for one instead of taking a little core.
 *
 * How: the Application pins its own thread around `reactHost.start()` ([begin], [handOver]). A new thread inherits the
 * affinity of the thread that creates it, so the pool thread that initializes Hermes and the TurboModules, and the JavaScript
 * thread that thread starts, begin on the big cores, with no polling and no window in which they run elsewhere. [release]
 * (the first transaction applied on the main thread, or [TIMEOUT_MS] after [begin]) gives every thread that still has the big
 * mask the mask the Application's thread had before. A device whose cores are alike is left alone.
 *
 * Whether the process is on screen is not asked of the system. The importance a starting process reports is not settled yet
 * when the Application is created (about one launch in thirty read it as a background start, and ran at half speed for want of
 * the pin: 400 ms to 600 ms against 300 ms), and asking costs a binder call to system_server on the way (6 ms). The boost starts
 * either way and [activityCreated] is what keeps it: a process that has made no Activity [HEADLESS_MS] after [begin] was started
 * for something that is not on screen (a push message, a job), and its threads are released then.
 */
object BootBoost {
  private const val TIMEOUT_MS = 3000L
  /** A process started for the screen has created its Activity within this long; one that has not was started for something else. */
  private const val HEADLESS_MS = 1500L

  /**
   * The libraries the start loads in this order: React Native's (which the Application's own `loadReactNative` needs next), the
   * app's (`appmodules`, which links the codegen libraries), Hermes (the pool thread's first step) and the Expo modules'. One thread
   * each, the arrangement the phone measured (SPEC, "Boot on the phone", round 2).
   */
  private val LIBRARIES = listOf("react_featureflagsjni", "appmodules", "hermesinstancejni", "expo-modules-core")

  private val lock = Any()
  @Volatile private var released = true
  @Volatile private var activityCreated = false
  @Volatile private var preloading = false
  /** The cores the threads were pinned to: what the kernel kept of the request after the cpuset (see [Affinity.reopen]). */
  private var big = 0L
  private var open = 0L
  /** The thread that was pinned, by id: [release] runs on any thread and must not touch its own. */
  private var callerTid = 0
  private var callerPinned = false

  /**
   * Call from `Application.attachBaseContext`, the first code of the app that runs: initializes SoLoader as `loadReactNative` will (a
   * second call is a no-op) and loads the [LIBRARIES] on threads of their own. They overlap what the main thread does before the host
   * starts (the content providers, 10 to 18 ms; the Application's own library loads, which find theirs done or wait for the one in
   * progress) and the pool thread's `hermesinstancejni`, which was 9 to 12 ms of its start. A load that fails is logged here and fails
   * again, with its cause, where the host needs the library.
   */
  @JvmStatic fun preloadLibraries(context: Context) {
    if (preloading) return
    preloading = true
    try {
      SoLoader.init(context, OpenSourceMergedSoMapping)
    } catch (error: Exception) {
      Log.w("SvelteEngine", "BootBoost: could not initialize SoLoader ahead of React Native, no library preload", error)
      return
    }
    val cores = Affinity.bigCores()
    for ((index, library) in LIBRARIES.withIndex()) {
      Thread({
        // Without the pin these threads start on little cores, which load a library in twice the time.
        if (cores != null) Affinity.setAffinity(0, cores)
        try {
          SoLoader.loadLibrary(library)
        } catch (error: Throwable) {
          Log.w("SvelteEngine", "BootBoost: could not preload $library", error)
        }
      }, "svelte-boot-$index").apply { isDaemon = true }.start()
    }
  }

  /**
   * Call on the main thread in `Application.onCreate`, before the React host starts: pins the calling thread to the big cores
   * until [handOver]. The pin holds until the first mount, or until [HEADLESS_MS] when no Activity came (see above).
   */
  @JvmStatic fun begin() {
    val mask = Affinity.bigCores() ?: return
    synchronized(lock) {
      val before = Affinity.affinityOf(0)
      if (before <= 0 || before == mask) return
      if (!Affinity.setAffinity(0, mask)) return
      val effective = Affinity.affinityOf(0)
      if (effective <= 0 || effective == before) {
        // The cpuset left no cores to choose from.
        Affinity.setAffinity(0, before)
        return
      }
      big = effective
      open = before
      callerTid = Process.myTid()
      callerPinned = true
      released = false
      Log.i("SvelteEngine", "BootBoost: pinned to ${java.lang.Long.toHexString(effective)}")
    }
    val main = Handler(Looper.getMainLooper())
    main.postDelayed({ release() }, TIMEOUT_MS)
    main.postDelayed({
      if (!activityCreated) {
        Log.i("SvelteEngine", "BootBoost: no activity after $HEADLESS_MS ms, a start for something that is not on screen")
        release()
      }
    }, HEADLESS_MS)
  }

  /** `MainActivity.onCreate`: the process was started for the screen, so the pin holds until the first mount. */
  @JvmStatic fun activityCreated() {
    activityCreated = true
  }

  /** The calling thread (the one that called [begin]) gets its own mask back; the threads it started keep the big mask until [release]. */
  @JvmStatic fun handOver() {
    synchronized(lock) {
      if (callerPinned) Affinity.setAffinity(callerTid, open)
      callerPinned = false
    }
  }

  /** The first screen is mounted (or a timeout): threads get their masks back. Safe to call any number of times, from any thread. */
  @JvmStatic fun release() {
    if (released) return
    synchronized(lock) {
      if (released) return
      released = true
      if (callerPinned) Affinity.setAffinity(callerTid, open)
      callerPinned = false
      Affinity.reopen(big, open)
      Log.i("SvelteEngine", "BootBoost: released")
    }
  }
}
