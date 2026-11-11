package expo.modules.svelteengine

/**
 * Which node a touch on a paragraph belongs to (SPEC.md, "Text parity", "Touches on nested Text"): React Native's
 * `ReactTextView.reactTagForTouch`, as a function of the laid-out lines and of where each fragment of the attributed string sits in the text. A Text nested
 * in a Text has no view, so its words are fragments of the paragraph's text and the touch is told apart by the character under the finger. Free of
 * Android classes so that a host check runs it ([Lines] is `android.text.Layout` in the engine and a grid of cells in the check).
 */
object TextHitRules {
  /** The geometry of a laid-out text, in the text box's own pixels (padding and `textAlignVertical`'s offset already taken off). */
  interface Lines {
    /** `Layout.getHeight`: the bottom of the last line. */
    val height: Int
    /** The length of the laid-out text, in UTF-16 units. */
    val textLength: Int
    /** `Layout.getLineForVertical`: the line holding [y], the first or the last for a [y] outside the text. */
    fun lineForVertical(y: Int): Int
    /** `Layout.getLineLeft` and `getLineRight`: the extent of the line's text (alignment and trailing whitespace as the layout counts them). */
    fun lineLeft(line: Int): Float
    fun lineRight(line: Int): Float
    /** `Layout.getOffsetForHorizontal`: the character offset nearest to [x] on [line]; may throw for a line the platform cannot measure. */
    fun offsetForHorizontal(line: Int, x: Float): Int
  }

  /**
   * The tag a touch at ([x], [y]) is for, or [fallback] (the paragraph's own) when it lands on no fragment of another node. Fragment `i` holds the characters
   * `starts[i]` until `ends[i]` of the text and belongs to node `tags[i]`; [count] of them.
   *
   * As `reactTagForTouch`: a touch below the first line or above the last one counts for the paragraph (here, not React Native's clamp to the nearest line: a
   * paragraph taller than its text has nothing to hand to a span at the bottom of its box), and so does one left of a line's text or right of it, where the
   * layout would still answer with the line's first or last offset. On a line, the character offset nearest the touch decides, [target].
   */
  fun tagAt(lines: Lines, x: Float, y: Float, starts: IntArray, ends: IntArray, tags: IntArray, count: Int, fallback: Int): Int {
    if (count == 0 || y < 0f || y >= lines.height) return fallback
    val line = lines.lineForVertical(y.toInt())
    // Whole pixels, as `reactTagForTouch` reads them.
    val xi = x.toInt()
    if (xi < lines.lineLeft(line).toInt() || xi > lines.lineRight(line).toInt()) return fallback
    val offset = try {
      lines.offsetForHorizontal(line, x)
    } catch (_: ArrayIndexOutOfBoundsException) {
      // https://issuetracker.google.com/issues/113348914, which `reactTagForTouch` answers with the paragraph's tag too.
      return fallback
    }
    return target(offset, starts, ends, tags, count, lines.textLength, fallback)
  }

  /**
   * `reactTagForTouch`'s choice: the innermost (shortest) fragment around [offset], the last of equals, else [fallback]. A fragment is around an offset
   * from its first character to the offset after its last (`Spanned.getSpans(offset, offset)`), so at the seam of two fragments both are around it and the
   * shorter wins. Fragments with no text are nobody's.
   */
  fun target(offset: Int, starts: IntArray, ends: IntArray, tags: IntArray, count: Int, textLength: Int, fallback: Int): Int {
    var target = fallback
    var shortest = textLength
    for (i in 0 until count) {
      val start = starts[i]
      val end = ends[i]
      if (end <= start || offset < start || offset > end) continue
      if (end - start <= shortest) {
        target = tags[i]
        shortest = end - start
      }
    }
    return target
  }

  /** Whether any of the [count] fragments belongs to a node other than the paragraph's own ([own]): a text of one node needs no search. */
  fun nested(tags: IntArray, count: Int, own: Int): Boolean {
    for (i in 0 until count) if (tags[i] != 0 && tags[i] != own) return true
    return false
  }
}
