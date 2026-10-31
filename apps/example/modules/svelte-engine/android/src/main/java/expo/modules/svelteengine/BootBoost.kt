package expo.modules.svelteengine

import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Keeps the host's start-up threads on the big cores until the first screen is mounted.
 *
 * Why: on a phone with a little/big split (the Galaxy A16: 2 x Cortex-A76 and 6 x Cortex-A55) the scheduler places a thread
 * that has just started on a little core unless a big one is idle, and both big cores are busy whenever the system has work
 * of its own at the launch (system_server's heap GC, the launching shell). About one launch in four then runs its start-up
 * at half the speed (JavaScript 172 ms against 92 ms, first frame 100 to 190 ms later), whatever the bundle does (SPEC,
 * "Boot: the launches that are slow"). A thread that is allowed only the big cores waits for one instead of taking a little core.
 *
 * How: the Application pins its own thread around `reactHost.start()` ([begin], [handOver]). A new thread inherits the
 * affinity of the thread that creates it, so the pool thread that initializes Hermes and the TurboModules, and the JavaScript
 * thread that thread starts, begin on the big cores, with no polling and no window in which they run elsewhere. [release]
 * (the first transaction applied on the main thread, or [TIMEOUT_MS] after [begin]) gives every thread that still has the big
 * mask the mask the Application's thread had before. A device whose cores are alike is left alone.
 */
object BootBoost {
  private const val TIMEOUT_MS = 3000L

  private val lock = Any()
  @Volatile private var released = true
  private var big = 0L
  private var open = 0L
  private var callerPinned = false

  /**
   * Call on the main thread in `Application.onCreate`, before the React host starts: starts the loading of the native library
   * the first Expo module needs, and pins the calling thread to the big cores until [handOver].
   */
  @JvmStatic fun begin() {
    Thread({ preload() }, "svelte-boot-load").apply { isDaemon = true }.start()
    val mask = Affinity.bigCores() ?: return
    synchronized(lock) {
      val before = Affinity.affinityOf(0)
      if (before <= 0 || before == mask) return
      big = mask
      open = before
      released = false
      callerPinned = Affinity.setAffinity(0, mask)
    }
    Handler(Looper.getMainLooper()).postDelayed({ release() }, TIMEOUT_MS)
  }

  /** The calling thread (the one that called [begin]) gets its own mask back; the threads it started keep the big mask until [release]. */
  @JvmStatic fun handOver() {
    synchronized(lock) {
      if (callerPinned) Affinity.setAffinity(0, open)
      callerPinned = false
    }
  }

  /** The first screen is mounted (or a timeout): threads get their masks back. Safe to call any number of times, from any thread. */
  @JvmStatic fun release() {
    if (released) return
    synchronized(lock) {
      if (released) return
      released = true
      if (callerPinned) Affinity.setAffinity(0, open)
      callerPinned = false
      // A thread inherits its creator's mask: every thread the pinned ones started in the meantime is narrowed too.
      for (tid in Affinity.tasks()) if (Affinity.affinityOf(tid) == big) Affinity.setAffinity(tid, open)
    }
  }

  /**
   * `expo-modules-core`'s native library (and `libworklets.so`, which it links) is loaded by the first Expo module the
   * JavaScript thread touches: 10 to 14 ms of `SoLoader.loadLibrary` inside `MainRuntime.install`, before the bundle can go on.
   * Loading it here, while Hermes starts on the pool thread, takes that off the JavaScript thread; SoLoader answers its own
   * later request from the same table.
   */
  private fun preload() {
    try {
      com.facebook.soloader.SoLoader.loadLibrary("expo-modules-core")
    } catch (error: Throwable) {
      Log.w("SvelteEngine", "BootBoost: could not preload expo-modules-core", error)
    }
  }
}
