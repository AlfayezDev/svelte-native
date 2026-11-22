package expo.modules.svelteengine

import java.io.File
import java.util.Locale
import kotlin.system.exitProcess

/**
 * Plain-JVM check of which node a touch on a paragraph belongs to (`TextHitRules`, SPEC.md "Touches on nested Text"). The layout is Android's, so the check lays text
 * out on a grid (a fixed cell per character; lines of a fixed number of characters; left to right, right to left, centred, mixed in direction, ellipsized) that
 * answers as `android.text.Layout` does (the cursor nearest the touch, no cursor at the end of a line that wraps), and asks the rules what a finger at a position is on.
 * What the rules decide before they ask (the lengths of the transformed fragments, the padding, which fragments are links) is run through the same functions the view runs.
 *
 * The last part, `tripwires`, is not a behaviour check: it reads the sources for the calls the pure code is useless without (a view that does not call it fails
 * no check above). They pin the shape of the code, and a change that keeps the behaviour may have to change them.
 * Usage: TextHitRulesCheck <svelte-core android main directory>   (src/test/run.sh)
 */
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
    exitProcess(1)
  }
}

/**
 * A text of [length] characters on lines of [perLine], a cell of [cell] by [lineHeight] pixels each, in a box [width] wide.
 * - [rtl]: a right-to-left paragraph, every character right to left and the first at the right edge; [center]: centred lines;
 * - [ellipsisAt]: the last line is cut after that many characters and an ellipsis (one cell) stands for the rest, which are not drawn;
 * - [visual] and [rtlChars]: one line of mixed direction, the logical characters in the order they are drawn, left to right, and which of them run right to left.
 * The cursor of an offset is at the leading edge of its character, `Layout.getPrimaryHorizontal`'s, and `offsetForHorizontal` answers the nearest one (the earlier of two
 * as near), but never the end of a line that wraps: that offset is the start of the next line, and the layout answers `lineEnd - 1` (Layout.java, getOffsetForHorizontal).
 */
private class Grid(
  val length: Int,
  val perLine: Int = length,
  val width: Int = 100,
  val cell: Int = 10,
  val lineHeight: Int = 20,
  val rtl: Boolean = false,
  val center: Boolean = false,
  val failOn: Int = -1,
  val failure: () -> RuntimeException = { ArrayIndexOutOfBoundsException("platform bug") },
  val ellipsisAt: Int = -1,
  val visual: IntArray? = null,
  val rtlChars: Set<Int> = emptySet(),
) : TextHitRules.Lines {
  private val lines = (length + perLine - 1) / perLine
  override val height get() = lines * lineHeight
  override val textLength get() = length

  private fun chars(line: Int) = minOf(perLine, length - line * perLine)

  private fun ellipsized(line: Int) = ellipsisAt >= 0 && line == lines - 1

  /** The cells a line draws: its characters, or the ones before the ellipsis and the ellipsis. */
  private fun slots(line: Int) = if (ellipsized(line)) ellipsisAt + 1 else chars(line)

  override fun lineForVertical(y: Int) = (y / lineHeight).coerceIn(0, lines - 1)

  override fun lineLeft(line: Int): Float {
    if (failOn == -2) throw failure()
    val extent = slots(line) * cell
    return when {
      center -> (width - extent) / 2f
      rtl -> (width - extent).toFloat()
      else -> 0f
    }
  }

  override fun lineRight(line: Int) = lineLeft(line) + slots(line) * cell

  override fun lineStart(line: Int) = line * perLine

  override fun ellipsisStart(line: Int) = if (ellipsized(line)) ellipsisAt else 0

  override fun ellipsisCount(line: Int) = if (ellipsized(line)) chars(line) - ellipsisAt else 0

  /** Where the cursor of the offset [k] of [line] is. */
  private fun cursor(line: Int, k: Int): Float {
    val left = lineLeft(line)
    val order = visual
    if (order != null) {
      val n = chars(line)
      val slotOf = IntArray(n)
      for (slot in order.indices) slotOf[order[slot]] = slot
      val c = minOf(k, n - 1)
      val isRtl = c in rtlChars
      // The leading edge of the character; after the last character, its trailing edge.
      val edge = if (k < n) isRtl else !isRtl
      return left + (slotOf[c] + if (edge) 1 else 0) * cell
    }
    if (ellipsized(line)) return left + minOf(k, ellipsisAt + 1) * cell
    return if (rtl) left + slots(line) * cell - k * cell else left + k * cell
  }

  override fun offsetForHorizontal(line: Int, x: Float): Int {
    if (line == failOn) throw failure()
    val n = chars(line)
    val max = if (line == lines - 1) n else n - 1
    var best = 0
    var bestDistance = Math.abs(cursor(line, 0) - x)
    for (k in 1..max) {
      val distance = Math.abs(cursor(line, k) - x)
      if (distance < bestDistance) {
        best = k
        bestDistance = distance
      }
    }
    return line * perLine + best
  }
}

/** The runs of a paragraph of fragments given as (length, tag), none of them a link. */
private fun runsOf(vararg parts: Pair<Int, Int>): TextHitRules.Runs {
  val r = TextHitRules.Runs(parts.size)
  var at = 0
  for (i in parts.indices) {
    r.starts[i] = at
    at += parts[i].first
    r.ends[i] = at
    r.tags[i] = parts[i].second
  }
  return r
}

private fun tagAt(lines: Grid, runs: TextHitRules.Runs, x: Float, y: Float, own: Int = 1) =
  TextHitRules.tagAt(lines, x, y, runs.starts, runs.ends, runs.tags, runs.count, own)

private fun rules() {
  // `<Text>See <Text onPress>this link</Text> here</Text>`: the paragraph is node 1, the link node 2; three fragments, 4 + 9 + 5 characters on one line of 180 px.
  val sentence = runsOf(4 to 1, 9 to 2, 5 to 1)
  val line = Grid(18, 18, width = 200)
  expect("a touch inside the link is the link's", tagAt(line, sentence, 100f, 10f), 2)
  expect("a touch on the words before it is the paragraph's", tagAt(line, sentence, 15f, 10f), 1)
  expect("a touch on the words after it is the paragraph's", tagAt(line, sentence, 165f, 10f), 1)
  expect("the link's first character is its own away from the seam", tagAt(line, sentence, 48f, 10f), 2)
  expect("the link's last character is its own away from the seam", tagAt(line, sentence, 122f, 10f), 2)
  // React Native's seam rule: at the seam of two fragments the cursor is in both (`getSpans(offset, offset)`) and the shorter fragment wins. The half of the link's first
  // and last character that is nearer the seam is the neighbour's, as in React Native.
  expect("the seam goes to the shorter fragment: 'See ' (4) against the link (9)", tagAt(line, sentence, 41f, 10f), 1)
  expect("the seam goes to the shorter fragment: ' here' (5) against the link (9)", tagAt(line, sentence, 129f, 10f), 1)
  expect("the seam goes to the link when it is the shorter one", tagAt(Grid(23, 23, width = 240), runsOf(12 to 1, 3 to 2, 8 to 1), 118f, 10f), 2)
  expect("a fragment with the paragraph's own tag answers with it", tagAt(Grid(23, 23, width = 240), runsOf(2 to 1, 12 to 2, 9 to 1), 5f, 10f), 1)

  // The innermost of nested spans: `<Text>a <Text link>b <Text bold>c</Text> d</Text> e</Text>` is five fragments, one per run of characters of one node.
  val nested = runsOf(2 to 1, 2 to 2, 1 to 3, 2 to 2, 2 to 1)
  val row = Grid(9, 9, width = 100)
  expect("the innermost span wins over the one around it", tagAt(row, nested, 46f, 10f), 3)
  expect("the part of the outer span before the inner one is the outer's", tagAt(row, nested, 25f, 10f), 2)
  expect("and the part after it too", tagAt(row, nested, 60f, 10f), 2)
  expect("a text before the spans is the paragraph's", tagAt(row, nested, 5f, 10f), 1)

  // Several lines: a link of ten characters across two lines of ten.
  val wrapped = runsOf(8 to 1, 10 to 2, 7 to 1)
  val two = Grid(25, 10, width = 100)
  expect("a touch on the link's part on the first line", tagAt(two, wrapped, 87f, 10f), 2)
  expect("a touch on the link's part on the second line", tagAt(two, wrapped, 35f, 30f), 2)
  expect("a touch on the words before the link on the first line", tagAt(two, wrapped, 35f, 10f), 1)
  expect("a touch on the words after the link on the second line", tagAt(two, wrapped, 85f, 30f), 1)
  expect("a touch on the third line is on its words", tagAt(two, wrapped, 25f, 50f), 1)
  // The layout never answers the end of a line that wraps (it is the start of the next one): the right half of the last character of a line is that character's, not
  // the first of the next line's fragment, which a layout that did would hand the press to.
  val seamAtTheWrap = runsOf(10 to 1, 10 to 2)
  expect("the right half of a line's last character is its own", tagAt(Grid(20, 10, width = 100), seamAtTheWrap, 97f, 10f), 1)
  expect("the left half of the next line's first character is its own", tagAt(Grid(20, 10, width = 100), seamAtTheWrap, 3f, 30f), 2)
  // Past the end of a line, where the layout would still answer with the line's last offset (the link ends the third line here).
  val tail = runsOf(20 to 1, 5 to 2)
  expect("a touch on the link at the end of the last line", tagAt(two, tail, 35f, 50f), 2)
  expect("a touch right of the last line's text is the paragraph's", tagAt(two, tail, 80f, 50f), 1)
  expect("a touch left of a right-aligned line's text is the paragraph's", tagAt(Grid(25, 10, width = 100, rtl = true), tail, 20f, 50f), 1)
  // Above and below the text: a paragraph taller than its text has nothing to hand to a span.
  expect("below the last line is the paragraph's", tagAt(two, tail, 25f, 61f), 1)
  expect("above the first line is the paragraph's", tagAt(two, tail, 25f, -1f), 1)
  expect("the first pixel of the box is the first line's", tagAt(Grid(25, 10, width = 100), runsOf(5 to 2, 20 to 1), 25f, 0f), 2)
  expect("the last pixel of the text is the last line's", tagAt(two, tail, 35f, 59.5f), 2)

  // Right to left: the first characters are at the right edge of the line.
  val rtl = runsOf(3 to 1, 3 to 2)
  val arabic = Grid(6, 6, width = 100, rtl = true)
  expect("a touch on the later characters (to the left) is the link's", tagAt(arabic, rtl, 52f, 10f), 2)
  expect("a touch on the first characters (at the right edge) is the paragraph's", tagAt(arabic, rtl, 87f, 10f), 1)
  expect("a touch left of the line's text, where the box is empty, is the paragraph's", tagAt(arabic, rtl, 20f, 10f), 1)
  expect("a touch right of the line's text is the paragraph's", tagAt(arabic, rtl, 101f, 10f), 1)
  val rtlWrapped = Grid(25, 10, width = 100, rtl = true)
  expect("right to left across lines: the link's part on the second line", tagAt(rtlWrapped, wrapped, 65f, 30f), 2)
  expect("right to left across lines: the words after it", tagAt(rtlWrapped, wrapped, 15f, 30f), 1)

  // Mixed in direction. A right-to-left paragraph of a Hebrew word (characters 0..2), digits (3..5) and a second Hebrew word, the link (6..8): drawn left to right, the
  // second word is at the left edge, then the digits, then the first word, so the position along the line is not the position in the text, and a rule that took it
  // to be (a character is `x / cell`) would hand the left of the line to the first word.
  val mixed = Grid(9, 9, width = 90, rtl = true, visual = intArrayOf(8, 7, 6, 3, 4, 5, 2, 1, 0), rtlChars = setOf(0, 1, 2, 6, 7, 8))
  val words = runsOf(3 to 1, 3 to 1, 3 to 2)
  expect("the second word is at the left edge though it is the later one", tagAt(mixed, words, 13f, 10f), 2)
  expect("and its other characters are too", tagAt(mixed, words, 24f, 10f), 2)
  expect("the digits are in the middle, the paragraph's", tagAt(mixed, words, 45f, 10f), 1)
  expect("the first word is at the right edge", tagAt(mixed, words, 87f, 10f), 1)
  // Left to right with a Hebrew word in it: the run is turned about inside its own place.
  val inline = Grid(12, 12, width = 120, visual = intArrayOf(0, 1, 2, 3, 7, 6, 5, 4, 8, 9, 10, 11), rtlChars = setOf(4, 5, 6, 7))
  val hebrew = runsOf(4 to 1, 4 to 2, 4 to 1)
  expect("a touch on the first character drawn of the turned run is the link's", tagAt(inline, hebrew, 45f, 10f), 2)
  expect("and on the last drawn", tagAt(inline, hebrew, 72f, 10f), 2)
  expect("and between", tagAt(inline, hebrew, 64f, 10f), 2)
  expect("a touch before it is the paragraph's", tagAt(inline, hebrew, 12f, 10f), 1)
  expect("and after it", tagAt(inline, hebrew, 93f, 10f), 1)

  // Centred lines: the text is where the line is, not at the box's edge.
  val centred = Grid(6, 6, width = 100, center = true)
  val halves = runsOf(3 to 1, 3 to 2)
  expect("a touch on the link of a centred line", tagAt(centred, halves, 57f, 10f), 2)
  expect("a touch on the words before it", tagAt(centred, halves, 30f, 10f), 1)
  expect("a touch left of a centred line's text is the paragraph's", tagAt(centred, halves, 10f, 10f), 1)
  expect("and right of it", tagAt(centred, halves, 95f, 10f), 1)

  // An ellipsis (`numberOfLines`): the text is cut after eight characters of thirteen, the ellipsis is drawn where the ninth was, and the rest is not drawn. The link on the
  // end of it is hidden; the span around the cut is visible up to the cut.
  val cut = Grid(13, 13, width = 200, ellipsisAt = 8)
  val ellipsis = runsOf(5 to 1, 4 to 2, 4 to 3)
  expect("a touch on the visible part of a span the cut goes through is the span's", tagAt(cut, ellipsis, 63f, 10f), 2)
  expect("a touch on the ellipsis is the paragraph's, not the hidden span's", tagAt(cut, ellipsis, 88f, 10f), 1)
  expect("a touch on the ellipsis, on the side of the last drawn character, too", tagAt(cut, ellipsis, 84f, 10f), 1)
  expect("a touch right of the ellipsis is the paragraph's", tagAt(cut, ellipsis, 120f, 10f), 1)
  expect("the characters before the cut are as they were", tagAt(cut, ellipsis, 72f, 10f), 2)
  // Two lines of ten and a third of five, cut after three characters: the ellipsis stands for the last two, and the second span runs through all of it.
  val third = Grid(25, 10, width = 100, ellipsisAt = 3)
  val spans = runsOf(5 to 1, 5 to 2, 15 to 3)
  expect("an ellipsis on the last of three lines leaves the first alone", tagAt(third, spans, 65f, 10f), 2)
  expect("the drawn characters before it are their span's", tagAt(third, spans, 15f, 50f), 3)
  expect("the ellipsis on the last line is the paragraph's, though the span runs through it", tagAt(third, spans, 35f, 50f), 1)

  // Fragments that do not add up to the layout's text: React Native's layout has a placeholder per inline view, which the engine's fragments leave out.
  expect("fragments the text is longer than are not asked", tagAt(Grid(19, 19, width = 200), sentence, 100f, 10f), 1)
  expect("nor those it is shorter than", tagAt(Grid(17, 17, width = 200), sentence, 100f, 10f), 1)
  expect("the same fragments over a text of their length are", tagAt(Grid(18, 18, width = 200), sentence, 100f, 10f), 2)

  // Whatever the layout throws is the paragraph's: the platform's own failure (issuetracker 113348914) and any other.
  expect("a line the layout cannot measure is the paragraph's", tagAt(Grid(18, 18, width = 200, failOn = 0), sentence, 100f, 10f), 1)
  expect("a failure of another kind in the offset", tagAt(Grid(18, 18, width = 200, failOn = 0, failure = { IllegalStateException("layout") }), sentence, 100f, 10f), 1)
  expect("or in the line's extent", tagAt(Grid(18, 18, width = 200, failOn = -2, failure = { NullPointerException() }), sentence, 100f, 10f), 1)
  expect("a text with no fragments is the paragraph's", TextHitRules.tagAt(line, 100f, 10f, IntArray(0), IntArray(0), IntArray(0), 0, 1), 1)

  // Equal lengths: the last of them, the more inner element of the two in React Native's array.
  expect("of equal length the later fragment wins", TextHitRules.target(4, intArrayOf(0, 4), intArrayOf(4, 8), intArrayOf(7, 8), 2, 8, 1), 8)
  expect("an empty fragment is nobody's", TextHitRules.target(4, intArrayOf(0, 4, 4), intArrayOf(4, 4, 8), intArrayOf(7, 9, 8), 3, 8, 1), 8)
  expect("a fragment the offset is not in is not asked", TextHitRules.target(2, intArrayOf(0, 3), intArrayOf(2, 6), intArrayOf(7, 9), 2, 6, 1), 7)
  expect("no fragment around the offset is the fallback", TextHitRules.target(9, intArrayOf(0, 3), intArrayOf(2, 6), intArrayOf(7, 9), 2, 12, 1), 1)
}

/** A fragment as the view reads it. */
private class Frag(val text: String, val transform: Int = TextTransform.NONE, val tag: Int = 0, val link: Boolean = false)

private fun runsFrom(frags: List<Frag>, own: Int, locale: Locale = Locale.ENGLISH) =
  TextHitRules.runs(frags.size, { frags[it].text }, { frags[it].transform }, { frags[it].tag }, { frags[it].link }, own, locale)

private fun runs() {
  // The text React Native laid out is each fragment transformed, and the length of a transformed text is not the one it had.
  val upper = TextTransform.UPPERCASE
  expect("ß upper-cased is two characters", TextTransform.apply("ß", upper, Locale.ENGLISH), "SS")
  expect("a transform of none is the text", TextTransform.apply("ß", TextTransform.NONE, Locale.ENGLISH), "ß")
  expect("İ lower-cased is two characters in English", TextTransform.apply("İ", TextTransform.LOWERCASE, Locale.ENGLISH).length, 2)
  expect("and one in Turkish", TextTransform.apply("İ", TextTransform.LOWERCASE, Locale.forLanguageTag("tr")).length, 1)
  expect("capitalizing keeps the length", TextTransform.apply("ßa wörld ǆ", TextTransform.CAPITALIZE, Locale.ENGLISH), "ßa Wörld Ǆ")

  val own = 1
  val strasse = runsFrom(listOf(Frag("straße ", upper), Frag("link", tag = 2, link = true), Frag(" end")), own)
  expect("the ends of upper-cased fragments are those of the laid-out text", strasse.ends.toList(), listOf(8, 12, 16))
  expect("the starts follow them", strasse.starts.toList(), listOf(0, 8, 12))
  expect("a fragment with no tag is the paragraph's", strasse.tags.toList(), listOf(1, 2, 1))
  expect("links", strasse.links.toList(), listOf(false, true, false))
  expect("a paragraph with a node of its own in it has something to search", TextHitRules.nested(strasse, own), true)
  expect("a paragraph of its own node alone has not", TextHitRules.nested(runsFrom(listOf(Frag("a"), Frag("b", tag = 1)), own), own), false)
  val dotted = runsFrom(listOf(Frag("İİ ", TextTransform.LOWERCASE), Frag("link", tag = 2)), own)
  expect("lower-cased İ in English", dotted.ends.toList(), listOf(5, 9))
  expect("lower-cased İ in Turkish", runsFrom(listOf(Frag("İİ ", TextTransform.LOWERCASE), Frag("link", tag = 2)), own, Locale.forLanguageTag("tr")).ends.toList(), listOf(3, 7))
  expect("capitalized text keeps its fragments' lengths", runsFrom(listOf(Frag("ab cd", TextTransform.CAPITALIZE), Frag("ef")), own).ends.toList(), listOf(5, 7))

  // Over the layout of that text a touch on the link is the link's: 8 + 4 + 4 characters, and the link at 8..12.
  val grid = Grid(16, 16, width = 200)
  expect("a touch on the link after an upper-cased ß", tagAt(grid, strasse, 98f, 10f), 2)
  expect("a touch on the upper-cased words before it", tagAt(grid, strasse, 35f, 10f), 1)
  expect("a touch on the link's last character", tagAt(grid, strasse, 113f, 10f), 2)
  // The lengths of the untransformed text (7 + 4 + 4) are not the layout's: no fragment is asked, whatever the touch is on.
  val untransformed = runsFrom(listOf(Frag("straße "), Frag("link", tag = 2), Frag(" end")), own)
  expect("lengths that are not the layout's give the paragraph's", tagAt(grid, untransformed, 98f, 10f), 1)
  // Lower-cased İ: five characters in English where there were three.
  expect("a touch on the link after a lower-cased İ", tagAt(Grid(9, 9, width = 200), dotted, 70f, 10f), 2)

  // The padding and `textAlignVertical`'s offset are taken off the touch before the layout is asked: the text is drawn inside them.
  val sentence = runsFrom(listOf(Frag("See "), Frag("this link", tag = 2), Frag(" here")), own)
  val line = Grid(18, 18, width = 200)
  fun touch(x: Float, y: Float, padL: Float = 0f, padT: Float = 0f, offset: Float = 0f) = TextHitRules.tagForTouch(line, x, y, padL, padT, offset, sentence, own)
  expect("no padding is the layout's own position", touch(100f, 10f), 2)
  expect("the left padding shifts the touch: on the link at 100 with 60 of padding it is at 160", touch(160f, 10f, padL = 60f), 2)
  expect("and what is at 15 (the words before the link) is at 75", touch(75f, 10f, padL = 60f), 1)
  expect("the top padding too: the first line is at 30 to 50 with 30 of padding", touch(100f, 40f, padT = 30f), 2)
  expect("a touch above the text, in the padding, is the paragraph's", touch(100f, 10f, padT = 30f), 1)
  expect("the vertical offset of `textAlignVertical` is added below the padding", touch(100f, 65f, padT = 30f, offset = 25f), 2)
  expect("a touch above where it starts is the paragraph's", touch(100f, 50f, padT = 30f, offset = 25f), 1)

  // The links a service lists: the link fragments, over the characters of the laid-out text.
  val links = TextHitRules.linkRanges(strasse, 16)
  expect("one link", links.size, 1)
  expect("its range", listOf(links[0].start, links[0].end, links[0].tag), listOf(8, 12, 2))
  val two = runsFrom(listOf(Frag("a ", tag = 2, link = true), Frag("b", tag = 3), Frag(" c", tag = 4, link = true), Frag("")), own)
  expect("two links", TextHitRules.linkRanges(two, 5).map { listOf(it.start, it.end, it.tag) }, listOf(listOf(0, 2, 2), listOf(3, 5, 4)))
  expect("a link that crosses the end of the text is cut", TextHitRules.linkRanges(two, 4).map { listOf(it.start, it.end, it.tag) }, listOf(listOf(0, 2, 2), listOf(3, 4, 4)))
  expect("and one that starts at the end is empty", TextHitRules.linkRanges(two, 3).map { listOf(it.start, it.end, it.tag) }, listOf(listOf(0, 2, 2)))
  expect("no link fragment, no link", TextHitRules.linkRanges(runsFrom(listOf(Frag("a", link = false), Frag("b", tag = 2)), own), 2).size, 0)
  expect("an empty fragment that is a link is not one", TextHitRules.linkRanges(runsFrom(listOf(Frag("", tag = 2, link = true)), own), 0).size, 0)
  expect("the link of a fragment with no tag clicks the paragraph", TextHitRules.linkRanges(runsFrom(listOf(Frag("a", link = true)), own), 1)[0].tag, own)

  // The node a touch is dispatched to.
  val asked = ArrayList<Int>()
  expect("a nested node with an emitter is dispatched to", TextHitRules.resolve(2, 1) { asked.add(it); true }, 2)
  expect("one without (deleted a frame ago) is the paragraph's", TextHitRules.resolve(2, 1) { asked.add(it); false }, 1)
  expect("the paragraph's own is not asked", TextHitRules.resolve(1, 1) { asked.add(it); false }, 1)
  expect("only the nested ones were asked", asked, listOf(2, 2))
}

/** The text of the file [name] under [main]. */
private fun text(main: String, name: String): String {
  val file = File(main).walkTopDown().firstOrNull { it.isFile && it.name == name } ?: error("$name not found under $main")
  return file.readText()
}

/**
 * Tripwires, not behaviour: what a host cannot run (the view, the root, the JNI and Fabric glue) is read for the calls into the checked code, so that a change which
 * stops using it fails here instead of passing every check above. A refactor that keeps the behaviour may have to change them.
 */
private fun tripwires(main: String) {
  val encoder = text(main, "PropsEncoder.cpp")
  val props = text(main, "Props.kt")
  val engineText = text(main, "EngineText.kt")
  val root = text(main, "EngineRoot.kt")
  val delegate = text(main, "MountingDelegate.cpp")
  val image = text(main, "EngineImage.kt")
  val spinner = text(main, "EngineSpinner.kt")
  val clicks = "override fun onTouchEvent(event: MotionEvent): Boolean = isClickable"

  expect("the encoder writes the record through the wire header", encoder.contains("fragmentwire::encodeTarget(target, fragment.parentShadowView.tag, ta.role, ta.accessibilityRole)"), true)
  expect("the decoder reads it through the wire decoder", props.contains("FragmentWire.TARGET ->") && props.contains("FragmentWire.tag(ops, i)") && props.contains("FragmentWire.isLink(ops, i)"), true)
  expect("the view asks the rules, with its padding and offset", engineText.contains("TextHitRules.tagForTouch(LayoutLines(l), x, y, node.padL, node.padT, verticalOffset, r, own)"), true)
  expect("the view builds the runs and the links with the rules", engineText.contains("TextHitRules.runs(") && engineText.contains("TextHitRules.linkRanges(r, string.length)"), true)
  expect("the view makes the link spans once", engineText.contains("linked = out") && engineText.split("linked = null").size == 3, true)
  expect("the root asks for a touch that starts and for one that joins", root.contains("val tag = tagAt(target, ev.x, ev.y)") && root.contains("tagAt(target, ev.getX(ev.actionIndex), ev.getY(ev.actionIndex))"), true)
  expect("and asks native whether the node has an emitter", root.contains("TextHitRules.resolve(") && root.contains("native?.hasEmitter(it)"), true)
  expect("the position JavaScript gets stays the paragraph's", root.contains("HitTest.toLocal(this, views[i], lastX[i], lastY[i], local)"), true)
  expect("nested Text emitters are kept on create, update and delete", Regex("""if \(isNestedText\(newView\)\) setEmitter""").containsMatchIn(delegate) &&
    Regex("""isNestedText\(newView\) && oldView\.eventEmitter != newView\.eventEmitter""").containsMatchIn(delegate) &&
    Regex("""isNestedText\(oldView\)\) eraseEmitter""").containsMatchIn(delegate), true)
  expect("and nothing else of a nested Text reaches Kotlin", Regex("""isNestedText\(\w+\)""").findAll(delegate).count(), 3)
  // A clickable view the engine hands every touch to must not perform the click on the lift (a second press, on the node, after the touch's own).
  expect("a text does not perform the click of a touch", engineText.contains(clicks), true)
  expect("nor does an image", image.contains(clicks), true)
  expect("nor a spinner", spinner.contains(clicks), true)
}

fun main(args: Array<String>) {
  rules()
  runs()
  tripwires(args.getOrNull(0) ?: error("usage: TextHitRulesCheck <svelte-core android main directory>"))
  System.err.println("TextHitRulesCheck: $checks checks")
}
