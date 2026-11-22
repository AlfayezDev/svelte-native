package expo.modules.svelteengine

/**
 * What a text input decides without asking Android (SPEC.md, "TextInput: autoCorrect", "TextInput: selection and autofill"): `src/test/run.sh` runs it on a plain JVM.
 *
 * `autoCorrect` is a tri-state in React Native: unset leaves the keyboard's own behaviour (suggestions, spell checking), `true` asks for
 * auto-correction, `false` turns suggestions off (`ReactTextInputManager.setAutoCorrect`). The typed props of Fabric's C++ cannot say
 * "unset" (the field is `false` until set), so the encoder reads the raw props the commit carried and sends one of the codes below.
 */
object InputRules {
  /** Not part of this update's raw props: the setting the view has stays. */
  const val AUTO_CORRECT_KEEP = -1

  /** The raw prop was removed (`null`): back to unset. */
  const val AUTO_CORRECT_CLEARED = 0

  const val AUTO_CORRECT_ON = 1

  /** `autoCorrect={false}`: the view sets `TYPE_TEXT_FLAG_NO_SUGGESTIONS`, which also keeps the platform's spell checker from starting. */
  const val AUTO_CORRECT_OFF = 2

  /**
   * The `inputType` flag [setting] stands for: [autoCorrectFlag] when it is on, [noSuggestionsFlag] when it is off (which also keeps the platform's spell
   * checker from starting), nothing otherwise. The flags are the caller's (`InputType.TYPE_TEXT_FLAG_AUTO_CORRECT`, `InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS`)
   * so that this file has no Android type; `InputRulesCheck` also reads `EngineInput.applyInputType` for the call that hands them over.
   */
  fun suggestionFlag(setting: Int, autoCorrectFlag: Int, noSuggestionsFlag: Int): Int = when (setting) {
    AUTO_CORRECT_ON -> autoCorrectFlag
    AUTO_CORRECT_OFF -> noSuggestionsFlag
    else -> 0
  }

  /** The setting after an update that carried [code]; [current] is what the view had. */
  fun autoCorrectAfter(current: Int, code: Int): Int = when (code) {
    AUTO_CORRECT_ON, AUTO_CORRECT_OFF -> code
    AUTO_CORRECT_CLEARED -> AUTO_CORRECT_CLEARED
    else -> current
  }

  /**
   * `showSoftInputOnFocus` (record 50) travels with the codes of `autoCorrect` (the same raw-props reading in the encoder), but unset is React Native's
   * default, true: whether the keyboard opens on focus after an update that carried [code], when it [current]ly does or not.
   */
  fun softInputAfter(current: Boolean, code: Int): Boolean = when (code) {
    AUTO_CORRECT_OFF -> false
    AUTO_CORRECT_ON, AUTO_CORRECT_CLEARED -> true
    else -> current
  }

  /** Record 49 is not part of this update's raw props: the caret stays where it is (the user may have moved it). */
  const val SELECTION_KEEP = -1

  /** `selection` was removed: nothing is selected by the props until they set one again. */
  const val SELECTION_CLEARED = 0

  /** `selection` was set, with its range. */
  const val SELECTION_SET = 1

  /**
   * Whether an update that carried selection [code] with [start]..[end] moves the caret, when the props last asked for [lastStart]..[lastEnd] (-1 for
   * none). The props carry `selection` only when it changed, but a state update of the field encodes the same props again: the range they asked for
   * last does not move the caret the user moved since.
   */
  fun selects(code: Int, start: Int, end: Int, lastStart: Int, lastEnd: Int): Boolean = code == SELECTION_SET && start >= 0 && (start != lastStart || end != lastEnd)

  /** A selection the text can hold: within 0..[length], `end` not before `start` (`EditText.setSelection` throws otherwise). */
  fun clampSelection(start: Int, end: Int, length: Int): Pair<Int, Int> {
    val from = start.coerceIn(0, length)
    return from to end.coerceIn(from, length)
  }

  const val AUTOFILL_AUTO = 0
  const val AUTOFILL_NO = 1

  /**
   * The `importantForAutofill` mode (0 auto, 1 no, 2 no-exclude-descendants, 3 yes, 4 yes-exclude-descendants, as record 50 carries it): the prop's
   * [important], except that an `autoComplete` that names no autofill hint (`"off"`, or a name Android has no hint for) turns autofill off, as
   * `ReactTextInputManager.setTextContentType` does.
   */
  fun autofillMode(autoComplete: String?, hasHint: Boolean, important: Int): Int = if (autoComplete != null && !hasHint) AUTOFILL_NO else important
}
