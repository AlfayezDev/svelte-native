package expo.modules.svelteengine

import kotlin.system.exitProcess

/**
 * Plain-JVM check of the text input's `autoCorrect` tri-state (`InputRules`, SPEC.md "TextInput: autoCorrect"): what a prop record does to the
 * setting a view keeps, so that an update that does not mention the prop leaves it and `false` stays different from unset.
 * Usage: InputRulesCheck <ReactTextInputManager.kt> <EngineInput.kt> <AutoCorrectCode.h>   (src/test/run.sh)
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

/** The flag each setting stands for, with distinct stand-ins for the platform's two flags, so that swapping on and off cannot pass. */
private fun flags() {
  val auto = 0x8000
  val none = 0x80000
  expect("on is the auto-correct flag", InputRules.suggestionFlag(InputRules.AUTO_CORRECT_ON, auto, none), auto)
  expect("off is the no-suggestions flag", InputRules.suggestionFlag(InputRules.AUTO_CORRECT_OFF, auto, none), none)
  expect("unset sets neither", InputRules.suggestionFlag(InputRules.AUTO_CORRECT_CLEARED, auto, none), 0)
  expect("not in this update sets neither", InputRules.suggestionFlag(InputRules.AUTO_CORRECT_KEEP, auto, none), 0)
}

/** `EngineInput` hands the platform's flags over by name, auto-correct to the first and no-suggestions to the second (swapping them there would swap the behaviour), after the view kept the setting an update carried. */
private fun againstEngineInput(source: String) {
  val text = java.io.File(source).readText().replace(Regex("\\s+"), " ")
  expect("EngineInput.applyInputType maps the setting through InputRules.suggestionFlag with the platform's flags the right way round",
    text.contains("InputRules.suggestionFlag(autoCorrect, autoCorrectFlag = InputType.TYPE_TEXT_FLAG_AUTO_CORRECT, noSuggestionsFlag = InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)"), true)
  expect("EngineInput keeps the setting an update carried", text.contains("autoCorrect = InputRules.autoCorrectAfter(autoCorrect, v.autoCorrect)"), true)
}

/** The encoder's codes (AutoCorrectCode.h) are the ones InputRules names. */
private fun againstEncoder(source: String) {
  val text = java.io.File(source).readText().replace(Regex("\\s+"), " ")
  expect("an absent key is the keep code", text.contains("if (!present) return ${InputRules.AUTO_CORRECT_KEEP};"), true)
  expect("a null is the cleared code", text.contains("if (!isBool) return ${InputRules.AUTO_CORRECT_CLEARED};"), true)
  expect("true is on and false is off", text.contains("return value ? ${InputRules.AUTO_CORRECT_ON} : ${InputRules.AUTO_CORRECT_OFF};"), true)
}

fun main(args: Array<String>) {
  flags()
  if (args.isNotEmpty()) againstReactNative(args[0])
  if (args.size > 1) againstEngineInput(args[1])
  if (args.size > 2) againstEncoder(args[2])
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
