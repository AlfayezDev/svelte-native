package expo.modules.svelteengine

/**
 * What a text input decides without asking Android (SPEC.md, "TextInput: autoCorrect"): `src/test/run.sh` runs it on a plain JVM.
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

  /** The setting after an update that carried [code]; [current] is what the view had. */
  fun autoCorrectAfter(current: Int, code: Int): Int = when (code) {
    AUTO_CORRECT_ON, AUTO_CORRECT_OFF -> code
    AUTO_CORRECT_CLEARED -> AUTO_CORRECT_CLEARED
    else -> current
  }
}
