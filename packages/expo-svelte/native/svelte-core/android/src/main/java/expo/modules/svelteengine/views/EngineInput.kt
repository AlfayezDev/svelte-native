package expo.modules.svelteengine.views

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.os.Build
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.text.method.PasswordTransformationMethod
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
import expo.modules.svelteengine.InputAutofill
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
  /** The range the props asked for last (record 49), -1 for none, and whether that was in the batch being mounted (the state text of the same commit is put in after it). */
  private var propSelStart = -1
  private var propSelEnd = -1
  private var selectionFresh = false
  /** The autofill name and mode the view was given last (record 50): applied again only when they change. */
  private var autofillName: String? = null
  private var autofillMode = -1
  private var padL = -1
  private var padT = -1
  private var padR = -1
  private var padB = -1
  /** `onContentSizeChange` and `onScroll` (record 51): whether JavaScript has a handler, and the numbers the last event carried (`InputRules.differs`), in px as React Native keeps them. */
  private var watchContentSize = false
  private var watchScroll = false
  private var sentContentW = 0
  private var sentContentH = 0
  private var sentScrollX = 0
  private var sentScrollY = 0

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
        if (!settingText && created) {
          val n = ++nativeEventCount
          if (n <= 3) android.util.Log.i("SvelteEngine", "input change #$n tag=${node.tag} length=${s?.length ?: 0} focused=$isFocused")
          ViewEvents.input(node.tag, ViewEvents.INPUT_CHANGE, s?.toString() ?: "", n, selectionStart, selectionEnd)
        }
        // After the change event, for text from JavaScript too, as ReactEditText's TextWatcherDelegator does. The edit's own layout has followed it by now:
        // an Editable tells the layout of its text before it calls `afterTextChanged`. The frame stays Yoga's, so no layout pass follows an edit to tell the new size.
        reportContentSize()
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

    showSoftInputOnFocus = InputRules.softInputAfter(showSoftInputOnFocus, v.showSoftInputOnFocus)
    applyAutofill(v)
    applyWatchers(v)

    if (create) {
      // Initial text from the props; the state (text + event count) overrides it once the layout ran.
      val initial = v.propText
      if (!initial.isNullOrEmpty()) maybeSetText(initial, v.propCount)
      created = true
      if (v.autoFocus) post { focus() }
    }
    applySelection(v)
  }

  /** The text of the TextInput state (set after layout, whenever the React tree text changes). */
  fun applyState(v: ViewProps) {
    val t = v.stateText ?: return
    maybeSetText(t, v.stateCount)
    // A commit that set the text and the selection together (an input that reformats what is typed): the range is the new text's.
    if (selectionFresh) selectRange(propSelStart, propSelEnd)
  }

  /**
   * `selection` (record 49), what React Native's TextInput does with the `setTextAndSelection` command: the caret goes where the props say when they
   * change it, after the text of the same commit (`applyState`), and stays where the user puts it otherwise (`InputRules.selects`). Like the command,
   * a range sent with an event count older than the field's is ignored: JavaScript set it before it heard of the last edit.
   */
  private fun applySelection(v: ViewProps) {
    // Props that answer an older edit than the user has made since (`mostRecentEventCount`, record 41) do not move the caret, as the command would not.
    if (v.selection == InputRules.SELECTION_SET && v.propCount < nativeEventCount) return
    when (v.selection) {
      InputRules.SELECTION_CLEARED -> { propSelStart = -1; propSelEnd = -1 }
      InputRules.SELECTION_SET -> if (InputRules.selects(v.selection, v.selectionStart, v.selectionEnd, propSelStart, propSelEnd)) {
        propSelStart = v.selectionStart
        propSelEnd = v.selectionEnd
        selectRange(propSelStart, propSelEnd)
        if (!selectionFresh) {
          selectionFresh = true
          post { selectionFresh = false }
        }
      }
    }
  }

  private fun selectRange(start: Int, end: Int) {
    val (from, to) = InputRules.clampSelection(start, end, length())
    if (selectionStart != from || selectionEnd != to) setSelection(from, to)
  }

  /**
   * `autoComplete` and `importantForAutofill` (record 50), as `ReactTextInputManager` applies them: the name's autofill hint (`InputAutofill`), and
   * autofill off for `"off"` or a name with no hint.
   */
  private fun applyAutofill(v: ViewProps) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val hint = InputAutofill.hintOf(v.autoComplete)
    val mode = InputRules.autofillMode(v.autoComplete, hint != null, v.importantForAutofill)
    if (v.autoComplete == autofillName && mode == autofillMode) return
    autofillName = v.autoComplete
    autofillMode = mode
    if (hint != null) setAutofillHints(hint) else setAutofillHints(*emptyArray<String>())
    importantForAutofill = when (mode) {
      InputRules.AUTOFILL_NO -> View.IMPORTANT_FOR_AUTOFILL_NO
      2 -> View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
      3 -> View.IMPORTANT_FOR_AUTOFILL_YES
      4 -> View.IMPORTANT_FOR_AUTOFILL_YES_EXCLUDE_DESCENDANTS
      else -> View.IMPORTANT_FOR_AUTOFILL_AUTO
    }
  }

  /** `onContentSizeChange` and `onScroll` (record 51). React Native gives the view a watcher while the prop is there, and a new watcher has sent nothing yet. */
  private fun applyWatchers(v: ViewProps) {
    val size = InputRules.watchAfter(watchContentSize, v.onContentSizeChange)
    if (size && !watchContentSize) { sentContentW = 0; sentContentH = 0 }
    watchContentSize = size
    val scroll = InputRules.watchAfter(watchScroll, v.onScroll)
    if (scroll && !watchScroll) { sentScrollX = 0; sentScrollY = 0 }
    watchScroll = scroll
  }

  /**
   * `ReactTextContentSizeWatcher.onLayout`: the size of the text layout between the paddings (the view's own size while there is no layout), in dp, when it is not the
   * one the last event carried. The first layout sends it, as does every edit that changes the number of lines; a frame that does not change, and an edit that does not
   * change the size, send nothing.
   */
  private fun reportContentSize() {
    if (!watchContentSize) return
    val content = layout
    val w = if (content != null) compoundPaddingLeft + content.width + compoundPaddingRight else width
    val h = if (content != null) compoundPaddingTop + content.height + compoundPaddingBottom else height
    if (!InputRules.differs(sentContentW, sentContentH, w, h)) return
    sentContentW = w; sentContentH = h
    val density = resources.displayMetrics.density
    ViewEvents.inputContentSize(node.tag, w / density, h / density)
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
    // The flags React Native's ReactTextInputManager leaves in the staged input type for these props (`InputRules.inputType`): the keyboard reads the capitalisation, the suggestions
    // and the variation from them. `autoCorrect` is React Native's tri-state: true asks for auto-correction, false turns suggestions off (which also keeps the platform's spell
    // checker, a main-thread binder call at attach and on every edit, from starting), unset leaves the type alone.
    val type = InputRules.inputType(v.keyboard, v.secure, v.capitalize, autoCorrect, v.multiline)
    if (type == inputTypeKey) return
    inputTypeKey = type
    val start = selectionStart; val end = selectionEnd
    // Each swap below sets the text again (`setKeyListenerOnly`, `setTransformationMethod`), which fires `afterTextChanged` and puts the selection at (0, 0): none of it is the user's, so no change
    // event goes to JavaScript (it would bump `nativeEventCount` and make a stale value of an edit that JavaScript has not heard yet) and no selection event for the move and the restore.
    val was = settingText
    settingText = true
    try {
      inputType = type
      // The platform makes a view multi-line only for a text class with the flag (`TextView.isMultilineInputType`), and React Native's multiline is the flag on any class: a number class with the
      // flag is made multi-line here. `setSingleLine(false)` sets the transformation method to null (`TextView.applySingleLine`), which unmasks a password that `setInputType` masked, so the
      // masking is set again for a password type (a text class never gets here: the platform has done what the flag asks, and kept the masking).
      if (InputRules.platformKeepsSingleLine(type)) {
        setSingleLine(false)
        if (InputRules.isPassword(type)) transformationMethod = PasswordTransformationMethod.getInstance()
      }
      // Changing the input type resets the typeface (password fields become monospace): put ours back.
      applyTypeface(family, weight, italic)
      if (start >= 0 && end >= 0 && start <= length() && end <= length()) setSelection(start, end)
    } finally {
      settingText = was
    }
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
    // `showSoftInputOnFocus={false}` (`inputMode="none"`) keeps the keyboard closed for a focus from JavaScript too, as React Native's `requestFocusInternal` does.
    if (!showSoftInputOnFocus) return
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

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    reportContentSize()
  }

  /** `ReactTextScrollWatcher`: the text scrolled inside the frame (the caret came into view, the user dragged), reported when the offset is not the last one sent. */
  override fun onScrollChanged(horiz: Int, vert: Int, oldHoriz: Int, oldVert: Int) {
    super.onScrollChanged(horiz, vert, oldHoriz, oldVert)
    if (!watchScroll || !InputRules.differs(sentScrollX, sentScrollY, horiz, vert)) return
    sentScrollX = horiz; sentScrollY = vert
    val density = resources.displayMetrics.density
    ViewEvents.inputScroll(node.tag, horiz / density, vert / density, width / density, height / density)
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
