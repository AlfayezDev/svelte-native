package expo.modules.svelteengine

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min

/**
 * The transitions between two screens of a stack on Android (SPEC.md "Navigation"): what each `animation` of a push screen plays, as one table of
 * [Motion]s that `EngineStack.system` runs. Plain Kotlin, so `src/test/engine.sh` checks it on the host.
 *
 * - `default` ([KIND_DEFAULT]): the movement of the framework's activity transition (`core/res/res/anim/activity_open_enter.xml`, `activity_open_exit.xml`,
 *   `activity_close_enter.xml`, `activity_close_exit.xml` of frameworks/base, the same files the SDK ships in `platforms/android-36/data/res/anim/`): both
 *   screens move 96 dp together over 450 ms on `fast_out_extra_slow_in`. The fade is Material's fade-through (`MaterialSharedAxis`, "slides and fades"; the
 *   predictive back guide's "fade through" whose threshold is 35 %, "At the 35% mark, neither screen is showing"): the screen going away fades out over the
 *   first 35 % of the movement and the one coming fades in over the rest, so the two are never seen together.
 * - `android_activity` ([KIND_ACTIVITY]): the framework's activity transition as it is, which React Navigation's native stack plays by default (react-native-
 *   screens `res/v33/anim-v33/rns_default_*.xml`, with 10 % of the width where Android 16 moves 96 dp): the screen on top fades in over 83 ms from 50 ms (out
 *   over 83 ms from 35 ms on a pop) over the screen below, which stays opaque.
 * - `fade`, `slide_from_right`, `slide_from_left`, `slide_from_bottom`, `fade_from_bottom`: react-native-screens' own (`res/base/anim/rns_fade_in.xml`,
 *   `rns_slide_in_from_right.xml`, `rns_fade_from_bottom.xml`... as `legacy/utils/FragmentTransactionKt.kt` pairs them), so a screen option written for
 *   React Navigation looks the same here. A resource with no interpolator takes Android's default, accelerate-decelerate; `config_mediumAnimTime` is 400 ms.
 *
 * While both screens are see-through (a fade-through, a crossfade) the stack draws the coming screen's surface under them, and a screen that moves less than
 * the whole width is drawn on across the strip it uncovers (the framework's `extend`), so nothing behind the stack shows.
 */
internal object TransitionRules {
  /** How far both screens move in the default and the activity transitions. Android 13 and 14 moved 10 % of the width; 96 dp since. */
  const val SHIFT_DP = 96f
  const val DURATION_MS = 450L
  /** The share of the movement by which the screen going away has faded out and after which the one coming fades in. */
  const val FADE_THROUGH = 0.35f

  /** The screen going away in the default transition (the one below on a push, the one on top on a pop) when [p] of the movement is done. */
  fun fadeOut(p: Float): Float = 1f - (p / FADE_THROUGH).coerceIn(0f, 1f)

  /** The screen coming in the default transition (the one on top on a push, the one below on a pop): transparent until 35 % of the movement. */
  fun fadeIn(p: Float): Float = ((p - FADE_THROUGH) / (1f - FADE_THROUGH)).coerceIn(0f, 1f)

  // The kinds of `EngineScreen.transitionKind`: 0 none, 1 a modal fading in alone, 2 a modal from the right, 3 a modal or sheet from the bottom (those four
  // move one screen, `EngineStack.animate`), and the push screens' transitions between two screens below (`EngineStack.system`, [motion]).
  const val KIND_DEFAULT = 4
  const val KIND_ACTIVITY = 5
  const val KIND_FADE = 6
  const val KIND_SLIDE_RIGHT = 7
  const val KIND_SLIDE_LEFT = 8
  const val KIND_SLIDE_BOTTOM = 9
  const val KIND_FADE_FROM_BOTTOM = 10

  /** A transition [motion] plays between two screens. */
  fun paired(kind: Int): Boolean = kind in KIND_DEFAULT..KIND_FADE_FROM_BOTTOM

  // Curves, as the framework's interpolators compute them.
  const val LINEAR = 0
  /** `fast_out_extra_slow_in` ([emphasized]). */
  const val EMPHASIZED = 1
  /** `accelerate_decelerate`, Android's default for an animation that names none: `cos((t + 1) π) / 2 + 0.5`. */
  const val ACCELERATE_DECELERATE = 2
  /** `decelerate_quint`, a `DecelerateInterpolator` of factor 2.5: `1 - (1 - t)^5`. */
  const val DECELERATE_QUINT = 3
  /** `accelerate_quint`, an `AccelerateInterpolator` of factor 2.5: `t^5`. */
  const val ACCELERATE_QUINT = 4

  fun curve(id: Int, t: Float): Float {
    val x = t.coerceIn(0f, 1f)
    return when (id) {
      EMPHASIZED -> emphasized(x)
      ACCELERATE_DECELERATE -> (cos((x + 1f) * PI) / 2.0 + 0.5).toFloat()
      DECELERATE_QUINT -> { val u = 1f - x; 1f - u * u * u * u * u }
      ACCELERATE_QUINT -> x * x * x * x * x
      else -> x
    }
  }

  /**
   * One screen's alpha: [from] to [to] over [length] from [start] on [curve]. In ms of the transition, or in shares of the movement's progress when
   * [onProgress] (the default transition's fade-through follows the movement, as Material's fades do).
   */
  class Fade(val from: Float, val to: Float, val start: Float, val length: Float, val curve: Int = LINEAR, val onProgress: Boolean = false) {
    fun at(ms: Float, progress: Float): Float {
      val x = if (onProgress) progress else ms
      return from + (to - from) * TransitionRules.curve(curve, (x - start) / length)
    }
  }

  // How a motion's distance is given.
  const val DP = 0
  const val WIDTH = 1
  const val HEIGHT = 2

  /**
   * One direction (the push or the pop) of a transition between the screen on top and the full screen below it. The screen on top moves between its place
   * and [amount] [unit]s away (towards [direction]: 1 the right or the bottom, -1 the left), on the X axis or, [vertical], the Y axis, over [durationMs] on
   * [curve]; when [moveUnder], the screen below moves with it, a distance behind ([underX]). [top] and [under] are their fades (null: they stay as they are).
   * [extend]: each moving screen is drawn on across the strip it uncovers (it moves less than the width).
   */
  class Motion(
    val durationMs: Long, val curve: Int, val unit: Int, val amount: Float, val direction: Int, val vertical: Boolean,
    val moveUnder: Boolean, val top: Fade?, val under: Fade?, val extend: Boolean,
  )

  private val defaultPush = Motion(DURATION_MS, EMPHASIZED, DP, SHIFT_DP, 1, false, true,
    Fade(0f, 1f, FADE_THROUGH, 1f - FADE_THROUGH, onProgress = true), Fade(1f, 0f, 0f, FADE_THROUGH, onProgress = true), true)
  private val defaultPop = Motion(DURATION_MS, EMPHASIZED, DP, SHIFT_DP, 1, false, true,
    Fade(1f, 0f, 0f, FADE_THROUGH, onProgress = true), Fade(0f, 1f, FADE_THROUGH, 1f - FADE_THROUGH, onProgress = true), true)
  // activity_open_enter: alpha 0 to 1, startOffset 50, duration 83, linear; activity_close_exit: 1 to 0, startOffset 35, duration 83.
  private val activityPush = Motion(DURATION_MS, EMPHASIZED, DP, SHIFT_DP, 1, false, true, Fade(0f, 1f, 50f, 83f), null, true)
  private val activityPop = Motion(DURATION_MS, EMPHASIZED, DP, SHIFT_DP, 1, false, true, Fade(1f, 0f, 35f, 83f), null, true)
  // rns_fade_in / rns_fade_out: alpha over 150 ms, the screen coming in and the one going out at once (the same pair on a pop).
  private val fadePush = Motion(150L, LINEAR, DP, 0f, 1, false, false,
    Fade(0f, 1f, 0f, 150f, ACCELERATE_DECELERATE), Fade(1f, 0f, 0f, 150f, ACCELERATE_DECELERATE), false)
  private val fadePop = Motion(150L, LINEAR, DP, 0f, 1, false, false,
    Fade(1f, 0f, 0f, 150f, ACCELERATE_DECELERATE), Fade(0f, 1f, 0f, 150f, ACCELERATE_DECELERATE), false)
  // rns_slide_in_from_right with rns_slide_out_to_left (a pop: rns_slide_in_from_left with rns_slide_out_to_right): 100 % of the width, config_mediumAnimTime.
  private val slideRight = Motion(400L, ACCELERATE_DECELERATE, WIDTH, 1f, 1, false, true, null, null, false)
  private val slideLeft = Motion(400L, ACCELERATE_DECELERATE, WIDTH, 1f, -1, false, true, null, null, false)
  // rns_slide_in_from_bottom / rns_slide_out_to_bottom, the screen below staying (rns_no_animation_medium).
  private val slideBottom = Motion(400L, ACCELERATE_DECELERATE, HEIGHT, 1f, 1, true, false, null, null, false)
  // rns_fade_from_bottom: translate 8 % up over 350 ms and alpha over 210 ms, both decelerate_quint; rns_fade_to_bottom: translate 8 % down over 250 ms
  // on accelerate_quint, alpha 1 to 0 from 100 ms over 150 ms, linear. The screen below stays (rns_no_animation_350, rns_no_animation_250).
  private val fadeFromBottomPush = Motion(350L, DECELERATE_QUINT, HEIGHT, 0.08f, 1, true, false, Fade(0f, 1f, 0f, 210f, DECELERATE_QUINT), null, false)
  private val fadeFromBottomPop = Motion(250L, ACCELERATE_QUINT, HEIGHT, 0.08f, 1, true, false, Fade(1f, 0f, 100f, 150f), null, false)

  /** What a transition of [kind] plays on a push ([push]) or a pop; null for a kind that moves one screen. */
  fun motion(kind: Int, push: Boolean): Motion? = when (kind) {
    KIND_DEFAULT -> if (push) defaultPush else defaultPop
    KIND_ACTIVITY -> if (push) activityPush else activityPop
    KIND_FADE -> if (push) fadePush else fadePop
    KIND_SLIDE_RIGHT -> slideRight
    KIND_SLIDE_LEFT -> slideLeft
    KIND_SLIDE_BOTTOM -> slideBottom
    KIND_FADE_FROM_BOTTOM -> if (push) fadeFromBottomPush else fadeFromBottomPop
    else -> null
  }

  /**
   * The points of `fast_out_extra_slow_in`'s path, `M 0,0 C 0.05,0 0.133333,0.06 0.166666,0.4 C 0.208333,0.82 0.25,1 1,1`, as x, y pairs: the start, then the
   * two control points and the end of each of its two cubic curves.
   */
  val PATH = floatArrayOf(0f, 0f, 0.05f, 0f, 0.133333f, 0.06f, 0.166666f, 0.4f, 0.208333f, 0.82f, 0.25f, 1f, 1f, 1f)

  /** Where the path's two curves meet. */
  val JOIN_X = PATH[6]
  val JOIN_Y = PATH[7]

  /** `fast_out_extra_slow_in`: the share of the movement done at [t] of the time. */
  fun emphasized(t: Float): Float {
    if (t <= 0f) return 0f
    if (t >= 1f) return 1f
    val q = PATH
    return if (t < JOIN_X) cubic(t, q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7])
    else cubic(t, q[6], q[7], q[8], q[9], q[10], q[11], q[12], q[13])
  }

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
   * Where the screen under the top one is while the top one is [topX] px from its place, the two moving [shift] px (negative: the top screen comes from the
   * left): they stay [shift] apart, so the screen under starts where a push leaves it (a full shift the other way) and is back in place once the top screen
   * has moved a full shift; a push cut short by a pop leaves both part of the way, and the pop goes on from there.
   */
  fun underX(topX: Float, shift: Float): Float = (topX - shift).coerceIn(min(0f, -shift), max(0f, -shift))

  /** The start of the strip a screen laid out from [left] to [right] uncovers when moved by [translation] px: right of it when it moved left, left of it when it moved right. */
  fun stripStart(left: Float, right: Float, translation: Float): Float = if (translation < 0f) right + translation else left

  /** The end of that strip; the same as its start when the screen has not moved. */
  fun stripEnd(left: Float, right: Float, translation: Float): Float = if (translation < 0f) right else left + translation

  /** A dismissal a gesture started (the edge swipe, predictive back) that has taken the screen further right than the shift: it slides off across the width instead. */
  fun exitsAcross(translation: Float, shift: Float): Boolean = translation > shift
}
