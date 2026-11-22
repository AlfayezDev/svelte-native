package expo.modules.svelteengine

/**
 * Which cores are the big ones, from numbers read off the device (no Android types, so the rules run on the host in a test).
 * A mask is a bit set of CPU indexes in a `Long`; indexes 0 to [MAX_CPUS] - 1 only.
 */
internal object BigCores {
  const val MAX_CPUS = 63

  /**
   * The number of CPU indexes to look at from the text of `/sys/devices/system/cpu/possible` (`0-7`, `0-3,6-7`, `0`): the
   * highest index plus one, at most [MAX_CPUS]; 0 when the text is not a CPU list. `availableProcessors()` counts online cores
   * only, so with a core offline it is no bound for the indexes.
   */
  fun possibleCount(text: String): Int {
    var highest = -1
    for (part in text.trim().split(',')) {
      val range = part.trim().split('-')
      if (range.size > 2) return 0
      val last = range.last().trim().toIntOrNull() ?: return 0
      if (range.size == 2 && (range[0].trim().toIntOrNull() ?: return 0) > last) return 0
      if (last > highest) highest = last
    }
    return (highest + 1).coerceIn(0, MAX_CPUS)
  }

  /**
   * [capacities] holds the capacity of each CPU by index, 0 for a core that is offline or unreadable. The big cores are those
   * whose capacity is at least half of the largest; null when fewer than two cores are known or all cores are alike (their
   * smallest is more than half of the largest), because pinning would then only take cores away.
   */
  fun mask(capacities: LongArray): Long? {
    val known = capacities.take(MAX_CPUS).filter { it > 0 }
    if (known.size < 2) return null
    val top = known.max()
    if (known.min() * 2 > top) return null
    var mask = 0L
    for (cpu in 0 until minOf(capacities.size, MAX_CPUS)) if (capacities[cpu] > 0 && capacities[cpu] * 2 >= top) mask = mask or (1L shl cpu)
    return mask.takeIf { it != 0L }
  }

  /**
   * The cores that are known ([capacities] as in [mask]: 0 for a core that is offline or unreadable) and not in [big]: where work that nothing
   * waits for goes while the big cores are held for the start. An offline core is not one of them. 0 when [big] covers every known core.
   */
  fun others(capacities: LongArray, big: Long): Long {
    var mask = 0L
    for (cpu in 0 until minOf(capacities.size, MAX_CPUS)) if (capacities[cpu] > 0 && ((big shr cpu) and 1L) == 0L) mask = mask or (1L shl cpu)
    return mask
  }

  /** Whether every core of [mask] is in [of]. */
  fun isSubset(mask: Long, of: Long): Boolean = mask != 0L && (mask and of.inv()) == 0L
}
