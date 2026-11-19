package expo.modules.svelteengine

import java.io.File
import kotlin.math.abs
import kotlin.system.exitProcess

/**
 * Plain-JVM check of Android's own transition between two screens (`TransitionRules`, SPEC.md "Navigation"), the default push and pop of a stack on Android,
 * against the framework's activity transition: frameworks/base, core/res/res/anim/activity_open_enter.xml (alpha 0 to 1, startOffset 50, duration 83;
 * translate 96dp to 0 over 450 on fast_out_extra_slow_in), activity_open_exit.xml (0 to -96dp, alpha 1), activity_close_enter.xml (-96dp to 0, alpha 1),
 * activity_close_exit.xml (0 to 96dp; alpha 1 to 0, startOffset 35, duration 83), and core/res/res/interpolator/fast_out_extra_slow_in.xml
 * (`M 0,0 C 0.05, 0, 0.133333, 0.06, 0.166666, 0.4 C 0.208333, 0.82, 0.25, 1, 1, 1`). The sources of EngineScreen and EngineStack are read for the calls
 * that make it the default. Usage: TransitionRulesCheck <EngineScreen.kt> <EngineStack.kt>   (src/test/run.sh)
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

private fun near(name: String, actual: Float, expected: Float, tolerance: Float = 1e-4f) {
  checks++
  if (abs(actual - expected) > tolerance) {
    failures++
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected (within $tolerance)")
  }
}

/** The path evaluated in doubles, independently: its parameter for x by Newton's method from a bisection start, then its y. */
private fun reference(x: Double): Double {
  fun bez(s: Double, a: Double, b: Double, c: Double, d: Double): Double { val u = 1 - s; return u * u * u * a + 3 * u * u * s * b + 3 * u * s * s * c + s * s * s * d }
  val (xs, ys) = if (x < 0.166666) doubleArrayOf(0.0, 0.05, 0.133333, 0.166666) to doubleArrayOf(0.0, 0.0, 0.06, 0.4)
    else doubleArrayOf(0.166666, 0.208333, 0.25, 1.0) to doubleArrayOf(0.4, 0.82, 1.0, 1.0)
  var lo = 0.0
  var hi = 1.0
  repeat(60) { val m = (lo + hi) / 2; if (bez(m, xs[0], xs[1], xs[2], xs[3]) < x) lo = m else hi = m }
  return bez((lo + hi) / 2, ys[0], ys[1], ys[2], ys[3])
}

private fun timing() {
  expect("both screens move 96 dp", TransitionRules.SHIFT_DP, 96f)
  expect("over 450 ms", TransitionRules.DURATION_MS, 450L)
  near("the pushed screen is transparent at the start", TransitionRules.openEnterAlpha(0f), 0f)
  near("and until 50 ms", TransitionRules.openEnterAlpha(50f), 0f)
  near("half way through its 83 ms fade at 91.5 ms", TransitionRules.openEnterAlpha(91.5f), 0.5f)
  near("opaque at 133 ms", TransitionRules.openEnterAlpha(133f), 1f)
  near("and to the end", TransitionRules.openEnterAlpha(450f), 1f)
  near("the popped screen is opaque at the start", TransitionRules.closeExitAlpha(0f), 1f)
  near("and until 35 ms", TransitionRules.closeExitAlpha(35f), 1f)
  near("half way through its 83 ms fade at 76.5 ms", TransitionRules.closeExitAlpha(76.5f), 0.5f)
  near("gone at 118 ms", TransitionRules.closeExitAlpha(118f), 0f)
  near("and to the end", TransitionRules.closeExitAlpha(450f), 0f)
}

private fun curve() {
  near("fast_out_extra_slow_in starts at 0", TransitionRules.emphasized(0f), 0f)
  near("and ends at 1", TransitionRules.emphasized(1f), 1f)
  near("its two curves meet at (0.166666, 0.4)", TransitionRules.emphasized(TransitionRules.JOIN_X), TransitionRules.JOIN_Y, 1e-3f)
  var worst = 0.0
  var previous = -1f
  var monotonic = true
  for (i in 0..1000) {
    val t = i / 1000f
    val y = TransitionRules.emphasized(t)
    worst = maxOf(worst, abs(y - reference(t.toDouble())))
    if (y < previous - 1e-6f) monotonic = false
    previous = y
  }
  expect("it never goes back", monotonic, true)
  expect("it is the framework's path to within 1e-4 everywhere (worst ${"%.2e".format(worst)})", worst < 1e-4, true)
  // Most of the movement is early: 71 % of it is done in the first 100 ms of the 450, 93 % by 200 ms.
  near("71 % of the movement is done at 100 ms", TransitionRules.emphasized(100f / 450f), 0.712f, 2e-3f)
  near("93 % at 200 ms", TransitionRules.emphasized(200f / 450f), 0.932f, 2e-3f)
}

private fun screens() {
  val shift = 252f // 96 dp at 2.625 (420 dpi, the OVH emulator)
  near("a push starts with the screen below in place (the pushed one a full shift right)", TransitionRules.underX(shift, shift), 0f)
  near("and ends with it a full shift left", TransitionRules.underX(0f, shift), -shift)
  near("the two stay a shift apart on the way", TransitionRules.underX(100f, shift), -152f)
  near("a pop that takes the top screen past the shift leaves the one below in place", TransitionRules.underX(400f, shift), 0f)
  // The strip a screen uncovers, for a screen laid out at 0..1080.
  near("moved 100 px left: the strip is its right 100 px", TransitionRules.stripStart(0f, 1080f, -100f), 980f)
  near("to its right edge", TransitionRules.stripEnd(0f, 1080f, -100f), 1080f)
  near("moved 100 px right: the strip starts at its left edge", TransitionRules.stripStart(0f, 1080f, 100f), 0f)
  near("and is 100 px wide", TransitionRules.stripEnd(0f, 1080f, 100f), 100f)
  expect("not moved: no strip", TransitionRules.stripEnd(0f, 1080f, 0f) - TransitionRules.stripStart(0f, 1080f, 0f), 0f)
  expect("a gesture that took the screen past the shift slides it off across the width", TransitionRules.exitsAcross(300f, shift), true)
  expect("one that did not lets Android's exit finish it", TransitionRules.exitsAcross(200f, shift), false)
}

private fun sources(screen: String, stack: String) {
  val kind = screen.substringAfter("fun transitionKind(): Int").substringBefore("\n  }\n")
  expect("a push screen with the default animation plays Android's own transition", kind.contains("0 -> 4"), true)
  expect("slide_from_right keeps the slide across the width", kind.contains("3 -> 2"), true)
  val insert = stack.substringAfter("fun insertScreen(").substringBefore("\n  fun exitScreen(")
  expect("a push of kind 4 runs the system transition with the screen below", insert.contains("if (kind == 4) system(child,"), true)
  val exit = stack.substringAfter("private fun exitTo(").substringBefore("\n  }\n")
  expect("an exit of kind 4 runs it with the screen that will be on top", exit.contains("4 -> system(s,"), true)
  val system = stack.substringAfter("private fun system(").substringBefore("\n  private fun animate(")
  for (call in listOf("TransitionRules.emphasized(f)", "TransitionRules.openEnterAlpha(ms)", "TransitionRules.closeExitAlpha(ms)", "TransitionRules.underX(s.translationX, shift)", "TransitionRules.DURATION_MS"))
    expect("the transition uses $call", system.contains(call), true)
  val draw = stack.substringAfter("private fun drawEdge(").substringBefore("\n  private fun fillEdge(")
  expect("the strip is the one TransitionRules gives", draw.contains("TransitionRules.stripStart(") && draw.contains("TransitionRules.stripEnd("), true)
}

fun main(args: Array<String>) {
  timing()
  curve()
  screens()
  sources(File(args[0]).readText(), File(args[1]).readText())
  println("transition rules: $checks checks, $failures failed")
  if (failures > 0) exitProcess(1)
}
