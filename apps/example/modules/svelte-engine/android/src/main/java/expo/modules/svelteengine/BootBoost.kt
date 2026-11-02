package expo.modules.svelteengine

import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import expo.modules.svelteengine.views.ViewWarmup
import java.io.File

/**
 * Keeps the host's start-up threads on the big cores until the first screen is mounted, and loads the native libraries the start
 * needs on threads of their own while the Application is still being set up. The rules are in [BootBoostCore]; this gives them the platform.
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
 * (the first transaction applied on the main thread, or [BootBoostCore.TIMEOUT_MS] after [begin]) gives every thread that still has the big
 * mask the mask the Application's thread had before. A device whose cores are alike is left alone, and so is a process of the app
 * that is not the one the screen lives in.
 *
 * Whether the process is on screen is not asked of the system. The importance a starting process reports is not settled yet
 * when the Application is created (about one launch in forty read it as a background start, and ran at half speed for want of
 * the pin: 400 ms to 600 ms against 300 ms), and asking costs a binder call to system_server on the way (6 ms). The boost starts
 * either way and [activityCreated] is what keeps it: a process that has made no Activity [BootBoostCore.HEADLESS_MS] after [begin] was started
 * for something that is not on screen (a push message, a job), and its threads are released then.
 */
object BootBoost {
  /**
   * The libraries the start loads in this order, one thread each: React Native's (which the Application's own `loadReactNative` needs
   * next) and the app's (`appmodules`, which links the codegen libraries) on the big cores, because the main thread waits for them; Hermes
   * (the pool thread's first step, about 70 ms later) and the Expo modules' (the JavaScript thread's, about 170 ms later) wherever they start.
   */
  private val LIBRARIES = listOf(
    PreloadedLibrary("react_featureflagsjni", pinned = true),
    PreloadedLibrary("appmodules", pinned = true),
    PreloadedLibrary("hermesinstancejni", pinned = false),
    PreloadedLibrary("expo-modules-core", pinned = false),
  )

  private class AndroidEnvironment : BootEnvironment {
    @Volatile var context: Context? = null

    override fun bigCores(): Long? = Affinity.bigCores()
    override fun affinityOf(tid: Int): Long = Affinity.affinityOf(tid)
    override fun setAffinity(tid: Int, mask: Long): Boolean = Affinity.setAffinity(tid, mask)
    override fun reopen(pinned: Long, open: Long) = Affinity.reopen(pinned, open)
    override fun currentTid(): Int = Process.myTid()
    override fun postToMain(delayMs: Long, task: () -> Unit) {
      Handler(Looper.getMainLooper()).postDelayed({ task() }, delayMs)
    }
    override fun startThread(name: String, task: () -> Unit) {
      Thread(task, name).apply { isDaemon = true }.start()
    }
    override fun initLoader() {
      SoLoader.init(checkNotNull(context) { "no context" }, OpenSourceMergedSoMapping)
    }
    override fun loadLibrary(name: String) {
      SoLoader.loadLibrary(name)
    }
    override fun nowMs(): Long = SystemClock.elapsedRealtime()
    override fun info(message: String) {
      Log.i("SvelteEngine", message)
    }
    override fun warn(message: String, error: Throwable) {
      Log.w("SvelteEngine", message, error)
    }
    override fun released() = ViewWarmup.firstMountStarted()
  }

  private val environment = AndroidEnvironment()
  private val core = BootBoostCore(environment, LIBRARIES)
  /** Null until [preloadLibraries] has looked: a start that never asked is the main process, as before the check existed. */
  @Volatile private var mainProcess: Boolean? = null

  /**
   * Call from `Application.attachBaseContext`, the first code of the app that runs: initializes SoLoader as `loadReactNative` will (a
   * second call is a no-op) and loads the [LIBRARIES] on threads of their own. They overlap what the main thread does before the host
   * starts (the content providers, 10 to 18 ms; the Application's own library loads, which find theirs done or wait for the one in
   * progress) and the pool thread's `hermesinstancejni`, which was 9 to 12 ms of its start. A load that fails is logged here and fails
   * again, with its cause, where the host needs the library. Nothing is done in a process that is not the main one.
   */
  @JvmStatic fun preloadLibraries(context: Context) {
    val main = BootBoostCore.isMainProcess(processName(context), context.packageName)
    mainProcess = main
    if (!main) return
    environment.context = context
    core.preloadLibraries()
  }

  /**
   * Call on the main thread in `Application.onCreate`, before the React host starts: pins the calling thread to the big cores
   * until [handOver]. The pin holds until the first mount, or until [BootBoostCore.HEADLESS_MS] when no Activity came (see above).
   */
  @JvmStatic fun begin() {
    if (mainProcess == false) return
    core.begin()
  }

  /** `MainActivity.onCreate`: the process was started for the screen, so the pin holds until the first mount. */
  @JvmStatic fun activityCreated() = core.activityCreated()

  /** The calling thread (the one that called [begin]) gets its own mask back; the threads it started keep the big mask until [release]. */
  @JvmStatic fun handOver() = core.handOver()

  /** The first screen is mounted (or a timeout): threads get their masks back. Safe to call any number of times, from any thread. */
  @JvmStatic fun release() = core.release()

  /** The name of this process: `Application.getProcessName` from API 28, `/proc/self/cmdline` before; null when neither can be read. */
  private fun processName(context: Context): String? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return Application.getProcessName()
    return try {
      File("/proc/self/cmdline").readText().substringBefore('\u0000').trim().ifEmpty { null }
    } catch (error: java.io.IOException) {
      Log.w("SvelteEngine", "BootBoost: could not read the process name, taking this for the main process of ${context.packageName}", error)
      null
    }
  }
}
