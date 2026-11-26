package expo.modules.svelteengine

/** Decoded records of the view kinds 5..9 (SPEC-views.md). Reset together with the owning [PropSet]. */
class ViewProps {
  // TextInput 40..51
  var fontSize = 14f
  var hasColor = false
  var color = 0
  /** 0 when neither `fontWeight` nor `fontStyle` is set (`InputRules.exactAdvances`), else the weight (400 for a style alone). */
  var weight = 0
  var italic = false
  var family: String? = null
  var letterSpacing = 0f
  var lineHeight = 0f
  var textAlign = 0
  var propText: String? = null
  var propCount = 0
  var placeholder: String? = null
  var hasPlaceholderColor = false
  var placeholderColor = 0
  var secure = false
  var multiline = false
  var editable = true
  var maxLength = -1
  /** The `includeFontPadding` prop of the field (record 43; true unless the prop says false, as React Native's default). */
  var includeFontPadding = true
  var keyboard = 0
  var capitalize = 3
  /** `InputRules` code of record 44: -1 not part of the update, 0 removed, 1 on, 2 off. */
  var autoCorrect = InputRules.AUTO_CORRECT_KEEP
  var returnKey = 0
  var submitBehavior = 0
  var hasSelectionColor = false
  var selectionColor = 0
  var hasCursorColor = false
  var cursorColor = 0
  var autoFocus = false
  var selectTextOnFocus = false
  var caretHidden = false
  var stateText: String? = null
  var stateCount = 0
  /** Record 49: `InputRules` selection code (-1 not part of the update, 0 removed, 1 set) and the range. */
  var selection = InputRules.SELECTION_KEEP
  var selectionStart = -1
  var selectionEnd = -1
  /** Record 50: the autofill name (React Native's Android token), `importantForAutofill` (0 auto .. 4), and the `showSoftInputOnFocus` code (as `autoCorrect`'s). */
  var autoComplete: String? = null
  var importantForAutofill = 0
  var showSoftInputOnFocus = InputRules.AUTO_CORRECT_KEEP
  /** Record 51: whether JavaScript has an `onContentSizeChange` and an `onScroll` handler, as `InputRules` codes (-1 not part of the update, 0 removed, 1 there). */
  var onContentSizeChange = InputRules.AUTO_CORRECT_KEEP
  var onScroll = InputRules.AUTO_CORRECT_KEEP

  // Switch 60..65
  var switchValue = false
  var enabled = true
  var hasThumb = false
  var thumb = 0
  var hasTrackFalse = false
  var trackFalse = 0
  var hasTrackTrue = false
  var trackTrue = 0
  var hasTrackTint = false
  var trackTint = 0

  // ActivityIndicator 70..73
  var spinnerStyle = 0
  var animating = true
  var hasSpinnerColor = false
  var spinnerColor = 0
  var indeterminate = false
  var progress = 0f

  // Image 80..83
  var imageUri: String? = null
  var imageWidth = 0f
  var imageHeight = 0f
  var imageScale = 1f
  var resizeMode = 0
  var hasTint = false
  var tint = 0
  var headers: Array<String>? = null

  // Modal 100
  var animationType = 0
  var transparent = false
  var statusBarTranslucent = false
  var navigationBarTranslucent = false
  var hardwareAccelerated = false
  var visible = false

  /** A record of this group was decoded since the last reset (PropSet.reset clears the group only then). */
  var touched = false

  fun reset() {
    touched = false
    fontSize = 14f; hasColor = false; color = 0; weight = 0; italic = false; family = null
    letterSpacing = 0f; lineHeight = 0f; textAlign = 0
    propText = null; propCount = 0; placeholder = null; hasPlaceholderColor = false; placeholderColor = 0
    secure = false; multiline = false; editable = true; maxLength = -1; includeFontPadding = true
    keyboard = 0; capitalize = 3; autoCorrect = InputRules.AUTO_CORRECT_KEEP; returnKey = 0; submitBehavior = 0
    hasSelectionColor = false; selectionColor = 0; hasCursorColor = false; cursorColor = 0
    autoFocus = false; selectTextOnFocus = false; caretHidden = false
    stateText = null; stateCount = 0
    selection = InputRules.SELECTION_KEEP; selectionStart = -1; selectionEnd = -1
    autoComplete = null; importantForAutofill = 0; showSoftInputOnFocus = InputRules.AUTO_CORRECT_KEEP
    onContentSizeChange = InputRules.AUTO_CORRECT_KEEP; onScroll = InputRules.AUTO_CORRECT_KEEP
    switchValue = false; enabled = true; hasThumb = false; thumb = 0
    hasTrackFalse = false; trackFalse = 0; hasTrackTrue = false; trackTrue = 0; hasTrackTint = false; trackTint = 0
    spinnerStyle = 0; animating = true; hasSpinnerColor = false; spinnerColor = 0; indeterminate = false; progress = 0f
    imageUri = null; imageWidth = 0f; imageHeight = 0f; imageScale = 1f; resizeMode = 0
    hasTint = false; tint = 0; headers = null
    animationType = 0; transparent = false; statusBarTranslucent = false
    navigationBarTranslucent = false; hardwareAccelerated = false; visible = false
  }
}

object PropsViews {
  private fun f(ops: IntArray, i: Int) = Float.fromBits(ops[i])

  /** Decodes the record [id] (40..109) whose values start at [at]; returns the index after it. */
  fun decode(id: Int, ops: IntArray, at: Int, strings: Array<String>, v: ViewProps): Int {
    var i = at
    v.touched = true
    when (id) {
      40 -> {
        v.fontSize = f(ops, i); v.hasColor = ops[i + 1] == 1; v.color = ops[i + 2]
        v.weight = ops[i + 3]; v.italic = ops[i + 4] == 1
        v.family = if (ops[i + 5] >= 0) strings[ops[i + 5]] else null
        v.letterSpacing = f(ops, i + 6); v.lineHeight = f(ops, i + 7); v.textAlign = ops[i + 8]
        i += 9
      }
      41 -> { v.propText = strings[ops[i]]; v.propCount = ops[i + 1]; i += 2 }
      42 -> {
        v.placeholder = if (ops[i] >= 0) strings[ops[i]] else null
        v.hasPlaceholderColor = ops[i + 1] == 1; v.placeholderColor = ops[i + 2]; i += 3
      }
      43 -> {
        v.secure = ops[i] == 1; v.multiline = ops[i + 1] == 1; v.editable = ops[i + 2] == 1
        v.maxLength = ops[i + 3]; v.includeFontPadding = ops[i + 4] == 1; i += 5
      }
      44 -> { v.keyboard = ops[i]; v.capitalize = ops[i + 1]; v.autoCorrect = ops[i + 2]; i += 3 }
      45 -> { v.returnKey = ops[i]; v.submitBehavior = ops[i + 1]; i += 2 }
      46 -> {
        v.hasSelectionColor = ops[i] == 1; v.selectionColor = ops[i + 1]
        v.hasCursorColor = ops[i + 2] == 1; v.cursorColor = ops[i + 3]; i += 4
      }
      47 -> { v.autoFocus = ops[i] == 1; v.selectTextOnFocus = ops[i + 1] == 1; v.caretHidden = ops[i + 2] == 1; i += 3 }
      48 -> { v.stateText = strings[ops[i]]; v.stateCount = ops[i + 1]; i += 2 }
      49 -> { v.selection = ops[i]; v.selectionStart = ops[i + 1]; v.selectionEnd = ops[i + 2]; i += 3 }
      50 -> {
        v.autoComplete = if (ops[i] >= 0) strings[ops[i]] else null
        v.importantForAutofill = ops[i + 1]; v.showSoftInputOnFocus = ops[i + 2]; i += 3
      }
      51 -> { v.onContentSizeChange = ops[i]; v.onScroll = ops[i + 1]; i += 2 }
      60 -> v.switchValue = ops[i++] == 1
      61 -> v.enabled = ops[i++] == 1
      62 -> { v.hasThumb = ops[i] == 1; v.thumb = ops[i + 1]; i += 2 }
      63 -> { v.hasTrackFalse = ops[i] == 1; v.trackFalse = ops[i + 1]; i += 2 }
      64 -> { v.hasTrackTrue = ops[i] == 1; v.trackTrue = ops[i + 1]; i += 2 }
      65 -> { v.hasTrackTint = ops[i] == 1; v.trackTint = ops[i + 1]; i += 2 }
      70 -> v.spinnerStyle = ops[i++]
      71 -> v.animating = ops[i++] == 1
      72 -> { v.hasSpinnerColor = ops[i] == 1; v.spinnerColor = ops[i + 1]; i += 2 }
      73 -> { v.indeterminate = ops[i] == 1; v.progress = f(ops, i + 1); i += 2 }
      80 -> {
        v.imageUri = if (ops[i] >= 0) strings[ops[i]] else null
        v.imageWidth = f(ops, i + 1); v.imageHeight = f(ops, i + 2); v.imageScale = f(ops, i + 3); i += 4
      }
      81 -> v.resizeMode = ops[i++]
      82 -> { v.hasTint = ops[i] == 1; v.tint = ops[i + 1]; i += 2 }
      83 -> {
        val n = ops[i++]
        v.headers = Array(n * 2) { k -> strings[ops[i + k]] }
        i += n * 2
      }
      100 -> {
        v.animationType = ops[i]; v.transparent = ops[i + 1] == 1; v.statusBarTranslucent = ops[i + 2] == 1
        v.navigationBarTranslucent = ops[i + 3] == 1; v.hardwareAccelerated = ops[i + 4] == 1
        v.visible = ops[i + 5] == 1; i += 6
      }
      else -> throw IllegalStateException("SvelteEngine: unknown view prop id $id at ${at - 1}")
    }
    return i
  }
}
