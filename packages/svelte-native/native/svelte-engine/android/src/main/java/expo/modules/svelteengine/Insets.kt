package expo.modules.svelteengine

import android.view.View
import androidx.core.graphics.Insets as GraphicsInsets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.svelteengine.views.EngineRoot

/**
 * Window insets of the engine overlay, reported to JavaScript as one record (see SPEC.md, "Insets and keyboard").
 *
 * Insets are read from `ViewCompat.getRootWindowInsets`, not from the listener's argument: in the legacy (non edge-to-edge)
 * layout the decor consumes the system bars before they reach the content view, but the root insets stay complete. Each
 * edge is then reduced by how far the overlay's own frame already sits inside it, so the numbers mean "how much of the
 * overlay the system covers" in both modes (all zero without edge-to-edge, real bars with it).
 *
 * The keyboard value is the overlap of the IME with the overlay, in dp. During an IME animation the per-frame
 * dispatches are ignored: the end state is emitted once when the animation is prepared (root insets already hold it)
 * and again at its end, so JavaScript lays out once per change, not once per frame.
 */
class Insets(private val root: EngineRoot, private val emit: (Map<String, Any?>) -> Unit) {
  private val density = root.resources.displayMetrics.density
  private val location = IntArray(2)
  private var last: Map<String, Any?>? = null
  private var animating = false

  fun install() {
    ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
      if (!animating) publish()
      insets
    }
    ViewCompat.setWindowInsetsAnimationCallback(root, object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
      override fun onPrepare(animation: WindowInsetsAnimationCompat) {
        if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
        animating = true
        publish()
      }
      override fun onProgress(insets: WindowInsetsCompat, runningAnimations: MutableList<WindowInsetsAnimationCompat>) = insets
      override fun onEnd(animation: WindowInsetsAnimationCompat) {
        if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
        animating = false
        publish()
      }
    })
    root.addOnLayoutChangeListener { _, l, t, r, b, ol, ot, or, ob -> if (r - l != or - ol || b - t != ob - ot || l != ol || t != ot) publish() }
    root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(v: View) { watchLayouts(); v.requestApplyInsets(); publish() }
      // A window that goes during an IME animation does not deliver its end: the next window starts with none running.
      override fun onViewDetachedFromWindow(v: View) { unwatchLayouts(); animating = false }
    })
    if (root.isAttachedToWindow) {
      watchLayouts()
      root.requestApplyInsets()
    }
  }

  /**
   * The overlay moved into a recreated Activity keeps the frame it had in the old window, and is attached before the new window has
   * been laid out: the insets read then are measured against a 0 x 0 window (the whole frame looked covered: the right inset was the
   * width and the bottom one more than the height, and a safe area view padded its content away). Until it is laid out
   * [compute] measures against the box the overlay is about to get ([overlayBox]), and every layout pass of the window publishes what
   * changed, so the first pass of the new window sends the measured values even though the overlay's own frame did not change.
   */
  private val globalLayout = android.view.ViewTreeObserver.OnGlobalLayoutListener { if (!animating) publish() }
  private var watched: android.view.ViewTreeObserver? = null

  private fun watchLayouts() {
    unwatchLayouts()
    watched = root.viewTreeObserver.also { it.addOnGlobalLayoutListener(globalLayout) }
  }

  private fun unwatchLayouts() {
    watched?.takeIf { it.isAlive }?.removeOnGlobalLayoutListener(globalLayout)
    watched = null
  }

  fun uninstall() {
    unwatchLayouts()
    ViewCompat.setOnApplyWindowInsetsListener(root, null)
    ViewCompat.setWindowInsetsAnimationCallback(root, null)
  }

  /**
   * The current record (main thread), or null before the overlay is attached to a window (or while the window has no insets). What it
   * returns is what JavaScript holds now: after a null the next value is published even when it equals the one published before (a
   * reader that subscribes then would otherwise wait for the next change).
   */
  fun read(): Map<String, Any?>? = compute().also { last = it }

  private fun publish() {
    // A window with no size yet (the overlay just moved into a recreated Activity, whose insets may not be dispatched yet) has nothing
    // better than what JavaScript holds from the old one: the window's first layout pass publishes. A first record still goes out.
    if (last != null && (root.rootView.width <= 0 || root.rootView.height <= 0)) return
    val next = compute() ?: return
    if (next == last) return
    last = next
    emit(next)
  }

  private fun compute(): Map<String, Any?>? {
    if (!root.isAttachedToWindow) return null
    val all = ViewCompat.getRootWindowInsets(root) ?: return null
    val windowWidth = root.rootView.width
    val windowHeight = root.rootView.height
    val (x, y, width, height) = overlayBox(windowWidth, windowHeight)
    val gapLeft = x
    val gapTop = y
    val gapRight = windowWidth - (x + width)
    val gapBottom = windowHeight - (y + height)
    val bars: GraphicsInsets = all.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val ime = all.getInsets(WindowInsetsCompat.Type.ime())
    // A box of no height (a window not laid out at all) has no edge for the keyboard to cover: no keyboard until the first layout pass.
    val visible = all.isVisible(WindowInsetsCompat.Type.ime()) && height > 0
    val keyboardPx = if (visible) (ime.bottom - gapBottom).coerceAtLeast(0) else 0
    return mapOf(
      "top" to dp((bars.top - gapTop).coerceAtLeast(0)),
      "right" to dp((bars.right - gapRight).coerceAtLeast(0)),
      "bottom" to dp((bars.bottom - gapBottom).coerceAtLeast(0)),
      "left" to dp((bars.left - gapLeft).coerceAtLeast(0)),
      "keyboardHeight" to dp(keyboardPx),
      "keyboardVisible" to (keyboardPx > 0),
      "frame" to mapOf("x" to dp(x), "y" to dp(y), "width" to dp(width), "height" to dp(height)),
    )
  }

  /**
   * The overlay's box in the window, `[x, y, width, height]` in px. Once the overlay is laid out, its own. Before that (a cold start's
   * first read, or the overlay moved into a recreated Activity: see [watchLayouts]) the box it is about to get: it fills the content
   * view (`MATCH_PARENT`), so the content view's padded box when that is laid out, or else the whole window (0 x 0 while the window has
   * no size either). The window's layout passes then publish the measured values if they differ. Measuring against a window or an
   * overlay that had no size gave nonsense (the blank screens after Back and reopen); reporting nothing until then laid the first
   * screen out without the system bars and again a few frames later, with its half-pixel edges rounded the other way.
   */
  private fun overlayBox(windowWidth: Int, windowHeight: Int): IntArray {
    val windowSized = windowWidth > 0 && windowHeight > 0
    if (windowSized && root.width > 0 && root.height > 0) {
      root.getLocationInWindow(location)
      return intArrayOf(location[0], location[1], root.width, root.height)
    }
    val parent = root.parent as? View
    if (windowSized && parent != null && parent.width > 0 && parent.height > 0) {
      parent.getLocationInWindow(location)
      val width = parent.width - parent.paddingLeft - parent.paddingRight
      val height = parent.height - parent.paddingTop - parent.paddingBottom
      if (width > 0 && height > 0) return intArrayOf(location[0] + parent.paddingLeft, location[1] + parent.paddingTop, width, height)
    }
    return intArrayOf(0, 0, windowWidth.coerceAtLeast(0), windowHeight.coerceAtLeast(0))
  }

  private fun dp(px: Int): Double = Math.round(px / density * 100.0) / 100.0
}
