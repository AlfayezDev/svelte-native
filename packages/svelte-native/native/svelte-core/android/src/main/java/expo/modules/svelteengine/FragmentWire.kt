package expo.modules.svelteengine

/**
 * Record 27 of a text's state (SPEC.md, "Touches on nested Text"), which follows each fragment's records: the tag of the node the fragment's text sits in, and flags. Read
 * here so that a host check can decode what the C++ encoder (`FragmentWire.h`, `FragmentWireTest.cpp`) wrote, with the code the engine runs.
 */
object FragmentWire {
  const val TARGET = 27
  /** The ints after the id: the tag, the flags. */
  const val TARGET_INTS = 2
  /** Flag: the node is a link for accessibility (`role` or `accessibilityRole` "link"). */
  const val LINK = 1

  fun tag(ops: IntArray, at: Int): Int = ops[at]

  fun isLink(ops: IntArray, at: Int): Boolean = ops[at + 1] and LINK != 0
}
