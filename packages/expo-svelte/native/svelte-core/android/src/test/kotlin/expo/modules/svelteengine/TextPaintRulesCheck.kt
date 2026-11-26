package expo.modules.svelteengine

import kotlin.system.exitProcess

/**
 * Plain-JVM check of which paint a text is laid out with (`TextPaintRules`, SPEC.md "Text parity"): a text that can end in an ellipsis keeps its font in spans and the view's
 * paint under it, as React Native's `ReactTextView` has it, and the sources of React Native still say that the view has no typeface of its own.
 * Usage: TextPaintRulesCheck <ReactTextView.java> <ReactTextViewManager.kt> <TextLayouts.kt>   (src/test/engine.sh)
 */
private var failures = 0
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    failures++
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
  }
}

fun main(args: Array<String>) {
  expect("a single plain fragment with no line limit keeps its font in the paint", TextPaintRules.fontInPaint(1, true, false, 0), true)
  expect("one that can end in an ellipsis does not", TextPaintRules.fontInPaint(1, true, false, 1), false)
  expect("nor one that has more than one line", TextPaintRules.fontInPaint(1, true, false, 3), false)
  expect("nor one that shrinks to fit", TextPaintRules.fontInPaint(1, true, true, 0), false)
  expect("nor one that is styled beyond the paint", TextPaintRules.fontInPaint(1, false, false, 0), false)
  expect("nor several fragments", TextPaintRules.fontInPaint(2, true, false, 0), false)
  if (args.size > 1) {
    val view = java.io.File(args[0]).readText()
    val manager = java.io.File(args[1]).readText()
    expect("RN: the text view sets no typeface of its own", view.contains("setTypeface("), false)
    expect("RN: and no font family prop", manager.contains("FONT_FAMILY"), false)
    expect("RN: it is told its size, which its paint measures the ellipsis at", view.contains("setTextSize(TypedValue.COMPLEX_UNIT_PX, mFontSize)"), true)
  }
  if (args.size > 2) {
    val layouts = java.io.File(args[2]).readText().replace(Regex("\\s+"), " ")
    expect("TextLayouts lays out under the view's paint unless the rule says the font is in the paint", layouts.contains("TextPaintRules.fontInPaint(frags.size, frags[0].plain, spec.fit, spec.maxLines)") && layouts.contains("if (bare) basePaint(frags[0]) else viewPaint(frags[0])"), true)
  }
  println("$checks checks, $failures failed")
  if (failures > 0) exitProcess(1)
}
