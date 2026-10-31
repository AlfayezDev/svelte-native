package expo.modules.svelteengine

import java.io.File

/** CPU affinity of one thread (`sched_setaffinity`), and which cores are the big ones. Shared by [BootBoost] and [MountBoost]. */
internal object Affinity {
  init { System.loadLibrary("svelteaffinity") }

  /** The affinity mask of thread [tid] (0: the calling thread) as a bit set of cores; -1 when it cannot be read. */
  @JvmStatic external fun affinityOf(tid: Int): Long

  /** Restricts thread [tid] (0: the calling thread) to the cores in [mask]; false when the kernel refused. */
  @JvmStatic external fun setAffinity(tid: Int, mask: Long): Boolean

  private fun capacity(cpu: Int): Long {
    val base = "/sys/devices/system/cpu/cpu$cpu"
    return try {
      (File("$base/cpu_capacity").takeIf { it.canRead() }?.readText() ?: File("$base/cpufreq/cpuinfo_max_freq").takeIf { it.canRead() }?.readText())?.trim()?.toLongOrNull() ?: 0L
    } catch (_: Exception) {
      0L
    }
  }

  private val big: Long? by lazy { findBigCores() }

  /** The cores whose capacity is at least half of the largest, as a mask; null when the cores are alike or unreadable. Read once. */
  fun bigCores(): Long? = big

  private fun findBigCores(): Long? {
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
}
