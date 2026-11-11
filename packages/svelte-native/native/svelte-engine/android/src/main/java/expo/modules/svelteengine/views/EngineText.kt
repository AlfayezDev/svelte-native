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
import expo.modules.svelteengine.Fragment
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

  /**
   * Where each fragment of the attributed string sits in the text (`starts` until `ends`, as `ReactTagSpan` covers it) and the node it belongs to; the paragraph's
   * own tag for a fragment whose state did not name one, and whether the node is a link.
   */
  private class Runs(val starts: IntArray, val ends: IntArray, val tags: IntArray, val links: BooleanArray)

  private fun runs(frags: List<Fragment>): Runs {
    val n = frags.size
    val r = Runs(IntArray(n), IntArray(n), IntArray(n), BooleanArray(n))
    var at = 0
    for (i in 0 until n) {
      val f = frags[i]
      r.starts[i] = at
      // The text React Native laid out has each fragment transformed (`TextTransform.apply`); the length of an uppercased text is not always the one it had.
      at += if (f.transform == 0) f.text.length else TextLayouts.transformed(f.text, f.transform).length
      r.ends[i] = at
      r.tags[i] = if (f.tag != 0) f.tag else node.tag
      r.links[i] = f.link
    }
    return r
  }

  /**
   * The node a touch at ([x], [y]), in this view's own pixels, belongs to (SPEC.md, "Touches on nested Text"): its own tag, or the tag of the Text nested in it
   * whose words are under the finger, as React Native's `ReactTextView.reactTagForTouch`. The touch is dispatched to that node, which is what lets a nested
   * Text have an `onPress` of its own.
   */
  fun tagForTouch(x: Float, y: Float): Int {
    val own = node.tag
    val frags = spec?.fragments ?: return own
    val l = layout ?: return own
    var nested = false
    for (i in frags.indices) {
      val t = frags[i].tag
      if (t != 0 && t != own) {
        nested = true
        break
      }
    }
    if (!nested) return own
    val r = runs(frags)
    return TextHitRules.tagAt(LayoutLines(l), x - node.padL, y - node.padT - verticalOffset, r.starts, r.ends, r.tags, frags.size, own)
  }

  /** What a service reads of the text: the string, with a link (`role` "link" on a nested Text, as React Native's `ReactLinkSpan`) as a `ClickableSpan` that clicks the nested node. */
  private fun withLinks(text: CharSequence): CharSequence {
    val frags = spec?.fragments
    if (frags == null || frags.none { it.link }) return text.toString()
    val r = runs(frags)
    val out = SpannableString(text.toString())
    for (i in frags.indices) {
      val end = minOf(r.ends[i], out.length)
      if (!r.links[i] || end <= r.starts[i]) continue
      out.setSpan(LinkSpan(r.tags[i]), r.starts[i], end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
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
  }

  override fun onDraw(canvas: Canvas) {
    val l = layout ?: return
    canvas.save()
    canvas.translate(node.padL, node.padT + verticalOffset)
    l.draw(canvas)
    canvas.restore()
  }
}
