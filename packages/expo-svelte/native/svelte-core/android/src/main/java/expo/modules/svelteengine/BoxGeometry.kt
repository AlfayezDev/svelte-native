package expo.modules.svelteengine

/**
 * The geometry of the border of square corners, as `BorderDrawable.drawRectangularBorders` computes it, as plain numbers so the host can run it (SPEC.md, "Box styles", `StyleRulesCheck`):
 * where the stroke of each side runs, and the corners of the four quadrilaterals. Sides are 0 left, 1 top, 2 right, 3 bottom; [borders] are the widths rounded to a pixel (left, top, right,
 * bottom). Bounds are the drawable's, `left`, `top`, `right` and `bottom`, `width` and `height` (px).
 */
internal object BoxGeometry {
  /**
   * The line a side's stroke follows, written to [out] as x1, y1, x2, y2: along the middle of the side's [border] pixels, from one end of the box to the other, where the middle is
   * `border / 2` with integer division from the edge (a 3 px border's line is 1 px in, so the stroke covers the pixels 0 to 3).
   */
  fun strokeLine(side: Int, left: Int, top: Int, right: Int, bottom: Int, border: Int, out: FloatArray) {
    when (side) {
      0 -> {
        val x = (left + border / 2).toFloat()
        out[0] = x; out[1] = top.toFloat(); out[2] = x; out[3] = bottom.toFloat()
      }
      1 -> {
        val y = (top + border / 2).toFloat()
        out[0] = left.toFloat(); out[1] = y; out[2] = right.toFloat(); out[3] = y
      }
      2 -> {
        val x = (right - border / 2).toFloat()
        out[0] = x; out[1] = top.toFloat(); out[2] = x; out[3] = bottom.toFloat()
      }
      else -> {
        val y = (bottom - border / 2).toFloat()
        out[0] = left.toFloat(); out[1] = y; out[2] = right.toFloat(); out[3] = y
      }
    }
  }

  /** The corners of the quadrilateral of a side, x1, y1 to x4, y4 into [out]: its outer edge and its inner one, the diagonals at the corners going where the neighbours' widths say. */
  fun quadrilateral(side: Int, left: Int, top: Int, width: Int, height: Int, borders: IntArray, out: FloatArray) {
    val l = borders[0]
    val t = borders[1]
    val r = borders[2]
    val b = borders[3]
    when (side) {
      0 -> set(out, left, top, left + l, top + t, left + l, top + height - b, left, top + height)
      1 -> set(out, left, top, left + l, top + t, left + width - r, top + t, left + width, top)
      2 -> set(out, left + width, top, left + width, top + height, left + width - r, top + height - b, left + width - r, top + t)
      else -> set(out, left, top + height, left + width, top + height, left + width - r, top + height - b, left + l, top + height - b)
    }
  }

  private fun set(out: FloatArray, x1: Int, y1: Int, x2: Int, y2: Int, x3: Int, y3: Int, x4: Int, y4: Int) {
    out[0] = x1.toFloat(); out[1] = y1.toFloat(); out[2] = x2.toFloat(); out[3] = y2.toFloat()
    out[4] = x3.toFloat(); out[5] = y3.toFloat(); out[6] = x4.toFloat(); out[7] = y4.toFloat()
  }
}
