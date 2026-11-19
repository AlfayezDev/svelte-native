package expo.modules.svelteengine

/**
 * Android's own transition between two full screens, the default push and pop of a stack on Android (SPEC.md "Navigation"): the framework's activity
 * transition, `core/res/res/anim/activity_open_enter.xml`, `activity_open_exit.xml`, `activity_close_enter.xml` and `activity_close_exit.xml` of
 * frameworks/base (the same files ship in the SDK, `platforms/android-36/data/res/anim/`). Both screens move 96 dp together over 450 ms on
 * `fast_out_extra_slow_in`; the screen on top fades, in over 83 ms from 50 ms on a push, out over 83 ms from 35 ms on a pop, and the screen under it stays
 * opaque. Each moving screen is drawn on across the strip it uncovers, on the side it moved away from (the framework's `extend`), so no gap shows at an
 * edge. Plain Kotlin, so `src/test/engine.sh` checks it on the host.
 */
internal object TransitionRules {
  /** How far both screens move. Android 13 and 14 moved 10 % of the width; 96 dp since. */
  const val SHIFT_DP = 96f
  const val DURATION_MS = 450L
  private const val FADE_MS = 83f
  private const val OPEN_FADE_START_MS = 50f
  private const val CLOSE_FADE_START_MS = 35f

  /** The screen a push brings in, [ms] into the push: transparent, then linear to opaque over 83 ms from 50 ms. */
  fun openEnterAlpha(ms: Float): Float = ((ms - OPEN_FADE_START_MS) / FADE_MS).coerceIn(0f, 1f)

  /** The screen a pop takes away, [ms] into the pop: opaque, then linear to transparent over 83 ms from 35 ms. */
  fun closeExitAlpha(ms: Float): Float = 1f - ((ms - CLOSE_FADE_START_MS) / FADE_MS).coerceIn(0f, 1f)

  /** `fast_out_extra_slow_in`, `M 0,0 C 0.05,0 0.133333,0.06 0.166666,0.4 C 0.208333,0.82 0.25,1 1,1`: the share of the movement done at [t] of the time. */
  fun emphasized(t: Float): Float {
    if (t <= 0f) return 0f
    if (t >= 1f) return 1f
    return if (t < JOIN_X) cubic(t, 0f, 0f, 0.05f, 0f, 0.133333f, 0.06f, JOIN_X, JOIN_Y)
    else cubic(t, JOIN_X, JOIN_Y, 0.208333f, 0.82f, 0.25f, 1f, 1f, 1f)
  }

  /** Where the path's two curves meet. */
  const val JOIN_X = 0.166666f
  const val JOIN_Y = 0.4f

  /** The y of a cubic Bézier at [x]; x grows along both curves of the path, so its parameter is found by bisection. */
  private fun cubic(x: Float, x0: Float, y0: Float, x1: Float, y1: Float, x2: Float, y2: Float, x3: Float, y3: Float): Float {
    var lo = 0f
    var hi = 1f
    repeat(24) {
      val mid = (lo + hi) / 2f
      if (bezier(mid, x0, x1, x2, x3) < x) lo = mid else hi = mid
    }
    return bezier((lo + hi) / 2f, y0, y1, y2, y3)
  }

  private fun bezier(s: Float, p0: Float, p1: Float, p2: Float, p3: Float): Float {
    val u = 1f - s
    return u * u * u * p0 + 3f * u * u * s * p1 + 3f * u * s * s * p2 + s * s * s * p3
  }

  /**
   * Where the screen under the top one is while the top one is [topX] px right of its place: the two stay [shift] px apart, so the screen under starts where
   * a push leaves it (a full shift to the left) and is back in place once the top screen has moved a full shift right; a push cut short by a pop leaves both
   * part of the way, and the pop goes on from there.
   */
  fun underX(topX: Float, shift: Float): Float = -(shift - topX).coerceIn(0f, shift)

  /** The start of the strip a screen laid out from [left] to [right] uncovers when moved by [translation] px: right of it when it moved left, left of it when it moved right. */
  fun stripStart(left: Float, right: Float, translation: Float): Float = if (translation < 0f) right + translation else left

  /** The end of that strip; the same as its start when the screen has not moved. */
  fun stripEnd(left: Float, right: Float, translation: Float): Float = if (translation < 0f) right else left + translation

  /** A dismissal a gesture started (the edge swipe, predictive back) that has taken the screen further right than the shift: it slides off across the width instead. */
  fun exitsAcross(translation: Float, shift: Float): Boolean = translation > shift
}
