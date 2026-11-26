package expo.modules.svelteengine

/**
 * The order siblings are drawn and hit in (SPEC.md, "Stacking"): `src/test/run.sh` runs `StackRulesCheck` on a plain JVM. `zIndex` orders them and an elevation orders nothing, as in React
 * Native (`ReactViewGroup` draws in `zIndex` order and brackets an elevated child's draw, `TouchTargetHelper` walks the same order from the top).
 */
object StackRules {
  /** The child indices from the bottom to the top: by `zIndex`, ties in insertion order (a stable sort). The hit order is this one walked from the top. */
  fun order(zIndex: FloatArray): IntArray {
    val ranked = arrayOfNulls<Int>(zIndex.size)
    for (i in ranked.indices) ranked[i] = i
    ranked.sortWith { a, b -> zIndex[a!!].compareTo(zIndex[b!!]) }
    return IntArray(ranked.size) { ranked[it]!! }
  }
}
