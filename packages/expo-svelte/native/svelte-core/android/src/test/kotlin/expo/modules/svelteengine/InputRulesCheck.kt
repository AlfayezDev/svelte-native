package expo.modules.svelteengine

import kotlin.system.exitProcess

/**
 * Plain-JVM check of the text input's `autoCorrect` tri-state (`InputRules`, SPEC.md "TextInput: autoCorrect"): what a prop record does to the
 * setting a view keeps, so that an update that does not mention the prop leaves it and `false` stays different from unset.
 * Also `showSoftInputOnFocus`, `selection` and autofill (SPEC.md "TextInput: selection and autofill"): what record 50 does to the keyboard, when record 49 moves
 * the caret, and that the autofill hints are React Native's, entry by entry.
 * Also `onContentSizeChange` and `onScroll` (SPEC.md "TextInput: content size and scroll events"): when a view watches and when a watcher has something to send, and that the
 * events say what React Native's watchers say.
 * Usage: InputRulesCheck <ReactTextInputManager.kt> <EngineInput.kt> <AutoCorrectCode.h> <InputAutofill.kt> <PropsEncoderViews.cpp> <ReactTextContentSizeWatcher.kt>
 *   <ReactTextScrollWatcher.kt> <ScrollEvent.kt> <InputEvents.cpp> <ViewEvents.kt> [<android.jar>]   (src/test/run.sh)
 * Also the input type (SPEC.md, "TextInput: the input type"): `InputRules.inputType` for every combination of `keyboardType`, `secureTextEntry`, `autoCapitalize`, `autoCorrect` and
 * `multiline` (`inputMode` is a `keyboardType` in JavaScript) against `ReactTextInputManager`'s staged flags, run here with the setters in every order.
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
  expect("EngineInput.applyInputType takes the input type from InputRules.inputType, with the setting the view kept", text.contains("val type = InputRules.inputType(v.keyboard, v.secure, v.capitalize, autoCorrect, v.multiline)"), true)
  expect("and computes none of the flags itself any more", text.substringAfter("private fun applyInputType(").substringBefore("private fun applyCursorTint").contains("InputType.TYPE_TEXT_FLAG_"), false)
  val applying = text.substringAfter("private fun applyInputType(").substringBefore("private fun applyCursorTint")
  expect("a view the platform kept single-line is made multi-line by hand, as React Native's multiline asks for any class", applying.contains("if (InputRules.platformKeepsSingleLine(type)) setSingleLine(false)"), true)
  expect("and the masking is decided after it (it takes the masking away), by the rules, from what the platform left: a secure field is masked whatever the type says, and one that is not is not", applying.indexOf("setSingleLine(false)") in 0 until applying.indexOf("val wanted = InputRules.transformationFor(v.secure, v.keyboard, type, current)") && applying.contains("val current = when (transformationMethod) { is PasswordTransformationMethod -> InputRules.Transformation.PASSWORD is SingleLineTransformationMethod -> InputRules.Transformation.SINGLE_LINE else -> InputRules.Transformation.NONE }"), true)
  expect("and not by the platform's predicate on the type any more (React Native's flags for a secure email, phone or url field are no password type to it)", applying.contains("isPassword("), false)
  // Each swap sets the text again and fires afterTextChanged with the selection at (0, 0): a number password made multi-line swaps three times. None of it is the user's.
  val guarded = applying.substringAfter("val was = settingText settingText = true try {").substringBefore("} finally { settingText = was }")
  expect("the type swaps run with settingText set, and it is put back as it was in a finally", applying.contains("val was = settingText settingText = true try {") && applying.contains("} finally { settingText = was }"), true)
  for (inside in listOf("inputType = type", "setSingleLine(false)", "transformationMethod = when (wanted)", "applyTypeface(family, weight, italic)", "setSelection(start, end)"))
    expect("$inside is inside the guarded block, so it sends neither a change nor a selection event", guarded.contains(inside), true)
  expect("the text watcher and the selection listener both skip while settingText is set", text.contains("if (!settingText && created) {") && text.contains("if (!created || settingText ||"), true)
  expect("the masking is PasswordTransformationMethod's, the unmasked single-line one SingleLineTransformationMethod's, and the other none", applying.contains("InputRules.Transformation.PASSWORD -> PasswordTransformationMethod.getInstance()") && applying.contains("InputRules.Transformation.SINGLE_LINE -> SingleLineTransformationMethod.getInstance()") && applying.contains("InputRules.Transformation.NONE -> null") && text.contains("import android.text.method.PasswordTransformationMethod") && text.contains("import android.text.method.SingleLineTransformationMethod"), true)
  expect("an update that changes nothing in the type leaves the field alone: the masking is a function of the type", applying.contains("if (type == inputTypeKey) return"), true)
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

private fun watchers() {
  expect("a handler turns the watcher on", InputRules.watchAfter(false, InputRules.AUTO_CORRECT_ON), true)
  expect("an update without the prop keeps it on", InputRules.watchAfter(true, InputRules.AUTO_CORRECT_KEEP), true)
  expect("an update without the prop keeps it off", InputRules.watchAfter(false, InputRules.AUTO_CORRECT_KEEP), false)
  expect("a removed prop turns it off", InputRules.watchAfter(true, InputRules.AUTO_CORRECT_CLEARED), false)
  expect("false turns it off", InputRules.watchAfter(true, InputRules.AUTO_CORRECT_OFF), false)
  expect("the first size is new, a watcher having sent nothing", InputRules.differs(0, 0, 472, 63), true)
  expect("the same size is not", InputRules.differs(472, 63, 472, 63), false)
  expect("a taller content is", InputRules.differs(472, 63, 472, 126), true)
  expect("a shorter content is", InputRules.differs(472, 126, 472, 63), true)
  expect("a wider content is", InputRules.differs(472, 63, 480, 63), true)
  expect("a scroll to an offset is", InputRules.differs(0, 0, 0, 80), true)
  expect("a scroll back to the start is", InputRules.differs(0, 80, 0, 0), true)
  expect("no scroll is not", InputRules.differs(0, 0, 0, 0), false)
}

/** React Native's watchers (the sources are the arguments): a boolean prop that is off by default, the size they report, when they send it, and the payload of a scroll. */
private fun watchersAgainstReactNative(manager: String, contentSize: String, scroll: String, scrollEvent: String) {
  val managerText = java.io.File(manager).readText().replace(Regex("\\s+"), " ")
  expect("RN: onContentSizeChange is a boolean prop, off by default", managerText.contains("@ReactProp(name = \"onContentSizeChange\", defaultBoolean = false)"), true)
  expect("RN: onScroll is a boolean prop, off by default", managerText.contains("@ReactProp(name = \"onScroll\", defaultBoolean = false)"), true)
  val sizeText = java.io.File(contentSize).readText().replace(Regex("\\s+"), " ")
  expect("RN: the content size is the layout between the paddings", sizeText.contains("contentWidth = (editText.compoundPaddingLeft + editText.layout.width + editText.compoundPaddingRight)") &&
    sizeText.contains("contentHeight = (editText.compoundPaddingTop + editText.layout.height + editText.compoundPaddingBottom)"), true)
  expect("RN: the size is the view's own while there is no layout", sizeText.contains("var contentWidth = editText.width var contentHeight = editText.height"), true)
  expect("RN: it is sent when width or height is not the one sent last", sizeText.contains("if (contentWidth != previousContentWidth || contentHeight != previousContentHeight)"), true)
  expect("RN: it is sent in dp", sizeText.contains("toDIPFromPixel(contentWidth.toFloat()), toDIPFromPixel(contentHeight.toFloat())"), true)
  val scrollText = java.io.File(scroll).readText().replace(Regex("\\s+"), " ")
  expect("RN: a scroll is sent when the offset is not the one sent last", scrollText.contains("if (previousHorizontal != horiz || previousVert != vert)"), true)
  expect("RN: a scroll has the offset, no velocity and no content size, and the view's size", scrollText.contains("horiz.toFloat(), vert.toFloat(), 0f, // can't get x velocity 0f, // can't get y velocity 0, // can't get content width 0, // can't get content height editText.width, editText.height"), true)
  val eventText = java.io.File(scrollEvent).readText().replace(Regex("\\s+"), " ")
  for (key in listOf("contentInset", "contentOffset", "contentSize", "layoutMeasurement", "velocity")) {
    expect("RN: a scroll event has $key", eventText.contains("event.putMap(\"$key\", $key)"), true)
  }
  expect("RN: a scroll event has target and timestamp", eventText.contains("event.putInt(\"target\", viewTag)") && eventText.contains("event.putDouble(\"timestamp\", timestamp.toDouble())"), true)
  expect("RN: responderIgnoreScroll is the flag's opposite", eventText.contains("\"responderIgnoreScroll\", !ReactNativeFeatureFlags.shouldTriggerResponderTransferOnScrollAndroid()"), true)
  expect("RN: a scroll event coalesces", eventText.contains("override fun canCoalesce(): Boolean = scrollEventType == ScrollEventType.SCROLL"), true)
}

/** The engine says the same: the input's own expressions, the record, and the two events' names and payloads. */
private fun watchersAgainstEngine(engineInput: String, encoder: String, inputEvents: String, viewEvents: String) {
  val input = java.io.File(engineInput).readText().replace(Regex("\\s+"), " ")
  expect("EngineInput: the content size is the layout between the paddings, the view's own size without one",
    input.contains("val w = if (content != null) compoundPaddingLeft + content.width + compoundPaddingRight else width") &&
      input.contains("val h = if (content != null) compoundPaddingTop + content.height + compoundPaddingBottom else height"), true)
  expect("EngineInput: the size goes out when it is not the one sent last, in dp", input.contains("if (!InputRules.differs(sentContentW, sentContentH, w, h)) return") &&
    input.contains("ViewEvents.inputContentSize(node.tag, w / density, h / density)"), true)
  expect("EngineInput: the size is looked at after a layout and after an edit", input.contains("super.onLayout(changed, left, top, right, bottom) reportContentSize()") &&
    input.contains("reportContentSize() } })"), true)
  expect("EngineInput: a scroll goes out when the offset is not the one sent last, with the view's size, in dp",
    input.contains("if (!watchScroll || !InputRules.differs(sentScrollX, sentScrollY, horiz, vert)) return") &&
      input.contains("ViewEvents.inputScroll(node.tag, horiz / density, vert / density, width / density, height / density)"), true)
  expect("EngineInput: the watchers follow record 51 through InputRules", input.contains("InputRules.watchAfter(watchContentSize, v.onContentSizeChange)") && input.contains("InputRules.watchAfter(watchScroll, v.onScroll)"), true)
  val encoderText = java.io.File(encoder).readText().replace(Regex("\\s+"), " ")
  expect("the encoder sends record 51 from the raw props of both handlers", encoderText.contains("kInputEvents = 51,") && encoderText.contains("o.begin(kInputEvents); b.putInt(rawFlagCode(p, \"onContentSizeChange\")); b.putInt(rawFlagCode(p, \"onScroll\"));"), true)
  val flag = encoderText.substringAfter("int32_t rawFlagCode(").substringBefore("// `selection`")
  expect("the encoder reads a handler's flag as autoCorrect's code", flag.contains("p.rawProps.get_ptr(key)") && flag.contains("return autoCorrectOfRaw(raw != nullptr, isBool, isBool && raw->getBool());"), true)
  val events = java.io.File(inputEvents).readText().replace(Regex("\\s+"), " ")
  val size = events.substringAfter("void inputContentSize(").substringBefore("void inputScroll(")
  expect("the content size event is topContentSizeChange: contentSize with width and height, and target, a unique event",
    size.contains("sendUnique(*emitter, \"contentSizeChange\"") && size.contains("\"contentSize\", folly::dynamic::object(\"width\"") && size.contains("(\"height\"") && size.contains("\"target\", tag"), true)
  val scroll = events.substringAfter("void inputScroll(").substringBefore("void switchChange(")
  expect("the scroll event is topScroll, a unique event", scroll.contains("sendUnique(*emitter, \"scroll\""), true)
  for (key in listOf("contentInset", "contentOffset", "contentSize", "layoutMeasurement", "velocity", "target", "timestamp", "responderIgnoreScroll")) {
    expect("the scroll event has $key", scroll.contains("\"$key\""), true)
  }
  expect("the natives are registered", events.contains("makeNativeMethod(\"inputContentSize\", inputContentSize)") && events.contains("makeNativeMethod(\"inputScroll\", inputScroll)"), true)
  val view = java.io.File(viewEvents).readText().replace(Regex("\\s+"), " ")
  expect("ViewEvents declares them with the arguments the natives read", view.contains("external fun inputContentSize(tag: Int, widthDp: Float, heightDp: Float)") &&
    view.contains("external fun inputScroll(tag: Int, xDp: Float, yDp: Float, widthDp: Float, heightDp: Float)"), true)
}

/** What `ReactTextInputManager` leaves in `stagedInputType`: its setters, in [order] (k keyboardType, s secureTextEntry, a autoCorrect, m multiline), then `reconcileAutoCapitalize`. A prop that is not given is not run. */
private fun reactNativeInputType(keyboard: Int, secure: Boolean, capitalize: Int, autoCorrect: Int, multiline: Boolean, order: String): Int {
  val auto = 0x8000
  val noSuggestions = 0x80000
  val numbered = 0x2 or 0x2000 or 0x1000 // INPUT_TYPE_KEYBOARD_NUMBERED: TYPE_CLASS_NUMBER, TYPE_NUMBER_FLAG_DECIMAL, TYPE_NUMBER_FLAG_SIGNED
  var staged = 0x1 // createViewInstance: `inputType and TYPE_TEXT_FLAG_MULTI_LINE.inv()` of an EditText's TYPE_CLASS_TEXT or TYPE_TEXT_FLAG_MULTI_LINE
  fun update(unset: Int, set: Int) { staged = (staged and unset.inv()) or set }
  fun checkPasswordType() { if ((staged and numbered) != 0 && (staged and 0x80) != 0) update(0x80, 0x10) }
  for (setter in order) when (setter) {
    'k' -> {
      val set = when (keyboard) {
        1 -> numbered // numeric
        2 -> 0x2 // number-pad
        3 -> 0x2 or 0x2000 // decimal-pad
        4 -> 0x20 or 0x1 // email-address
        5 -> 0x3 // phone-pad
        6 -> 0x90 // visible-password: a variation, no class
        7 -> 0x10 // url: a variation, no class
        else -> 0x1
      }
      update(0xF, set)
      checkPasswordType()
    }
    's' -> if (secure) { update(0x90, 0x80); checkPasswordType() }
    'a' -> if (autoCorrect == InputRules.AUTO_CORRECT_ON || autoCorrect == InputRules.AUTO_CORRECT_OFF) update(auto or noSuggestions, if (autoCorrect == InputRules.AUTO_CORRECT_ON) auto else noSuggestions)
    'm' -> if (multiline) update(0, 0x20000)
  }
  val capitalisation = 0x4000 or 0x2000 or 0x1000
  val value = when (capitalize) { 0 -> 0; 1 -> 0x1000; 2 -> 0x2000; else -> 0x4000 }
  return if ((staged and 0xF) == 0x1) (staged and capitalisation.inv()) or value else staged and 0x4000.inv()
}

private fun permutations(of: String): List<String> = if (of.length <= 1) listOf(of) else of.indices.flatMap { at -> permutations(of.removeRange(at, at + 1)).map { of[at] + it } }

private fun inputTypes(androidJar: String?) {
  val orders = permutations("ksam")
  var combinations = 0
  var orderDependent = 0
  for (keyboard in 0..7) for (secure in listOf(false, true)) for (capitalize in 0..3) for (autoCorrect in listOf(InputRules.AUTO_CORRECT_CLEARED, InputRules.AUTO_CORRECT_ON, InputRules.AUTO_CORRECT_OFF)) for (multiline in listOf(false, true)) {
    combinations++
    val reactNative = orders.map { reactNativeInputType(keyboard, secure, capitalize, autoCorrect, multiline, it) }.toSet()
    val ours = InputRules.inputType(keyboard, secure, capitalize, autoCorrect, multiline)
    val label = "keyboard $keyboard, secureTextEntry $secure, autoCapitalize $capitalize, autoCorrect $autoCorrect, multiline $multiline"
    // React Native's setters do not commute for a keyboard that is a bare variation with `secureTextEntry` around it (the order of the props decides): the engine's type is one of its results.
    if (reactNative.size > 1) orderDependent++
    expect("input type of $label is React Native's (${reactNative.map { "0x" + it.toString(16) }})", ours in reactNative, true)
  }
  expect("the combinations the check ran", combinations, 8 * 2 * 4 * 3 * 2)
  expect("only visible-password and url with a password are order dependent in React Native itself (every autoCapitalize, autoCorrect and multiline of them)", orderDependent, 2 * 4 * 3 * 2)
  // The report: a multiline field, auto-correction on, the default capitalisation: Gboard starts with the shift on and shows its suggestions.
  val report = InputRules.inputType(0, secure = false, capitalize = 3, autoCorrect = InputRules.AUTO_CORRECT_ON, multiline = true)
  expect("a multiline text input with auto-correction on and the default capitalisation", report, 0x1 or 0x4000 or 0x8000 or 0x20000)
  expect("it asks for capital letters at the start of a sentence, for suggestions and for several lines", Triple(report and 0x4000, report and 0x8000, report and 0x20000), Triple(0x4000, 0x8000, 0x20000))
  expect("a single-line field with nothing set is a plain text field with capital sentences", InputRules.inputType(0, secure = false, capitalize = 3, autoCorrect = InputRules.AUTO_CORRECT_CLEARED, multiline = false), 0x1 or 0x4000)
  expect("autoCapitalize none asks for none", InputRules.inputType(0, secure = false, capitalize = 0, autoCorrect = InputRules.AUTO_CORRECT_CLEARED, multiline = false), 0x1)
  expect("autoCorrect false turns suggestions off", InputRules.inputType(0, secure = false, capitalize = 3, autoCorrect = InputRules.AUTO_CORRECT_OFF, multiline = false), 0x1 or 0x4000 or 0x80000)
  expect("a password keeps the flags React Native keeps on it", InputRules.inputType(0, secure = true, capitalize = 3, autoCorrect = InputRules.AUTO_CORRECT_ON, multiline = false), 0x1 or 0x80 or 0x4000 or 0x8000)
  expect("a numeric field takes no capital letters, and keeps auto-correction and multiline as React Native does", InputRules.inputType(2, secure = false, capitalize = 3, autoCorrect = InputRules.AUTO_CORRECT_ON, multiline = true), 0x2 or 0x8000 or 0x20000)
  expect("a numeric password is the number variation", InputRules.inputType(2, secure = true, capitalize = 3, autoCorrect = InputRules.AUTO_CORRECT_CLEARED, multiline = false), 0x2 or 0x10)
  expect("visible-password wins over secureTextEntry", InputRules.inputType(6, secure = true, capitalize = 3, autoCorrect = InputRules.AUTO_CORRECT_CLEARED, multiline = false), 0x90)
  // What the platform masks, and what it leaves single-line (the engine sets the masking again after making a number class multi-line: `setSingleLine(false)` drops it).
  fun typeOf(keyboard: Int, secure: Boolean, multiline: Boolean) = InputRules.inputType(keyboard, secure, 3, InputRules.AUTO_CORRECT_CLEARED, multiline)
  val textPassword = typeOf(0, secure = true, multiline = true)
  expect("a text password with several lines is masked by the platform, which has made it multi-line itself (no setSingleLine)", Pair(InputRules.isPassword(textPassword), InputRules.platformKeepsSingleLine(textPassword)), Pair(true, false))
  val numberPassword = typeOf(2, secure = true, multiline = true)
  expect("a number password with several lines is one the platform keeps single-line, and masks: the masking is set again after setSingleLine(false)", Pair(InputRules.isPassword(numberPassword), InputRules.platformKeepsSingleLine(numberPassword)), Pair(true, true))
  expect("a number field with several lines is made multi-line and is not masked", Pair(InputRules.isPassword(typeOf(2, secure = false, multiline = true)), InputRules.platformKeepsSingleLine(typeOf(2, secure = false, multiline = true))), Pair(false, true))
  expect("a single-line password is masked and needs nothing", Pair(InputRules.isPassword(typeOf(0, secure = true, multiline = false)), InputRules.platformKeepsSingleLine(typeOf(0, secure = true, multiline = false))), Pair(true, false))
  expect("visible-password shows its text", InputRules.isPassword(typeOf(6, secure = false, multiline = false)), false)
  expect("so does it when secureTextEntry is set (visible-password wins)", InputRules.isPassword(typeOf(6, secure = true, multiline = false)), false)
  expect("a web password is masked", InputRules.isPassword(0x1 or 0xE0), true)
  expect("an email field and a phone field are not", Pair(InputRules.isPassword(typeOf(4, secure = false, multiline = false)), InputRules.isPassword(typeOf(5, secure = false, multiline = false))), Pair(false, false))
  var keptSingleLine = 0
  for (keyboard in 0..7) for (secure in listOf(false, true)) for (multiline in listOf(false, true)) {
    val type = typeOf(keyboard, secure, multiline)
    // Only a multi-line type of a class that is not text: the text class is the platform's (and the class-less visible-password and url are not text either: they have no class bits).
    val expected = multiline && (type and 0xF) != 0x1
    if (expected) keptSingleLine++
    expect("platformKeepsSingleLine of keyboard $keyboard, secure $secure, multiline $multiline", InputRules.platformKeepsSingleLine(type), expected)
  }
  expect("some of the combinations are the ones the platform keeps single-line", keptSingleLine > 0, true)
  // The constants are the platform's own.
  if (androidJar != null && java.io.File(androidJar).isFile) {
    val platform = java.net.URLClassLoader(arrayOf(java.io.File(androidJar).toURI().toURL()), null).loadClass("android.text.InputType")
    for ((name, value) in mapOf(
      "TYPE_MASK_CLASS" to InputRules.TYPE_MASK_CLASS, "TYPE_MASK_VARIATION" to InputRules.TYPE_MASK_VARIATION, "TYPE_TEXT_VARIATION_WEB_PASSWORD" to InputRules.TYPE_TEXT_VARIATION_WEB_PASSWORD, "TYPE_CLASS_TEXT" to InputRules.TYPE_CLASS_TEXT, "TYPE_CLASS_NUMBER" to InputRules.TYPE_CLASS_NUMBER, "TYPE_CLASS_PHONE" to InputRules.TYPE_CLASS_PHONE,
      "TYPE_NUMBER_FLAG_SIGNED" to InputRules.TYPE_NUMBER_FLAG_SIGNED, "TYPE_NUMBER_FLAG_DECIMAL" to InputRules.TYPE_NUMBER_FLAG_DECIMAL, "TYPE_NUMBER_VARIATION_PASSWORD" to InputRules.TYPE_NUMBER_VARIATION_PASSWORD,
      "TYPE_TEXT_FLAG_CAP_CHARACTERS" to InputRules.TYPE_TEXT_FLAG_CAP_CHARACTERS, "TYPE_TEXT_FLAG_CAP_WORDS" to InputRules.TYPE_TEXT_FLAG_CAP_WORDS, "TYPE_TEXT_FLAG_CAP_SENTENCES" to InputRules.TYPE_TEXT_FLAG_CAP_SENTENCES,
      "TYPE_TEXT_FLAG_AUTO_CORRECT" to InputRules.TYPE_TEXT_FLAG_AUTO_CORRECT, "TYPE_TEXT_FLAG_MULTI_LINE" to InputRules.TYPE_TEXT_FLAG_MULTI_LINE, "TYPE_TEXT_FLAG_NO_SUGGESTIONS" to InputRules.TYPE_TEXT_FLAG_NO_SUGGESTIONS,
      "TYPE_TEXT_VARIATION_URI" to InputRules.TYPE_TEXT_VARIATION_URI, "TYPE_TEXT_VARIATION_EMAIL_ADDRESS" to InputRules.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, "TYPE_TEXT_VARIATION_PASSWORD" to InputRules.TYPE_TEXT_VARIATION_PASSWORD,
      "TYPE_TEXT_VARIATION_VISIBLE_PASSWORD" to InputRules.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
    )) expect("InputRules.$name is android.text.InputType.$name", platform.getField(name).getInt(null), value)
  } else {
    println("input type: no android.jar, the constants were not compared with the platform's")
  }
}

/** The setters of React Native's `ReactTextInputManager` still say what `InputRules.inputType` (and the check's copy of them) says. */
private fun inputTypeAgainstReactNative(source: String) {
  val text = java.io.File(source).readText().replace(Regex("\\s+"), " ")
  for (line in listOf(
    "editText.inputType = inputType and (InputType.TYPE_TEXT_FLAG_MULTI_LINE.inv())",
    "flagsToUnset = if (multiline) 0 else InputType.TYPE_TEXT_FLAG_MULTI_LINE, flagsToSet = if (multiline) InputType.TYPE_TEXT_FLAG_MULTI_LINE else 0,",
    "if (password) { InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD } else { InputType.TYPE_NUMBER_VARIATION_PASSWORD or InputType.TYPE_TEXT_VARIATION_PASSWORD }, flagsToSet = if (password) InputType.TYPE_TEXT_VARIATION_PASSWORD else 0,",
    "var autoCapitalizeValue = InputType.TYPE_TEXT_FLAG_CAP_SENTENCES",
    "var flagsToSet = InputType.TYPE_CLASS_TEXT",
    "flagsToSet = INPUT_TYPE_KEYBOARD_NUMBERED",
    "flagsToSet = INPUT_TYPE_KEYBOARD_NUMBER_PAD",
    "flagsToSet = INPUT_TYPE_KEYBOARD_DECIMAL_PAD",
    "flagsToSet = InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS or InputType.TYPE_CLASS_TEXT",
    "flagsToSet = InputType.TYPE_CLASS_PHONE",
    "flagsToSet = InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD",
    "flagsToSet = InputType.TYPE_TEXT_VARIATION_URI",
    "updateStagedInputTypeFlag(view, InputType.TYPE_MASK_CLASS, flagsToSet)",
    "private const val INPUT_TYPE_KEYBOARD_NUMBER_PAD = InputType.TYPE_CLASS_NUMBER",
    "INPUT_TYPE_KEYBOARD_NUMBER_PAD or InputType.TYPE_NUMBER_FLAG_DECIMAL",
    "INPUT_TYPE_KEYBOARD_DECIMAL_PAD or InputType.TYPE_NUMBER_FLAG_SIGNED",
    "(view.stagedInputType and AUTOCAPITALIZE_FLAGS.inv()) or autoCapValue",
    "view.stagedInputType and InputType.TYPE_TEXT_FLAG_CAP_SENTENCES.inv()",
    "updateStagedInputTypeFlag( view, InputType.TYPE_TEXT_VARIATION_PASSWORD, InputType.TYPE_NUMBER_VARIATION_PASSWORD, )",
  )) expect("RN: $line", text.contains(line), true)
  expect("RN: reconcileAutoCapitalize and the staged type are committed after all the setters", text.contains("reconcileAutoCapitalize(view) view.commitStagedInputType()"), true)
}

/**
 * What `TextView` does with a transformation method on `setInputType` and `setSingleLine` (AOSP's `TextView.setInputType(int)`, `applySingleLine`), for the three of them that matter: the masking, the single-line
 * method and none. The platform masks a view only for a type its own `isPasswordInputType` says is a password, and lets go of a masking only when the type it was set for was one.
 */
private class FakeTextView(var currentType: Int, var singleLine: Boolean, var transformation: InputRules.Transformation) {
  private fun password(type: Int) = InputRules.isPassword(type)
  private fun visiblePassword(type: Int) = (type and (0xF or 0xFF0)) == (0x1 or 0x90)
  private fun multilineType(type: Int) = (type and (0xF or 0x20000)) == (0x1 or 0x20000)
  fun applyType(type: Int) {
    val wasPassword = password(currentType)
    val wasVisible = visiblePassword(currentType)
    currentType = type
    val isPassword = password(type)
    val isVisible = visiblePassword(type)
    var force = false
    if (isPassword) transformation = InputRules.Transformation.PASSWORD
    else if (isVisible || wasPassword || wasVisible) { if (transformation == InputRules.Transformation.PASSWORD) force = true }
    val single = !multilineType(type)
    if (singleLine != single || force) applySingleLine(single, !isPassword)
  }
  private fun applySingleLine(single: Boolean, applyTransformation: Boolean) {
    singleLine = single
    if (applyTransformation) transformation = if (single) InputRules.Transformation.SINGLE_LINE else InputRules.Transformation.NONE
  }
  fun makeSingleLine(single: Boolean) = applySingleLine(single, true)
}

/** `EngineInput.applyInputType`, with [engine] true; false is what it did before: the platform's masking and nothing more (after a multi-line number password's masking set again). */
private fun applyLikeEngine(view: FakeTextView, keyboard: Int, secure: Boolean, multiline: Boolean, engine: Boolean = true) {
  val type = InputRules.inputType(keyboard, secure, 3, InputRules.AUTO_CORRECT_CLEARED, multiline)
  view.applyType(type)
  if (InputRules.platformKeepsSingleLine(type)) {
    view.makeSingleLine(false)
    if (!engine && InputRules.isPassword(type)) view.transformation = InputRules.Transformation.PASSWORD
  }
  if (engine) view.transformation = InputRules.transformationFor(secure, keyboard, type, view.transformation)
}

private fun masking() {
  val keyboards = (0..7).toList() + 99
  val states = keyboards.flatMap { keyboard -> listOf(false, true).flatMap { secure -> listOf(false, true).map { multiline -> Triple(keyboard, secure, multiline) } } }
  // The rows of the issue: React Native's flags for a secure field are kept, and the platform masks only one of them.
  fun typeOf(keyboard: Int, secure: Boolean = true, multiline: Boolean = false) = InputRules.inputType(keyboard, secure, 3, InputRules.AUTO_CORRECT_CLEARED, multiline)
  expect("React Native's flags for a secure email field are kept", typeOf(InputRules.KEYBOARD_EMAIL), 0x40a1)
  expect("for a secure phone field", typeOf(InputRules.KEYBOARD_PHONE), 0x13)
  expect("for a secure url field", typeOf(InputRules.KEYBOARD_URL), 0x80)
  expect("for the default one", typeOf(0), 0x4081)
  expect("for a number-pad one", typeOf(InputRules.KEYBOARD_NUMBER_PAD), 0x12)
  expect("for visible-password", typeOf(InputRules.KEYBOARD_VISIBLE_PASSWORD), 0x90)
  for (keyboard in listOf(InputRules.KEYBOARD_EMAIL, InputRules.KEYBOARD_PHONE, InputRules.KEYBOARD_URL))
    expect("the platform alone leaves a secure field with keyboard $keyboard unmasked, which is why the field masks by itself", InputRules.isPassword(typeOf(keyboard)), false)
  // Every keyboard, secure or not, single- or multi-line, mounted: masked exactly when it is secure and not visible-password.
  for ((keyboard, secure, multiline) in states) for (start in listOf(FakeTextView(0x20001, false, InputRules.Transformation.NONE), FakeTextView(0x1, true, InputRules.Transformation.SINGLE_LINE))) {
    applyLikeEngine(start, keyboard, secure, multiline)
    expect("keyboard $keyboard, secure $secure, multiline $multiline, mounted: masked", start.transformation == InputRules.Transformation.PASSWORD, InputRules.masks(secure, keyboard))
  }
  // Every change of props (a keyboard changing at runtime, secureTextEntry on and off, multiline on and off) from every state to every state.
  var wrong = 0
  var transitions = 0
  for (before in states) for (after in states) {
    val view = FakeTextView(0x20001, false, InputRules.Transformation.NONE)
    applyLikeEngine(view, before.first, before.second, before.third)
    applyLikeEngine(view, after.first, after.second, after.third)
    transitions++
    if ((view.transformation == InputRules.Transformation.PASSWORD) != InputRules.masks(after.second, after.first)) wrong++
  }
  expect("$transitions changes of props, from every keyboard, secure and multiline state to every other: the masking is what the new props say", wrong, 0)
  // What the engine did before (the platform's masking alone) fails exactly the changes this is for, and the ones of the issue are among them.
  var failedBefore = 0
  for (before in states) for (after in states) {
    val view = FakeTextView(0x20001, false, InputRules.Transformation.NONE)
    applyLikeEngine(view, before.first, before.second, before.third, engine = false)
    applyLikeEngine(view, after.first, after.second, after.third, engine = false)
    if ((view.transformation == InputRules.Transformation.PASSWORD) != InputRules.masks(after.second, after.first)) failedBefore++
  }
  expect("the platform's masking alone is wrong for some of them (the check can fail)", failedBefore > 0, true)
  for (keyboard in listOf(InputRules.KEYBOARD_EMAIL, InputRules.KEYBOARD_PHONE, InputRules.KEYBOARD_URL)) {
    val mounted = FakeTextView(0x20001, false, InputRules.Transformation.NONE)
    applyLikeEngine(mounted, keyboard, true, false, engine = false)
    expect("keyboard $keyboard, secure, the platform alone: shows the text", mounted.transformation == InputRules.Transformation.PASSWORD, false)
    val changed = FakeTextView(0x20001, false, InputRules.Transformation.NONE)
    applyLikeEngine(changed, 0, true, false, engine = false)
    applyLikeEngine(changed, keyboard, true, false, engine = false)
    expect("keyboard $keyboard, changed from the default secure field, the platform alone: unmasks it", changed.transformation == InputRules.Transformation.PASSWORD, false)
    val withEngine = FakeTextView(0x20001, false, InputRules.Transformation.NONE)
    applyLikeEngine(withEngine, 0, true, false)
    applyLikeEngine(withEngine, keyboard, true, false)
    expect("keyboard $keyboard, changed from the default secure field: still masked", withEngine.transformation, InputRules.Transformation.PASSWORD)
  }
  // Secure off unmasks, from every keyboard, and a field that is not masked is not left with a method that does not fit its lines.
  for (keyboard in keyboards) for (multiline in listOf(false, true)) {
    val view = FakeTextView(0x20001, false, InputRules.Transformation.NONE)
    applyLikeEngine(view, keyboard, true, multiline)
    applyLikeEngine(view, keyboard, false, multiline)
    expect("keyboard $keyboard, multiline $multiline: secureTextEntry turned off unmasks", view.transformation == InputRules.Transformation.PASSWORD, false)
    if (keyboard != InputRules.KEYBOARD_VISIBLE_PASSWORD) expect("keyboard $keyboard, multiline $multiline: and the method fits the lines", view.transformation, if (multiline) InputRules.Transformation.NONE else InputRules.Transformation.SINGLE_LINE)
  }
  // The engine returns early on a type it has seen: no two sets of props that differ in the masking have the same type, whatever else they say.
  val maskOf = HashMap<Int, Boolean>()
  var aliased = 0
  for ((keyboard, secure, multiline) in states) for (capitalize in 0..3) for (autoCorrect in listOf(InputRules.AUTO_CORRECT_CLEARED, InputRules.AUTO_CORRECT_ON, InputRules.AUTO_CORRECT_OFF)) {
    val type = InputRules.inputType(keyboard, secure, capitalize, autoCorrect, multiline)
    val masks = InputRules.masks(secure, keyboard)
    val seen = maskOf.getOrPut(type) { masks }
    if (seen != masks) aliased++
  }
  expect("a type says whether the field is masked (the engine does not look at the props again when the type is the same)", aliased, 0)
}

/** The size and the advances of a field's text (SPEC.md, "TextInput: text metrics"): the rules, and that React Native's sources still do what they stand for and the view calls them. */
private fun textMetrics(editText: String?, textAttributes: String?, engineInput: String?, inputManager: String?, encoder: String?) {
  expect("22 sp at 2.625 is 58 px", InputRules.fontSizePx(22f * 2.625f), 58f)
  expect("16 sp at 2.625 is 42 px", InputRules.fontSizePx(16f * 2.625f), 42f)
  expect("a size that is not set stays", InputRules.fontSizePx(0f), 0f)
  expect("a family turns the exact advances on", InputRules.exactAdvances("IBMPlexSans", 0, false), true)
  expect("an italic turns them on", InputRules.exactAdvances(null, 0, true), true)
  expect("a weight turns them on, 400 too (fontWeight '400' is a weight)", InputRules.exactAdvances(null, 400, false), true)
  expect("so does a style that is not italic (the record carries 400 for it)", InputRules.exactAdvances(null, 400, false), true)
  expect("a weight and a style that are not set keep the hinted paint", InputRules.exactAdvances(null, 0, false), false)
  expect("a field that allows font scaling takes the scaled px (1.3 times the font)", InputRules.effectivePx(true, 42f, 54.6f), 54.6f)
  expect("one that does not keeps dp times the density", InputRules.effectivePx(false, 42f, 54.6f), 42f)
  expect("a letter spacing of -0.5 dp scales with the font (React Native has no sign test)", InputRules.scales(true, -0.5f * 2.625f), true)
  expect("a value of 0 is left alone", InputRules.scales(true, 0f), false)
  expect("a field that does not allow font scaling scales nothing", InputRules.scales(false, 42f), false)
  expect("a negative spacing at 1.3 is -1.3 times as long", InputRules.effectivePx(true, -1.3125f, -1.7062f), -1.7062f)
  expect("an unset maxFontSizeMultiplier is no cap (0)", InputRules.maxFontScale(Float.NaN), 0f)
  expect("a set one is the cap", InputRules.maxFontScale(1.5f), 1.5f)
  expect("the line height span is the line height rounded up", InputRules.lineHeightSpanPx(57.75f, 5), 58)
  expect("an empty field has none", InputRules.lineHeightSpanPx(57.75f, 0), 0)
  expect("a field with no line height has none", InputRules.lineHeightSpanPx(0f, 5), 0)
  if (textAttributes != null) {
    val body = java.io.File(textAttributes).readText().replace(Regex("\\s+"), " ")
    expect("RN: the font size is rounded up", body.contains("Math.ceil(PixelUtil.toPixelFromSP("), true)
    expect("RN: the size is scaled with the system's font when the field allows it", body.contains("return if (allowFontScaling) { Math.ceil(PixelUtil.toPixelFromSP(fontSize, effectiveMaxFontSizeMultiplier).toDouble()) .toInt() } else { Math.ceil(PixelUtil.toPixelFromDIP(fontSize).toDouble()).toInt() }"), true)
    expect("RN: so are the line height and the letter spacing", body.contains("if (allowFontScaling) PixelUtil.toPixelFromSP(lineHeight, effectiveMaxFontSizeMultiplier) else PixelUtil.toPixelFromDIP(lineHeight)") && body.contains("if (allowFontScaling) PixelUtil.toPixelFromSP(letterSpacing, effectiveMaxFontSizeMultiplier) else PixelUtil.toPixelFromDIP(letterSpacing)"), true)
  }
  if (editText != null) {
    val rnBody = java.io.File(editText).readText().replace(Regex("\\s+"), " ")
    expect("RN: a field applies its text attributes again when the configuration changes", rnBody.contains("public override fun onConfigurationChanged(newConfig: Configuration) { super.onConfigurationChanged(newConfig) if ( ReactNativeNewArchitectureFeatureFlags.enableBridgelessArchitecture() && ReactNativeFeatureFlags.enableFontScaleChangesUpdatingLayout() ) { applyTextAttributes() } }"), true)
    val body = java.io.File(editText).readText().replace(Regex("\\s+"), " ")
    expect("RN: a family, a weight or a style turn subpixel text on", body.contains("fontStyle != ReactConstants.UNSET || fontWeight != ReactConstants.UNSET || fontFamily != null") && body.contains("paintFlags or Paint.SUBPIXEL_TEXT_FLAG"), true)
    expect("RN: and linear text", body.contains("paintFlags or Paint.LINEAR_TEXT_FLAG"), true)
    expect("RN: the line height is a span on the text, not the platform's line spacing", body.contains("CustomLineHeightSpan(lineHeight)") && !body.contains("setLineSpacing("), true)
    expect("RN: an empty field's text is null", body.contains("if (reactTextUpdate.text.length == 0) { text = null }"), true)
  }
  if (inputManager != null) {
    val body = java.io.File(inputManager).readText().replace(Regex("\\s+"), " ")
    expect("RN: the includeFontPadding prop is the view's, true by default", body.contains("@ReactProp(name = ViewProps.INCLUDE_FONT_PADDING, defaultBoolean = true) public fun setIncludeFontPadding(view: ReactEditText, includepad: Boolean) { view.includeFontPadding = includepad }"), true)
  }
  if (encoder != null) {
    val body = java.io.File(encoder).readText().replace(Regex("\\s+"), " ")
    expect("the record carries includeFontPadding", body.contains("b.putInt(p.paragraphAttributes.includeFontPadding ? 1 : 0);"), true)
    expect("the record carries allowFontScaling and the cap, and no multiplier of the props (there is none on Android)", body.contains("b.putInt(ta.allowFontScaling.value_or(true) ? 1 : 0); b.putFloat(static_cast<float>(ta.maxFontSizeMultiplier));") && !body.substringAfter("void encodeInput(").substringBefore("o.begin(kInputTextProp)").contains("* multiplier"), true)
    expect("and 0 for a weight and a style that are not set", body.contains("(ta.fontStyle.has_value() ? 400 : 0)"), true)
  }
  if (engineInput != null) {
    val body = java.io.File(engineInput).readText().replace(Regex("\\s+"), " ")
    expect("EngineInput rounds the size up", body.contains("InputRules.fontSizePx(effectivePx(rawSize))"), true)
    expect("and scales the size, the line height and the letter spacing as React Native does", body.contains("PixelUtil.toPixelFromSP(px / resources.displayMetrics.density, InputRules.maxFontScale(maxScale))") && body.contains("effectivePx(rawHeight)") && body.contains("effectivePx(rawSpacing)") && body.contains("InputRules.scales(scalable, px)"), true)
    expect("and again when the font scale changes", body.contains("override fun onConfigurationChanged(newConfig: Configuration) { super.onConfigurationChanged(newConfig) if (scalable) applyTextMetrics() }"), true)
    expect("EngineInput sets the advances from the rule", body.contains("InputRules.exactAdvances(family, weight, italic)") && body.contains("Paint.SUBPIXEL_TEXT_FLAG or Paint.LINEAR_TEXT_FLAG"), true)
    expect("EngineInput puts the line height on the text as a span", body.contains("InputRules.lineHeightSpanPx(lineHeightPx, length)") && body.contains("TextLayouts.LineHeight(lineHeightPx)") && !body.contains("setLineSpacing(extra"), true)
    expect("EngineInput takes the font padding from the prop", body.contains("includeFontPadding = v.includeFontPadding") && !body.contains("includeFontPadding = false"), true)
  }
}

fun main(args: Array<String>) {
  textMetrics(args.getOrNull(11), args.getOrNull(12), args.getOrNull(1), args.getOrNull(0), args.getOrNull(4))
  inputTypes(args.getOrNull(10))
  if (args.isNotEmpty()) inputTypeAgainstReactNative(args[0])
  flags()
  selectionAndAutofill()
  watchers()
  if (args.isNotEmpty()) againstReactNative(args[0])
  if (args.size > 1) againstEngineInput(args[1])
  if (args.size > 2) againstEncoder(args[2])
  if (args.size > 3) hintsAgainstReactNative(args[0], args[3])
  if (args.size > 4) selectionAgainstEncoder(args[4])
  if (args.size > 9) {
    watchersAgainstReactNative(args[0], args[5], args[6], args[7])
    watchersAgainstEngine(args[1], args[4], args[8], args[9])
  }
  masking()
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
