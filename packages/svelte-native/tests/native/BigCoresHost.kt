import expo.modules.svelteengine.BigCores

// Host-side check of which cores count as big (BigCores.kt, no Android types). One command per line on stdin, one result per line;
// tests/big-cores.test.ts holds the expectations.
//
//   possible TEXT          ->  the number of CPU indexes in the text of /sys/devices/system/cpu/possible
//   mask C0 C1 C2 ...      ->  the big cores as a hex bit set (capacities by cpu index, 0 for offline), or `none`
//   subset MASK OF         ->  true when every core of MASK (hex) is in OF (hex)

fun main() {
  for (line in generateSequence(::readLine)) {
    val parts = line.trim().split(' ')
    println(
      when (parts[0]) {
        "possible" -> BigCores.possibleCount(parts.drop(1).joinToString(" ")).toString()
        "mask" -> BigCores.mask(parts.drop(1).map { it.toLong() }.toLongArray())?.let { java.lang.Long.toHexString(it) } ?: "none"
        "subset" -> BigCores.isSubset(java.lang.Long.parseUnsignedLong(parts[1], 16), java.lang.Long.parseUnsignedLong(parts[2], 16)).toString()
        else -> throw IllegalArgumentException(line)
      },
    )
  }
}
