package expo.modules.svelteengine

import android.util.Log
import java.io.File

/** CPU affinity of one thread (`sched_setaffinity`), and which cores are the big ones. Shared by [BootBoost], [MountBoost], [expo.modules.svelteengine.views.InputWarmup] and [expo.modules.svelteengine.views.ViewWarmup]. */
internal object Affinity {
  /** False when the library could not be loaded: a boost is an optimization, and a missing one must not stop the app from starting. */
  private val available: Boolean = try {
    System.loadLibrary("svelteaffinity")
    true
  } catch (error: Throwable) {
    Log.w("SvelteEngine", "Affinity: svelteaffinity could not be loaded, no thread boost", error)
    false
  }

  @JvmStatic private external fun nativeAffinityOf(tid: Int): Long
  @JvmStatic private external fun nativeSetAffinity(tid: Int, mask: Long): Boolean

  /** The affinity mask of thread [tid] (0: the calling thread) as a bit set of cores; -1 when it cannot be read. */
  fun affinityOf(tid: Int): Long = if (available) nativeAffinityOf(tid) else -1L

  /** Restricts thread [tid] (0: the calling thread) to the cores in [mask], intersected with its cpuset; false when the kernel refused. */
  fun setAffinity(tid: Int, mask: Long): Boolean = available && nativeSetAffinity(tid, mask)

  private fun read(path: String): String? = try {
    File(path).takeIf { it.canRead() }?.readText()
  } catch (_: Exception) {
    null
  }

  private fun capacity(cpu: Int): Long {
    val base = "/sys/devices/system/cpu/cpu$cpu"
    return (read("$base/cpu_capacity") ?: read("$base/cpufreq/cpuinfo_max_freq"))?.trim()?.toLongOrNull() ?: 0L
  }

  /** The number of CPU indexes of the device (`/sys/devices/system/cpu/possible`; a core that is offline still has its index). Read once. */
  private val cpus: Int by lazy { BigCores.possibleCount(read("/sys/devices/system/cpu/possible") ?: "") }

  /** The capacity of each CPU by index, 0 for one that is offline or unreadable. Read once. */
  private val capacities: LongArray by lazy { LongArray(cpus) { capacity(it) } }

  private val big: Long? by lazy {
    if (!available) return@lazy null
    if (cpus == 0) null else BigCores.mask(capacities)
  }

  /** The cores whose capacity is at least half of the largest, as a mask; null when the cores are alike or unreadable. Read once. */
  fun bigCores(): Long? = big

  /**
   * Restricts the calling thread to the cores that are not big ones, for work that nothing waits for on the spot (a view built ahead of time):
   * the big cores belong to the main thread, the RenderThread and the start-up threads while a boost holds them, and a thread started
   * during a boost would inherit their mask. Nothing is done on a device whose cores are alike. [reopen] leaves such a thread alone, since its
   * mask is not inside the big one. True when the thread is held to the other cores now, false when nothing was done (alike cores, no other
   * core is known, or the kernel refused: logged once at debug level).
   */
  fun keepOffBigCores(): Boolean {
    val big = bigCores() ?: return false
    val others = BigCores.others(capacities, big)
    if (others == 0L) return false
    if (setAffinity(0, others)) return true
    // Once: the kernel refused (a cpuset that leaves the thread none of the little cores); the thread runs where it started, as before the call.
    if (!refusalLogged) {
      refusalLogged = true
      Log.d("SvelteEngine", "Affinity: could not keep a thread off the big cores (mask ${java.lang.Long.toHexString(others)})")
    }
    return false
  }

  @Volatile private var refusalLogged = false

  /** The thread ids of this process. */
  fun tasks(): List<Int> = File("/proc/self/task").list()?.mapNotNull { it.toIntOrNull() } ?: emptyList()

  /** The id of this process's thread named [name] (its `comm`, 15 characters at most), or 0. */
  fun threadNamed(name: String): Int {
    for (tid in tasks()) {
      val comm = try { File("/proc/self/task/$tid/comm").readText().trim() } catch (_: Exception) { continue }
      if (comm == name) return tid
    }
    return 0
  }

  /**
   * Gives every thread of the process whose mask lies inside [pinned] the mask [open]. A thread inherits its creator's affinity,
   * so the threads a pinned thread started meanwhile (an image loader's pool, a handler thread) carry the narrow mask for good
   * unless they are reset. `sched_setaffinity` intersects the request with the cpuset, so [pinned] is the mask read back after
   * pinning, and a subset of it counts.
   */
  fun reopen(pinned: Long, open: Long) {
    for (tid in tasks()) {
      val mask = affinityOf(tid)
      if (mask != open && BigCores.isSubset(mask, pinned)) setAffinity(tid, open)
    }
  }
}
