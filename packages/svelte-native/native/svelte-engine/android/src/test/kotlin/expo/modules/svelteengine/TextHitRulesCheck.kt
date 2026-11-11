package expo.modules.svelteengine

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of which node a touch on a paragraph belongs to (`TextHitRules`, SPEC.md "Touches on nested Text"). The layout is Android's, so the check lays text
 * out on a grid (a fixed cell per character, lines of a fixed number of characters, left to right or right to left) and asks the rules what a finger at a position
 * is on; the sources are then read for the wiring that the rules are useless without: the wire record that carries each fragment's node, the decoder that reads it, the
 * view that asks, the root that dispatches to the answer and the mounting delegate that keeps the nested nodes' emitters.
 * Usage: TextHitRulesCheck <svelte-engine android main directory>   (src/test/run.sh)
 */
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
    exitProcess(1)
  }
}

/** A text of [length] characters on lines of [perLine], a cell of [cell] by [lineHeight] pixels each, in a box [width] wide. */
private class Grid(
  val length: Int,
  val perLine: Int,
  val width: Int = 100,
  val cell: Int = 10,
  val lineHeight: Int = 20,
  val rtl: Boolean = false,
  val failOn: Int = -1,
) : TextHitRules.Lines {
  private val lines = (length + perLine - 1) / perLine
  override val height get() = lines * lineHeight
  override val textLength get() = length

  private fun chars(line: Int) = minOf(perLine, length - line * perLine)

  override fun lineForVertical(y: Int) = (y / lineHeight).coerceIn(0, lines - 1)

  override fun lineLeft(line: Int) = if (rtl) (width - chars(line) * cell).toFloat() else 0f

  override fun lineRight(line: Int) = lineLeft(line) + chars(line) * cell

  /** The cursor nearest to [x]: the platform answers with an offset that is at a seam, never inside a character. */
  override fun offsetForHorizontal(line: Int, x: Float): Int {
    if (line == failOn) throw ArrayIndexOutOfBoundsException("platform bug")
    val n = chars(line)
    val k = Math.round(if (rtl) (lineRight(line) - x) / cell else (x - lineLeft(line)) / cell).coerceIn(0, n)
    return line * perLine + k
  }
}

/** The fragments of a paragraph: text lengths and tags in order. */
private class Runs(vararg parts: Pair<Int, Int>) {
  val count = parts.size
  val starts = IntArray(count)
  val ends = IntArray(count)
  val tags = IntArray(count)

  init {
    var at = 0
    for (i in parts.indices) {
      starts[i] = at
      at += parts[i].first
      ends[i] = at
      tags[i] = parts[i].second
    }
  }
}

private fun tagAt(lines: Grid, runs: Runs, x: Float, y: Float, own: Int = 1) = TextHitRules.tagAt(lines, x, y, runs.starts, runs.ends, runs.tags, runs.count, own)

private fun rules() {
  // `<Text>See <Text onPress>this link</Text> here</Text>`: the paragraph is node 1, the link node 2; three fragments, 4 + 9 + 5 characters on one line of 180 px.
  val sentence = Runs(4 to 1, 9 to 2, 5 to 1)
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
  val wide = Runs(2 to 1, 12 to 2, 9 to 1)
  expect("the seam goes to the link when it is the shorter one", tagAt(Grid(23, 23, width = 240), Runs(12 to 1, 3 to 2, 8 to 1), 118f, 10f), 2)
  expect("a fragment with the paragraph's own tag answers with it", tagAt(Grid(23, 23, width = 240), wide, 5f, 10f), 1)

  // The innermost of nested spans: `<Text>a <Text link>b <Text bold>c</Text> d</Text> e</Text>` is five fragments, one per run of characters of one node.
  val nested = Runs(2 to 1, 2 to 2, 1 to 3, 2 to 2, 2 to 1)
  val row = Grid(9, 9, width = 100)
  expect("the innermost span wins over the one around it", tagAt(row, nested, 46f, 10f), 3)
  expect("the part of the outer span before the inner one is the outer's", tagAt(row, nested, 25f, 10f), 2)
  expect("and the part after it too", tagAt(row, nested, 60f, 10f), 2)
  expect("a text before the spans is the paragraph's", tagAt(row, nested, 5f, 10f), 1)

  // Several lines: a link of ten characters across two lines of ten.
  val wrapped = Runs(8 to 1, 10 to 2, 7 to 1)
  val two = Grid(25, 10, width = 100)
  expect("a touch on the link's part on the first line", tagAt(two, wrapped, 85f, 10f), 2)
  expect("a touch on the link's part on the second line", tagAt(two, wrapped, 35f, 30f), 2)
  expect("a touch on the words before the link on the first line", tagAt(two, wrapped, 35f, 10f), 1)
  expect("a touch on the words after the link on the second line", tagAt(two, wrapped, 85f, 30f), 1)
  expect("a touch on the third line is on its words", tagAt(two, wrapped, 25f, 50f), 1)
  // Past the end of a line, where the layout would still answer with the line's last offset (the link ends the third line here).
  val tail = Runs(20 to 1, 5 to 2)
  expect("a touch on the link at the end of the last line", tagAt(two, tail, 35f, 50f), 2)
  expect("a touch right of the last line's text is the paragraph's", tagAt(two, tail, 80f, 50f), 1)
  expect("a touch left of a right-aligned line's text is the paragraph's", tagAt(Grid(25, 10, width = 100, rtl = true), tail, 20f, 50f), 1)
  // Above and below the text: a paragraph taller than its text has nothing to hand to a span.
  expect("below the last line is the paragraph's", tagAt(two, tail, 25f, 61f), 1)
  expect("above the first line is the paragraph's", tagAt(two, tail, 25f, -1f), 1)
  expect("the first pixel of the box is the first line's", tagAt(Grid(25, 10, width = 100), Runs(5 to 2, 20 to 1), 25f, 0f), 2)
  expect("the last pixel of the text is the last line's", tagAt(two, tail, 35f, 59.5f), 2)

  // Right to left: the first characters are at the right edge of the line.
  val rtl = Runs(3 to 1, 3 to 2)
  val arabic = Grid(6, 6, width = 100, rtl = true)
  expect("a touch on the later characters (to the left) is the link's", tagAt(arabic, rtl, 52f, 10f), 2)
  expect("a touch on the first characters (at the right edge) is the paragraph's", tagAt(arabic, rtl, 87f, 10f), 1)
  expect("a touch left of the line's text, where the box is empty, is the paragraph's", tagAt(arabic, rtl, 20f, 10f), 1)
  expect("a touch right of the line's text is the paragraph's", tagAt(arabic, rtl, 101f, 10f), 1)
  val rtlWrapped = Grid(25, 10, width = 100, rtl = true)
  expect("right to left across lines: the link's part on the second line", tagAt(rtlWrapped, wrapped, 65f, 30f), 2)
  expect("right to left across lines: the words after it", tagAt(rtlWrapped, wrapped, 15f, 30f), 1)

  // What the platform cannot answer (issuetracker 113348914) is the paragraph's, as `reactTagForTouch` returns its target.
  expect("a line the layout cannot measure is the paragraph's", tagAt(Grid(18, 18, width = 200, failOn = 0), sentence, 100f, 10f), 1)
  expect("a text with no fragments is the paragraph's", TextHitRules.tagAt(line, 100f, 10f, IntArray(0), IntArray(0), IntArray(0), 0, 1), 1)

  // Equal lengths: the last of them, the more inner element of the two in React Native's array.
  expect("of equal length the later fragment wins", TextHitRules.target(4, intArrayOf(0, 4), intArrayOf(4, 8), intArrayOf(7, 8), 2, 8, 1), 8)
  expect("an empty fragment is nobody's", TextHitRules.target(4, intArrayOf(0, 4, 4), intArrayOf(4, 4, 8), intArrayOf(7, 9, 8), 3, 8, 1), 8)
  expect("a fragment the offset is not in is not asked", TextHitRules.target(2, intArrayOf(0, 3), intArrayOf(2, 6), intArrayOf(7, 9), 2, 6, 1), 7)
  expect("no fragment around the offset is the fallback", TextHitRules.target(9, intArrayOf(0, 3), intArrayOf(2, 6), intArrayOf(7, 9), 2, 12, 1), 1)

  expect("one node needs no search", TextHitRules.nested(intArrayOf(1, 1, 1), 3, 1), false)
  expect("a fragment of the paragraph with no tag needs no search", TextHitRules.nested(intArrayOf(0, 1), 2, 1), false)
  expect("another node does", TextHitRules.nested(intArrayOf(1, 2, 1), 3, 1), true)
}

/** The text of the file [name] under [main]. */
private fun text(main: String, name: String): String {
  val file = File(main).walkTopDown().firstOrNull { it.isFile && it.name == name } ?: error("$name not found under $main")
  return file.readText()
}

private fun source(main: String) {
  val encoder = text(main, "PropsEncoder.cpp")
  val props = text(main, "Props.kt")
  val engineText = text(main, "EngineText.kt")
  val root = text(main, "EngineRoot.kt")
  val delegate = text(main, "MountingDelegate.cpp")

  // The wire: the id the encoder writes is the one the decoder reads, and it is written after each fragment's own records.
  val id = Regex("""kFragmentTarget = (\d+)""").find(encoder)?.groupValues?.get(1) ?: error("kFragmentTarget not declared in PropsEncoder.cpp")
  expect("the decoder reads the record the encoder writes", Regex("""\n\s+$id -> \{[^}]*fr\.tag = ops\[i\]""").containsMatchIn(props), true)
  expect("the record is written with each fragment, from its parent node", encoder.contains("r.begin(kFragmentTarget);\n      batch.putInt(fragment.parentShadowView.tag);"), true)
  expect("the record id is not another record's", Regex("""= $id,""").findAll(encoder).count(), 1)

  // The view asks the rules, the root dispatches to what it answers for a touch that starts and for one that joins.
  expect("a text answers with the rules", engineText.contains("TextHitRules.tagAt(LayoutLines(l)"), true)
  expect("a touch starts at the nested node", root.contains("val tag = tagAt(target, ev.x, ev.y)") && root.contains("track(ev, 0, target, tag)"), true)
  expect("a second finger too", root.contains("tagAt(target, ev.getX(ev.actionIndex), ev.getY(ev.actionIndex))") && root.contains("track(ev, ev.actionIndex, target, tag)"), true)
  expect("a text does not perform the click of a touch (a service's click is the only one)", engineText.contains("override fun onTouchEvent(event: MotionEvent): Boolean = isClickable"), true)
  expect("the position JavaScript gets stays the paragraph's", root.contains("HitTest.toLocal(this, views[i], lastX[i], lastY[i], local)"), true)

  // The native side: a nested Text's emitter is kept from its Create to its Delete, so that dispatchTouch and dispatchClick find it.
  val nestedCalls = Regex("""isNestedText\(\w+\)""").findAll(delegate).count()
  expect("nested Text emitters are kept on create, update and delete", Regex("""if \(isNestedText\(newView\)\) setEmitter""").containsMatchIn(delegate) &&
    Regex("""isNestedText\(newView\) && oldView\.eventEmitter != newView\.eventEmitter""").containsMatchIn(delegate) &&
    Regex("""isNestedText\(oldView\)\) eraseEmitter""").containsMatchIn(delegate), true)
  expect("and nothing else of a nested Text reaches Kotlin", nestedCalls, 3)
}

fun main(args: Array<String>) {
  rules()
  source(args.getOrNull(0) ?: error("usage: TextHitRulesCheck <svelte-engine android main directory>"))
  System.err.println("TextHitRulesCheck: $checks checks")
}
