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

  // `android.text.InputType`'s values, which `InputRulesCheck` compares with the platform's own class where an android.jar is at hand. This file has no Android type.
  const val TYPE_MASK_CLASS = 0xF
  const val TYPE_MASK_VARIATION = 0xFF0
  const val TYPE_CLASS_TEXT = 0x1
  const val TYPE_CLASS_NUMBER = 0x2
  const val TYPE_CLASS_PHONE = 0x3
  const val TYPE_NUMBER_FLAG_SIGNED = 0x1000
  const val TYPE_NUMBER_FLAG_DECIMAL = 0x2000
  const val TYPE_NUMBER_VARIATION_PASSWORD = 0x10
  const val TYPE_TEXT_FLAG_CAP_CHARACTERS = 0x1000
  const val TYPE_TEXT_FLAG_CAP_WORDS = 0x2000
  const val TYPE_TEXT_FLAG_CAP_SENTENCES = 0x4000
  const val TYPE_TEXT_FLAG_AUTO_CORRECT = 0x8000
  const val TYPE_TEXT_FLAG_MULTI_LINE = 0x20000
  const val TYPE_TEXT_FLAG_NO_SUGGESTIONS = 0x80000
  const val TYPE_TEXT_VARIATION_URI = 0x10
  const val TYPE_TEXT_VARIATION_EMAIL_ADDRESS = 0x20
  const val TYPE_TEXT_VARIATION_PASSWORD = 0x80
  const val TYPE_TEXT_VARIATION_WEB_PASSWORD = 0xE0
  const val TYPE_TEXT_VARIATION_VISIBLE_PASSWORD = 0x90

  /** The codes of record 47's keyboard (`keyboardCode` in `PropsEncoderViews.cpp`): 0 is the default keyboard, and any name React Native does not know. */
  const val KEYBOARD_NUMERIC = 1
  const val KEYBOARD_NUMBER_PAD = 2
  const val KEYBOARD_DECIMAL_PAD = 3
  const val KEYBOARD_EMAIL = 4
  const val KEYBOARD_PHONE = 5
  const val KEYBOARD_VISIBLE_PASSWORD = 6
  const val KEYBOARD_URL = 7

  /** The codes of `autoCapitalize` (`capitalizeCode`): none, characters, words, and sentences, which is also the default. */
  const val CAPITALIZE_NONE = 0
  const val CAPITALIZE_CHARACTERS = 1
  const val CAPITALIZE_WORDS = 2

  /**
   * The `inputType` of a text input: what `ReactTextInputManager` leaves in `ReactEditText.stagedInputType` for the props it was given, the flags a keyboard reads
   * (Gboard starts with the shift on for `TYPE_TEXT_FLAG_CAP_SENTENCES` and shows its suggestion strip for a field that takes suggestions). The view starts as
   * `createViewInstance` leaves it (`TYPE_CLASS_TEXT`, the `EditText`'s own type without `TYPE_TEXT_FLAG_MULTI_LINE`), and each prop is a setter that unsets some bits and sets others:
   *
   * - `keyboardType` unsets the class bits and sets the keyboard's whole type: a variation without a class for `visible-password` and `url` (`TYPE_CLASS_TEXT` is not in
   *   `TYPE_TEXT_VARIATION_VISIBLE_PASSWORD` or `_URI`, and React Native does not add it);
   * - `secureTextEntry` (only when it is true: false is the same as unset for it) unsets the visible-password bits and sets the password variation, and a numeric keyboard's
   *   password is the number variation (`checkPasswordType`); `visible-password` wins over it, as React Native's comment says it does;
   * - `autoCorrect` unsets both of its flags and sets the one the setting stands for ([suggestionFlag]), whatever the class and whether the field is a password;
   * - `multiline` sets `TYPE_TEXT_FLAG_MULTI_LINE`, whatever the class (`ReactEditText` makes the view multi-line for it);
   * - `autoCapitalize` is not a setter of the flags: `reconcileAutoCapitalize` runs after all of them, and for a text class replaces the three capitalisation bits by the prop's (sentences
   *   when it is unset), for any other class takes `TYPE_TEXT_FLAG_CAP_SENTENCES` away (its other two bits are `TYPE_NUMBER_FLAG_SIGNED` and `_DECIMAL`).
   *
   * What the engine computed before dropped `autoCorrect`, `multiline` and the capitalisation from a password field and `autoCorrect` and `multiline` from every other class that
   * is not text, and gave `visible-password` and `url` a class.
   */
  fun inputType(keyboard: Int, secure: Boolean, capitalize: Int, autoCorrect: Int, multiline: Boolean): Int {
    var staged = TYPE_CLASS_TEXT
    fun update(unset: Int, set: Int) { staged = (staged and unset.inv()) or set }
    val numbered = TYPE_CLASS_NUMBER or TYPE_NUMBER_FLAG_DECIMAL or TYPE_NUMBER_FLAG_SIGNED
    fun checkPasswordType() {
      if ((staged and numbered) != 0 && (staged and TYPE_TEXT_VARIATION_PASSWORD) != 0) update(TYPE_TEXT_VARIATION_PASSWORD, TYPE_NUMBER_VARIATION_PASSWORD)
    }
    fun keyboardType() {
      update(
        TYPE_MASK_CLASS,
        when (keyboard) {
          KEYBOARD_NUMERIC -> numbered
          KEYBOARD_NUMBER_PAD -> TYPE_CLASS_NUMBER
          KEYBOARD_DECIMAL_PAD -> TYPE_CLASS_NUMBER or TYPE_NUMBER_FLAG_DECIMAL
          KEYBOARD_EMAIL -> TYPE_TEXT_VARIATION_EMAIL_ADDRESS or TYPE_CLASS_TEXT
          KEYBOARD_PHONE -> TYPE_CLASS_PHONE
          KEYBOARD_VISIBLE_PASSWORD -> TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
          KEYBOARD_URL -> TYPE_TEXT_VARIATION_URI
          else -> TYPE_CLASS_TEXT
        },
      )
      checkPasswordType()
    }
    fun secureTextEntry() {
      update(TYPE_TEXT_VARIATION_VISIBLE_PASSWORD, TYPE_TEXT_VARIATION_PASSWORD)
      checkPasswordType()
    }
    if (secure && keyboard == KEYBOARD_VISIBLE_PASSWORD) { secureTextEntry(); keyboardType() } else { keyboardType(); if (secure) secureTextEntry() }
    update(TYPE_TEXT_FLAG_AUTO_CORRECT or TYPE_TEXT_FLAG_NO_SUGGESTIONS, suggestionFlag(autoCorrect, TYPE_TEXT_FLAG_AUTO_CORRECT, TYPE_TEXT_FLAG_NO_SUGGESTIONS))
    if (multiline) update(0, TYPE_TEXT_FLAG_MULTI_LINE)
    val capitalisation = TYPE_TEXT_FLAG_CAP_SENTENCES or TYPE_TEXT_FLAG_CAP_WORDS or TYPE_TEXT_FLAG_CAP_CHARACTERS
    if ((staged and TYPE_MASK_CLASS) == TYPE_CLASS_TEXT) {
      update(
        capitalisation,
        when (capitalize) {
          CAPITALIZE_NONE -> 0
          CAPITALIZE_CHARACTERS -> TYPE_TEXT_FLAG_CAP_CHARACTERS
          CAPITALIZE_WORDS -> TYPE_TEXT_FLAG_CAP_WORDS
          else -> TYPE_TEXT_FLAG_CAP_SENTENCES
        },
      )
    } else {
      update(TYPE_TEXT_FLAG_CAP_SENTENCES, 0)
    }
    return staged
  }

  /**
   * Whether the platform masks the text of an input of this [type]: `TextView.isPasswordInputType`, whose `setInputType` then sets `PasswordTransformationMethod`. A text password
   * (`secureTextEntry`), a web password and a number password (the numeric keyboards'); not `visible-password`.
   */
  fun isPassword(type: Int): Boolean {
    val variation = type and (TYPE_MASK_CLASS or TYPE_MASK_VARIATION)
    return variation == (TYPE_CLASS_TEXT or TYPE_TEXT_VARIATION_PASSWORD) || variation == (TYPE_CLASS_TEXT or TYPE_TEXT_VARIATION_WEB_PASSWORD) ||
      variation == (TYPE_CLASS_NUMBER or TYPE_NUMBER_VARIATION_PASSWORD)
  }

  /**
   * Whether a field masks its text: `secureTextEntry`, except under the `visible-password` keyboard, which wins over it (as it does in React Native's flags). Not a question for [isPassword] of
   * the type: React Native's own flags for a secure field with the email, phone or url keyboard (`0x40a1`, `0x13`, `0x80`) are no password type to Android, whose `setInputType` then
   * leaves the text unmasked (React Native shows it: a known gap of its own). A password shown in plain text is worse than a flag that differs, so the masking is the field's to set by itself.
   */
  fun masks(secure: Boolean, keyboard: Int): Boolean = secure && keyboard != KEYBOARD_VISIBLE_PASSWORD

  /** What `TextView.getTransformationMethod` is: the masking, the single-line one (`SingleLineTransformationMethod`), or none. */
  enum class Transformation { PASSWORD, SINGLE_LINE, NONE }

  /**
   * The transformation method a field has after an update: [current] is what the platform left it with after `setInputType(type)` (and `setSingleLine(false)` for a type it kept single-line).
   * A field that [masks] is masked whatever the platform did. A field that does not is not: the platform lets go of a masking only when the type it was set for was a password type, and for a
   * secure field with the email keyboard it was set by hand, so it is let go of by hand too (to the method a field of that type has: none when it has several lines, the single-line one when not).
   */
  fun transformationFor(secure: Boolean, keyboard: Int, type: Int, current: Transformation): Transformation = when {
    masks(secure, keyboard) -> Transformation.PASSWORD
    current == Transformation.PASSWORD -> if ((type and TYPE_TEXT_FLAG_MULTI_LINE) != 0) Transformation.NONE else Transformation.SINGLE_LINE
    else -> current
  }

  /**
   * Whether the platform leaves a view of this [type] single-line although the type says multi-line: `TextView.setInputType` makes a view multi-line when the class is text and the flag is
   * set (`isMultilineInputType`), and React Native's `multiline` is the flag on any class. For a text class the platform already did what the flag asks (and kept the masking of a password
   * it set), so the view is made multi-line by hand only here.
   */
  fun platformKeepsSingleLine(type: Int): Boolean = (type and TYPE_TEXT_FLAG_MULTI_LINE) != 0 && (type and TYPE_MASK_CLASS) != TYPE_CLASS_TEXT

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

  /**
   * `onContentSizeChange` and `onScroll` (record 51) are booleans, and React Native gives a view the watcher of each only while the prop is there
   * (`ReactTextInputManager.setOnContentSizeChange`, `setOnScroll`; JavaScript sends `true` for a handler it has). They travel with the codes of `autoCorrect`
   * (the same raw-props reading): whether the view watches after an update that carried [code], when it [current]ly does or not.
   */
  fun watchAfter(current: Boolean, code: Int): Boolean = when (code) {
    AUTO_CORRECT_ON -> true
    AUTO_CORRECT_OFF, AUTO_CORRECT_CLEARED -> false
    else -> current
  }

  /** Whether a watcher has something to send: React Native's two watchers send only when one of the two numbers is not the one they sent last. */
  fun differs(lastA: Int, lastB: Int, a: Int, b: Int): Boolean = a != lastA || b != lastB

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

  /**
   * `TextAttributes.effectiveFontSize`: the pixel size a field's text is laid out and drawn at is the scaled size rounded up to a whole pixel (22 sp at 2.625 is 58 px, not 57.75), and the
   * letter spacing is its share of that size. A size that is not set (0) stays so.
   */
  fun fontSizePx(size: Float): Float = if (size > 0f) Math.ceil(size.toDouble()).toFloat() else size

  /**
   * `ReactEditText.maybeUpdateTypeface`: a family, a weight or a style (a style of `normal` too) turns on subpixel and linear text, the advances React Native measures and draws a field's
   * text with; text in the platform's default font keeps the hinted paint. The record carries 0 for a weight that is not set (400 when only a style is), as a fragment's does.
   */
  fun exactAdvances(family: String?, weight: Int, italic: Boolean): Boolean = family != null || italic || weight != 0

  /**
   * The line height of the `CustomLineHeightSpan` a field's text has, in px (rounded up as the span does), or 0 for none: an empty field has no span (its text is null in React Native
   * and the hint is laid out plain), nor has one with no line height.
   */
  fun lineHeightSpanPx(lineHeight: Float, textLength: Int): Int = if (textLength == 0 || lineHeight <= 0f) 0 else Math.ceil(lineHeight.toDouble()).toInt()
}
