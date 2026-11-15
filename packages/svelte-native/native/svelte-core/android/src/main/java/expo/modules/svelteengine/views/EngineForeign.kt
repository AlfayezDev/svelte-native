package expo.modules.svelteengine.views

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup

/**
 * The engine's frame for a view another library owns (SPEC.md, "Foreign views"): a WebView, a map, a video player. React
 * Native's own Java mounting creates that view, sets its props, lays it out and sends it commands; this node is the part
 * the engine owns, so everything about its place in the engine tree stays the engine's: its frame, transform, opacity,
 * stacking, clipping, `pointerEvents`, and removal with its parent.
 *
 * The view is the frame's only child and fills it, at the origin. React Native lays the view out at that origin in the
 * size of the frame (the C++ delegate hands it the frame's own pixel size, see `inEngineFrame`), so both layout paths
 * agree, and this class lays the view out again on every engine pass, which is what the platform needs when the view asks
 * for a layout of its own (a WebView finishing a load).
 *
 * The view arrives some time after the frame (React Native mounts on its own schedule, see [ForeignViews]), so the frame
 * starts empty. It is never pooled: [ViewPool] only takes the plain container and the text and scroll views.
 */
class EngineForeign(context: Context) : EngineView(context) {
  /** The view React Native created for this node; null until [adopt] and again after [release]. */
  var content: View? = null
    private set

  /** Puts [view], React Native's view for this node, inside the frame. */
  fun adopt(view: View) {
    if (view === content) return
    release()
    (view.parent as? ViewGroup)?.removeView(view)
    content = view
    addView(view)
    requestLayout()
  }

  /** Takes the view out of the frame. The view stays React Native's: it drops it when the node is deleted. */
  fun release() {
    val view = content ?: return
    content = null
    removeView(view)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
    content?.measure(MeasureSpec.makeMeasureSpec(node.w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(node.h, MeasureSpec.EXACTLY))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    content?.layout(0, 0, node.w, node.h)
  }

  // `pointerEvents`: none leaves the view out of touch handling (a native view would otherwise take a touch the engine's
  // hit test excluded), box-only keeps the touches for the frame, so a handler in JavaScript can have them.
  override fun dispatchTouchEvent(ev: MotionEvent): Boolean = node.pointer != POINTER_NONE && super.dispatchTouchEvent(ev)

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean = node.pointer == POINTER_BOX_ONLY

  private companion object {
    const val POINTER_NONE = 1
    const val POINTER_BOX_ONLY = 3
  }
}
