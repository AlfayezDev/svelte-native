package expo.modules.svelteengine

import kotlin.system.exitProcess

/**
 * Plain-JVM check of what `Capture` decides before it draws (`CaptureRules`), without a device: the library's module draws a
 * view the engine does not own, so every option must reach it, and only an engine view is refused an option the engine does
 * not capture. Usage: `src/test/run.sh`.
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

fun main() {
  val plain = emptyMap<String, Any?>()
  val unsupported = listOf(
    mapOf<String, Any?>("format" to "raw"),
    mapOf<String, Any?>("result" to "zip-base64"),
    mapOf<String, Any?>("snapshotContentContainer" to true),
  )

  // A foreign or unknown tag answers null whatever the options are: the library's module owns that view and takes them all.
  for (options in unsupported + listOf(plain, mapOf<String, Any?>("handleGLSurfaceViewOnAndroid" to true))) {
    expect("a view the engine does not own, $options", CaptureRules.plan(false, options), CaptureRules.Plan.NotEngine)
  }

  // An engine view is drawn, or refused an option it does not capture.
  expect("engine view, no options", CaptureRules.plan(true, plain), CaptureRules.Plan.Draw)
  expect("engine view, png base64", CaptureRules.plan(true, mapOf("format" to "png", "result" to "base64")), CaptureRules.Plan.Draw)
  expect("engine view, SurfaceView overlay", CaptureRules.plan(true, mapOf("handleGLSurfaceViewOnAndroid" to true)), CaptureRules.Plan.Draw)
  for (options in unsupported) {
    expect("engine view, $options", CaptureRules.plan(true, options) is CaptureRules.Plan.Reject, true)
  }

  if (failures > 0) {
    System.err.println("$failures of $checks check(s) failed")
    exitProcess(1)
  }
  System.err.println("CaptureCheck: $checks checks passed")
}
