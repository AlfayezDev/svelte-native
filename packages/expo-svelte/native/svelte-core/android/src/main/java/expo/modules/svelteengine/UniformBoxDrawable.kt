package expo.modules.svelteengine

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.View
import com.facebook.react.uimanager.PixelUtil
import kotlin.math.roundToInt

/**
 * The box of the common case, drawn by one drawable: a fill and a border of one width and one colour, solid, round corners (any radii) or none, no shadow (SPEC.md, "Box styles").
 * What React Native draws for it with a `CompositeBackgroundDrawable` (a `LayerDrawable` of a `BackgroundDrawable` and a `BorderDrawable`, and the style objects they read) is drawn
 * here the same way, step for step, with no layers and no style objects: `BackgroundDrawable.draw` (the fill, a rounded one pulled in by 0.8 px where a border covers its edge), then
 * `BorderDrawable.drawRectangularBorders` (a stroke of whole pixels for each side, or the four quadrilaterals for a translucent colour) or `drawRoundedBorders` (a stroke of the
 * width along the centre line of the border, clipped to the outer rounded rectangle), `CompositeBackgroundDrawable.getOutline` for the elevation's shadow and
 * `BackgroundStyleApplicator.clipToPaddingBox` for `overflow` (that is [clipToPaddingBox]). Lengths are the dp React Native's drawables hold, converted with `PixelUtil` where
 * they convert, in the same operations; the radii go through `ensureNoOverlap` as `BorderRadiusStyle.resolve` does ([StyleRules.ensureNoOverlap]). The host check reads both sources
 * for the constants and the calls (`StyleRulesCheck`), and `/__dev/styles` compares the pixels with React Native's own views, tile by tile.
 *
 * One difference, on purpose: the stroke's paint style is set for each kind of drawing, where React Native's `BorderDrawable` keeps the one of its last fast-path draw (a view whose
 * border went from opaque to translucent draws its quadrilaterals as outlines there, a view that was never opaque as fills).
 */
class UniformBoxDrawable : Drawable() {
  private var fill = 0
  private var color = 0
  private var widthDp = 0f
  /** Top left, top right, bottom right, bottom left, dp; 0 is no radius. */
  private val radiiDp = FloatArray(4)
  private var rounded = false
  private var drawAlpha = 255

  private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val backgroundRect = RectF()
  private val backgroundPath = Path()
  private val outerClipPath = Path()
  private val centerRect = RectF()
  private val centerPath = Path()
  private val sidePath = Path()
  private val boundsRect = RectF()
  /** The resolved radii, dp, as [StyleRules.ensureNoOverlap] leaves them: top left (horizontal, vertical), top right, bottom right, bottom left. */
  private val computed = FloatArray(8)
  /** [computed] in px. */
  private val radiiPx = FloatArray(8)
  private val scratch = FloatArray(8)
  private var uniformRadii = false
  private var needUpdatePath = true

  /** Writes the box; true when something differed (the drawable draws again). [radii] are dp. */
  fun set(fill: Int, color: Int, widthDp: Float, radii: FloatArray): Boolean {
    var changed = false
    if (this.fill != fill) { this.fill = fill; changed = true }
    if (this.color != color) { this.color = color; changed = true }
    if (this.widthDp != widthDp) { this.widthDp = widthDp; changed = true }
    if (setRadiiQuietly(radii)) changed = true
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
    var changed = false
    for (k in 0..3) if (radiiDp[k] != radii[k]) { radiiDp[k] = radii[k]; changed = true }
    if (changed) rounded = radiiDp.any { it > 0f }
    return changed
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
    val widthPx = PixelUtil.toPixelFromDIP(widthDp)
    resolve(computed, PixelUtil.toDIPFromPixel(bounds.width().toFloat()), PixelUtil.toDIPFromPixel(bounds.height().toFloat()))
    uniformRadii = computed[0] == computed[2] && computed[1] == computed[3] && computed[0] == computed[4] && computed[1] == computed[5] &&
      computed[0] == computed[6] && computed[1] == computed[7]

    // BackgroundDrawable.updatePath: the fill is the whole bounds, pulled in by `pathAdjustment` where the border is drawn over its rounded edge.
    backgroundRect.set(bounds)
    if (widthPx != 0f && rounded) {
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

    // BorderDrawable.updatePath: the outer rounded rectangle, the centre line of the border, its path when the corners differ.
    if (rounded) {
      boundsRect.set(bounds)
      outerClipPath.reset()
      outerClipPath.addRoundRect(boundsRect, radiiPx, Path.Direction.CW)
      centerRect.set(bounds)
      centerRect.top += widthPx * 0.5f
      centerRect.bottom -= widthPx * 0.5f
      centerRect.left += widthPx * 0.5f
      centerRect.right -= widthPx * 0.5f
      if (!uniformRadii) {
        centerPath.reset()
        val half = widthPx * 0.5f
        centerPath.addRoundRect(
          centerRect,
          floatArrayOf(
            radiiPx[0] - half, radiiPx[1] - half, radiiPx[2] - half, radiiPx[3] - half,
            radiiPx[4] - half, radiiPx[5] - half, radiiPx[6] - half, radiiPx[7] - half,
          ),
          Path.Direction.CW,
        )
      }
    }
  }

  override fun draw(canvas: Canvas) {
    if (bounds.isEmpty) return
    updatePath()
    val widthPx = PixelUtil.toPixelFromDIP(widthDp)
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
    if (rounded) drawRoundedBorders(canvas, widthPx) else drawRectangularBorders(canvas, widthPx)
  }

  private fun drawRectangularBorders(canvas: Canvas, widthPx: Float) {
    val border = widthPx.roundToInt()
    if (border <= 0) return
    val left = bounds.left
    val top = bounds.top
    val right = bounds.right
    val bottom = bounds.bottom
    // `fastBorderCompatibleColorOrZero`: the four sides have one colour here, so it is that colour unless it is translucent.
    val fast = if (Color.alpha(color) < 255) 0 else color
    borderPaint.pathEffect = null
    if (fast != 0) {
      if (Color.alpha(fast) != 0) {
        borderPaint.color = multiplyColorAlpha(fast, drawAlpha)
        borderPaint.style = Paint.Style.STROKE
        val half = (border / 2).toFloat()
        // left, top, right, bottom, each a line along the middle of the side's `border` pixels
        borderPaint.strokeWidth = border.toFloat()
        sidePath.reset()
        sidePath.moveTo(left + half, top.toFloat())
        sidePath.lineTo(left + half, bottom.toFloat())
        canvas.drawPath(sidePath, borderPaint)
        sidePath.reset()
        sidePath.moveTo(left.toFloat(), top + half)
        sidePath.lineTo(right.toFloat(), top + half)
        canvas.drawPath(sidePath, borderPaint)
        sidePath.reset()
        sidePath.moveTo(right - half, top.toFloat())
        sidePath.lineTo(right - half, bottom.toFloat())
        canvas.drawPath(sidePath, borderPaint)
        sidePath.reset()
        sidePath.moveTo(left.toFloat(), bottom - half)
        sidePath.lineTo(right.toFloat(), bottom - half)
        canvas.drawPath(sidePath, borderPaint)
      }
    } else {
      // The four quadrilaterals, with no anti-aliasing (they meet on the diagonals of the corners).
      borderPaint.isAntiAlias = false
      borderPaint.style = Paint.Style.FILL
      val width = bounds.width()
      val height = bounds.height()
      val l = left.toFloat()
      val t = top.toFloat()
      val b = border.toFloat()
      quadrilateral(canvas, l, t, l + b, t + b, l + b, t + height - b, l, t + height)
      quadrilateral(canvas, l, t, l + b, t + b, l + width - b, t + b, l + width, t)
      quadrilateral(canvas, l + width, t, l + width, t + height, l + width - b, t + height - b, l + width - b, t + b)
      quadrilateral(canvas, l, t + height, l + width, t + height, l + width - b, t + height - b, l + b, t + height - b)
      borderPaint.isAntiAlias = true
    }
  }

  private fun quadrilateral(canvas: Canvas, x1: Float, y1: Float, x2: Float, y2: Float, x3: Float, y3: Float, x4: Float, y4: Float) {
    if (color == Color.TRANSPARENT) return
    borderPaint.color = multiplyColorAlpha(color, drawAlpha)
    sidePath.reset()
    sidePath.moveTo(x1, y1)
    sidePath.lineTo(x2, y2)
    sidePath.lineTo(x3, y3)
    sidePath.lineTo(x4, y4)
    sidePath.lineTo(x1, y1)
    canvas.drawPath(sidePath, borderPaint)
  }

  private fun drawRoundedBorders(canvas: Canvas, widthPx: Float) {
    canvas.save()
    canvas.clipPath(outerClipPath)
    if (widthPx > 0f) {
      borderPaint.pathEffect = null
      borderPaint.color = multiplyColorAlpha(color, drawAlpha)
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

  /** `CompositeBackgroundDrawable.getOutline`: the shadow of `elevation` follows the rounded rectangle, each radius grown by the border's width. */
  override fun getOutline(outline: Outline) {
    if (!rounded) {
      outline.setRect(bounds)
      return
    }
    // React Native resolves these against the bounds in px, as if they were dp.
    resolve(scratch, bounds.width().toFloat(), bounds.height().toFloat())
    val path = Path()
    path.addRoundRect(
      RectF(bounds),
      floatArrayOf(
        PixelUtil.toPixelFromDIP(scratch[0] + widthDp), PixelUtil.toPixelFromDIP(scratch[1] + widthDp),
        PixelUtil.toPixelFromDIP(scratch[2] + widthDp), PixelUtil.toPixelFromDIP(scratch[3] + widthDp),
        PixelUtil.toPixelFromDIP(scratch[4] + widthDp), PixelUtil.toPixelFromDIP(scratch[5] + widthDp),
        PixelUtil.toPixelFromDIP(scratch[6] + widthDp), PixelUtil.toPixelFromDIP(scratch[7] + widthDp),
      ),
      Path.Direction.CW,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      outline.setPath(path)
    } else {
      @Suppress("DEPRECATION") outline.setConvexPath(path)
    }
  }

  /**
   * `overflow: hidden` clips what the view draws to the inside of its border, with the corners rounded by the radii less the width (`BackgroundStyleApplicator.clipToPaddingBox`).
   * [canvas] is the one `dispatchDraw` gets.
   */
  fun clipToPaddingBox(view: View, canvas: Canvas) {
    val drawing = Rect()
    view.getDrawingRect(drawing)
    val inset = PixelUtil.toPixelFromDIP(widthDp)
    val box = RectF(
      bounds.left + inset,
      bounds.top + inset,
      bounds.right - inset,
      bounds.bottom - inset,
    )
    if (rounded) {
      resolve(scratch, PixelUtil.toDIPFromPixel(bounds.width().toFloat()), PixelUtil.toDIPFromPixel(bounds.height().toFloat()))
      val path = Path()
      path.addRoundRect(
        box,
        floatArrayOf(
          inner(scratch[0], inset), inner(scratch[1], inset), inner(scratch[2], inset), inner(scratch[3], inset),
          inner(scratch[4], inset), inner(scratch[5], inset), inner(scratch[6], inset), inner(scratch[7], inset),
        ),
        Path.Direction.CW,
      )
      path.offset(drawing.left.toFloat(), drawing.top.toFloat())
      canvas.clipPath(path)
    } else {
      box.offset(drawing.left.toFloat(), drawing.top.toFloat())
      canvas.clipRect(box)
    }
  }

  /** `getInnerBorderRadius`: a radius (dp) less the border's width (px), in px, never below 0. */
  private fun inner(radiusDp: Float, insetPx: Float): Float = (PixelUtil.toPixelFromDIP(radiusDp) - insetPx).coerceAtLeast(0f)

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
