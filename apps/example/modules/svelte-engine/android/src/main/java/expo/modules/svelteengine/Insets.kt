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
      override fun onViewAttachedToWindow(v: View) { v.requestApplyInsets(); publish() }
      override fun onViewDetachedFromWindow(v: View) {}
    })
    if (root.isAttachedToWindow) root.requestApplyInsets()
  }

  fun uninstall() {
    ViewCompat.setOnApplyWindowInsetsListener(root, null)
    ViewCompat.setWindowInsetsAnimationCallback(root, null)
  }

  /** The current record (main thread), or null before the overlay is attached to a window. */
  fun read(): Map<String, Any?>? = compute()

  private fun publish() {
    val next = compute() ?: return
    if (next == last) return
    last = next
    emit(next)
  }

  private fun compute(): Map<String, Any?>? {
    if (!root.isAttachedToWindow) return null
    val all = ViewCompat.getRootWindowInsets(root) ?: return null
    val width = root.width
    val height = root.height
    root.getLocationInWindow(location)
    val windowWidth = root.rootView.width
    val windowHeight = root.rootView.height
    val gapLeft = location[0]
    val gapTop = location[1]
    val gapRight = windowWidth - (location[0] + width)
    val gapBottom = windowHeight - (location[1] + height)
    val bars: GraphicsInsets = all.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val ime = all.getInsets(WindowInsetsCompat.Type.ime())
    val visible = all.isVisible(WindowInsetsCompat.Type.ime())
    val keyboardPx = if (visible) (ime.bottom - gapBottom).coerceAtLeast(0) else 0
    return mapOf(
      "top" to dp((bars.top - gapTop).coerceAtLeast(0)),
      "right" to dp((bars.right - gapRight).coerceAtLeast(0)),
      "bottom" to dp((bars.bottom - gapBottom).coerceAtLeast(0)),
      "left" to dp((bars.left - gapLeft).coerceAtLeast(0)),
      "keyboardHeight" to dp(keyboardPx),
      "keyboardVisible" to (keyboardPx > 0),
      "frame" to mapOf("x" to dp(gapLeft), "y" to dp(gapTop), "width" to dp(width), "height" to dp(height)),
    )
  }

  private fun dp(px: Int): Double = Math.round(px / density * 100.0) / 100.0
}
