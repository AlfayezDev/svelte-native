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
 *   <ReactTextScrollWatcher.kt> <ScrollEvent.kt> <InputEvents.cpp> <ViewEvents.kt>   (src/test/run.sh)
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

fun main(args: Array<String>) {
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
