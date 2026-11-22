package expo.modules.svelteengine

import kotlin.system.exitProcess

/**
 * Plain-JVM check of the text input's `autoCorrect` tri-state (`InputRules`, SPEC.md "TextInput: autoCorrect"): what a prop record does to the
 * setting a view keeps, so that an update that does not mention the prop leaves it and `false` stays different from unset.
 * Also `showSoftInputOnFocus`, `selection` and autofill (SPEC.md "TextInput: selection and autofill"): what record 50 does to the keyboard, when record 49 moves
 * the caret, and that the autofill hints are React Native's, entry by entry.
 * Usage: InputRulesCheck <ReactTextInputManager.kt> <EngineInput.kt> <AutoCorrectCode.h> <InputAutofill.kt> <PropsEncoderViews.cpp>   (src/test/run.sh)
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

/** The `"name" to HintConstants.X` pairs of a Kotlin source, in order. */
private fun hintPairs(source: String): List<Pair<String, String>> =
  Regex("\"([^\"]+)\"\\s+to\\s+HintConstants\\.([A-Z0-9_]+)").findAll(java.io.File(source).readText()).map { it.groupValues[1] to it.groupValues[2] }.toList()

/** `InputAutofill`'s table is React Native's (`REACT_PROPS_AUTOFILL_HINTS_MAP`), every name with the same hint. */
private fun hintsAgainstReactNative(reactNative: String, ours: String) {
  val theirs = hintPairs(reactNative)
  val mine = hintPairs(ours)
  expect("React Native's table was found", theirs.size > 40, true)
  expect("InputAutofill has React Native's names and hints", mine.toSet(), theirs.toSet())
}

/** The encoder's selection codes (`encodeSelection`) and the soft input's raw-props reading are the ones InputRules names. */
private fun selectionAgainstEncoder(source: String) {
  val text = java.io.File(source).readText().replace(Regex("\\s+"), " ")
  expect("a selection the update does not mention is the keep code", text.contains("int32_t code = ${InputRules.SELECTION_KEEP};"), true)
  expect("a range is the set code", text.contains("code = ${InputRules.SELECTION_SET};"), true)
  expect("anything else (null, removed) is the cleared code", text.contains("code = ${InputRules.SELECTION_CLEARED};"), true)
  expect("showSoftInputOnFocus is read from the raw props as autoCorrect is", text.contains("get_ptr(\"showSoftInputOnFocus\")") && text.contains("b.putInt(softInputCode(p));"), true)
}

private fun selectionAndAutofill() {
  expect("the keyboard opens on focus by default", InputRules.softInputAfter(true, InputRules.AUTO_CORRECT_KEEP), true)
  expect("false keeps it closed", InputRules.softInputAfter(true, InputRules.AUTO_CORRECT_OFF), false)
  expect("an update without the prop keeps false", InputRules.softInputAfter(false, InputRules.AUTO_CORRECT_KEEP), false)
  expect("true opens it again", InputRules.softInputAfter(false, InputRules.AUTO_CORRECT_ON), true)
  expect("a removed prop is the default, true", InputRules.softInputAfter(false, InputRules.AUTO_CORRECT_CLEARED), true)
  expect("a range the props set moves the caret", InputRules.selects(InputRules.SELECTION_SET, 1, 3, -1, -1), true)
  expect("a new range moves it", InputRules.selects(InputRules.SELECTION_SET, 4, 4, 1, 3), true)
  expect("the range they asked for last does not (a state update encodes the same props again)", InputRules.selects(InputRules.SELECTION_SET, 4, 4, 4, 4), false)
  expect("an update that does not mention it does not", InputRules.selects(InputRules.SELECTION_KEEP, 4, 4, -1, -1), false)
  expect("a removed selection does not", InputRules.selects(InputRules.SELECTION_CLEARED, -1, -1, 4, 4), false)
  expect("a range is clamped to the text", InputRules.clampSelection(4, 12, 8), 4 to 8)
  expect("an end before the start is the start", InputRules.clampSelection(5, 2, 8), 5 to 5)
  expect("a range past the text is its end", InputRules.clampSelection(10, 12, 3), 3 to 3)
  expect("a name with a hint keeps the prop's mode", InputRules.autofillMode("password-new", true, 3), 3)
  expect("off turns autofill off", InputRules.autofillMode("off", false, InputRules.AUTOFILL_AUTO), InputRules.AUTOFILL_NO)
  expect("a name with no hint turns it off", InputRules.autofillMode("not-a-hint", false, 3), InputRules.AUTOFILL_NO)
  expect("no name keeps the prop's mode", InputRules.autofillMode(null, false, InputRules.AUTOFILL_AUTO), InputRules.AUTOFILL_AUTO)
}

fun main(args: Array<String>) {
  flags()
  selectionAndAutofill()
  if (args.isNotEmpty()) againstReactNative(args[0])
  if (args.size > 1) againstEngineInput(args[1])
  if (args.size > 2) againstEncoder(args[2])
  if (args.size > 3) hintsAgainstReactNative(args[0], args[3])
  if (args.size > 4) selectionAgainstEncoder(args[4])
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
