package expo.modules.svelteengine

import kotlin.system.exitProcess

/**
 * Plain-JVM check of what the accessibility hot path decides without asking Android (SPEC.md, "Accessibility props"): when a node's content
 * description has to be built again (`A11yRules.descriptionChanged`), what an `EngineText` has told the live regions (`TextTold`) and the answer
 * that is read once per frame (`FrameFlag`).
 * Usage: A11yLiveCheck   (src/test/run.sh)
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

private fun records(state: Int? = null, valueText: String? = null, hint: String? = null, mode: Int = 0, role: Int = -1): A11yRecords {
  val r = A11yRecords()
  if (state != null) { r.hasState = true; r.state = state }
  if (valueText != null) { r.valueMask = A11yRules.VALUE_TEXT; r.valueText = valueText }
  r.hint = hint
  r.mode = mode
  r.role = role
  return r
}

private fun descriptions() {
  val none = A11yRecords()
  expect("nothing changed", A11yRules.descriptionChanged("Save", "Save", none, none), false)
  expect("no label at all", A11yRules.descriptionChanged(null, null, none, none), false)
  expect("the label changed", A11yRules.descriptionChanged("Save", "Saved", none, none), true)
  expect("a label came", A11yRules.descriptionChanged(null, "Save", none, none), true)
  expect("a label went", A11yRules.descriptionChanged("Save", null, none, none), true)
  expect("a state came", A11yRules.descriptionChanged("Save", "Save", none, records(state = A11yRules.BUSY)), true)
  expect("the state changed", A11yRules.descriptionChanged("Save", "Save", records(state = A11yRules.BUSY), records(state = A11yRules.SELECTED)), true)
  expect("the same state", A11yRules.descriptionChanged("Save", "Save", records(state = A11yRules.BUSY), records(state = A11yRules.BUSY)), false)
  expect("the value's text changed", A11yRules.descriptionChanged("Volume", "Volume", records(valueText = "5"), records(valueText = "6")), true)
  expect("the value's text went", A11yRules.descriptionChanged("Volume", "Volume", records(valueText = "5"), none), true)
  expect("the same value text", A11yRules.descriptionChanged("Volume", "Volume", records(valueText = "5"), records(valueText = "5")), false)
  // what the description does not say: the hint, the mode (live region, importance) and the role
  expect("a hint is not in the description", A11yRules.descriptionChanged("Save", "Save", none, records(hint = "Saves")), false)
  expect("the mode is not in the description", A11yRules.descriptionChanged("Save", "Save", none, records(mode = 5)), false)
  expect("the role is not in the description", A11yRules.descriptionChanged("Save", "Save", none, records(role = 3)), false)
  // a skipped build must give what a built one would have: the cached description of unchanged inputs is the one built for them
  val label = "Mute"
  val before = records(state = A11yRules.BUSY)
  val built = A11yRules.contentDescription(label, before.hasState, before.state, before.valueText, "busy", "mixed")
  expect("the cache stands for the same inputs", built, A11yRules.contentDescription(label, before.hasState, before.state, before.valueText, "busy", "mixed"))
}

private fun told() {
  val text = TextTold()
  expect("the first text is not news", text.changed("Hello"), false)
  expect("the same text is not", text.changed(StringBuilder("Hello")), false)
  expect("another text is", text.changed("Hello!"), true)
  expect("and then it is the one told", text.changed("Hello!"), false)
  expect("a text that goes is news", text.changed(null), true)
  expect("a text after none is a first one", text.changed("Back"), false)
  text.clear()
  expect("a cleared view starts over", text.changed("Other"), false)

  // The text is remembered on every rebuild, whoever listens: only the announcement is gated. A service that starts listening later must not
  // hear of a change that happened while nobody did.
  val rebuilds = listOf("A" to false, "B" to false, "B" to true, "C" to true, "C" to true, "D" to false, "D" to true)
  val announced = ArrayList<String>()
  val view = TextTold()
  for ((now, listening) in rebuilds) if (view.changed(now) && listening) announced.add(now)
  expect("only changes heard by a listener are announced", announced, listOf("C"))
  // the gate before the memory (the old order) announced D as well: it changed while nobody listened, and was told to the listener that came after
  val old = ArrayList<String>()
  var memory: String? = null
  for ((now, listening) in rebuilds) if (listening && now != memory) { val first = memory == null; memory = now; if (!first) old.add(now) }
  expect("the old order told a change nobody heard", old, listOf("C", "D"))
}

private fun perFrame() {
  val flag = FrameFlag()
  expect("nothing is known before the first read", flag.cached(100L), null)
  expect("the read is kept for its frame", flag.store(100L, true), true)
  expect("and given back within it", flag.cached(100L), true)
  expect("a new frame asks again", flag.cached(116L), null)
  expect("a changed answer is the new frame's", flag.store(116L, false), false)
  expect("false is an answer too", flag.cached(116L), false)
  var reads = 0
  for (frame in listOf(1L, 1L, 1L, 2L, 2L, 3L)) if (flag.cached(frame) == null) { reads++; flag.store(frame, true) }
  expect("one read per frame", reads, 3)
}

fun main() {
  descriptions()
  told()
  perFrame()
  if (failures > 0) {
    System.err.println("$failures of $checks checks failed")
    exitProcess(1)
  }
  println("A11yLiveCheck: $checks checks passed")
}
