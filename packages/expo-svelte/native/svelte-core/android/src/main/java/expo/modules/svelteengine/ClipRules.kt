package expo.modules.svelteengine

/**
 * What an engine view clips what it draws to, as plain numbers so the host can check it (SPEC.md, "Scroll viewport clip").
 */
internal object ClipRules {
  /** `overflow` record 7: `visible`. Anything else (`hidden`, `scroll`) clips. */
  const val OVERFLOW_VISIBLE = 0

  /**
   * The rectangle a scroll view clips its children to, written to [out] as left, top, right, bottom; false (nothing written) when its `overflow` is visible.
   *
   * It is the view's own bounds less its border widths ([border]: left, top, right, bottom, px), as `ReactScrollView.draw` clips with `clipToPaddingBox`, and
   * not Android's padding: a scroll view under a large or translucent header keeps its content from the top of the screen
   * (`EngineHeader` pads it by the header's height and turns `clipToPadding` off) and that content has to show under the header. The coordinates are the ones
   * `dispatchDraw` draws in, where the canvas is already moved by the scroll offset, so the viewport is the bounds shifted by [scrollX] and [scrollY].
   */
  fun scrollViewport(overflow: Int, scrollX: Int, scrollY: Int, width: Int, height: Int, border: FloatArray, out: FloatArray): Boolean {
    if (overflow == OVERFLOW_VISIBLE) return false
    out[0] = scrollX + border[0]
    out[1] = scrollY + border[1]
    out[2] = scrollX + width - border[2]
    out[3] = scrollY + height - border[3]
    return true
  }

  /**
   * Where a scroll view's content child sits in it, written to [out] as left, top, right, bottom: where Yoga put it (`frame*`: inside the view's border and padding) and Android's
   * padding besides ([paddingLeft], [paddingTop]: what `EngineHeader` gives a scroll view under a large or translucent header, its own height). The platform's scroll view puts its
   * child at the padding alone, which loses Yoga's offset (a bordered scroll view's content sat on the border); Yoga's offset alone loses the header's.
   */
  fun scrollContent(frameLeft: Int, frameTop: Int, frameRight: Int, frameBottom: Int, paddingLeft: Int, paddingTop: Int, out: IntArray) {
    out[0] = frameLeft + paddingLeft
    out[1] = frameTop + paddingTop
    out[2] = frameRight + paddingLeft
    out[3] = frameBottom + paddingTop
  }
}
