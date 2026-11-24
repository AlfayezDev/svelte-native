package expo.modules.svelteengine

/**
 * The box style records of a view, decoded (SPEC.md, "Box styles"; written by `StyleWire.h`). Plain Kotlin, no Android types, so the host check
 * (`src/test/run.sh`, `StyleRulesCheck`) runs the production decoder on the bytes the C++ encoder test wrote.
 *
 * Record 140 box shadow (a layer count, then [SHADOW_INTS] ints per layer: offsetX, offsetY, blurRadius, spreadDistance as float bits, the ARGB colour as it came (0 is transparent), inset), 141 border
 * sides (the style, a mask of the sides that have a colour, the colours of left, top, right, bottom), 142 transform origin (a unit and a value per axis; unit 0 not set, 1 px,
 * 2 percent). A record that is absent means the prop is not set.
 */
class StyleRecords {
  /** A record of this group was decoded since the last [reset] (the owner clears only then). */
  var touched = false
  /** Record 140 as it came: [SHADOW_INTS] ints per layer, null when the view has no shadow. */
  var shadows: IntArray? = null
  /** Record 141 came: the sides do not all have one colour, or the border is not solid. */
  var hasSides = false
  /** 0 solid, 1 dashed, 2 dotted. */
  var borderStyle = 0
  /** Bit i: side i (left, top, right, bottom) has a colour. */
  var sideMask = 0
  val sideColors = IntArray(4)
  var originXUnit = 0
  var originX = 0f
  var originYUnit = 0
  var originY = 0f

  fun reset() {
    touched = false
    shadows = null
    hasSides = false; borderStyle = 0; sideMask = 0
    sideColors.fill(0)
    originXUnit = 0; originX = 0f; originYUnit = 0; originY = 0f
  }

  /** Nothing set: the view has none of these styles. */
  val isEmpty: Boolean
    get() = shadows == null && !hasSides && originXUnit == 0 && originYUnit == 0

  fun copyFrom(other: StyleRecords) {
    shadows = other.shadows
    hasSides = other.hasSides; borderStyle = other.borderStyle; sideMask = other.sideMask
    other.sideColors.copyInto(sideColors)
    originXUnit = other.originXUnit; originX = other.originX; originYUnit = other.originYUnit; originY = other.originY
  }

  /** Decodes record [id] whose payload starts at [at]; returns the index after it. */
  fun decode(id: Int, ops: IntArray, at: Int): Int {
    var i = at
    touched = true
    when (id) {
      BOX_SHADOW -> {
        val n = ops[i++]
        shadows = ops.copyOfRange(i, i + n * SHADOW_INTS)
        i += n * SHADOW_INTS
      }
      BORDER_SIDES -> {
        hasSides = true
        borderStyle = ops[i]; sideMask = ops[i + 1]
        for (k in 0..3) sideColors[k] = ops[i + 2 + k]
        i += 6
      }
      TRANSFORM_ORIGIN -> {
        originXUnit = ops[i]; originX = Float.fromBits(ops[i + 1])
        originYUnit = ops[i + 2]; originY = Float.fromBits(ops[i + 3])
        i += 4
      }
      else -> throw IllegalStateException("SvelteEngine: unknown style record $id")
    }
    return i
  }

  companion object {
    const val BOX_SHADOW = 140
    const val BORDER_SIDES = 141
    const val TRANSFORM_ORIGIN = 142
    const val SHADOW_INTS = 6
  }
}
