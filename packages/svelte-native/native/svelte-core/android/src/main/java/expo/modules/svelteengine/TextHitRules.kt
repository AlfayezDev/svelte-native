package expo.modules.svelteengine

import java.util.Locale

/**
 * Which node a touch on a paragraph belongs to (SPEC.md, "Text parity", "Touches on nested Text"): React Native's
 * `ReactTextView.reactTagForTouch`, as a function of the laid-out lines and of where each fragment of the attributed string sits in the text. A Text nested in a
 * Text has no view, so its words are fragments of the paragraph's text and the touch is told apart by the character under the finger. Free of
 * Android classes so that a host check runs all of it ([Lines] is `android.text.Layout` in the engine and a grid of cells in the check).
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
    /** `Layout.getLineStart`. */
    fun lineStart(line: Int): Int
    /** `Layout.getEllipsisStart` (relative to the start of the line) and `getEllipsisCount`: the characters an ellipsis stands for, none when the line is not ellipsized. */
    fun ellipsisStart(line: Int): Int
    fun ellipsisCount(line: Int): Int
  }

  /**
   * Where each fragment of the attributed string sits in the laid-out text: fragment `i` holds the characters `starts[i]` until `ends[i]` and belongs to node
   * `tags[i]`, and [links] says which are links for accessibility. [count] fragments.
   */
  class Runs(val count: Int) {
    val starts = IntArray(count)
    val ends = IntArray(count)
    val tags = IntArray(count)
    val links = BooleanArray(count)
  }

  /**
   * The runs of a paragraph of [count] fragments (`text(i)`, `transform(i)` a [TextTransform] mode, `tag(i)`, `link(i)`), the paragraph itself being node [own] (the node
   * of a fragment whose state did not name one). The laid-out text has each fragment transformed (`TextLayoutManager` appends `TextTransform.apply` of it), and the
   * length of a transformed text is not the one it had (`ß` upper-cased is `SS`, `İ` lower-cased is two characters), so the runs are measured on what was laid out.
   */
  fun runs(
    count: Int,
    text: (Int) -> String,
    transform: (Int) -> Int,
    tag: (Int) -> Int,
    link: (Int) -> Boolean,
    own: Int,
    locale: Locale = Locale.getDefault(),
  ): Runs {
    val r = Runs(count)
    var at = 0
    for (i in 0 until count) {
      r.starts[i] = at
      val mode = transform(i)
      at += if (mode == TextTransform.NONE) text(i).length else TextTransform.apply(text(i), mode, locale).length
      r.ends[i] = at
      val t = tag(i)
      r.tags[i] = if (t != 0) t else own
      r.links[i] = link(i)
    }
    return r
  }

  /** Whether any fragment belongs to a node other than the paragraph's own ([own]): a text of one node needs no search. */
  fun nested(runs: Runs, own: Int): Boolean {
    for (i in 0 until runs.count) if (runs.tags[i] != own) return true
    return false
  }

  /**
   * The tag a touch at ([x], [y]) is for, [x] and [y] in the view's own pixels: the text is laid out inside the padding, and `textAlignVertical`'s offset
   * ([verticalOffset]) is added below the top padding when it is drawn, so they are taken off the touch. See [tagAt].
   */
  fun tagForTouch(lines: Lines, x: Float, y: Float, padL: Float, padT: Float, verticalOffset: Float, runs: Runs, own: Int): Int =
    tagAt(lines, x - padL, y - padT - verticalOffset, runs.starts, runs.ends, runs.tags, runs.count, own)

  /**
   * The tag a touch at ([x], [y]), in the text box's own pixels, is for, or [fallback] (the paragraph's own) when it lands on no fragment of another node. Fragment `i`
   * holds the characters `starts[i]` until `ends[i]` of the text and belongs to node `tags[i]`; [count] of them.
   *
   * As `reactTagForTouch`: a touch below the first line or above the last one counts for the paragraph (here, not React Native's clamp to the nearest line: a
   * paragraph taller than its text has nothing to hand to a span at the bottom of its box), and so does one left of a line's text or right of it, where the
   * layout would still answer with the line's first or last offset. On a line, the character offset nearest the touch decides, [target]. Also the paragraph's:
   * - a text the fragments do not add up to (the length of the laid-out text is not theirs: React Native's layout has a placeholder character per inline view, which
   *   the fragments of the engine leave out), where no offset can be told to a fragment;
   * - a touch on an ellipsis, where the offset lies in the characters it stands for (or at their edge: half a glyph either side), which are not drawn and so not a
   *   span the finger is on;
   * - anything the layout throws: the platform's own failures (https://issuetracker.google.com/issues/113348914, which `reactTagForTouch` answers with the
   *   paragraph's tag too) and any other, so a hit test never ends the app.
   */
  fun tagAt(lines: Lines, x: Float, y: Float, starts: IntArray, ends: IntArray, tags: IntArray, count: Int, fallback: Int): Int {
    return try {
      if (count == 0 || ends[count - 1] != lines.textLength || y < 0f || y >= lines.height) return fallback
      val line = lines.lineForVertical(y.toInt())
      // Whole pixels, as `reactTagForTouch` reads them.
      val xi = x.toInt()
      if (xi < lines.lineLeft(line).toInt() || xi > lines.lineRight(line).toInt()) return fallback
      val offset = lines.offsetForHorizontal(line, x)
      val hidden = lines.ellipsisCount(line)
      if (hidden > 0) {
        val from = lines.lineStart(line) + lines.ellipsisStart(line)
        if (offset >= from && offset <= from + hidden) return fallback
      }
      target(offset, starts, ends, tags, count, lines.textLength, fallback)
    } catch (_: RuntimeException) {
      fallback
    }
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

  /**
   * The node the touch is dispatched to: [tag], the one the rules found, unless it is a nested Text that native no longer has an event emitter for ([hasEmitter]):
   * the Text was deleted, and the commit that deleted it has not reached the views yet, so a finger can land on its words for one more frame. A touch dispatched
   * to a node with no emitter is dropped, the paragraph's own press with it.
   */
  fun resolve(tag: Int, own: Int, hasEmitter: (Int) -> Boolean): Int = if (tag != own && !hasEmitter(tag)) own else tag

  /** The characters of a link, to the node it clicks. */
  class LinkRange(val start: Int, val end: Int, val tag: Int)

  /** The links of the paragraph, as the ranges of the text ([textLength] long) a service lists: the fragments that are links, the empty ones and what is past the text left out. */
  fun linkRanges(runs: Runs, textLength: Int): List<LinkRange> {
    val out = ArrayList<LinkRange>(2)
    for (i in 0 until runs.count) {
      val end = minOf(runs.ends[i], textLength)
      if (runs.links[i] && end > runs.starts[i]) out.add(LinkRange(runs.starts[i], end, runs.tags[i]))
    }
    return out
  }
}
