package expo.modules.svelteengine

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.DashPathEffect
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathEffect
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.View
import com.facebook.react.uimanager.PixelUtil
import kotlin.math.roundToInt

/**
 * The box of the common cases, drawn by one drawable of the engine's (SPEC.md, "Box styles", `StyleRules.boxKind`): a fill and
 * - a solid border of one width and one colour with round corners (any radii) or square ones,
 * - a border of square corners whose sides have their own widths or colours (a divider is a bottom border only), solid, or dashed and dotted when it is one colour,
 * - no border and corners of different radii (a `GradientDrawable` scales radii that overflow together; React Native's scale each corner).
 * What React Native draws for these with a `CompositeBackgroundDrawable` (a `LayerDrawable` of a `BackgroundDrawable` and a `BorderDrawable`, and the style objects they read) is drawn
 * here the same way, step for step, with no layers and no style objects: `BackgroundDrawable.draw` (the fill, a rounded one pulled in by 0.8 px where a border covers its edge), then
 * `BorderDrawable.drawRectangularBorders` (a stroke of whole pixels along the middle of each side, or the four quadrilaterals for a translucent or mixed colour) or `drawRoundedBorders`
 * (a stroke of the width along the centre line of the border, clipped to the outer rounded rectangle), `CompositeBackgroundDrawable.getOutline` for the elevation's shadow and
 * `BackgroundStyleApplicator.clipToPaddingBox` for `overflow` (that is [PaddingBoxClip]). Lengths are the dp React Native's drawables hold, converted with `PixelUtil` where
 * they convert, in the same operations; the radii go through `ensureNoOverlap` as `BorderRadiusStyle.resolve` does ([StyleRules.ensureNoOverlap]). The host check reads both sources
 * for the constants and the calls (`StyleRulesCheck`), and `/__dev/styles` compares the pixels with React Native's own views, tile by tile.
 *
 * Sides and corners are the physical ones Fabric resolved (right to left already applied): there is no edge to resolve by a layout direction here, so the drawable has no direction.
 * Round corners need one width and one colour (`StyleRules.boxKind` sends nothing else here); the widths and colours of the four sides are for square corners.
 *
 * One difference, on purpose: the stroke's paint style is set for each kind of drawing, where React Native's `BorderDrawable` keeps the one of its last fast-path draw (a view whose
 * border went from opaque to translucent draws its quadrilaterals as outlines there, a view that was never opaque as fills), and the path effect of a dashed border is set for the
 * strokes only.
 */
class BoxDrawable : Drawable() {
  private var fill = 0
  /** Left, top, right, bottom. */
  private val colors = IntArray(4)
  /** Left, top, right, bottom, dp. */
  private val widthsDp = FloatArray(4)
  /** Top left, top right, bottom right, bottom left, dp; 0 is no radius. */
  private val radiiDp = FloatArray(4)
  /** 0 solid, 1 dashed, 2 dotted. */
  private var borderStyle = 0
  private var rounded = false
  private var drawAlpha = 255

  private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val backgroundRect = RectF()
  private val backgroundPath = Path()
  private val outerClipPath = Path()
  private val centerRect = RectF()
  private val centerPath = Path()
  private val centerRadii = FloatArray(8)
  private val sidePath = Path()
  private val line = FloatArray(4)
  private val quad = FloatArray(8)
  private val boundsRect = RectF()
  /** The resolved radii, dp, as [StyleRules.ensureNoOverlap] leaves them: top left (horizontal, vertical), top right, bottom right, bottom left. */
  private val computed = FloatArray(8)
  /** [computed] in px. */
  private val radiiPx = FloatArray(8)
  private val scratch = FloatArray(8)
  /** What [getOutline] builds, kept: the outline is asked for by every view that is attached or resized. */
  private val outlinePath = Path()
  private val outlineRadii = FloatArray(8)
  /** The widths in px, and each rounded to a pixel (what the strokes and quadrilaterals of square corners use). */
  private val widthsPx = FloatArray(4)
  private val borders = IntArray(4)
  /** The path effect of each side's stroke (dashes and dots), null for solid. */
  private val effects = arrayOfNulls<PathEffect>(4)
  private val clip = PaddingBoxClip()
  private var uniformRadii = false
  private var anyWidth = false
  private var needUpdatePath = true

  /** Writes the box; true when something differed (the drawable draws again). [widths] and [radii] are dp, [colors] ARGB, all in the orders above. */
  fun set(fill: Int, colors: IntArray, widths: FloatArray, radii: FloatArray, style: Int): Boolean {
    var changed = false
    if (this.fill != fill) { this.fill = fill; changed = true }
    if (!this.colors.contentEquals(colors)) { colors.copyInto(this.colors); changed = true }
    if (!widthsDp.contentEquals(widths)) { widths.copyInto(widthsDp); changed = true }
    if (setRadiiQuietly(radii)) changed = true
    if (borderStyle != style) { borderStyle = style; changed = true }
    if (changed) { needUpdatePath = true; invalidateSelf() }
    return changed
  }

  fun setFill(fill: Int) {
    if (this.fill == fill) return
    this.fill = fill
    invalidateSelf()
  }

  fun setRadii(radii: FloatArray) {
    if (setRadiiQuietly(radii)) { needUpdatePath = true; invalidateSelf() }
  }

  private fun setRadiiQuietly(radii: FloatArray): Boolean {
    if (radiiDp.contentEquals(radii)) return false
    radii.copyInto(radiiDp)
    rounded = StyleRules.hasRadius(radiiDp)
    return true
  }

  override fun onBoundsChange(bounds: Rect) {
    super.onBoundsChange(bounds)
    needUpdatePath = true
  }

  override fun setAlpha(alpha: Int) {
    drawAlpha = alpha
    invalidateSelf()
  }

  override fun setColorFilter(colorFilter: ColorFilter?) {}

  @Deprecated("Deprecated in Java")
  override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

  /** The radii of the bounds, dp, resolved against a width and a height in dp (`BorderRadiusStyle.resolve`). */
  private fun resolve(into: FloatArray, width: Float, height: Float) {
    for (k in 0..3) { into[2 * k] = radiiDp[k]; into[2 * k + 1] = radiiDp[k] }
    StyleRules.ensureNoOverlap(into, width, height)
  }

  private fun updatePath() {
    if (!needUpdatePath) return
    needUpdatePath = false
    anyWidth = false
    for (side in 0..3) {
      widthsPx[side] = PixelUtil.toPixelFromDIP(widthsDp[side])
      borders[side] = widthsPx[side].roundToInt()
      if (widthsDp[side] != 0f) anyWidth = true
      effects[side] = if (borderStyle == 0 || borders[side] <= 0) null else dashes(borderStyle, borders[side].toFloat())
    }
    resolve(computed, PixelUtil.toDIPFromPixel(bounds.width().toFloat()), PixelUtil.toDIPFromPixel(bounds.height().toFloat()))
    uniformRadii = computed[0] == computed[2] && computed[1] == computed[3] && computed[0] == computed[4] && computed[1] == computed[5] &&
      computed[0] == computed[6] && computed[1] == computed[7]

    // BackgroundDrawable.updatePath: the fill is the whole bounds, pulled in by `pathAdjustment` where the border is drawn over its rounded edge.
    backgroundRect.set(bounds)
    if (anyWidth && rounded) {
      backgroundRect.left += PATH_ADJUSTMENT
      backgroundRect.top += PATH_ADJUSTMENT
      backgroundRect.right -= PATH_ADJUSTMENT
      backgroundRect.bottom -= PATH_ADJUSTMENT
    }
    if (rounded) for (k in 0..7) radiiPx[k] = PixelUtil.toPixelFromDIP(computed[k])
    if (rounded && !uniformRadii) {
      backgroundPath.reset()
      backgroundPath.addRoundRect(backgroundRect, radiiPx, Path.Direction.CW)
    }

    // BorderDrawable.updatePath: the outer rounded rectangle, the centre line of the border, its path when the corners differ (round corners have one width, the first).
    if (rounded && anyWidth) {
      val half = widthsPx[0] * 0.5f
      boundsRect.set(bounds)
      outerClipPath.reset()
      outerClipPath.addRoundRect(boundsRect, radiiPx, Path.Direction.CW)
      centerRect.set(bounds)
      centerRect.top += half
      centerRect.bottom -= half
      centerRect.left += half
      centerRect.right -= half
      if (!uniformRadii) {
        for (k in 0..7) centerRadii[k] = radiiPx[k] - half
        centerPath.reset()
        centerPath.addRoundRect(centerRect, centerRadii, Path.Direction.CW)
      }
    }
  }

  override fun draw(canvas: Canvas) {
    if (bounds.isEmpty) return
    updatePath()
    // BackgroundDrawable.draw
    backgroundPaint.color = fill
    if (drawAlpha != 255) backgroundPaint.alpha = (((drawAlpha / 255f) * (Color.alpha(fill) / 255f)) * 255f).roundToInt()
    if (backgroundPaint.alpha != 0) {
      if (uniformRadii && rounded) {
        canvas.drawRoundRect(backgroundRect, PixelUtil.toPixelFromDIP(computed[0]), PixelUtil.toPixelFromDIP(computed[1]), backgroundPaint)
      } else if (!rounded) {
        canvas.drawRect(backgroundRect, backgroundPaint)
      } else {
        canvas.drawPath(backgroundPath, backgroundPaint)
      }
    }
    // BorderDrawable.draw
    if (!anyWidth) return
    if (rounded) drawRoundedBorders(canvas) else drawRectangularBorders(canvas)
  }

  private fun drawRectangularBorders(canvas: Canvas) {
    val borderLeft = borders[0]
    val borderTop = borders[1]
    val borderRight = borders[2]
    val borderBottom = borders[3]
    if (borderLeft <= 0 && borderTop <= 0 && borderRight <= 0 && borderBottom <= 0) return
    val left = bounds.left
    val top = bounds.top
    val right = bounds.right
    val bottom = bounds.bottom
    val fast = StyleRules.fastBorderColor(widthsPx, colors)
    if (fast != 0) {
      // One colour, none of them translucent: a stroke along the middle of each side that has a width.
      borderPaint.color = multiplyColorAlpha(fast, drawAlpha)
      borderPaint.style = Paint.Style.STROKE
      for (side in 0..3) {
        if (borders[side] <= 0) continue
        BoxGeometry.strokeLine(side, left, top, right, bottom, borders[side], line)
        stroke(canvas, side)
      }
    } else {
      // The quadrilaterals, with no anti-aliasing (they meet on the diagonals of the corners).
      borderPaint.pathEffect = null
      borderPaint.isAntiAlias = false
      borderPaint.style = Paint.Style.FILL
      for (side in 0..3) {
        if (borders[side] <= 0 || colors[side] == Color.TRANSPARENT) continue
        BoxGeometry.quadrilateral(side, left, top, bounds.width(), bounds.height(), borders, quad)
        borderPaint.color = multiplyColorAlpha(colors[side], drawAlpha)
        sidePath.reset()
        sidePath.moveTo(quad[0], quad[1])
        sidePath.lineTo(quad[2], quad[3])
        sidePath.lineTo(quad[4], quad[5])
        sidePath.lineTo(quad[6], quad[7])
        sidePath.lineTo(quad[0], quad[1])
        canvas.drawPath(sidePath, borderPaint)
      }
      borderPaint.isAntiAlias = true
    }
  }

  /** The stroke of [side] along [line], as wide as the side's border, with the dashes of that width. */
  private fun stroke(canvas: Canvas, side: Int) {
    borderPaint.pathEffect = effects[side]
    borderPaint.strokeWidth = borders[side].toFloat()
    sidePath.reset()
    sidePath.moveTo(line[0], line[1])
    sidePath.lineTo(line[2], line[3])
    canvas.drawPath(sidePath, borderPaint)
  }

  private fun drawRoundedBorders(canvas: Canvas) {
    canvas.save()
    canvas.clipPath(outerClipPath)
    val widthPx = widthsPx[0]
    if (widthPx > 0f) {
      borderPaint.pathEffect = null
      borderPaint.color = multiplyColorAlpha(colors[0], drawAlpha)
      borderPaint.style = Paint.Style.STROKE
      borderPaint.strokeWidth = widthPx
      if (uniformRadii) {
        canvas.drawRoundRect(centerRect, PixelUtil.toPixelFromDIP(computed[0]) - widthPx * 0.5f, PixelUtil.toPixelFromDIP(computed[1]) - widthPx * 0.5f, borderPaint)
      } else {
        canvas.drawPath(centerPath, borderPaint)
      }
    }
    canvas.restore()
  }

  /**
   * `CompositeBackgroundDrawable.getOutline`: the shadow of `elevation` follows the rounded rectangle, each radius grown by the border's width. A view asks for it when it is attached,
   * before it has a size, and an empty rectangle has an empty outline (`Outline.setRoundRect`), which is all React Native's gives then: nothing is built for it.
   */
  override fun getOutline(outline: Outline) {
    if (bounds.isEmpty) {
      outline.setEmpty()
      return
    }
    if (!rounded) {
      outline.setRect(bounds)
      return
    }
    // React Native resolves these against the bounds in px, as if they were dp. Round corners have one width, the border's, in dp.
    resolve(scratch, bounds.width().toFloat(), bounds.height().toFloat())
    for (k in 0..7) outlineRadii[k] = PixelUtil.toPixelFromDIP(scratch[k] + widthsDp[0])
    outlinePath.reset()
    boundsRect.set(bounds)
    outlinePath.addRoundRect(boundsRect, outlineRadii, Path.Direction.CW)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      outline.setPath(outlinePath)
    } else {
      @Suppress("DEPRECATION") outline.setConvexPath(outlinePath)
    }
  }

  /** `overflow: hidden` for the view this drawable is the background of: [PaddingBoxClip], with this box's bounds, radii and widths. [canvas] is the one `dispatchDraw` gets. */
  fun clipToPaddingBox(view: View, canvas: Canvas) {
    clip.clipDp(view, canvas, bounds.left, bounds.top, bounds.right, bounds.bottom, radiiDp, widthsDp)
  }

  /** `BorderDrawable.getPathEffect`. */
  private fun dashes(style: Int, width: Float): PathEffect =
    if (style == 1) DashPathEffect(floatArrayOf(width * 3, width * 3, width * 3, width * 3), 0f) else DashPathEffect(floatArrayOf(width, width, width, width), 0f)

  /** `BorderDrawable.multiplyColorAlpha`. */
  private fun multiplyColorAlpha(color: Int, rawAlpha: Int): Int {
    if (rawAlpha == 255) return color
    if (rawAlpha == 0) return color and 0x00FFFFFF
    val alpha = rawAlpha + (rawAlpha shr 7)
    val colorAlpha = color ushr 24
    val multipliedAlpha = colorAlpha * (alpha shr 7) shr 8
    return (multipliedAlpha shl 24) or (color and 0x00FFFFFF)
  }

  private companion object {
    /** `BackgroundDrawable.pathAdjustment`. */
    const val PATH_ADJUSTMENT = 0.8f
  }
}
