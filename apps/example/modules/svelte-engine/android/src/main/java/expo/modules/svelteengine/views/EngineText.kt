package expo.modules.svelteengine.views

import android.content.Context
import android.graphics.Canvas
import android.text.Layout
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import expo.modules.svelteengine.A11y
import expo.modules.svelteengine.TextLayouts
import expo.modules.svelteengine.TextSpec

/** Draws an android.text.Layout at the padding offset. Never a TextView. */
class EngineText(context: Context) : View(context), EngineNode {
  override val node = NodeState()
  var spec: TextSpec? = null
  var layout: Layout? = null
  /** `textAlignVertical` offset in px, added below the top padding (prepared layouts bring their own). */
  var verticalOffset = 0f
  /** Width the current layout was built for, -1 when it must be rebuilt. */
  var builtWidth = -1
  var builtHeight = -1

  /** The layout depends on the box height (`textAlignVertical`, `adjustsFontSizeToFit`). */
  val heightMatters get() = spec?.let { it.prepared == null && (it.vAlign != 0 || it.fit) } == true

  init {
    setWillNotDraw(false)
    // Like TextView: text is read by TalkBack and listed by uiautomator even without a content description.
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
  }

  /** The text a service was last told of, so that only a change of it is announced to a live region (see [A11y.textChanged]). */
  private var told: String? = null

  /** Rebuilds the layout for the current spec and frame width. */
  fun rebuild() {
    val s = spec
    val width = (node.w - node.padL - node.padR).toInt()
    val height = (node.h - node.padT - node.padB).toInt()
    val built = if (s == null) null else TextLayouts.build(s, width, height)
    layout = built?.layout
    verticalOffset = built?.verticalOffset ?: 0f
    builtWidth = width
    builtHeight = height
    invalidate()
    // `TextView.setText` tells the platform, which sends the change up to a live region; this view is a plain `View`.
    if (A11y.listening(context)) {
      val now = plainText()?.toString()
      if (now != told) {
        val first = told == null
        told = now
        if (!first) A11y.textChanged(this)
      }
    }
  }

  /** Drops the content so the view can serve another tag ([ViewPool]). */
  fun clearForReuse() {
    spec = null
    layout = null
    verticalOffset = 0f
    builtWidth = -1
    builtHeight = -1
    told = null
  }

  /** As React Native's `ReactTextView`: glyphs do not overlap, so alpha is applied per draw, never through a layer. */
  override fun hasOverlappingRendering(): Boolean = false

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
  }

  /** The visible text, from the built layout or (before the first layout pass) the spec's fragments. */
  private fun plainText(): CharSequence? {
    layout?.text?.let { return it }
    val frags = spec?.fragments ?: return null
    if (frags.size == 1) return frags[0].text
    return frags.joinToString("") { it.text }
  }

  override fun getAccessibilityClassName(): CharSequence = "android.widget.TextView"

  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    val t = plainText()
    if (!t.isNullOrEmpty()) info.text = t.toString()
  }

  override fun onDraw(canvas: Canvas) {
    val l = layout ?: return
    canvas.save()
    canvas.translate(node.padL, node.padT + verticalOffset)
    l.draw(canvas)
    canvas.restore()
  }
}
