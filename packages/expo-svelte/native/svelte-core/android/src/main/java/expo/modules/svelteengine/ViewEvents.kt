package expo.modules.svelteengine

import com.facebook.proguard.annotations.DoNotStrip

/** Events of the view kinds 5..9, forwarded to the Fabric event emitters in C++ (InputEvents.cpp). */
@DoNotStrip
object ViewEvents {
  const val INPUT_CHANGE = 0
  const val INPUT_FOCUS = 1
  const val INPUT_BLUR = 2
  const val INPUT_END_EDITING = 3
  const val INPUT_SUBMIT = 4
  const val INPUT_KEY_PRESS = 5
  const val INPUT_SELECTION = 6

  const val IMAGE_LOAD_START = 0
  const val IMAGE_LOAD = 1
  const val IMAGE_ERROR = 2
  const val IMAGE_LOAD_END = 3

  const val MODAL_REQUEST_CLOSE = 0
  const val MODAL_SHOW = 1
  const val MODAL_DISMISS = 2

  /** [text]: the text (change, endEditing, submitEditing) or the key (keyPress). */
  @JvmStatic external fun input(tag: Int, kind: Int, text: String?, eventCount: Int, selStart: Int, selEnd: Int)

  /** An input's content size in dp (`onContentSizeChange`): `{contentSize: {width, height}}`, as React Native's `ReactContentSizeChangedEvent`. */
  @JvmStatic external fun inputContentSize(tag: Int, widthDp: Float, heightDp: Float)

  /** An input scrolled (`onScroll`): the offset and the view's size, in dp, as React Native's `ReactTextScrollWatcher` sends them in a `ScrollEvent`. */
  @JvmStatic external fun inputScroll(tag: Int, xDp: Float, yDp: Float, widthDp: Float, heightDp: Float)

  @JvmStatic external fun switchChange(tag: Int, value: Boolean)

  /** [width]/[height] in pixels of the decoded source (load only). */
  @JvmStatic external fun image(tag: Int, kind: Int, width: Float, height: Float, uri: String?, error: String?)

  @JvmStatic external fun modal(tag: Int, kind: Int)

  /** An accessibility action the user chose from the actions menu (`onAccessibilityAction`): `{actionName}`, as React Native's. */
  @JvmStatic external fun accessibilityAction(tag: Int, name: String)

  /** The modal's content size in dp, written into ModalHostViewState so Yoga lays the children out. */
  @JvmStatic external fun modalSize(tag: Int, widthDp: Float, heightDp: Float)

  init {
    System.loadLibrary("svelteengine")
  }
}
