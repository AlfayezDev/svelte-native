package expo.modules.svelteblur

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * What `SvelteBlurView` decides without Android types, so that the host check (`src/test/run.sh`, `BlurRulesCheck`) can run it: how strong the blur
 * is, which colour lies over it, and how big the picture of the backdrop is.
 *
 * `intensity` is 0 to 100 as in `expo-blur` (50 when the app gives none; the native side clamps). It sets the blur radius and how opaque the tint is:
 *  - radius: 0 to [MAX_RADIUS_DP] density-independent pixels, linear in the intensity, so 100 blurs by 25 dp.
 *    The picture of what is behind the view is [divisor] times smaller than the view, so the radius the effect gets is in pixels of that picture
 *    (`dp * density / divisor`); below [MIN_EFFECT_RADIUS] of them there is no effect (a blur of 0 is an error on some devices).
 *  - tint: white for `light`, `extraLight` and every `...Light` material, black for `dark` and every `...Dark` one, and for every other name
 *    (`default`, `regular`, `prominent`, `systemMaterial`, ..., and a name that is none of them) white by day and black at night. The alpha lies between
 *    [BLURRED_ALPHA_MIN] and [BLURRED_ALPHA_MAX] over a real blur and between [PLAIN_ALPHA_MIN] and [PLAIN_ALPHA_MAX] without one (API below 31, a
 *    canvas that is not hardware accelerated, a view that has not seen its backdrop yet), which has to hide more because nothing is blurred. Intensity 0
 *    draws nothing.
 */
object BlurRules {
  const val DEFAULT_INTENSITY = 50.0
  const val DEFAULT_TINT = "default"

  /** The blur radius at intensity 100, in dp. */
  const val MAX_RADIUS_DP = 25f

  /** The smallest radius, in pixels of the backdrop picture, that is still blurred. */
  const val MIN_EFFECT_RADIUS = 0.5f

  /** The backdrop picture is this many times smaller than the view: a quarter of each side is a sixteenth of the pixels to draw and to blur. */
  const val DIVISOR = 4

  /** The most pixels the backdrop picture may have (a full screen at the first divisor is about 0.16 million); a larger view takes a bigger divisor. */
  const val MAX_PIXELS = 1_000_000

  /** The backdrop bitmaps' sides are multiples of this many pixels, so a view that grows or shrinks a pixel at a time does not allocate a bitmap for each pixel. */
  const val CAPACITY_STEP = 32

  /** The most bytes of software copies of hardware bitmaps (an image behind the blur) that are kept; past it the copies are dropped and made again as they are drawn. */
  const val COPY_BUDGET_BYTES = 12 * 1024 * 1024

  const val BLURRED_ALPHA_MIN = 0.12
  const val BLURRED_ALPHA_MAX = 0.45
  const val PLAIN_ALPHA_MIN = 0.30
  const val PLAIN_ALPHA_MAX = 0.75

  private const val WHITE = 0xFFFFFF
  private const val BLACK = 0x000000

  /** The first Android version with `RenderEffect`, which blurs on the GPU. */
  const val MIN_BLUR_SDK = 31

  enum class Group { LIGHT, DARK, ADAPTIVE }

  /** The prop as the view keeps it: a missing or non-finite value is the default, anything else is clamped to 0 to 100. */
  fun intensity(value: Double?): Double = if (value == null || !value.isFinite()) DEFAULT_INTENSITY else value.coerceIn(0.0, 100.0)

  /** Which colour a tint name asks for; `null` and a name nobody knows are adaptive. */
  fun group(tint: String?): Group = when {
    tint == null -> Group.ADAPTIVE
    tint == "light" || tint == "extraLight" || tint.endsWith("Light") -> Group.LIGHT
    tint == "dark" || tint.endsWith("Dark") -> Group.DARK
    else -> Group.ADAPTIVE
  }

  /** The colour over the blur (ARGB): see the class comment. [night] is the current night mode, which adaptive tints follow. */
  fun overlayColor(tint: String?, intensity: Double, night: Boolean, blurred: Boolean): Int {
    if (intensity <= 0.0) return 0
    val fraction = (intensity / 100.0).coerceIn(0.0, 1.0)
    val alpha = if (blurred) BLURRED_ALPHA_MIN + (BLURRED_ALPHA_MAX - BLURRED_ALPHA_MIN) * fraction else PLAIN_ALPHA_MIN + (PLAIN_ALPHA_MAX - PLAIN_ALPHA_MIN) * fraction
    val dark = when (group(tint)) {
      Group.LIGHT -> false
      Group.DARK -> true
      Group.ADAPTIVE -> night
    }
    return ((alpha * 255).roundToInt() shl 24) or (if (dark) BLACK else WHITE)
  }

  /** The radius the blur effect gets, in pixels of the backdrop picture, which is [scale] (picture width over view width) times the view's size. */
  fun radius(intensity: Double, density: Float, scale: Float): Float = (intensity / 100.0 * MAX_RADIUS_DP).toFloat() * density * scale

  fun hasEffect(radius: Float): Boolean = radius >= MIN_EFFECT_RADIUS

  /** Whether the view can show a real blur: a version with `RenderEffect` and a hardware accelerated canvas. */
  fun canBlur(sdk: Int, hardwareAccelerated: Boolean): Boolean = sdk >= MIN_BLUR_SDK && hardwareAccelerated

  /**
   * Why a pre-draw of the backdrop does nothing (`Backdrop.update`), in the order the reasons are looked at, which is the order of their cost: the cheap facts of the view first, and the walks up its parents
   * (visibility on the screen, a layer) after. `null` is a pre-draw that draws the picture. [onScreen], [isRoot] and [layered] are asked only when the facts before them let the question be asked.
   */
  enum class Idle { NO_SIZE, NO_INTENSITY, NOT_SHOWN, WINDOW_HIDDEN, OFF_SCREEN, IS_ROOT, LAYER }

  inline fun idleReason(
    width: Int,
    height: Int,
    intensity: Double,
    shown: Boolean,
    windowVisible: Boolean,
    onScreen: () -> Boolean,
    isRoot: () -> Boolean,
    layered: () -> Boolean,
  ): Idle? = when {
    width <= 0 || height <= 0 -> Idle.NO_SIZE
    intensity <= 0.0 -> Idle.NO_INTENSITY
    !shown -> Idle.NOT_SHOWN
    !windowVisible -> Idle.WINDOW_HIDDEN
    !onScreen() -> Idle.OFF_SCREEN
    isRoot() -> Idle.IS_ROOT
    layered() -> Idle.LAYER
    else -> null
  }

  /**
   * Whether a pre-draw that did nothing for [reason] asks for a frame of its own ([asked]: it already did, for as long as the reason has stood). A view under a layer waits for the layer to go, and a layer
   * goes by itself when a transition ends, but not when a screen holds one while it stands still (the engine's resident layer lets go of it on the first invalidation under the screen, and nothing else): a
   * pre-draw only runs for a frame, and a screen at rest has none, so the view that waited for the layer to go would wait for ever, drawing its stronger tint. One invalidation of the view is what the
   * screen's layer lets go for, and the frame it makes is the one the picture is drawn in.
   */
  fun asksForFrame(reason: Idle?, asked: Boolean): Boolean = reason == Idle.LAYER && !asked

  /**
   * Whether a picture drawn now is recorded: when it is not the one on show ([sameAsShown]), and also when the view has stood idle under a layer since ([stale]): what the node holds was recorded before
   * the layer and may not be what is behind the view now, and a picture that "equals" it is not a reason to leave the node as it is.
   */
  fun shouldRecord(sameAsShown: Boolean, stale: Boolean): Boolean = !sameAsShown || stale

  /**
   * The side, in pixels, of the bitmaps that hold a picture [needed] pixels across, when they are [current] now (0 when there are none): [current] while the picture
   * fits and is not under half of it, otherwise [needed] rounded up to [CAPACITY_STEP]. A picture smaller than the bitmap is drawn into its corner.
   */
  fun capacity(needed: Int, current: Int): Int =
    if (current > 0 && needed <= current && needed * 2 >= current) current else ((max(needed, 1) + CAPACITY_STEP - 1) / CAPACITY_STEP) * CAPACITY_STEP

  /**
   * How much of its size a hardware bitmap's software copy keeps. The backdrop is [divisor] times smaller than the window, and a bitmap is about as big as the
   * pixels it covers, so twice the backdrop's resolution (`2 / divisor`, at most 1) is enough for the bilinear scaling to look right and the copy takes a
   * fourth of the pixels at the first divisor.
   */
  fun copyScale(divisor: Int): Float = minOf(1f, 2f / divisor)

  /** A side of the copy of a bitmap whose side is [size] pixels: [scale] of it, at least one pixel. */
  fun copySide(size: Int, scale: Float): Int = max(1, (size * scale).roundToInt())

  /** The size of the backdrop picture of a view [width] by [height] pixels: the view's size over [divisor], at least one pixel each way. */
  class Picture(val width: Int, val height: Int, val divisor: Int) {
    val pictureWidth: Int = max(1, ceil(width.toDouble() / divisor).toInt())
    val pictureHeight: Int = max(1, ceil(height.toDouble() / divisor).toInt())

    /** How many pixels of the view one pixel of the picture covers across and down (the divisor, but for the rounding up). */
    val scaleX: Float get() = width.toFloat() / pictureWidth
    val scaleY: Float get() = height.toFloat() / pictureHeight
  }

  /** The picture for a view that has a size, `null` for one that has none. */
  fun picture(width: Int, height: Int): Picture? {
    if (width <= 0 || height <= 0) return null
    var divisor = DIVISOR
    while (ceil(width.toDouble() / divisor) * ceil(height.toDouble() / divisor) > MAX_PIXELS) divisor *= 2
    return Picture(width, height, divisor)
  }
}
