package expo.modules.svelteengine

import kotlin.system.exitProcess

/**
 * Plain-JVM check of what a header and a sheet decide from measurements that are not there yet (`ChromeRules`, SPEC.md "Native screens, Android"):
 * the first layout of a screen runs detached, where the window reports no insets and the stack around a sheet may not have a size.
 * The numbers are the OVH emulator's (1080x2400 at 420 dpi, a 128 px status bar, a 2169 px pane under the tab bar, a 2273 px sheet box).
 * Usage: ChromeRulesCheck <EngineHeader.kt> <EngineSheet.kt>   (src/test/run.sh)
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
  // The route-tree lab's pushed screens (tree-detail, screens-header, -translucent, -toolbar, -toolbar-center): their parity references are 1 px above the window's inset.
  expect("the first screen of a stack lays out again on attach", ChromeRules.headerRelayoutOnAttach(true, -1, 128), true)
  expect("a pushed screen keeps what it drew detached", ChromeRules.headerRelayoutOnAttach(false, -1, 128), false)
  expect("the first screen does not when the window says what it used", ChromeRules.headerRelayoutOnAttach(true, 128, 128), false)
}

private fun sheet() {
  // The sheet was inserted into a stack with no size (rest 0: the top detent), laid out again at 1252 with the same frame.
  expect("a sheet that was never put at a rest goes to the rest the layout works out, whatever its frame did", ChromeRules.sheetMoves(Float.NaN, 1252f, false), true)
  expect("a sheet put at the top detent while the stack had no size moves to its detent once the layout knows it", ChromeRules.sheetMoves(0f, 1252f, false), true)
  expect("a sheet at its rest stays for a layout that changed nothing", ChromeRules.sheetMoves(1252f, 1252f, false), false)
  expect("a sheet whose own frame changed is put at its rest again", ChromeRules.sheetMoves(1252f, 1252f, true), true)
}

private fun normalized(path: String) = java.io.File(path).readText().replace(Regex("\\s+"), " ")

/** `EngineHeader` asks the window through the rule, and asks for the second layout when it attaches. */
private fun againstHeader(path: String) {
  val text = normalized(path)
  expect("EngineHeader reads the window's inset through ChromeRules.headerInset", text.contains("private fun windowInset(): Int? = ChromeRules.headerInset(inSheet(), SafeArea.top(this))"), true)
  expect("EngineHeader's layout refreshes from it", text.contains("private fun refreshInset() { cachedInset = windowInset() ?: -1 }"), true)
  val attach = text.substringAfter("override fun onAttachedToWindow() {").substringBefore("override fun onDetachedFromWindow()")
  expect("EngineHeader's first screen of a stack lays out again on attach when the window's inset is not the one it laid out with", attach.contains("if (ChromeRules.headerRelayoutOnAttach(firstOfStack(), cachedInset, windowInset())) requestLayout()"), true)
  val apply = text.substringAfter("override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {").substringBefore("// Drawing")
  expect("EngineHeader's window dispatch asks the same question", apply.contains("if (ChromeRules.insetStale(before, cachedInset)) requestLayout()"), true)
}

/** `EngineSheet` puts an idle sheet at the rest every layout works out, not only after its own frame changed. */
private fun againstSheet(path: String) {
  val text = normalized(path)
  val layout = text.substringAfter("override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {").substringBefore("/** The enter transition ended")
  expect("EngineSheet.onLayout moves an idle sheet by ChromeRules.sheetMoves", layout.contains("if (ChromeRules.sheetMoves(restApplied, rest, changed) && !dragging && settler == null && !transitioning && !leaving)"), true)
  expect("EngineSheet remembers the rest it put the sheet at", layout.contains("restApplied = rest"), true)
  val attach = text.substringAfter("override fun onAttachedToWindow() {").substringBefore("override fun onDetachedFromWindow()")
  expect("EngineSheet lays out again once attached", attach.contains("requestLayout()"), true)
  expect("EngineSheet lays out again when the window's status bar is not the one its detents were worked out with", text.contains("if (ChromeRules.insetStale(topSeen, stack?.let { SafeArea.top(it) })) requestLayout()"), true)
}

fun main(args: Array<String>) {
  header()
  sheet()
  if (args.isNotEmpty()) againstHeader(args[0])
  if (args.size > 1) againstSheet(args[1])
  if (failures > 0) {
    System.err.println("$failures of $checks checks failed")
    exitProcess(1)
  }
  println("chrome rules: $checks checks passed")
}
