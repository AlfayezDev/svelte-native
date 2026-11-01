package expo.modules.svelteengine

import android.util.Log
import java.io.File

/** CPU affinity of one thread (`sched_setaffinity`), and which cores are the big ones. Shared by [BootBoost] and [MountBoost]. */
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

  private val big: Long? by lazy {
    if (!available) return@lazy null
    val cpus = BigCores.possibleCount(read("/sys/devices/system/cpu/possible") ?: "")
    if (cpus == 0) null else BigCores.mask(LongArray(cpus) { capacity(it) })
  }

  /** The cores whose capacity is at least half of the largest, as a mask; null when the cores are alike or unreadable. Read once. */
  fun bigCores(): Long? = big

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
