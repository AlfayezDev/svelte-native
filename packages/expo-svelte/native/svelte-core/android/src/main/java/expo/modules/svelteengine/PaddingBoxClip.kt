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
  private val rect = FloatArray(4)
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
    val rounded = BoxGeometry.paddingBox(left, top, right, bottom, widths, radii, PixelUtil.getDisplayMetricDensity(), resolved, rect, inner)
    box.set(rect[0], rect[1], rect[2], rect[3])
    if (rounded) {
      path.reset()
      path.addRoundRect(box, inner, Path.Direction.CW)
      path.offset(drawing.left.toFloat(), drawing.top.toFloat())
      canvas.clipPath(path)
    } else {
      box.offset(drawing.left.toFloat(), drawing.top.toFloat())
      canvas.clipRect(box)
    }
  }
}
