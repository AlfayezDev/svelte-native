package expo.modules.svelteengine.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.drawable.GradientDrawable
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.uimanager.PointerEvents
import com.facebook.react.uimanager.ReactPointerEventsView
import expo.modules.svelteengine.A11y
import expo.modules.svelteengine.BoxStyle
import expo.modules.svelteengine.A11yRecords
import expo.modules.svelteengine.GestureRules
import expo.modules.svelteengine.Props
import expo.modules.svelteengine.StyleRecords
import expo.modules.svelteengine.BoxDrawable
import expo.modules.svelteengine.ClipRules
import expo.modules.svelteengine.PaddingBoxClip

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
  /** `accessibilityLabel` as the prop gave it (the view's content description may carry more: "busy", the value's text). */
  var label: String? = null
  /** The content description built for [label] and the state and value in [a11y] (`A11y.apply` builds it again only when they change). */
  var description: String? = null
  /** The accessibility records applied (state, value, hint, actions, mode, role), null when none is set: what the delegate publishes. */
  var a11y: A11yRecords? = null
  /** Expanded (2) or collapsed (1) by an accessibility action since the last props: React Native flips the node's expand action until JavaScript answers. */
  var expandedLocal = 0
  var a11yDelegate = false
  var transformed = false
  /** How far the keyboard's followers have moved the view (px, `KeyboardDrive`): added to the translation `Props.setTransform` writes, so a commit does not take it away. */
  var drivenY = 0f
  var outlineClip = false
  /** Record 15 as applied (Props.applyCommon). */
  var viewFlags = 0

  var drawable: GradientDrawable? = null
  var bg = 0
  val radii = FloatArray(4)
  val border = FloatArray(4)
  var borderColor = 0

  /** The box style records applied (box shadow, border sides, transform origin), null when the view has none: the origin is where the view pivots (`Props.applyPivot`). */
  var style: StyleRecords? = null

  /** What the last full record held of [style], so a partial write (`setNativeProps`) puts the rest back. */
  fun rememberStyle(from: StyleRecords) {
    val own = style
    if (own == null) {
      if (!from.isEmpty) style = StyleRecords().also { it.copyFrom(from) }
    } else own.copyFrom(from)
  }

  /**
   * React Native's own drawables draw the box (`BoxStyle`), and not the plain [drawable]. What `BoxStyle.apply` last wrote to them (the drawables' own state, which [radii], [border] and
   * [bg] are not once the node is reset for the pool: they are zero then and the drawables keep what they had), to write only what changed. A recycled view keeps its drawables.
   */
  var boxStyle = false
  /** The box is drawn by [BoxDrawable] (`StyleRules.boxKind`): this one. It holds its own state, and a recycled view keeps it like [boxStyle]'s drawables. */
  var engineBox: BoxDrawable? = null
  /** What [engineBox] has besides the node's [radii] and [border]: the colours of the sides and the border style, to ask `StyleRules.boxKind` again when the radii are animated. */
  val engineColors = IntArray(4)
  var engineStyle = 0
  /** What clips a view whose box is React Native's drawables to its padding box, without allocating for each draw (`BoxStyle.clipToPaddingBox`). */
  var boxClip: PaddingBoxClip? = null
  var boxRtl = false
  var boxShadows: IntArray? = null
  var boxBorderStyle = 0
  val boxColors = IntArray(4)
  val boxRadii = FloatArray(4)
  val boxBorder = FloatArray(4)
  var boxBg = 0
  /** An outset shadow is among [boxShadows]: it draws outside the view, so the view's own outline must not clip it. */
  var boxOutset = false

  val w get() = r - l
  val h get() = b - t

  /**
   * Back to the state of a new view for [ViewPool]. The background drawable and the a11y delegate stay installed
   * (the delegate reads `testID`, `role` and `a11y` from here, the drawable is rewritten by the next full prop record);
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
    label = null
    description = null
    a11y = null
    expandedLocal = 0
    transformed = false
    drivenY = 0f
    bg = 0
    radii.fill(0f)
    border.fill(0f)
    borderColor = 0
    style = null
  }
}

/**
 * A view the mounting layer owns. It is a `ReactPointerEventsView` so that react-native-gesture-handler's orchestrator, which
 * walks the view tree itself and never asks [HitTest], skips what JavaScript's touches skip (SPEC.md, "Gestures", Android
 * contract item 3): a view with `pointerEvents` none or box-only hides its subtree, one with none or box-none is no target.
 */
interface EngineNode : ReactPointerEventsView {
  val node: NodeState

  override val pointerEvents: PointerEvents get() = GestureRules.pointerEvents(node.pointer)
}

/** Frame placement shared by the container views: children sit at the frames Yoga gave them. */
object Frames {
  private val exact = View.MeasureSpec.EXACTLY

  fun place(child: View) {
    val st = (child as EngineNode).node
    if (!st.hasFrame) return
    child.measure(View.MeasureSpec.makeMeasureSpec(st.w, exact), View.MeasureSpec.makeMeasureSpec(st.h, exact))
    child.layout(st.l, st.t, st.r, st.b)
    if (st.transformed) Props.applyPivot(child, st)
  }

  private val content = IntArray(4)

  /** A scroll view's content child at Yoga's origin for it and the view's padding (`ClipRules.scrollContent`): a no-op where that is where the platform put it. */
  fun layoutContent(parent: ViewGroup) {
    val c = parent.getChildAt(0) ?: return
    val st = (c as? EngineNode)?.node ?: return
    if (!st.hasFrame) return
    ClipRules.scrollContent(st.l, st.t, st.r, st.b, parent.paddingLeft, parent.paddingTop, content)
    if (c.left != content[0] || c.top != content[1] || c.right != content[2] || c.bottom != content[3]) {
      c.measure(View.MeasureSpec.makeMeasureSpec(st.w, exact), View.MeasureSpec.makeMeasureSpec(st.h, exact))
      c.layout(content[0], content[1], content[2], content[3])
    }
    // The pivot follows the size the content has now (`place` does the same): one set at mount, when the content had none, is the top left.
    if (st.transformed) Props.applyPivot(c, st)
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

  /**
   * `overflow: hidden` as React Native has it (`ReactViewGroup.dispatchDraw`, `clipToPaddingBox`): the canvas is clipped to the padding box, the view's size less its border
   * widths, whatever its children are. Android's own spelling of it, `clipChildren`, cuts each child off at the child's own bounds instead: a child that draws outside its
   * bounds on purpose (react-native-fast-shadow's shadow, a glow, a scaled view) lost the part outside, and a child outside the parent was not clipped at all. The
   * clip does not depend on what the view holds, so a sibling is clipped the same before and after a foreign view mounts next to it. A rounded view also clips to its outline
   * (`Props`, `RoundedOutline`). `clipChildren` stays off for every engine view.
   */
  var hidesOverflow = false
    set(value) {
      if (field == value) return
      field = value
      invalidate()
    }

  /** How the view clips what it draws: `canvas` (overflow hidden, the padding box), `none`. What the lab's `inspect` reports. */
  val clipMode: String get() = if (hidesOverflow) "canvas" else "none"

  override fun dispatchDraw(canvas: Canvas) {
    if (!hidesOverflow) {
      super.dispatchDraw(canvas)
      return
    }
    val saved = canvas.save()
    // React Native's own clip, round corners and border widths included (`ReactViewGroup.dispatchDraw`), for a view whose box is its drawables or the engine's.
    if (!BoxStyle.clipToPaddingBox(this, node, canvas)) {
      val widths = node.border
      canvas.clipRect(widths[0], widths[1], width - widths[2], height - widths[3])
    }
    super.dispatchDraw(canvas)
    canvas.restoreToCount(saved)
  }

  override fun onRtlPropertiesChanged(layoutDirection: Int) {
    super.onRtlPropertiesChanged(layoutDirection)
    BoxStyle.directionChanged(this, node, layoutDirection)
  }

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
