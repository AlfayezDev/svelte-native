package expo.modules.svelteengine

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the order siblings are drawn and hit in (`StackRules`, SPEC.md "Stacking"): `zIndex`, then insertion order, and an elevation never moves a child (the rule has no
 * elevation to look at; `EngineView` is read for the one place that hands it the `zIndex` of the children and uses the answer for both orders).
 * Usage: StackRulesCheck <EngineView.kt>   (src/test/engine.sh)
 */
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
    exitProcess(1)
  }
}

private fun order(vararg z: Float): List<Int> = StackRules.order(z).toList()

fun main(args: Array<String>) {
  expect("no zIndex keeps the order the children are in", order(0f, 0f, 0f), listOf(0, 1, 2))
  expect("a higher zIndex is later, so on top", order(2f, 0f, 1f), listOf(1, 2, 0))
  expect("ties keep insertion order", order(1f, 0f, 1f, 0f), listOf(1, 3, 0, 2))
  expect("a negative zIndex goes under", order(0f, -1f, 0f), listOf(1, 0, 2))
  // A plate with an elevation before the card that holds the rows: the elevation is no argument of the rule, so the plate stays before the card (the card is drawn and hit first from the top).
  expect("an elevated sibling before another stays before it", order(0f, 0f), listOf(0, 1))
  if (args.isNotEmpty()) {
    val view = File(args[0]).readText().replace(Regex("\\s+"), " ")
    val body = view.substringAfter("private fun sortOrders() {").substringBefore("override fun getChildDrawingOrder")
    expect("EngineView orders by zIndex alone", body.contains("StackRules.order(FloatArray(n) { (getChildAt(it) as? EngineNode)?.node?.zIndex ?: 0f })") && !body.contains("node?.elevation"), true)
    expect("and draws and hits in that one order", body.contains("drawOrder = order") && body.contains("hitOrder = order"), true)
  }
  println("$checks checks")
}
