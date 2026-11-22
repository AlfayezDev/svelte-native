package expo.modules.svelteengine

/**
 * Decoder of the typed animated buffer that AnimatedBridge.cpp fills from Reanimated's per-frame prop updates
 * (SPEC.md, "Animated write path"). Pure Kotlin on purpose: no Android classes, so `src/test/kotlin/AnimatedWireCheck.kt`
 * runs it on a plain JVM against buffers the C++ encoder wrote.
 *
 * Layout (int words, floats as raw bits): `[viewCount]`, then per view `tag, recordCount, records...`, a record being
 * `id, payload...` with the ids and payloads of PropsEncoder.cpp. Lengths are dp (the Kotlin side applies the density).
 */
object AnimatedWire {
  /** Ints in the buffer; AnimatedBridge.h `kBufferInts` must match. */
  const val BUFFER_INTS = 4096

  const val REC_BACKGROUND = 1
  const val REC_OPACITY = 2
  const val REC_RADIUS = 3
  const val REC_TRANSFORM = 6
  const val REC_ELEVATION = 9

  /** Receives one view's decoded records; primitives only so a frame allocates nothing. */
  interface Target {
    fun opacity(value: Float)

    fun background(color: Int)

    /** dp, one per corner. */
    fun radius(topLeft: Float, topRight: Float, bottomRight: Float, bottomLeft: Float)

    /** Translation in dp, scales, rotation in degrees about the view centre. */
    fun transform(tx: Float, ty: Float, sx: Float, sy: Float, rotation: Float)

    /** zIndex and elevation (dp); NaN means that one is not part of the write. */
    fun stacking(zIndex: Float, elevation: Float)
  }

  /**
   * Decodes the [count] records starting at [at] into [target]; returns the index after the last record, or -1 for an
   * id this build does not know (the buffer is then from another version and nothing after it can be trusted).
   */
  fun decodeRecords(ints: IntArray, at: Int, count: Int, target: Target): Int {
    var i = at
    for (r in 0 until count) {
      when (ints[i++]) {
        REC_BACKGROUND -> target.background(ints[i++])
        REC_OPACITY -> target.opacity(Float.fromBits(ints[i++]))
        REC_RADIUS -> {
          target.radius(Float.fromBits(ints[i]), Float.fromBits(ints[i + 1]), Float.fromBits(ints[i + 2]), Float.fromBits(ints[i + 3]))
          i += 4
        }
        REC_TRANSFORM -> {
          target.transform(
            Float.fromBits(ints[i]), Float.fromBits(ints[i + 1]), Float.fromBits(ints[i + 2]),
            Float.fromBits(ints[i + 3]), Float.fromBits(ints[i + 4]),
          )
          i += 5
        }
        REC_ELEVATION -> {
          target.stacking(Float.fromBits(ints[i]), Float.fromBits(ints[i + 1]))
          i += 2
        }
        else -> return -1
      }
    }
    return i
  }
}
