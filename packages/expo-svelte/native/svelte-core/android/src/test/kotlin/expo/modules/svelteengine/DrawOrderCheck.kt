package expo.modules.svelteengine

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the order an elevated child is drawn in (SPEC.md, "Elevation and draw order"). The views are Android's and cannot run here, so the check reads the
 * sources: React Native's `ReactViewGroup.drawChild` brackets the draw of a child that has an elevation with `enableZ(canvas, true)` and `enableZ(canvas, false)`, which draws it
 * in a chunk of its own (the shadow, and the order the siblings are in); `EngineView.drawChild` does the same through `CanvasZ`, which does what `CanvasUtil.enableZ` does.
 * Usage: DrawOrderCheck <ReactViewGroup.kt> <CanvasUtil.kt> <EngineView.kt> <CanvasZ.kt>   (src/test/engine.sh)
 */
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
    exitProcess(1)
  }
}

private fun text(path: String) = File(path).readText().replace(Regex("\\s+"), " ")

fun main(args: Array<String>) {
  val react = text(args[0])
  val util = text(args[1])
  val engine = text(args[2])
  val z = text(args[3])
  val reactBody = react.substringAfter("override fun drawChild(").substringBefore("public fun setOpacityIfPossible")
  expect("RN: only a child with an elevation is bracketed", reactBody.contains("val drawWithZ = child.elevation > 0"), true)
  expect(
    "RN: Z ordering is on for the draw of the child and off after it",
    reactBody.indexOf("enableZ(canvas, true)") in 0 until reactBody.indexOf("super.drawChild(canvas, child, drawingTime)") &&
      reactBody.indexOf("super.drawChild(canvas, child, drawingTime)") < reactBody.indexOf("enableZ(canvas, false)"),
    true,
  )
  expect("RN: enableZ is the canvas's on API 29 and the hidden barriers before", util.contains("canvas.enableZ()") && util.contains("canvas.disableZ()") && util.contains("insertReorderBarrier") && util.contains("insertInorderBarrier"), true)
  val engineBody = engine.substringAfter("override fun drawChild(").substringBefore("override fun onRtlPropertiesChanged")
  expect("EngineView brackets the draw of a child that has an elevation", engineBody.contains("val withZ = child.elevation > 0f"), true)
  expect(
    "EngineView: on before the child is drawn, off after it",
    engineBody.indexOf("CanvasZ.enable(canvas, true)") in 0 until engineBody.indexOf("super.drawChild(canvas, child, drawingTime)") &&
      engineBody.indexOf("super.drawChild(canvas, child, drawingTime)") < engineBody.indexOf("CanvasZ.enable(canvas, false)"),
    true,
  )
  expect("CanvasZ: the canvas's calls from API 29", z.contains("canvas.enableZ()") && z.contains("canvas.disableZ()") && z.contains("Build.VERSION_CODES.Q"), true)
  expect("CanvasZ: the hidden barriers before it", z.contains("insertReorderBarrier") && z.contains("insertInorderBarrier"), true)
  println("$checks checks")
}
