package expo.modules.svelteengine

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.File

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

  init { System.loadLibrary("svelteboot") }

  @JvmStatic private external fun affinityOf(tid: Int): Long
  @JvmStatic private external fun setAffinity(tid: Int, mask: Long): Boolean

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
    val mask = bigCores() ?: return
    synchronized(lock) {
      val before = affinityOf(0)
      if (before <= 0 || before == mask) return
      big = mask
      open = before
      released = false
      callerPinned = setAffinity(0, mask)
    }
    Handler(Looper.getMainLooper()).postDelayed({ release() }, TIMEOUT_MS)
  }

  /** The calling thread (the one that called [begin]) gets its own mask back; the threads it started keep the big mask until [release]. */
  @JvmStatic fun handOver() {
    synchronized(lock) {
      if (callerPinned) setAffinity(0, open)
      callerPinned = false
    }
  }

  /** The first screen is mounted (or a timeout): threads get their masks back. Safe to call any number of times, from any thread. */
  @JvmStatic fun release() {
    if (released) return
    synchronized(lock) {
      if (released) return
      released = true
      if (callerPinned) setAffinity(0, open)
      callerPinned = false
      // A thread inherits its creator's mask: every thread the pinned ones started in the meantime is narrowed too.
      for (tid in tasks()) if (affinityOf(tid) == big) setAffinity(tid, open)
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

  private fun capacity(cpu: Int): Long {
    val base = "/sys/devices/system/cpu/cpu$cpu"
    return try {
      (File("$base/cpu_capacity").takeIf { it.canRead() }?.readText() ?: File("$base/cpufreq/cpuinfo_max_freq").takeIf { it.canRead() }?.readText())?.trim()?.toLongOrNull() ?: 0L
    } catch (_: Exception) {
      0L
    }
  }

  /** The cores whose capacity is at least half of the largest, as a mask; null when the cores are alike or unreadable. */
  private fun bigCores(): Long? {
    val cpus = Runtime.getRuntime().availableProcessors().coerceAtMost(62)
    val capacities = LongArray(cpus) { capacity(it) }
    val known = capacities.filter { it > 0 }
    if (known.size < 2) return null
    val top = known.max()
    if (known.min() * 2 > top) return null
    var mask = 0L
    for (cpu in 0 until cpus) if (capacities[cpu] * 2 >= top) mask = mask or (1L shl cpu)
    return mask.takeIf { it != 0L }
  }

  private fun tasks(): List<Int> = File("/proc/self/task").list()?.mapNotNull { it.toIntOrNull() } ?: emptyList()
}
