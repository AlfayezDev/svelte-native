package expo.modules.svelteengine

/**
 * The accessibility prop records of a view, decoded (SPEC.md, "Accessibility props"; written by `A11yWire.h`). Plain Kotlin, no Android types,
 * so the host check (`src/test/run.sh`, `A11yRulesCheck`) runs the production decoder on the bytes the C++ encoder test wrote.
 *
 * Record 16 state (bit set, see [A11yRules]), 17 value (mask, then min, max, now, text as present), 18 hint, 19 actions (count, then name and
 * label per action, label -1 for none), 25 mode (live region and importantForAccessibility), 26 role (the ordinal of `facebook::react::Role`).
 * A record that is absent means the prop is not set.
 */
class A11yRecords {
  /** A record of this group was decoded since the last [reset] (the owner clears only then). */
  var touched = false
  var hasState = false
  var state = 0
  var valueMask = 0
  var min = 0
  var max = 0
  var now = 0
  var valueText: String? = null
  var hint: String? = null
  var actionNames: Array<String> = NO_NAMES
  var actionLabels: Array<String?> = NO_LABELS
  var mode = 0
  /** Ordinal of the ARIA role, -1 when `role` is not set. */
  var role = -1

  fun reset() {
    touched = false
    hasState = false; state = 0
    valueMask = 0; min = 0; max = 0; now = 0; valueText = null
    hint = null
    actionNames = NO_NAMES; actionLabels = NO_LABELS
    mode = 0
    role = -1
  }

  /** Nothing set: the view needs no accessibility delegate for these props. */
  val isEmpty: Boolean
    get() = !hasState && valueMask == 0 && hint == null && actionNames.isEmpty() && mode == 0 && role < 0

  fun copyFrom(other: A11yRecords) {
    hasState = other.hasState; state = other.state
    valueMask = other.valueMask; min = other.min; max = other.max; now = other.now; valueText = other.valueText
    hint = other.hint
    actionNames = other.actionNames; actionLabels = other.actionLabels
    mode = other.mode
    role = other.role
  }

  fun sameAs(other: A11yRecords): Boolean =
    hasState == other.hasState && state == other.state && valueMask == other.valueMask && min == other.min && max == other.max &&
      now == other.now && valueText == other.valueText && hint == other.hint && mode == other.mode && role == other.role &&
      actionNames.contentEquals(other.actionNames) && actionLabels.contentEquals(other.actionLabels)

  /** Decodes record [id] whose payload starts at [at]; returns the index after it. */
  fun decode(id: Int, ops: IntArray, at: Int, strings: Array<String>): Int {
    var i = at
    touched = true
    when (id) {
      STATE -> { hasState = true; state = ops[i++] }
      VALUE -> {
        valueMask = ops[i++]
        if (valueMask and A11yRules.VALUE_MIN != 0) min = ops[i++]
        if (valueMask and A11yRules.VALUE_MAX != 0) max = ops[i++]
        if (valueMask and A11yRules.VALUE_NOW != 0) now = ops[i++]
        if (valueMask and A11yRules.VALUE_TEXT != 0) valueText = strings[ops[i++]]
      }
      HINT -> hint = strings[ops[i++]]
      ACTIONS -> {
        val n = ops[i++]
        val names = arrayOfNulls<String>(n)
        val labels = arrayOfNulls<String>(n)
        for (k in 0 until n) {
          names[k] = strings[ops[i++]]
          val label = ops[i++]
          labels[k] = if (label >= 0) strings[label] else null
        }
        @Suppress("UNCHECKED_CAST")
        actionNames = names as Array<String>
        actionLabels = labels
      }
      MODE -> mode = ops[i++]
      ROLE -> role = ops[i++]
      else -> throw IllegalStateException("SvelteEngine: not an accessibility record: $id")
    }
    return i
  }

  companion object {
    const val STATE = 16
    const val VALUE = 17
    const val HINT = 18
    const val ACTIONS = 19
    const val MODE = 25
    const val ROLE = 26

    private val NO_NAMES = emptyArray<String>()
    private val NO_LABELS = emptyArray<String?>()
  }
}
