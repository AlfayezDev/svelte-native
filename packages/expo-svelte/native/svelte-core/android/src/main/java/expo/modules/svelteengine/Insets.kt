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
 * dispatches are ignored: the end state is emitted once when the animation starts and again at its end, so JavaScript
 * lays out once per change, not once per frame. It is read in `onStart`, not `onPrepare`: the window dispatches the end
 * state between the two, so the root insets still hold the start state in `onPrepare` (the content moved only once the
 * keyboard had finished opening or closing, #109).
 */
class Insets(private val root: EngineRoot, private val drive: KeyboardDrive, private val emit: (Map<String, Any?>) -> Unit) {
  private val density = root.resources.displayMetrics.density
  private val location = IntArray(2)
  private var last: Map<String, Any?>? = null
  private var animating = false
  /** The IME animations that are running: a boolean lost a frame or two when one animation's end came after the next one's start. */
  private val frames = KeyboardFrames()

  fun install() {
    drive.navigationBar = { ViewCompat.getRootWindowInsets(root)?.let { (it.getInsets(WindowInsetsCompat.Type.systemBars()).bottom - gapBottom()).coerceAtLeast(0) } ?: 0 }
    ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
      if (!animating) { publish(); val px = imeOverlap(); drive.settle(px); frames.settled(px) }
      insets
    }
    ViewCompat.setWindowInsetsAnimationCallback(root, object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
      override fun onPrepare(animation: WindowInsetsAnimationCompat) {
        if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) { animating = true; frames.prepare() }
      }
      override fun onStart(animation: WindowInsetsAnimationCompat, bounds: WindowInsetsAnimationCompat.BoundsCompat): WindowInsetsAnimationCompat.BoundsCompat {
        if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
          publish()
          val target = imeOverlap()
          frames.start(target)
          drive.start(target)
        }
        return bounds
      }
      override fun onProgress(insets: WindowInsetsCompat, runningAnimations: MutableList<WindowInsetsAnimationCompat>): WindowInsetsCompat {
        if (animating && runningAnimations.any { it.typeMask and WindowInsetsCompat.Type.ime() != 0 }) {
          frames.frame((insets.getInsets(WindowInsetsCompat.Type.ime()).bottom - gapBottom()).coerceAtLeast(0))?.let { drive.progress(it) }
        }
        return insets
      }
      override fun onEnd(animation: WindowInsetsAnimationCompat) {
        if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
        // An animation that ends while another runs (the keyboard turned around) is not the keyboard settling.
        if (!frames.end()) return
        animating = false
        publish()
        val px = imeOverlap()
        frames.settled(px)
        drive.end(px)
      }
    })
    root.addOnLayoutChangeListener { _, l, t, r, b, ol, ot, or, ob -> if (r - l != or - ol || b - t != ob - ot || l != ol || t != ot) publish() }
    root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(v: View) { watchLayouts(); drive.install(v); v.requestApplyInsets(); publish() }
      // A window that goes during an IME animation does not deliver its end: the next window starts with none running.
      override fun onViewDetachedFromWindow(v: View) { unwatchLayouts(); animating = false; frames.reset() }
    })
    if (root.isAttachedToWindow) {
      drive.install(root)
      watchLayouts()
      root.requestApplyInsets()
    }
  }

  /**
   * The overlay moved into a recreated Activity keeps the frame it had in the old window, and is attached before the new window has
   * been laid out: the insets read then are measured against a 0 x 0 window (the whole frame looked covered: the right inset was the
   * width and the bottom one more than the height, and a safe area view padded its content away). Until it is laid out
   * [compute] takes the overlay to fill it, and every layout pass of the window publishes what
   * changed, so the first pass of the new window sends the measured values even though the overlay's own frame did not change.
   */
  private val globalLayout = android.view.ViewTreeObserver.OnGlobalLayoutListener { if (!animating) { publish(); drive.layoutChanged() } }
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
    drive.uninstall()
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
    val width = root.width
    val height = root.height
    root.getLocationInWindow(location)
    val windowWidth = root.rootView.width
    val windowHeight = root.rootView.height
    // Before the window and the overlay are laid out (a cold start's first read, or the overlay moved into a recreated Activity: see
    // [watchLayouts]) there is nothing to measure the overlay against. It is taken to fill the window, as it does once laid out (the
    // library runs edge-to-edge; in the legacy layout the bars read until the first pass are the decor's), so the first record has the
    // system bars and a screen's first layout has its header's inset. Its frame reads 0 x 0, "not measured yet" (JavaScript waits for a
    // height before it uses one), and it has no keyboard. The window's first layout pass publishes the measured values. Measuring against
    // a window or an overlay with no size gave nonsense (the blank screens after Back and reopen); reporting nothing until then laid the
    // first screen out without the bars and again a few frames later, with its half-pixel edges rounded the other way.
    val laidOut = windowWidth > 0 && windowHeight > 0 && width > 0 && height > 0
    val gapLeft = if (laidOut) location[0] else 0
    val gapTop = if (laidOut) location[1] else 0
    val gapRight = if (laidOut) windowWidth - (location[0] + width) else 0
    val gapBottom = if (laidOut) windowHeight - (location[1] + height) else 0
    val bars: GraphicsInsets = all.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val ime = all.getInsets(WindowInsetsCompat.Type.ime())
    val visible = laidOut && all.isVisible(WindowInsetsCompat.Type.ime())
    val keyboardPx = if (visible) (ime.bottom - gapBottom).coerceAtLeast(0) else 0
    val frame = if (laidOut) mapOf("x" to dp(gapLeft), "y" to dp(gapTop), "width" to dp(width), "height" to dp(height))
      else mapOf("x" to 0.0, "y" to 0.0, "width" to 0.0, "height" to 0.0)
    return mapOf(
      "top" to dp((bars.top - gapTop).coerceAtLeast(0)),
      "right" to dp((bars.right - gapRight).coerceAtLeast(0)),
      "bottom" to dp((bars.bottom - gapBottom).coerceAtLeast(0)),
      "left" to dp((bars.left - gapLeft).coerceAtLeast(0)),
      "keyboardHeight" to dp(keyboardPx),
      "keyboardVisible" to (keyboardPx > 0),
      "keyboardAnimating" to animating,
      "frame" to frame,
    )
  }

  /** The overlay's gap to the window's bottom edge (px), 0 until the window and the overlay are laid out: the part of the IME's inset the overlay does not cover. */
  private fun gapBottom(): Int {
    val windowHeight = root.rootView.height
    if (windowHeight <= 0 || root.height <= 0 || root.rootView.width <= 0 || root.width <= 0) return 0
    root.getLocationInWindow(location)
    return windowHeight - (location[1] + root.height)
  }

  /** How much of the overlay the IME covers (px) in the root insets: what [compute] reports as the keyboard's height, and the end state of an animation from its start on. */
  private fun imeOverlap(): Int {
    val all = ViewCompat.getRootWindowInsets(root) ?: return 0
    if (!root.isAttachedToWindow || !all.isVisible(WindowInsetsCompat.Type.ime())) return 0
    return (all.getInsets(WindowInsetsCompat.Type.ime()).bottom - gapBottom()).coerceAtLeast(0)
  }

  private fun dp(px: Int): Double = Math.round(px / density * 100.0) / 100.0
}
