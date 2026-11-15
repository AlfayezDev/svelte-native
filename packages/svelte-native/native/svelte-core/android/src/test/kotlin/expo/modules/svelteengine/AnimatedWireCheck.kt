package expo.modules.svelteengine

import java.io.File
import java.util.Locale
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the Kotlin half of the typed animated wire format (AnimatedWire.decodeRecords). Reads the fixture
 * AnimatedWireTest.cpp wrote (name, tab, typed buffer ints, tab, the text it expects) and renders each buffer through
 * the production decoder, so both halves are verified against the same bytes. Usage: AnimatedWireCheck <fixture>
 * (src/test/run.sh compiles and runs both).
 */
private class Recorder : AnimatedWire.Target {
  val text = StringBuilder()

  private fun num(v: Float): String = if (v.isNaN()) "nan" else String.format(Locale.ROOT, "%.6f", if (v == 0f) 0f else v)

  override fun opacity(value: Float) { text.append(";opacity=").append(num(value)) }

  override fun background(color: Int) { text.append(";bg=").append(color) }

  override fun radius(topLeft: Float, topRight: Float, bottomRight: Float, bottomLeft: Float) {
    text.append(";radius=").append(num(topLeft)).append(',').append(num(topRight)).append(',').append(num(bottomRight)).append(',').append(num(bottomLeft))
  }

  override fun transform(tx: Float, ty: Float, sx: Float, sy: Float, rotation: Float) {
    text.append(";transform=").append(num(tx)).append(',').append(num(ty)).append(',').append(num(sx)).append(',').append(num(sy)).append(',').append(num(rotation))
  }

  override fun stacking(zIndex: Float, elevation: Float) { text.append(";stacking=").append(num(zIndex)).append(',').append(num(elevation)) }
}

/** The view loop of AnimatedBridge.flush without the views: header, then records through the decoder. */
private fun render(buffer: IntArray): String {
  val recorder = Recorder()
  var at = 1
  for (view in 0 until buffer[0]) {
    if (view > 0) recorder.text.append(" | ")
    recorder.text.append("tag=").append(buffer[at])
    at = AnimatedWire.decodeRecords(buffer, at + 2, buffer[at + 1], recorder)
    if (at < 0) return recorder.text.append(";?unknown record").toString()
  }
  check(at == buffer.size) { "records end at $at, buffer has ${buffer.size} ints" }
  return recorder.text.toString()
}

fun main(args: Array<String>) {
  val lines = File(args[0]).readLines().filter { it.isNotBlank() }
  var failures = 0
  for (line in lines) {
    val (name, ints, expected) = line.split('\t')
    val buffer = IntArray(ints.split(',').size) { ints.split(',')[it].toInt() }
    val actual = render(buffer)
    if (actual != expected) {
      failures++
      System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
    }
  }

  // An id this build does not know stops the decode instead of misreading what follows.
  val corrupt = intArrayOf(1, 7, 1, 99, 0)
  if (AnimatedWire.decodeRecords(corrupt, 3, 1, Recorder()) != -1) {
    failures++
    System.err.println("FAIL unknown record id must return -1")
  }

  if (failures > 0) {
    System.err.println("$failures of ${lines.size + 1} check(s) failed")
    exitProcess(1)
  }
  System.err.println("AnimatedWireCheck: ${lines.size + 1} checks passed")
}
