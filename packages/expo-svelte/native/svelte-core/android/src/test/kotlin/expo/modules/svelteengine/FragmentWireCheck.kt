package expo.modules.svelteengine

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the other half of record 27 (`FragmentWire`): what the C++ encoder wrote (FragmentWireTest.cpp verified these streams) is decoded by the code the
 * engine runs, to the tag and the link flag the encoder was given.
 * Usage: FragmentWireCheck <fixture>   (src/test/run.sh)
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
  val lines = File(args.getOrNull(0) ?: error("usage: FragmentWireCheck <fixture>")).readLines().filter { it.isNotBlank() }
  expect("the fixture has the cases", lines.size >= 10, true)
  for (line in lines) {
    val cells = line.split('\t')
    val ops = cells[1].split(',').map { it.toInt() }.toIntArray()
    expect("${cells[0]}: one record", ops[0], 1)
    expect("${cells[0]}: the record id", ops[1], FragmentWire.TARGET)
    expect("${cells[0]}: the record is its size", ops.size, 2 + FragmentWire.TARGET_INTS)
    expect("${cells[0]}: tag", FragmentWire.tag(ops, 2), cells[2].toInt())
    expect("${cells[0]}: link", FragmentWire.isLink(ops, 2), cells[3] == "1")
  }
  // Flags the decoder does not know are no link.
  expect("another flag is not a link", FragmentWire.isLink(intArrayOf(5, 2), 0), false)
  expect("the link flag among others", FragmentWire.isLink(intArrayOf(5, 3), 0), true)
  System.err.println("FragmentWireCheck: $checks checks")
}
