package expo.modules.svelteengine.views

import android.content.Context
import android.graphics.Canvas
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.TextPaint
import android.text.style.ClickableSpan
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import expo.modules.svelteengine.A11y
import expo.modules.svelteengine.TextHitRules
import expo.modules.svelteengine.TextLayouts
import expo.modules.svelteengine.TextSpec
import expo.modules.svelteengine.TextTold

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
  private val told = TextTold()

  /** Rebuilds the layout for the current spec and frame width. */
  fun rebuild() {
    val s = spec
    val width = (node.w - node.padL - node.padR).toInt()
    val height = (node.h - node.padT - node.padB).toInt()
    val built = if (s == null) null else TextLayouts.build(s, width, height)
    layout = built?.layout
    linked = null
    verticalOffset = built?.verticalOffset ?: 0f
    builtWidth = width
    builtHeight = height
    invalidate()
    // `TextView.setText` tells the platform, which sends the change up to a live region; this view is a plain `View`. The text is remembered on every rebuild and only the
    // announcement is gated on a service listening (asked once per frame, and only for a text that changed).
    if (told.changed(plainText()) && A11y.listening(context)) A11y.textChanged(this)
  }

  /** Drops the content so the view can serve another tag ([ViewPool]). */
  fun clearForReuse() {
    spec = null
    layout = null
    linked = null
    verticalOffset = 0f
    builtWidth = -1
    builtHeight = -1
    told.clear()
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

  /**
   * A text that listens for `click` is clickable for accessibility services ([A11y.setClickable]), and `View.onTouchEvent` performs the click when the finger lifts:
   * JavaScript would hear `click` after the press its touch has already made ([EngineRoot] hands it every touch), and a press on a nested Text would press the paragraph
   * around it as well. The touch is consumed as a clickable view consumes it (a scroll ancestor can still take the gesture over) and nothing more; a click comes from a service.
   */
  override fun onTouchEvent(event: MotionEvent): Boolean = isClickable

  override fun getAccessibilityClassName(): CharSequence = "android.widget.TextView"

  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    val t = plainText()
    if (!t.isNullOrEmpty()) info.text = withLinks(t)
  }

  /** The runs of the fragments of the text (see [TextHitRules.runs]); null when the text has no fragments. */
  private fun runs(): TextHitRules.Runs? {
    val frags = spec?.fragments ?: return null
    return TextHitRules.runs(frags.size, { frags[it].text }, { frags[it].transform }, { frags[it].tag }, { frags[it].link }, node.tag)
  }

  /**
   * The node a touch at ([x], [y]), in this view's own pixels, belongs to (SPEC.md, "Touches on nested Text"): its own tag, or the tag of the Text nested in it
   * whose words are under the finger, as React Native's `ReactTextView.reactTagForTouch`. The touch is dispatched to that node, which is what lets a nested
   * Text have an `onPress` of its own.
   */
  fun tagForTouch(x: Float, y: Float): Int {
    val own = node.tag
    val l = layout ?: return own
    val r = runs() ?: return own
    if (!TextHitRules.nested(r, own)) return own
    return TextHitRules.tagForTouch(LayoutLines(l), x, y, node.padL, node.padT, verticalOffset, r, own)
  }

  /** The text a service was given with its links, and the string it was made of: a service asks again for the node it activates a link of, which has to find the same spans. */
  private var linked: SpannableString? = null

  /**
   * What a service reads of the text: the string, with a link (`role` "link" on a nested Text, as React Native's `ReactLinkSpan`) as a `ClickableSpan` that clicks the nested node.
   * The spans are made once for the text and handed out again: the platform names a link by its span's id, and activating one asks the view for its node again
   * and looks the span up by that id, so a node built with spans of its own every time finds none and the activation does nothing.
   */
  private fun withLinks(text: CharSequence): CharSequence {
    val string = text.toString()
    linked?.let { if (it.toString() == string) return it }
    val r = runs()
    val links = if (r == null) emptyList() else TextHitRules.linkRanges(r, string.length)
    if (links.isEmpty()) return string
    val out = SpannableString(string)
    for (link in links) out.setSpan(LinkSpan(link.tag), link.start, link.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    linked = out
    return out
  }

  /** The activation of a link a service lists: the click goes to the nested node, as React Native's `ReactLinkSpan`. It draws nothing of its own. */
  private class LinkSpan(val tag: Int) : ClickableSpan() {
    override fun onClick(widget: View) {
      A11y.clicks?.invoke(tag)
    }

    override fun updateDrawState(ds: TextPaint) {}
  }

  /** [TextHitRules.Lines] over a built layout. */
  private class LayoutLines(private val layout: Layout) : TextHitRules.Lines {
    override val height get() = layout.height
    override val textLength get() = layout.text.length
    override fun lineForVertical(y: Int) = layout.getLineForVertical(y)
    override fun lineLeft(line: Int) = layout.getLineLeft(line)
    override fun lineRight(line: Int) = layout.getLineRight(line)
    override fun offsetForHorizontal(line: Int, x: Float) = layout.getOffsetForHorizontal(line, x)
    override fun lineStart(line: Int) = layout.getLineStart(line)
    override fun ellipsisStart(line: Int) = layout.getEllipsisStart(line)
    override fun ellipsisCount(line: Int) = layout.getEllipsisCount(line)
  }

  override fun onDraw(canvas: Canvas) {
    val l = layout ?: return
    canvas.save()
    canvas.translate(node.padL, node.padT + verticalOffset)
    l.draw(canvas)
    canvas.restore()
  }
}
