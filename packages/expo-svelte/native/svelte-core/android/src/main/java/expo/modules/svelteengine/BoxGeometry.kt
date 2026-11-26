package expo.modules.svelteengine

/**
 * The geometry of the engine's box drawable, as `BackgroundDrawable`, `BorderDrawable`, `CompositeBackgroundDrawable` and `BackgroundStyleApplicator` compute it, as plain numbers so the host can
 * run it (SPEC.md, "Box styles", `StyleRulesCheck`): the radii resolved against the bounds, the rectangle of the fill, the centre line of a round border, the outline, the padding box and its
 * radii, and, for square corners, where the stroke of each side runs and the corners of the four quadrilaterals. Lengths are dp where React Native's are, converted with the density as
 * `PixelUtil.toPixelFromDIP` converts (`dp * density`, `TypedValue.applyDimension`) and back (`px / density`); the drawable passes `PixelUtil.getDisplayMetricDensity()`.
 *
 * Square corners: Sides are 0 left, 1 top, 2 right, 3 bottom; [borders] are the widths rounded to a pixel (left, top, right,
 * bottom). Bounds are the drawable's, `left`, `top`, `right` and `bottom`, `width` and `height` (px).
 */
internal object BoxGeometry {
  /** `BackgroundDrawable.pathAdjustment`: the fill is pulled in by this where a border is drawn over its rounded edge. */
  const val PATH_ADJUSTMENT = 0.8f

  /**
   * The radii of a box ([radiiDp]: top left, top right, bottom right, bottom left, dp, 0 for none) resolved against its bounds ([width], [height], dp) as `BorderRadiusStyle.resolve` does,
   * written to [out] as a horizontal and a vertical radius for each corner in the same order (eight floats, dp).
   */
  fun resolveRadii(radiiDp: FloatArray, width: Float, height: Float, out: FloatArray) {
    for (k in 0..3) {
      out[2 * k] = radiiDp[k]
      out[2 * k + 1] = radiiDp[k]
    }
    StyleRules.ensureNoOverlap(out, width, height)
  }

  fun toPx(resolvedDp: FloatArray, density: Float, out: FloatArray) {
    for (k in 0 until resolvedDp.size) out[k] = resolvedDp[k] * density
  }

  /** Whether the four corners have the same horizontal and vertical radius (`ComputedBorderRadius.isUniform`), in [resolved] (eight floats). */
  fun uniformRadii(resolved: FloatArray): Boolean =
    resolved[0] == resolved[2] && resolved[1] == resolved[3] && resolved[0] == resolved[4] && resolved[1] == resolved[5] && resolved[0] == resolved[6] && resolved[1] == resolved[7]

  /**
   * The rectangle the fill is drawn in, written to [out] as left, top, right, bottom: the bounds, pulled in on every side by [PATH_ADJUSTMENT] where there is a border and a radius
   * (`BackgroundDrawable.updatePath`).
   */
  fun fillRect(left: Int, top: Int, right: Int, bottom: Int, hasBorder: Boolean, rounded: Boolean, out: FloatArray) {
    val adjust = if (hasBorder && rounded) PATH_ADJUSTMENT else 0f
    out[0] = left + adjust
    out[1] = top + adjust
    out[2] = right - adjust
    out[3] = bottom - adjust
  }

  /** The centre line of a round border of [widthPx], written to [out] as left, top, right, bottom: the bounds pulled in by half the width (`BorderDrawable.updatePath`). */
  fun centerRect(left: Int, top: Int, right: Int, bottom: Int, widthPx: Float, out: FloatArray) {
    val half = widthPx * 0.5f
    out[0] = left + half
    out[1] = top + half
    out[2] = right - half
    out[3] = bottom - half
  }

  /** The radii of the centre line: each outer radius (px) less half the width, for the path of corners that differ. */
  fun centerRadii(radiiPx: FloatArray, widthPx: Float, out: FloatArray) {
    val half = widthPx * 0.5f
    for (k in 0 until radiiPx.size) out[k] = radiiPx[k] - half
  }

  /**
   * The radii of the outline (`CompositeBackgroundDrawable.getOutline`), px, eight floats into [out]: each radius resolved against the bounds in px as if they were dp, the border's width
   * ([widthDp], one for round corners) added, then converted.
   */
  fun outlineRadii(radiiDp: FloatArray, widthDp: Float, boundsWidth: Int, boundsHeight: Int, density: Float, scratch: FloatArray, out: FloatArray) {
    resolveRadii(radiiDp, boundsWidth.toFloat(), boundsHeight.toFloat(), scratch)
    for (k in 0..7) out[k] = (scratch[k] + widthDp) * density
  }

  /**
   * The padding box of a box ([widthsDp]: left, top, right, bottom; [radiiDp]) in bounds of [boundsWidth] by [boundsHeight] px from ([left], [top]) (`BackgroundStyleApplicator.clipToPaddingBox`):
   * the rectangle into [box] as left, top, right, bottom and, when there is a radius, each radius less the border's width at its side, never below 0, into [inner] (eight floats, px).
   * Returns whether there is a radius (the clip is a rounded path then, a rectangle otherwise).
   */
  fun paddingBox(left: Int, top: Int, right: Int, bottom: Int, widthsDp: FloatArray, radiiDp: FloatArray, density: Float, scratch: FloatArray, box: FloatArray, inner: FloatArray): Boolean {
    val insetLeft = widthsDp[0] * density
    val insetTop = widthsDp[1] * density
    val insetRight = widthsDp[2] * density
    val insetBottom = widthsDp[3] * density
    box[0] = left + insetLeft
    box[1] = top + insetTop
    box[2] = right - insetRight
    box[3] = bottom - insetBottom
    if (!StyleRules.hasRadius(radiiDp)) return false
    resolveRadii(radiiDp, (right - left) / density, (bottom - top) / density, scratch)
    inner[0] = innerRadius(scratch[0], insetLeft, density)
    inner[1] = innerRadius(scratch[1], insetTop, density)
    inner[2] = innerRadius(scratch[2], insetRight, density)
    inner[3] = innerRadius(scratch[3], insetTop, density)
    inner[4] = innerRadius(scratch[4], insetRight, density)
    inner[5] = innerRadius(scratch[5], insetBottom, density)
    inner[6] = innerRadius(scratch[6], insetLeft, density)
    inner[7] = innerRadius(scratch[7], insetBottom, density)
    return true
  }

  /** `getInnerBorderRadius`: a radius (dp) less the border's width (px), in px, never below 0. */
  fun innerRadius(radiusDp: Float, insetPx: Float, density: Float): Float = (radiusDp * density - insetPx).coerceAtLeast(0f)

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
