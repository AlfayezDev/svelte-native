package expo.modules.svelteengine

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the insets' dp (`InsetRules`, SPEC.md "Insets"): the pixels divided by the density as a float, not rounded to two decimals; React Native's `PixelUtil.toDIPFromPixel` is
 * read for what it does, and `Insets.kt` for the call that hands it the rule.
 * Usage: InsetRulesCheck <PixelUtil.kt> <Insets.kt> <views directory>   (src/test/engine.sh)
 */
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
    exitProcess(1)
  }
}

fun main(args: Array<String>) {
  expect("128 px at 2.625 is 48.761906 dp, the float React Native serializes", InsetRules.dp(128, 2.625f), (128f / 2.625f).toDouble())
  expect("and not the two decimals of 48.76", InsetRules.dp(128, 2.625f) == 48.76, false)
  expect("a whole dp stays whole", InsetRules.dp(63, 2.625f), 24.0)
  expect("zero is zero", InsetRules.dp(0, 2.625f), 0.0)
  // The header at 2.625: a 56 dp bar is 147 px, the inset 128 px. JavaScript estimates 56 + 48.761906; the native side measures (147 + 128) / 2.625.
  val estimate = 56.0 + InsetRules.dp(128, 2.625f)
  val measured = InsetRules.metric(147f + 128f, 2.625f).toDouble()
  expect("the native header height is the estimate to float precision (104.761906, not 104.76)", Math.abs(estimate - measured) < 1e-4, true)
  expect("and the inset it reports is the one JavaScript has", InsetRules.metric(128f, 2.625f).toDouble(), InsetRules.dp(128, 2.625f))
  if (args.size > 2) {
    for (name in listOf("EngineHeader.kt", "EngineToolbar.kt", "EngineTabs.kt")) {
      val view = File(args[2] + "/" + name).readText().replace(Regex("\\s+"), " ")
      val body = view.substringAfter("private fun reportMetrics() {").substringBefore("NavEvents.metrics(")
      expect("$name reports its size and inset through the rule, rounded to nothing", body.contains("InsetRules.metric(") && !body.contains("round2") && !body.contains("* 100f") && !body.contains("roundToInt"), true)
    }
  }
  if (args.isNotEmpty()) {
    val util = File(args[0]).readText().replace(Regex("\\s+"), " ")
    expect("RN: a pixel value is divided by the density as a float", util.contains("public fun toDIPFromPixel(value: Float): Float { if (value.isNaN()) { return Float.NaN } return value / DisplayMetricsHolder.getScreenDisplayMetrics().density }"), true)
  }
  if (args.size > 1) {
    val insets = File(args[1]).readText().replace(Regex("\\s+"), " ")
    expect("Insets hands the pixels to the rule and rounds nothing", insets.contains("private fun dp(px: Int): Double = InsetRules.dp(px, density)") && !insets.contains("Math.round("), true)
  }
  println("$checks checks")
}
