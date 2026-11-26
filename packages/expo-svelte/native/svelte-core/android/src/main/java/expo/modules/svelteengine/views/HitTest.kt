package expo.modules.svelteengine.views

import android.graphics.Matrix
import android.view.View
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.ScrollView

/**
 * Touch target search, a port of React Native's TouchTargetHelper.findTouchTargetView for the engine tree.
 * Children are tried topmost first ([EngineView.hitChildIndex]); coordinates are mapped child-wise with the parent's
 * scroll offset and the inverse of the child's transform matrix; clipping parents reject points outside their bounds;
 * pointerEvents: none = view and subtree excluded, box-only = the view only, box-none = descendants only, auto =
 * descendants first, then the view. Main thread only (shared scratch state).
 */
object HitTest {
  private const val AUTO = 0
  private const val NONE = 1
  private const val BOX_NONE = 2
  private const val BOX_ONLY = 3

  private val inverse = Matrix()
  private val pt = FloatArray(2)

  /** Deepest engine view under ([x], [y]) in [root]'s coordinates, or null. */
  fun find(root: ViewGroup, x: Float, y: Float): View? = hitChildren(root, x, y)

  /** Maps a point in [root]'s coordinates into [target]'s own coordinate space (inverse of [find]'s walk). */
  fun toLocal(root: ViewGroup, target: View?, x: Float, y: Float, out: FloatArray) {
    out[0] = x
    out[1] = y
    if (target == null) return
    var depth = 0
    var v: View? = target
    while (v != null && v !== root) {
      depth++
      v = v.parent as? View
    }
    if (v == null) {
      out[0] = 0f
      out[1] = 0f
      return
    }
    val chain = arrayOfNulls<View>(depth)
    v = target
    for (i in 0 until depth) {
      chain[i] = v
      v = v!!.parent as? View
    }
    for (i in depth - 1 downTo 0) {
      val c = chain[i]!!
      val parent = c.parent as ViewGroup
      out[0] += parent.scrollX - c.left
      out[1] += parent.scrollY - c.top
      if (!c.matrix.isIdentity && c.matrix.invert(inverse)) {
        inverse.mapPoints(out)
      }
    }
  }

  private fun hitChildren(parent: ViewGroup, x: Float, y: Float): View? {
    val px = x + parent.scrollX
    val py = y + parent.scrollY
    val engine = parent as? EngineView
    for (rank in parent.childCount - 1 downTo 0) {
      val c = parent.getChildAt(engine?.hitChildIndex(rank) ?: rank)
      if (c.visibility != View.VISIBLE || (c is EngineScreen && !c.touchable)) continue
      var cx = px - c.left
      var cy = py - c.top
      if (!c.matrix.isIdentity) {
        if (!c.matrix.invert(inverse)) continue
        pt[0] = cx
        pt[1] = cy
        inverse.mapPoints(pt)
        cx = pt[0]
        cy = pt[1]
      }
      val hit = hitView(c, cx, cy)
      if (hit != null) return hit
    }
    return null
  }

  private fun hitView(v: View, x: Float, y: Float): View? {
    val st = (v as? EngineNode)?.node ?: return null
    val pe = st.pointer
    if (pe == NONE) return null
    // hitSlop (px) grows the touch rect like TouchTargetHelper's ReactHitSlopView rect.
    val slop = st.hitSlop
    val inside = if (slop == null) {
      x >= 0f && y >= 0f && x < v.width && y < v.height
    } else {
      x >= -slop[0] && y >= -slop[1] && x < v.width + slop[2] && y < v.height + slop[3]
    }
    if (v is EngineForeign && pe != BOX_ONLY) {
      // A foreign view takes its touches itself, the way the platform delivers them (SPEC.md, "Foreign views"): the
      // target is the view, which carries no engine tag, so the gesture is claimed and JavaScript's touch dispatch hears
      // nothing of it. Before the view exists, the frame is the target (and has no emitter to tell either). A view that has
      // no touch handling of its own (an Svg) is not one that takes them: the target is its frame, which has the tag, so
      // JavaScript hears the touch and the responders above the view (a Pressable) press, as in React Native; with
      // box-none the frame is no target, as for any view, and the parent is.
      val content = v.content
      if (content != null && inside && content.visibility == View.VISIBLE && !v.passesTouchesToParent()) return content
    } else if (v is ViewGroup && pe != BOX_ONLY) {
      val clips = st.overflow == 1 || v is ScrollView || v is HorizontalScrollView
      if (inside || !clips) {
        val t = hitChildren(v, x, y)
        if (t != null) return t
      }
    }
    return if (inside && pe != BOX_NONE) v else null
  }
}
