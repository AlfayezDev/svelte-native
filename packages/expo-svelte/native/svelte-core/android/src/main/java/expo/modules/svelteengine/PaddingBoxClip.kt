package expo.modules.svelteengine

import android.graphics.Canvas
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.view.View
import com.facebook.react.uimanager.PixelUtil

/**
 * `BackgroundStyleApplicator.clipToPaddingBox` without its allocations (SPEC.md, "Box styles"): `overflow: hidden` clips what a view draws to the inside of its border, with the corners
 * rounded by the radii less the border's widths. React Native's allocates a `Rect`, a `RectF`, a `Path` and an array of radii for every draw of every view that clips; this keeps them, so a
 * list of clipping rows allocates nothing while it scrolls. The arithmetic is React Native's, in its units (radii and widths in dp, resolved against the bounds in dp as
 * `BorderRadiusStyle.resolve` does, converted with `PixelUtil` where React Native converts), and the host check reads both sources for it (`StyleRulesCheck`).
 */
class PaddingBoxClip {
  private val drawing = Rect()
  private val box = RectF()
  private val path = Path()
  private val resolved = FloatArray(8)
  private val inner = FloatArray(8)
  private val radiiDp = FloatArray(4)
  private val widthsDp = FloatArray(4)

  /** Clips [canvas] for a view whose box is drawn by React Native's drawables: [radiiPx] and [widthsPx] are what `BoxStyle` gave them, in px (the node's mirrors). */
  fun clipPx(view: View, canvas: Canvas, radiiPx: FloatArray, widthsPx: FloatArray) {
    val density = view.resources.displayMetrics.density
    for (k in 0..3) {
      radiiDp[k] = radiiPx[k] / density
      widthsDp[k] = widthsPx[k] / density
    }
    clipDp(view, canvas, 0, 0, view.width, view.height, radiiDp, widthsDp)
  }

  /** The bounds of the box are [left], [top], [right] and [bottom] (px, a view's own: `0, 0, width, height`), the radii top left, top right, bottom right, bottom left and the widths left, top, right, bottom, dp. */
  fun clipDp(view: View, canvas: Canvas, left: Int, top: Int, right: Int, bottom: Int, radii: FloatArray, widths: FloatArray) {
    view.getDrawingRect(drawing)
    val insetLeft = PixelUtil.toPixelFromDIP(widths[0])
    val insetTop = PixelUtil.toPixelFromDIP(widths[1])
    val insetRight = PixelUtil.toPixelFromDIP(widths[2])
    val insetBottom = PixelUtil.toPixelFromDIP(widths[3])
    box.set(left + insetLeft, top + insetTop, right - insetRight, bottom - insetBottom)
    if (StyleRules.hasRadius(radii)) {
      for (k in 0..3) {
        resolved[2 * k] = radii[k]
        resolved[2 * k + 1] = radii[k]
      }
      StyleRules.ensureNoOverlap(resolved, PixelUtil.toDIPFromPixel((right - left).toFloat()), PixelUtil.toDIPFromPixel((bottom - top).toFloat()))
      inner[0] = inner(resolved[0], insetLeft)
      inner[1] = inner(resolved[1], insetTop)
      inner[2] = inner(resolved[2], insetRight)
      inner[3] = inner(resolved[3], insetTop)
      inner[4] = inner(resolved[4], insetRight)
      inner[5] = inner(resolved[5], insetBottom)
      inner[6] = inner(resolved[6], insetLeft)
      inner[7] = inner(resolved[7], insetBottom)
      path.reset()
      path.addRoundRect(box, inner, Path.Direction.CW)
      path.offset(drawing.left.toFloat(), drawing.top.toFloat())
      canvas.clipPath(path)
    } else {
      box.offset(drawing.left.toFloat(), drawing.top.toFloat())
      canvas.clipRect(box)
    }
  }

  /** `getInnerBorderRadius`: a radius (dp) less the border's width (px), in px, never below 0. */
  private fun inner(radiusDp: Float, insetPx: Float): Float = (PixelUtil.toPixelFromDIP(radiusDp) - insetPx).coerceAtLeast(0f)
}
