package expo.modules.svelteengine.views

import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import expo.modules.svelteengine.A11y

/** Per-view state the mounting layer keeps outside of View ids and tags. */
class NodeState {
  var tag = 0
  var l = 0
  var t = 0
  var r = 0
  var b = 0
  var hasFrame = false
  var padL = 0f
  var padT = 0f
  var padR = 0f
  var padB = 0f

  var pointer = 0
  /** `hitSlop` in px (left, top, right, bottom), null when zero. */
  var hitSlop: FloatArray? = null
  var overflow = 0
  var elevation = 0f
  var zIndex = 0f
  var testID: String? = null
  var role: String? = null
  var a11yDelegate = false
  var transformed = false
  var outlineClip = false
  /** Record 15 as applied (Props.applyCommon). */
  var viewFlags = 0

  var drawable: GradientDrawable? = null
  var bg = 0
  val radii = FloatArray(4)
  val border = FloatArray(4)
  var borderColor = 0

  val w get() = r - l
  val h get() = b - t

  /**
   * Back to the state of a new view for [ViewPool]. The background drawable and the a11y delegate stay installed
   * (the delegate reads `testID` and `role` from here, the drawable is rewritten by the next full prop record);
   * `outlineClip` stays because it mirrors the view's own outline provider.
   */
  fun reset() {
    tag = 0
    l = 0; t = 0; r = 0; b = 0
    hasFrame = false
    padL = 0f; padT = 0f; padR = 0f; padB = 0f
    pointer = 0
    hitSlop = null
    overflow = 0
    elevation = 0f
    zIndex = 0f
    testID = null
    role = null
    transformed = false
    bg = 0
    radii.fill(0f)
    border.fill(0f)
    borderColor = 0
  }
}

interface EngineNode {
  val node: NodeState
}

/** Frame placement shared by the container views: children sit at the frames Yoga gave them. */
object Frames {
  private val exact = View.MeasureSpec.EXACTLY

  fun place(child: View) {
    val st = (child as EngineNode).node
    if (!st.hasFrame) return
    child.measure(View.MeasureSpec.makeMeasureSpec(st.w, exact), View.MeasureSpec.makeMeasureSpec(st.h, exact))
    child.layout(st.l, st.t, st.r, st.b)
    if (st.transformed) {
      child.pivotX = st.w / 2f
      child.pivotY = st.h / 2f
    }
  }

  fun measureChildren(parent: ViewGroup) {
    for (i in 0 until parent.childCount) {
      val c = parent.getChildAt(i)
      val st = (c as? EngineNode)?.node ?: continue
      if (!st.hasFrame) continue
      c.measure(View.MeasureSpec.makeMeasureSpec(st.w, exact), View.MeasureSpec.makeMeasureSpec(st.h, exact))
    }
  }

  fun layoutChildren(parent: ViewGroup) {
    for (i in 0 until parent.childCount) {
      val c = parent.getChildAt(i)
      val st = (c as? EngineNode)?.node ?: continue
      if (!st.hasFrame) continue
      if (c.isLayoutRequested || c.left != st.l || c.top != st.t || c.right != st.r || c.bottom != st.b) place(c)
    }
  }
}

/**
 * Plain container: no measure of its own, children are laid out by their stored frames.
 *
 * Stacking: siblings draw in `zIndex` order (stable, ties keep insertion order) through `getChildDrawingOrder`;
 * `View.elevation` (px, from the `elevation` prop only) additionally lets Android's own Z sort lift a child. Hit
 * testing walks the same order top-down: (elevation, zIndex, index), see [HitTest].
 */
open class EngineView(context: Context) : ViewGroup(context), EngineNode {
  override val node = NodeState()

  /**
   * React Native's rule (`ReactViewGroup.hasOverlappingRendering`): a view's alpha is multiplied into each primitive it
   * draws unless `needsOffscreenAlphaCompositing` asks for an offscreen pass. Android's default (true) makes the
   * renderer promote every view with 0 < alpha < 1 to a hardware layer of its own (`RenderProperties::promotedToLayer`),
   * rebuilt whenever the alpha crosses 1: with 48 fading tiles that was 32–48 layer renders per churn round and the
   * `flush layers` spikes of churn-animated (3.6 % dropped frames on the Samsung A16).
   */
  var offscreenAlpha = false

  override fun hasOverlappingRendering(): Boolean = offscreenAlpha

  /** The center slot of a toolbar (`EngineHeaderSlot` of slot 4) and what it holds are part of the toolbar band: `svelte-toolbar:center` (`A11y.TOOLBAR_ID`). A `testID` is appended by `A11y`'s delegate. */
  override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
    super.onInitializeAccessibilityNodeInfo(info)
    var view: View? = this
    while (view is EngineView && view !is EngineToolbar) {
      if (view is EngineHeaderSlot && view.toolbar != null) {
        info.viewIdResourceName = "${A11y.TOOLBAR_ID}:center"
        return
      }
      view = view.parent as? View
    }
  }

  /** Children with a non-default zIndex or elevation; 0 means plain insertion order everywhere. */
  private var stacked = 0
  private var orderDirty = true
  private var drawOrder = IntArray(0)
  private var hitOrder = IntArray(0)

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
    Frames.measureChildren(this)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    Frames.layoutChildren(this)
  }

  // Like React Native's ReactViewGroup, a touch that lands on a view is consumed so that a scroll ancestor takes the
  // gesture over through onInterceptTouchEvent (and EngineRoot sends cancel). pointerEvents none / box-none views are
  // never touch targets themselves.
  override fun onTouchEvent(event: MotionEvent): Boolean = node.pointer == 0 || node.pointer == 3

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    orderDirty = true
    if (isStacked(child)) stackingChanged(false, true, countOnly = true)
  }

  override fun onViewRemoved(child: View) {
    super.onViewRemoved(child)
    orderDirty = true
    if (isStacked(child)) stackingChanged(true, false, countOnly = true)
  }

  /** A child's zIndex/elevation changed (called by Props for attached children). */
  fun stackingChanged(was: Boolean, now: Boolean, countOnly: Boolean = false) {
    orderDirty = true
    if (was != now) stacked += if (now) 1 else -1
    if (!countOnly) invalidate()
    val enable = stacked > 0
    if (isChildrenDrawingOrderEnabled != enable) isChildrenDrawingOrderEnabled = enable
  }

  private fun isStacked(c: View): Boolean {
    val st = (c as? EngineNode)?.node ?: return false
    return st.zIndex != 0f || st.elevation != 0f
  }

  private fun sortOrders() {
    val n = childCount
    val byZ = arrayOfNulls<Int>(n)
    val byHit = arrayOfNulls<Int>(n)
    for (i in 0 until n) { byZ[i] = i; byHit[i] = i }
    fun z(i: Int) = (getChildAt(i) as? EngineNode)?.node?.zIndex ?: 0f
    fun e(i: Int) = (getChildAt(i) as? EngineNode)?.node?.elevation ?: 0f
    byZ.sortWith { a, b -> z(a!!).compareTo(z(b!!)) }
    byHit.sortWith { a, b ->
      val c = e(a!!).compareTo(e(b!!))
      if (c != 0) c else z(a).compareTo(z(b))
    }
    drawOrder = IntArray(n) { byZ[it]!! }
    hitOrder = IntArray(n) { byHit[it]!! }
    orderDirty = false
  }

  override fun getChildDrawingOrder(childCount: Int, drawingPosition: Int): Int {
    if (stacked == 0) return drawingPosition
    if (orderDirty || drawOrder.size != childCount) sortOrders()
    return drawOrder[drawingPosition]
  }

  /** Child index at hit rank [rank] (0 = bottom, childCount - 1 = topmost). */
  fun hitChildIndex(rank: Int): Int {
    if (stacked == 0) return rank
    if (orderDirty || hitOrder.size != childCount) sortOrders()
    return hitOrder[rank]
  }
}
