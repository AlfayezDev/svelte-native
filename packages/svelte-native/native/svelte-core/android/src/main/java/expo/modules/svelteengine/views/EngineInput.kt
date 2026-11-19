package expo.modules.svelteengine.views

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.os.Build
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import expo.modules.svelteappearance.isNight
import expo.modules.svelteengine.InputRules
import expo.modules.svelteengine.TextLayouts
import expo.modules.svelteengine.ViewEvents
import expo.modules.svelteengine.ViewProps
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.max
import kotlin.math.min

/**
 * TextInput on a plain framework [EditText] (no AppCompat). Text ownership follows React Native's
 * ReactEditText: every user edit bumps [nativeEventCount] and is reported with that count; text coming
 * from JS (state / setTextAndSelection) carries the newest count JS has seen and is applied only when
 * that count is not older than the native one.
 */
class EngineInput(context: Context) : EditText(context), EngineNode {
  override val node = NodeState()

  companion object {
    /** An input built ahead of time, and the context it was built with: the engine's views use one context for the life of a host. */
    private class Spare(val context: Context, val view: EngineInput)

    /** What [obtain] may hand out, and the generation it was built in: a discard moves the generation on, so a build that was under way during it never publishes. */
    private class State(val generation: Int, val spare: Spare?)

    private val state = AtomicReference(State(0, null))

    /**
     * An input for [context], the one built ahead of time when there is one (the constructor of an `EditText` is 5 to 19 ms of the main
     * thread on the A16, whatever the cache holds: it runs on a cold core), else a new one. Main thread. The next one is built ahead
     * after this one is taken and after a miss (no spare yet, a discard, a spare of a host that was reloaded), so the spare is back for the
     * next screen with an input.
     */
    fun obtain(context: Context): EngineInput {
      var taken: Spare? = null
      while (true) {
        val now = state.get()
        val spare = now.spare ?: break
        if (state.compareAndSet(now, State(now.generation, null))) {
          taken = spare
          break
        }
      }
      InputWarmup.stock(context, RESTOCK_MS)
      if (taken != null && taken.context === context) {
        Log.d(TAG, "input taken from the spare")
        return taken.view
      }
      Log.d(TAG, "input built on the main thread (${if (taken == null) "no spare" else "the spare was built for another host"})")
      return EngineInput(context)
    }

    /**
     * Called off the main thread by [InputWarmup]: builds the input [obtain] hands out next, unless one is there. False when a discard came while it
     * was being built: the input is dropped, and the caller builds another for the generation that is current now.
     */
    internal fun stockSpare(context: Context): Boolean {
      val before = state.get()
      if (before.spare != null) return true
      val view = EngineInput(context)
      while (true) {
        val now = state.get()
        if (now.generation != before.generation) return false
        if (now.spare != null) return true // filled meanwhile
        if (state.compareAndSet(now, State(now.generation, Spare(context, view)))) {
          Log.d(TAG, "input spare built (generation ${now.generation})")
          return true
        }
      }
    }

    /** The spare is for a configuration or a host that is gone (font scale, locale, night mode; the module's destroy): nothing built before now is handed out. */
    fun discardSpare() {
      while (true) {
        val now = state.get()
        if (state.compareAndSet(now, State(now.generation + 1, null))) {
          Log.d(TAG, "input spare discarded (generation ${now.generation + 1})")
          return
        }
      }
    }

    /** Whether the spare is there (the lab and the tests ask). */
    internal fun hasSpare(): Boolean = state.get().spare != null

    private const val TAG = "SvelteEngine"
    private const val RESTOCK_MS = 300L
  }

  var nativeEventCount = 0
    private set

  private var settingText = false
  private var submitBehavior = 0
  private var returnKey = 0
  private var lastSelStart = -1
  private var lastSelEnd = -1
  private var inputTypeKey = Int.MIN_VALUE
  /** The `autoCorrect` setting (`InputRules`): an update that does not carry the prop leaves it. */
  private var autoCorrect = InputRules.AUTO_CORRECT_CLEARED
  private var family: String? = null
  private var weight = 400
  private var italic = false
  private var created = false
  private var padL = -1
  private var padT = -1
  private var padR = -1
  private var padB = -1

  init {
    background = null
    // Yoga owns the box: no font padding of its own, the frame comes from the layout.
    includeFontPadding = false
    setPadding(0, 0, 0, 0)
    addTextChangedListener(object : TextWatcher {
      override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
      override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
      override fun afterTextChanged(s: Editable?) {
        // Creation-time setters (input type, hint, initial text) also fire this; React Native's ReactEditText reports
        // nothing before the view is fully created, and a stray empty change here overwrote a bound value in JavaScript.
        if (settingText || !created) return
        val n = ++nativeEventCount
        if (n <= 3) android.util.Log.i("SvelteEngine", "input change #$n tag=${node.tag} length=${s?.length ?: 0} focused=$isFocused")
        ViewEvents.input(node.tag, ViewEvents.INPUT_CHANGE, s?.toString() ?: "", n, selectionStart, selectionEnd)
      }
    })
    setOnFocusChangeListener { _, hasFocus ->
      if (hasFocus) {
        ViewEvents.input(node.tag, ViewEvents.INPUT_FOCUS, null, 0, 0, 0)
      } else {
        ViewEvents.input(node.tag, ViewEvents.INPUT_BLUR, null, 0, 0, 0)
        ViewEvents.input(node.tag, ViewEvents.INPUT_END_EDITING, text?.toString() ?: "", 0, 0, 0)
      }
    }
    setOnEditorActionListener { _, actionId, _ ->
      if ((actionId and EditorInfo.IME_MASK_ACTION) != 0 || actionId == EditorInfo.IME_NULL) {
        val multi = isMultiline()
        // submitBehavior: 1 submit, 2 blurAndSubmit, 3 newline (C++ resolves the default)
        val shouldSubmit = submitBehavior == 1 || submitBehavior == 2
        val shouldBlur = submitBehavior == 2
        if (shouldSubmit) ViewEvents.input(node.tag, ViewEvents.INPUT_SUBMIT, text?.toString() ?: "", 0, 0, 0)
        if (shouldBlur) blur()
        if (shouldBlur || shouldSubmit || !multi) true
        else actionId == EditorInfo.IME_ACTION_NEXT || actionId == EditorInfo.IME_ACTION_PREVIOUS
      } else {
        true
      }
    }
  }

  private fun isMultiline() = (inputType and InputType.TYPE_TEXT_FLAG_MULTI_LINE) != 0

  /** Applies the box padding Yoga computed (layout insets), called after every frame update. */
  fun syncPadding() {
    val l = node.padL.toInt(); val t = node.padT.toInt(); val r = node.padR.toInt(); val b = node.padB.toInt()
    if (l == padL && t == padT && r == padR && b == padB) return
    padL = l; padT = t; padR = r; padB = b
    setPadding(l, t, r, b)
  }

  /** Applies a complete prop record. [create] is true for the first apply of the view. */
  fun apply(v: ViewProps, create: Boolean) {
    applyTextStyle(v)

    val hint = v.placeholder
    if (this.hint?.toString() != hint) this.hint = hint
    // The default hint is 40 % of the mode's text colour: on a dark surface a black one could not be read. JavaScript sends the props again when the mode changes (the text's default colour).
    setHintTextColor(if (v.hasPlaceholderColor) v.placeholderColor else if (isNight(resources)) 0x66FFFFFF else 0x66000000)

    isEnabled = v.editable
    submitBehavior = v.submitBehavior
    if (returnKey != v.returnKey || create) {
      returnKey = v.returnKey
      imeOptions = when (v.returnKey) {
        1 -> EditorInfo.IME_ACTION_GO
        2 -> EditorInfo.IME_ACTION_NEXT
        3 -> EditorInfo.IME_ACTION_NONE
        4 -> EditorInfo.IME_ACTION_PREVIOUS
        5 -> EditorInfo.IME_ACTION_SEARCH
        6 -> EditorInfo.IME_ACTION_SEND
        else -> EditorInfo.IME_ACTION_DONE
      }
    }
    autoCorrect = InputRules.autoCorrectAfter(autoCorrect, v.autoCorrect)
    applyInputType(v)

    val gravityH = when (v.textAlign) {
      1 -> Gravity.CENTER_HORIZONTAL
      2 -> Gravity.END
      else -> Gravity.START
    }
    val gravityV = if (v.multiline) Gravity.TOP else Gravity.CENTER_VERTICAL
    if (gravity != (gravityH or gravityV)) gravity = gravityH or gravityV

    filters = if (v.maxLength >= 0) arrayOf(InputFilter.LengthFilter(v.maxLength)) else emptyArray()

    if (v.hasSelectionColor) highlightColor = v.selectionColor
    applyCursorTint(v)
    isCursorVisible = !v.caretHidden
    setSelectAllOnFocus(v.selectTextOnFocus)

    if (create) {
      // Initial text from the props; the state (text + event count) overrides it once the layout ran.
      val initial = v.propText
      if (!initial.isNullOrEmpty()) maybeSetText(initial, v.propCount)
      created = true
      if (v.autoFocus) post { focus() }
    }
  }

  /** The text of the TextInput state (set after layout, whenever the React tree text changes). */
  fun applyState(v: ViewProps) {
    val t = v.stateText ?: return
    maybeSetText(t, v.stateCount)
  }

  private fun applyTextStyle(v: ViewProps) {
    if (textSize != v.fontSize) setTextSize(TypedValue.COMPLEX_UNIT_PX, v.fontSize)
    setTextColor(if (v.hasColor) v.color else 0xFF000000.toInt())
    if (v.fontSize > 0f && letterSpacing != v.letterSpacing / v.fontSize) letterSpacing = v.letterSpacing / v.fontSize
    if (v.lineHeight > 0f) {
      val extra = v.lineHeight - paint.getFontMetricsInt(null)
      setLineSpacing(extra, 1f)
    } else {
      setLineSpacing(0f, 1f)
    }
    applyTypeface(v.family, v.weight, v.italic)
  }

  private fun applyTypeface(family: String?, weight: Int, italic: Boolean) {
    this.family = family; this.weight = weight; this.italic = italic
    val tf: Typeface = TextLayouts.typeface(family, weight, italic)
    if (typeface !== tf) typeface = tf
  }

  private fun applyInputType(v: ViewProps) {
    var type = when (v.keyboard) {
      1 -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL or InputType.TYPE_NUMBER_FLAG_SIGNED
      2 -> InputType.TYPE_CLASS_NUMBER
      3 -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
      4 -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
      5 -> InputType.TYPE_CLASS_PHONE
      6 -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
      7 -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
      else -> InputType.TYPE_CLASS_TEXT
    }
    val isNumber = (type and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_NUMBER
    if (v.secure && v.keyboard != 6) {
      type = if (isNumber) {
        InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
      } else {
        InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
      }
    } else if ((type and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT) {
      type = type or when (v.capitalize) {
        1 -> InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
        2 -> InputType.TYPE_TEXT_FLAG_CAP_WORDS
        3 -> InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        else -> 0
      }
      // As `ReactTextInputManager.setAutoCorrect`: true asks for auto-correction, false turns suggestions off (which also keeps the
      // platform's spell checker, a main-thread binder call at attach and on every edit, from starting), unset leaves the type alone.
      type = type or InputRules.suggestionFlag(autoCorrect, autoCorrectFlag = InputType.TYPE_TEXT_FLAG_AUTO_CORRECT, noSuggestionsFlag = InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
    }
    if (v.multiline && (type and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT) {
      type = type or InputType.TYPE_TEXT_FLAG_MULTI_LINE
    }
    if (type == inputTypeKey) return
    inputTypeKey = type
    val start = selectionStart; val end = selectionEnd
    inputType = type
    // Changing the input type resets the typeface (password fields become monospace): put ours back.
    applyTypeface(family, weight, italic)
    if (start >= 0 && end >= 0 && start <= length() && end <= length()) setSelection(start, end)
  }

  private fun applyCursorTint(v: ViewProps) {
    if (!v.hasCursorColor || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val tint = ColorStateList.valueOf(v.cursorColor)
    textCursorDrawable?.setTintList(tint)
    textSelectHandle?.setTintList(tint)
    textSelectHandleLeft?.setTintList(tint)
    textSelectHandleRight?.setTintList(tint)
  }

  /** React Native's ReactEditText.maybeSetText: never replaces text the user has edited since [eventCount]. */
  fun maybeSetText(newText: String, eventCount: Int) {
    if (eventCount < nativeEventCount) return
    val current = text?.toString() ?: ""
    if (current == newText) return
    val start = selectionStart
    settingText = true
    try {
      if (newText.isEmpty()) {
        // Buggy keyboards keep their composing text unless the text is set to null.
        setText(null as CharSequence?)
      } else {
        editableText.replace(0, length(), newText)
      }
      val keep = if (start < 0) newText.length else min(start, newText.length)
      setSelection(keep)
    } finally {
      settingText = false
    }
  }

  /** The `setTextAndSelection` view command: [text] may be null to change only the selection. */
  fun setTextAndSelection(eventCount: Int, text: String?, start: Int, end: Int) {
    if (eventCount < nativeEventCount) return
    if (text != null) maybeSetText(text, eventCount)
    if (start >= 0) {
      val e = if (end >= 0) end else start
      val len = length()
      setSelection(max(0, min(start, len)), max(0, min(e, len)))
    }
  }

  fun focus() {
    if (!isFocusableInTouchMode) isFocusableInTouchMode = true
    requestFocus()
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    imm?.showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
  }

  fun blur() {
    // clearFocus alone hands the focus to the first focusable view, which is this one again.
    val host = parent as? ViewGroup
    if (host != null) {
      host.isFocusableInTouchMode = true
      host.requestFocus()
    }
    clearFocus()
    val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
    imm?.hideSoftInputFromWindow(windowToken, 0)
  }

  override fun onSelectionChanged(selStart: Int, selEnd: Int) {
    super.onSelectionChanged(selStart, selEnd)
    if (!created || settingText || (selStart == lastSelStart && selEnd == lastSelEnd)) return
    lastSelStart = selStart; lastSelEnd = selEnd
    ViewEvents.input(node.tag, ViewEvents.INPUT_SELECTION, null, 0, selStart, selEnd)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(
      View.MeasureSpec.makeMeasureSpec(node.w, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(node.h, View.MeasureSpec.EXACTLY),
    )
  }

  /** keyPress events like ReactEditTextInputConnectionWrapper: one printable char, Enter, Backspace. */
  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
    val base = super.onCreateInputConnection(outAttrs) ?: return null
    if (isMultiline() && (submitBehavior == 1 || submitBehavior == 2)) {
      outAttrs.imeOptions = outAttrs.imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION.inv()
    }
    return object : InputConnectionWrapper(base, false) {
      private fun key(k: String) = ViewEvents.input(node.tag, ViewEvents.INPUT_KEY_PRESS, k, 0, 0, 0)

      override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
        if (!text.isNullOrEmpty()) key(if (text == "\n") "Enter" else text.last().toString())
        return super.commitText(text, newCursorPosition)
      }

      override fun setComposingText(text: CharSequence?, newCursorPosition: Int): Boolean {
        if (!text.isNullOrEmpty()) key(text.last().toString())
        return super.setComposingText(text, newCursorPosition)
      }

      override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
        key("Backspace")
        return super.deleteSurroundingText(beforeLength, afterLength)
      }

      override fun sendKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
          when (event.keyCode) {
            KeyEvent.KEYCODE_DEL -> key("Backspace")
            KeyEvent.KEYCODE_ENTER -> key("Enter")
            else -> event.unicodeChar.takeIf { it != 0 }?.let { key(it.toChar().toString()) }
          }
        }
        return super.sendKeyEvent(event)
      }
    }
  }
}
