package expo.modules.svelteengine

import kotlin.system.exitProcess

/**
 * Plain-JVM check of what a header and a sheet decide from measurements that are not there yet (`ChromeRules`, SPEC.md "Native screens, Android"):
 * the first layout of a screen runs detached, where the window reports no insets and the stack around a sheet may not have a size.
 * The numbers are the OVH emulator's (1080x2400 at 420 dpi, a 128 px status bar, a 2169 px pane under the tab bar, a 2273 px sheet box).
 * Usage: ChromeRulesCheck <EngineHeader.kt> <EngineSheet.kt> <EngineStack.kt>   (src/test/run.sh)
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

private fun header() {
  expect("a header the window has reported takes the window's inset", ChromeRules.headerInset(false, 128), 128)
  expect("a header the window has not reported for takes none", ChromeRules.headerInset(false, null), null)
  // The compose sheet of the route-tree lab: its box (2273 px) starts 104 px above its 2169 px stack, so its layout position makes the status bar 232 px.
  expect("a header in a sheet keeps the padding its screen gave it, whatever the window says of its position", ChromeRules.headerInset(true, 232), null)
  expect("a header laid out before the window reported lays out again when it does", ChromeRules.insetStale(-1, 128), true)
  expect("a header that used the window's inset stays", ChromeRules.insetStale(128, 128), false)
  expect("a window that still has no inset leaves the header as it is", ChromeRules.insetStale(-1, null), false)
  expect("an inset that moved lays the header out again", ChromeRules.insetStale(128, 96), true)
  expect("a header in a sheet never has a window inset to be stale against", ChromeRules.insetStale(-1, ChromeRules.headerInset(true, 232)), false)
}

private fun sheet() {
  // The sheet was inserted into a stack with no size (translation 0: the top detent), laid out again at 1252 with the same frame.
  expect("a sheet put at the top detent while the stack had no size moves to its detent once the layout knows it", ChromeRules.sheetMoves(0f, 1252f, false, false), true)
  expect("a sheet at its rest stays for a layout that changed nothing", ChromeRules.sheetMoves(1252f, 1252f, false, false), false)
  expect("a sheet whose own frame changed is put at its rest again", ChromeRules.sheetMoves(1252f, 1252f, true, false), true)
  expect("a sheet whose rest moved under it (the window reported the status bar) is put at the new one", ChromeRules.sheetMoves(1252f, 1228f, false, false), true)

  // A sheet at its 50 % detent (rest 1252), dragged to the top one (rest 0) and released: the settle ends at 0 and the rest is 0.
  expect("a layout after a settle to another detent finds the sheet at its rest and leaves it", ChromeRules.sheetMoves(0f, 0f, false, false), false)
  // The same sheet, a predictive back gesture on it (translation rest + progress * height * 0.25, here 40 % of a 2273 px box), a layout of its content in the middle.
  val gesture = 0f + 0.4f * 2273f * 0.25f
  expect("a layout during a predictive back does not move the sheet", ChromeRules.sheetMoves(gesture, 0f, false, true), false)
  expect("a layout during a predictive back does not move the sheet, whatever its frame did", ChromeRules.sheetMoves(gesture, 0f, true, true), false)
  expect("a layout during the animation that cancels the gesture does not move the sheet", ChromeRules.sheetMoves(57f, 0f, false, true), false)
  expect("a layout during a drag or its settle does not move the sheet", ChromeRules.sheetMoves(640f, 1252f, true, true), false)
  expect("a layout after the cancel animation ended finds the sheet at its rest", ChromeRules.sheetMoves(0f, 0f, false, false), false)
}

private fun normalized(path: String) = java.io.File(path).readText().replace(Regex("\\s+"), " ")

/** `EngineHeader` asks the window through the rule, and asks for the second layout when it attaches. */
private fun againstHeader(path: String) {
  val text = normalized(path)
  expect("EngineHeader reads the window's inset through ChromeRules.headerInset", text.contains("private fun windowInset(): Int? = ChromeRules.headerInset(inSheet(), SafeArea.top(this))"), true)
  expect("EngineHeader's layout refreshes from it", text.contains("private fun refreshInset() { cachedInset = windowInset() ?: -1 }"), true)
  val attach = text.substringAfter("override fun onAttachedToWindow() {").substringBefore("override fun onDetachedFromWindow()")
  expect("EngineHeader lays out again on attach when the window's inset is not the one it laid out with, pushed screens included", attach.contains("if (ChromeRules.insetStale(cachedInset, windowInset())) requestLayout()"), true)
  expect("EngineHeader no longer picks the first screen of a stack", text.contains("firstOfStack"), false)
  val apply = text.substringAfter("override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {").substringBefore("// Drawing")
  expect("EngineHeader's window dispatch asks the same question", apply.contains("if (ChromeRules.insetStale(before, cachedInset)) requestLayout()"), true)
}

/** `EngineSheet` puts an idle sheet at the rest every layout works out, not only after its own frame changed, and leaves alone a sheet that something else moves. */
private fun againstSheet(path: String) {
  val text = normalized(path)
  val layout = text.substringAfter("override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {").substringBefore("/** The enter transition ended")
  expect("EngineSheet.onLayout moves a sheet by ChromeRules.sheetMoves, from where the sheet is", layout.contains("if (ChromeRules.sheetMoves(translationY, rest, changed, busy)) translationY = rest"), true)
  expect("EngineSheet remembers no rest of its own: a settle, a snap and a move to the rest end at the translation it is compared with", text.contains("restApplied"), false)
  val busy = text.substringAfter("private val busy: Boolean get() = ").substringBefore("override fun onLayout").trim().split(" || ")
  for (term in listOf("dragging", "settler != null", "transitioning", "leaving", "running != null", "gesturing"))
    expect("EngineSheet is busy while its condition is: $term", busy.contains(term), true)
  val attach = text.substringAfter("override fun onAttachedToWindow() {").substringBefore("override fun onDetachedFromWindow()")
  expect("EngineSheet lays out again once attached", attach.contains("requestLayout()"), true)
  expect("EngineSheet lays out again when the window's status bar is not the one its detents were worked out with", text.contains("if (ChromeRules.insetStale(topSeen, stack?.let { SafeArea.top(it) })) requestLayout()"), true)
}

/** `EngineStack` marks the screen a gesture moves for as long as it holds it: predictive back, and the edge swipe. */
private fun againstStack(path: String) {
  val text = normalized(path)
  val hold = text.substringAfter("private fun holdGesture(s: EngineScreen) {").substringBefore("private fun releaseGesture()")
  expect("EngineStack marks the screen as gesturing when it holds it", hold.contains("s.gesturing = true"), true)
  val release = text.substringAfter("private fun releaseGesture() {").substringBefore("private val backCallback")
  expect("EngineStack clears the mark when it lets the screen go", release.contains("gestureScreen?.let { it.gesturing = false; it.releaseLayer() }"), true)
  val started = text.substringAfter("override fun handleOnBackStarted(backEvent: BackEventCompat) {").substringBefore("override fun handleOnBackProgressed")
  expect("a predictive back holds the screen it moves", started.contains("holdGesture(top)"), true)
  val cancelled = text.substringAfter("override fun handleOnBackCancelled() {").substringBefore("private var backRegistered")
  expect("the animation that cancels a predictive back is an animation of the stack (the sheet's layout sees it as running)", cancelled.contains("animate(top, 0f, top.restY, 1f, 1f, 150L)"), true)
}

fun main(args: Array<String>) {
  header()
  sheet()
  if (args.isNotEmpty()) againstHeader(args[0])
  if (args.size > 1) againstSheet(args[1])
  if (args.size > 2) againstStack(args[2])
  if (failures > 0) {
    System.err.println("$failures of $checks checks failed")
    exitProcess(1)
  }
  println("chrome rules: $checks checks passed")
}
