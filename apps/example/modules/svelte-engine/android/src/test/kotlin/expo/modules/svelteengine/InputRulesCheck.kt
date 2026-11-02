package expo.modules.svelteengine

import kotlin.system.exitProcess

/**
 * Plain-JVM check of the text input's `autoCorrect` tri-state (`InputRules`, SPEC.md "TextInput: autoCorrect"): what a prop record does to the
 * setting a view keeps, so that an update that does not mention the prop leaves it and `false` stays different from unset.
 * Usage: InputRulesCheck <ReactTextInputManager.kt>   (src/test/run.sh)
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

/** React Native's own `setAutoCorrect` (the file is the first argument) must still mean what `InputRules` says: true asks for auto-correction, false turns suggestions off, null leaves the type alone. */
private fun againstReactNative(source: String) {
  val body = java.io.File(source).readText().substringAfter("fun setAutoCorrect(").substringBefore("@ReactProp(name = \"multiline\"")
  val compact = body.replace(Regex("\\s+"), " ")
  expect("RN: true sets TYPE_TEXT_FLAG_AUTO_CORRECT", compact.contains("true -> InputType.TYPE_TEXT_FLAG_AUTO_CORRECT"), true)
  expect("RN: false sets TYPE_TEXT_FLAG_NO_SUGGESTIONS", compact.contains("false -> InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS"), true)
  expect("RN: null sets nothing", compact.contains("else -> 0"), true)
  expect("RN: both flags are cleared first", compact.contains("flagsToUnset = InputType.TYPE_TEXT_FLAG_AUTO_CORRECT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS"), true)
}

fun main(args: Array<String>) {
  if (args.isNotEmpty()) againstReactNative(args[0])
  val unset = InputRules.AUTO_CORRECT_CLEARED
  expect("a view starts unset", InputRules.autoCorrectAfter(unset, InputRules.AUTO_CORRECT_KEEP), unset)
  expect("false is a setting of its own", InputRules.autoCorrectAfter(unset, InputRules.AUTO_CORRECT_OFF), InputRules.AUTO_CORRECT_OFF)
  expect("true is a setting of its own", InputRules.autoCorrectAfter(unset, InputRules.AUTO_CORRECT_ON), InputRules.AUTO_CORRECT_ON)
  expect("an update without the prop keeps false", InputRules.autoCorrectAfter(InputRules.AUTO_CORRECT_OFF, InputRules.AUTO_CORRECT_KEEP), InputRules.AUTO_CORRECT_OFF)
  expect("an update without the prop keeps true", InputRules.autoCorrectAfter(InputRules.AUTO_CORRECT_ON, InputRules.AUTO_CORRECT_KEEP), InputRules.AUTO_CORRECT_ON)
  expect("false turns to true", InputRules.autoCorrectAfter(InputRules.AUTO_CORRECT_OFF, InputRules.AUTO_CORRECT_ON), InputRules.AUTO_CORRECT_ON)
  expect("true turns to false", InputRules.autoCorrectAfter(InputRules.AUTO_CORRECT_ON, InputRules.AUTO_CORRECT_OFF), InputRules.AUTO_CORRECT_OFF)
  expect("a removed prop clears false", InputRules.autoCorrectAfter(InputRules.AUTO_CORRECT_OFF, InputRules.AUTO_CORRECT_CLEARED), unset)
  expect("a removed prop clears true", InputRules.autoCorrectAfter(InputRules.AUTO_CORRECT_ON, InputRules.AUTO_CORRECT_CLEARED), unset)
  expect("the header's search field (code 0) is unset", InputRules.autoCorrectAfter(InputRules.AUTO_CORRECT_ON, 0), unset)
  println("$checks checks, $failures failed")
  if (failures > 0) exitProcess(1)
}
