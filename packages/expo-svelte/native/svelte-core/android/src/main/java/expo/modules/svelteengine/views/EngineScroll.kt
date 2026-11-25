package expo.modules.svelteengine.views

import android.content.Context
import android.graphics.Canvas
import android.os.SystemClock
import android.view.inputmethod.InputMethodManager
import android.widget.OverScroller
import expo.modules.svelteengine.ClipRules
import expo.modules.svelteengine.PropSet
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import com.swmansion.gesturehandler.core.NativeViewGestureHandler.NativeViewGestureHandlerHook
import expo.modules.svelteengine.SvelteEngineNative
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Programmatic scroll surface shared by [EngineScroll] and [EngineHScroll] (used by Commands). Offsets in px. */
interface EngineScrollable {
  fun scrollToPx(x: Int, y: Int, animated: Boolean)
  fun scrollToEndPx(animated: Boolean)
  fun flashIndicators()
}

/**
 * Shared bridge between an Android scroll view and the C++ event emitter and Fabric state, following
 * ReactScrollView / ReactScrollViewHelper: scroll events throttled by `scrollEventThrottle`, begin/end drag from the
 * touch gesture (end drag carries the release velocity), momentum begin/end around the post-touch fling detected by an
 * idle timer, content offset pushed into ScrollViewState.
 */
class ScrollBridge(private val view: ViewGroup, private val node: NodeState) {
  var native: SvelteEngineNative? = null
  var scrollEnabled = true
  /** `scrollEventThrottle` in ms (0 = every change). */
  var throttleMs = 0f

  private val density = view.resources.displayMetrics.density
  private val horizontal = view is HorizontalScrollView

  // Snapping (ReactScrollView.flingAndSnap), all px.
  private var paging = false
  private var snapInterval = 0
  private var snapAlignment = 0
  private var disableIntervalMomentum = false
  private var snapToStart = true
  private var snapToEnd = true
  private var snapOffsets: IntArray? = null
  private var friction = Float.NaN
  private var keyboardDismiss = 0
  private var pendingOffset: IntArray? = null
  /** Scratch scroller for [predict]; one per bridge instead of one per snapped fling. */
  private var predictor: OverScroller? = null

  private var dragging = false
  private var lastScrollDispatch = 0L
  private var velocityX = 0f
  private var velocityY = 0f
  private var tracker: VelocityTracker? = null

  private var postTouching = false
  private var stable = 0
  private var snappingToPage = false
  private var activelyScrolling = false

  private var stateX = Float.NaN
  private var stateY = Float.NaN
  private var lastStatePush = 0L

  val isScrollable get() = scrollEnabled
  val snapping get() = paging || snapInterval > 0 || snapOffsets != null
  /** Mirrors PointerEvents.canBeTouchTarget / canChildrenBeTouchTarget for the scroll view's own pointerEvents. */
  val canBeTouchTarget get() = node.pointer == 0 || node.pointer == 3
  val canChildrenBeTouchTarget get() = node.pointer == 0 || node.pointer == 2

  private val viewport = FloatArray(4)

  /**
   * Clips [canvas] to the scroll view's viewport when its `overflow` is not visible (SPEC.md, "Scroll viewport clip") and returns the save count to restore to, or -1 when
   * nothing was clipped. A scroll view has to clip its own children, as `ReactScrollView.draw` does: Android's way is the parent's `clipChildren`, which no engine view
   * sets, so without this the content of a scroll view is drawn wherever it scrolls to, over the header and the status bar that sit before the scroll view in the screen.
   */
  fun clipToViewport(canvas: Canvas): Int {
    if (!ClipRules.scrollViewport(node.overflow, view.scrollX, view.scrollY, view.width, view.height, node.border, viewport)) return -1
    val saved = canvas.save()
    canvas.clipRect(viewport[0], viewport[1], viewport[2], viewport[3])
    return saved
  }

  /** Applies the scroll records of [p]; `contentOffset` only on creation (it is an initial offset). */
  fun configure(p: PropSet, create: Boolean) {
    scrollEnabled = p.scrollEnabled == 1
    throttleMs = p.scrollThrottle
    paging = p.paging
    snapInterval = p.snapInterval.toInt()
    snapAlignment = p.snapAlignment
    disableIntervalMomentum = p.disableIntervalMomentum
    snapToStart = p.snapToStart
    snapToEnd = p.snapToEnd
    snapOffsets = p.snapOffsets?.let { o -> IntArray(o.size) { o[it].toInt() } }
    keyboardDismiss = p.keyboardDismiss
    view.overScrollMode = when (p.overScroll) {
      1 -> View.OVER_SCROLL_ALWAYS
      2 -> View.OVER_SCROLL_NEVER
      else -> View.OVER_SCROLL_IF_CONTENT_SCROLLS
    }
    // `decelerationRate` 0.998 is both the Fabric default and 'normal': leave Android's friction alone for it, like React
    // Native, which only calls the setter for an explicit prop.
    val rate = p.decelerationRate
    friction = if (rate == DEFAULT_DECELERATION) Float.NaN else 1f - rate
    scroller()?.let { if (!friction.isNaN()) it.setFriction(friction) else it.setFriction(ViewConfiguration.getScrollFriction()) }
    if (create && (p.contentOffsetX != 0f || p.contentOffsetY != 0f)) {
      pendingOffset = intArrayOf(p.contentOffsetX.roundToInt(), p.contentOffsetY.roundToInt())
    }
  }

  /** Called after every scroll and layout pass of a scroll view the keyboard's chat lift watches (`KeyboardDrive`: `onEndVisible`); null for the rest. */
  var watcher: (() -> Unit)? = null

  /** After a layout pass: applies the initial `contentOffset` once the content has its Yoga frame. */
  fun onLaidOut() {
    watcher?.invoke()
    val o = pendingOffset ?: return
    val content = view.getChildAt(0) as? EngineNode ?: return
    if (!content.node.hasFrame) return
    pendingOffset = null
    view.scrollTo(o[0], o[1])
  }

  /** The platform scroller (React Native reads the same private field to set friction and fling to snap targets). */
  fun scroller(): OverScroller? {
    return try {
      val f = scrollerField(view.javaClass.superclass ?: return null) ?: return null
      f.get(view) as? OverScroller
    } catch (_: Throwable) {
      null
    }
  }

  private fun position() = if (horizontal) view.scrollX else view.scrollY
  private fun viewport() = if (horizontal) view.width - view.paddingLeft - view.paddingRight else view.height - view.paddingTop - view.paddingBottom
  private fun maxScroll(): Int {
    val c = view.getChildAt(0) ?: return 0
    return max(0, (if (horizontal) c.width else c.height) - viewport())
  }

  private fun smoothTo(target: Int) {
    activelyScrolling = true
    if (view is HorizontalScrollView) view.smoothScrollTo(target, view.scrollY) else (view as ScrollView).smoothScrollTo(view.scrollX, target)
  }

  /** `predictFinalScrollPosition`: where a fling with [velocity] (px/s) would stop, with this view's friction. */
  private fun predict(velocity: Int): Int {
    val sc = predictor ?: OverScroller(view.context).also { predictor = it }
    sc.setFriction(if (friction.isNaN()) ViewConfiguration.getScrollFriction() else friction)
    val over = viewport() / 2
    return if (horizontal) {
      sc.fling(view.scrollX, view.scrollY, velocity, 0, 0, maxScroll(), 0, 0, over, 0)
      sc.finalX
    } else {
      sc.fling(view.scrollX, view.scrollY, 0, velocity, 0, 0, 0, maxScroll(), 0, over)
      sc.finalY
    }
  }

  /** `smoothScrollAndSnap`: paging with the viewport as interval; moves at most to the neighbouring page. */
  private fun smoothScrollAndSnap(velocity: Int) {
    val interval = max(1, viewport()).toDouble()
    val currentOffset = position().toDouble()
    var targetOffset = predict(velocity).toDouble()
    var previousPage = floor(currentOffset / interval).toInt()
    var nextPage = ceil(currentOffset / interval).toInt()
    var currentPage = (currentOffset / interval).roundToInt()
    val targetPage = (targetOffset / interval).roundToInt()
    if (velocity > 0 && nextPage == previousPage) nextPage++ else if (velocity < 0 && previousPage == nextPage) previousPage--
    if (velocity > 0 && currentPage < nextPage && targetPage > previousPage) {
      currentPage = nextPage
    } else if (velocity < 0 && currentPage > previousPage && targetPage < nextPage) {
      currentPage = previousPage
    }
    targetOffset = currentPage * interval
    if (targetOffset != currentOffset) smoothTo(targetOffset.toInt())
  }

  private fun itemStart(pos: Int, size: Int, viewport: Int) = when (snapAlignment) {
    2 -> pos - (viewport - size) / 2
    3 -> pos - (viewport - size)
    else -> pos
  }

  /**
   * `flingAndSnap`: picks the snap offset around where the fling would stop (`snapToOffsets`, `snapToInterval` with
   * `snapToAlignment`, or the paging interval), honours `snapToStart/End` and `disableIntervalMomentum`, then flings the
   * platform scroller exactly to it (min = max = target) so the easing is the fling's, not smoothScrollTo's 250 ms.
   */
  fun flingAndSnap(velocityIn: Int) {
    if (view.childCount <= 0) return
    var velocity = velocityIn
    if (snapInterval == 0 && snapOffsets == null) {
      smoothScrollAndSnap(velocity)
      return
    }
    val maximum = maxScroll()
    var target = predict(velocity)
    if (disableIntervalMomentum) target = position()
    var smaller = 0
    var larger = maximum
    var first = 0
    var last = maximum
    val viewport = viewport()
    val offsets = snapOffsets
    if (offsets != null) {
      first = offsets[0]
      last = offsets[offsets.size - 1]
      for (offset in offsets) {
        if (offset <= target && target - offset < target - smaller) smaller = offset
        if (offset >= target && offset - target < larger - target) larger = offset
      }
    } else if (snapAlignment != 0) {
      val ratio = target.toDouble() / snapInterval
      smaller = max(itemStart((floor(ratio) * snapInterval).toInt(), snapInterval, viewport), 0)
      larger = min(itemStart((ceil(ratio) * snapInterval).toInt(), snapInterval, viewport), maximum)
    } else {
      val ratio = target.toDouble() / snapInterval
      smaller = (floor(ratio) * snapInterval).toInt()
      larger = min((ceil(ratio) * snapInterval).toInt(), maximum)
    }
    val nearest = if (abs(target - smaller) < abs(larger - target)) smaller else larger
    if (!snapToEnd && target >= last) {
      if (position() < last) target = last // else free scrolling
    } else if (!snapToStart && target <= first) {
      if (position() > first) target = first
    } else if (velocity > 0) {
      velocity += ((larger - target) * 10.0).toInt()
      target = larger
    } else if (velocity < 0) {
      velocity -= ((target - smaller) * 10.0).toInt()
      target = smaller
    } else {
      target = nearest
    }
    target = min(max(0, target), maximum)

    val sc = scroller()
    if (sc == null) {
      smoothTo(target)
      return
    }
    activelyScrolling = true
    val over = if (target == 0 || target == maximum) viewport / 2 else 0
    if (horizontal) {
      sc.fling(view.scrollX, view.scrollY, if (velocity != 0) velocity else target - view.scrollX, 0, target, target, 0, 0, over, 0)
    } else {
      sc.fling(view.scrollX, view.scrollY, 0, if (velocity != 0) velocity else target - view.scrollY, 0, 0, target, target, 0, over)
    }
    view.postInvalidateOnAnimation()
  }

  /** `keyboardDismissMode` on-drag/interactive: drag start hides the IME and blurs the focused engine input. */
  private fun dismissKeyboard() {
    val focused = view.rootView?.findFocus()
    if (focused is EngineInput) {
      focused.blur()
    } else {
      val imm = view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
      imm?.hideSoftInputFromWindow(view.windowToken, 0)
    }
  }

  fun emit(kind: Int, vx: Float = 0f, vy: Float = 0f) {
    val n = native ?: return
    if (kind == 0) {
      val now = SystemClock.uptimeMillis()
      // Same rule as ReactScrollViewHelper.emitScrollEvent: 17 ms is the floor so 60 fps throttles never drop frames.
      if (throttleMs >= max(17L, now - lastScrollDispatch)) return
      lastScrollDispatch = now
    }
    val content = view.getChildAt(0) ?: return
    n.dispatchScroll(
      node.tag,
      kind,
      view.scrollX / density,
      view.scrollY / density,
      content.width / density,
      content.height / density,
      view.width / density,
      view.height / density,
      vx,
      vy,
    )
  }

  /** Pushes the offset into ScrollViewState (like forceUpdateState); deduped, and rate limited while scrolling. */
  fun pushState(force: Boolean) {
    val n = native ?: return
    val x = view.scrollX / density
    val y = view.scrollY / density
    if (x == stateX && y == stateY) return
    val now = SystemClock.uptimeMillis()
    if (!force && now - lastStatePush < STATE_INTERVAL_MS) return
    stateX = x
    stateY = y
    lastStatePush = now
    n.updateScrollState(node.tag, x, y)
  }

  fun onScrollChanged() {
    activelyScrolling = true
    emit(0)
    pushState(false)
    watcher?.invoke()
  }

  /** Called first for every touch event the scroll view dispatches (tracks velocity, stops a running fling). */
  fun onDispatch(ev: MotionEvent) {
    val action = ev.actionMasked
    if (action == MotionEvent.ACTION_DOWN) {
      tracker?.recycle()
      tracker = VelocityTracker.obtain()
      velocityX = 0f
      velocityY = 0f
      if (postTouching) {
        // Touching a flinging list stops it: close the momentum phase JavaScript was told about.
        cancelPostTouchScrolling()
        emit(4)
      }
    }
    val t = tracker ?: return
    t.addMovement(ev)
    if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
      t.computeCurrentVelocity(1) // px per ms
      velocityX = t.xVelocity / density
      velocityY = t.yVelocity / density
      t.recycle()
      tracker = null
    }
  }

  /** The scroll view intercepted the gesture (a child touch becomes a drag). */
  fun onIntercepted() {
    var p = view.parent
    while (p != null) {
      if (p is EngineRoot) { p.cancelActiveTouch(); break }
      p = p.parent
    }
    if (!dragging) {
      dragging = true
      if (keyboardDismiss != 0) dismissKeyboard()
      emit(1)
      cancelPostTouchScrolling()
    }
  }

  /** Called from onTouchEvent before the platform handles it. */
  fun onTouch(ev: MotionEvent) {
    val action = ev.actionMasked
    if ((action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) && dragging) {
      dragging = false
      pushState(true)
      val up = action == MotionEvent.ACTION_UP
      emit(2, if (up) velocityX else 0f, if (up) velocityY else 0f)
      startPostTouchScrolling()
    }
  }

  /** No drag, momentum phase or fling is running, so the view can be reused ([ViewPool]). */
  fun isIdle(): Boolean = !dragging && !postTouching && scroller()?.isFinished != false

  /**
   * Forgets the previous owner's gesture and event bookkeeping. The caller clears the scroll offset (with `native`
   * unset, so no event goes out for a tag that is gone) and `MountingManager` hands the view its new `native`.
   */
  fun resetForReuse() {
    watcher = null
    cancelPostTouchScrolling()
    tracker?.recycle()
    tracker = null
    dragging = false
    activelyScrolling = false
    velocityX = 0f
    velocityY = 0f
    lastScrollDispatch = 0L
    stateX = Float.NaN
    stateY = Float.NaN
    lastStatePush = 0L
    pendingOffset = null
    abortScroller()
  }

  /** Programmatic animated scroll: report it as momentum like React Native's smoothScrollTo. */
  fun beginProgrammatic() = startPostTouchScrolling()

  private fun startPostTouchScrolling() {
    if (postTouching) return
    emit(3)
    activelyScrolling = false
    postTouching = true
    stable = 0
    snappingToPage = false
    view.postOnAnimationDelayed(postTouchStep, MOMENTUM_DELAY_MS)
  }

  /** The idle check of a momentum phase: one runnable per bridge, re-posted until the scroll has been still for a few checks. */
  private val postTouchStep = object : Runnable {
    override fun run() {
      if (activelyScrolling) {
        activelyScrolling = false
        stable = 0
        view.postOnAnimationDelayed(this, MOMENTUM_DELAY_MS)
      } else {
        pushState(true)
        // Like ReactScrollView: only done after a few stable frames, so a fling that has not started yet survives.
        stable++
        if (stable >= 3) {
          postTouching = false
          emit(4)
        } else {
          // A release without fling velocity never reaches fling(): page-align once, as React Native does.
          if (snapping && !snappingToPage) {
            snappingToPage = true
            flingAndSnap(0)
          }
          view.postOnAnimationDelayed(this, MOMENTUM_DELAY_MS)
        }
      }
    }
  }

  private fun cancelPostTouchScrolling() {
    if (postTouching) view.removeCallbacks(postTouchStep)
    postTouching = false
  }

  fun onDetached() {
    cancelPostTouchScrolling()
    tracker?.recycle()
    tracker = null
  }

  /** Stops fling and snap animations before a programmatic non-animated jump. */
  fun abortScroller() {
    scroller()?.let { if (!it.isFinished) it.abortAnimation() }
  }

  private companion object {
    const val MOMENTUM_DELAY_MS = 20L
    const val STATE_INTERVAL_MS = 50L
    const val DEFAULT_DECELERATION = 0.998f
    private val scrollerFields = HashMap<Class<*>, java.lang.reflect.Field?>()

    fun scrollerField(cls: Class<*>): java.lang.reflect.Field? = scrollerFields.getOrPut(cls) {
      try {
        cls.getDeclaredField("mScroller").also { it.isAccessible = true }
      } catch (_: Throwable) {
        null
      }
    }
  }
}

/**
 * Puts a scroll view back at the origin before it is pooled. `ScrollView.scrollTo` does nothing while the view has no child, and
 * a dead tree can arrive content first (the order of the mutation stream's deletes): the offset would outlive the view and show
 * on its next owner, whose content is laid out from its own origin (a gesture aimed at a laid-out rectangle found another row).
 * With no child, an empty stand-in child is attached just long enough for the move.
 */
private fun resetOffset(view: ViewGroup, standIn: View, offset: Boolean, scrollTo: (Int, Int) -> Unit) {
  if (view.childCount > 0 || !offset) {
    scrollTo(0, 0)
    return
  }
  view.addView(standIn)
  scrollTo(0, 0)
  view.removeView(standIn)
}

class EngineScroll(context: Context) : ScrollView(context), EngineNode, EngineScrollable, NativeViewGestureHandlerHook {
  override val node = NodeState()
  val bridge = ScrollBridge(this, node)
  private val standIn by lazy(LazyThreadSafetyMode.NONE) { View(context) }

  init {
    overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
    isFillViewport = false
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
    measureContent()
  }

  private fun measureContent() {
    val c = getChildAt(0) ?: return
    val cs = (c as? EngineNode)?.node ?: return
    val cw = if (cs.hasFrame) cs.w else node.w
    val ch = if (cs.hasFrame) cs.h else node.h
    c.measure(View.MeasureSpec.makeMeasureSpec(cw, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(ch, View.MeasureSpec.EXACTLY))
  }

  // The content child keeps the size Yoga gave it; never let ScrollView re-measure it.
  override fun measureChild(child: View, parentWidthMeasureSpec: Int, parentHeightMeasureSpec: Int) = measureContent()

  override fun measureChildWithMargins(child: View, parentWidthMeasureSpec: Int, widthUsed: Int, parentHeightMeasureSpec: Int, heightUsed: Int) = measureContent()

  override fun onScrollChanged(l: Int, t: Int, oldl: Int, oldt: Int) {
    super.onScrollChanged(l, t, oldl, oldt)
    bridge.onScrollChanged()
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    bridge.onLaidOut()
  }

  override fun dispatchDraw(canvas: Canvas) {
    val saved = bridge.clipToViewport(canvas)
    super.dispatchDraw(canvas)
    if (saved >= 0) canvas.restoreToCount(saved)
  }

  /** Back to the scroll position and event state of a new view ([ViewPool]); the content child is detached afterwards. */
  fun resetForReuse() {
    bridge.native = null
    resetOffset(this, standIn, scrollX != 0 || scrollY != 0, ::scrollTo)
    bridge.resetForReuse()
    // The room the keyboard's chat lift or aware scroll made at the bottom (`KeyboardDrive`).
    if (paddingBottom != 0) setPadding(paddingLeft, paddingTop, paddingRight, 0)
    // Edge glows of the previous owner would otherwise keep animating on the next one.
    overScrollMode = OVER_SCROLL_NEVER
    overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    bridge.onDetached()
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    bridge.onDispatch(ev)
    return super.dispatchTouchEvent(ev)
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (!bridge.scrollEnabled) return false
    if (!bridge.canChildrenBeTouchTarget) return true
    val r = super.onInterceptTouchEvent(ev)
    if (r) bridge.onIntercepted()
    return r
  }

  override fun onTouchEvent(ev: MotionEvent): Boolean {
    if (!bridge.scrollEnabled || !bridge.canBeTouchTarget) return false
    bridge.onTouch(ev)
    return super.onTouchEvent(ev)
  }

  // react-native-gesture-handler's `Gesture.Native()` on this view (SPEC.md, "Gestures", Android contract item 7): what its
  // `ScrollViewHook` says for a React Native scroll view, and the touch the handler feeds the view goes the way a dispatched
  // touch does, through the bridge's velocity tracker (the handler calls `onTouchEvent` itself).
  override fun shouldCancelRootViewGestureHandlerIfNecessary() = true

  override fun sendTouchEvent(view: View?, event: MotionEvent): Boolean {
    bridge.onDispatch(event)
    return onTouchEvent(event)
  }

  override fun fling(velocityY: Int) {
    if (bridge.snapping) bridge.flingAndSnap(velocityY) else super.fling(velocityY)
  }

  override fun scrollToPx(x: Int, y: Int, animated: Boolean) {
    if (animated) {
      bridge.beginProgrammatic()
      smoothScrollTo(x, y)
    } else {
      bridge.abortScroller()
      scrollTo(x, y)
    }
  }

  // The end is the end of the content and of the room at its bottom (padding: a keyboard's lift makes some), as `ReactScrollView.scrollToEnd` (the child's height and the bottom padding).
  override fun scrollToEndPx(animated: Boolean) {
    val h = getChildAt(0)?.height ?: 0
    scrollToPx(scrollX, expo.modules.svelteengine.KeyboardRules.endOffset(h, height, paddingTop, paddingBottom), animated)
  }

  override fun flashIndicators() {
    awakenScrollBars()
  }
}

class EngineHScroll(context: Context) : HorizontalScrollView(context), EngineNode, EngineScrollable, NativeViewGestureHandlerHook {
  override val node = NodeState()
  val bridge = ScrollBridge(this, node)
  private val standIn by lazy(LazyThreadSafetyMode.NONE) { View(context) }

  init {
    overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
    isFillViewport = false
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
    measureContent()
  }

  private fun measureContent() {
    val c = getChildAt(0) ?: return
    val cs = (c as? EngineNode)?.node ?: return
    val cw = if (cs.hasFrame) cs.w else node.w
    val ch = if (cs.hasFrame) cs.h else node.h
    c.measure(View.MeasureSpec.makeMeasureSpec(cw, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(ch, View.MeasureSpec.EXACTLY))
  }

  override fun measureChild(child: View, parentWidthMeasureSpec: Int, parentHeightMeasureSpec: Int) = measureContent()

  override fun measureChildWithMargins(child: View, parentWidthMeasureSpec: Int, widthUsed: Int, parentHeightMeasureSpec: Int, heightUsed: Int) = measureContent()

  override fun onScrollChanged(l: Int, t: Int, oldl: Int, oldt: Int) {
    super.onScrollChanged(l, t, oldl, oldt)
    bridge.onScrollChanged()
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    bridge.onLaidOut()
  }

  override fun dispatchDraw(canvas: Canvas) {
    val saved = bridge.clipToViewport(canvas)
    super.dispatchDraw(canvas)
    if (saved >= 0) canvas.restoreToCount(saved)
  }

  /** Back to the scroll position and event state of a new view ([ViewPool]); the content child is detached afterwards. */
  fun resetForReuse() {
    bridge.native = null
    resetOffset(this, standIn, scrollX != 0 || scrollY != 0, ::scrollTo)
    bridge.resetForReuse()
    // Edge glows of the previous owner would otherwise keep animating on the next one.
    overScrollMode = OVER_SCROLL_NEVER
    overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    bridge.onDetached()
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    bridge.onDispatch(ev)
    return super.dispatchTouchEvent(ev)
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (!bridge.scrollEnabled) return false
    if (!bridge.canChildrenBeTouchTarget) return true
    val r = super.onInterceptTouchEvent(ev)
    if (r) bridge.onIntercepted()
    return r
  }

  override fun onTouchEvent(ev: MotionEvent): Boolean {
    if (!bridge.scrollEnabled || !bridge.canBeTouchTarget) return false
    bridge.onTouch(ev)
    return super.onTouchEvent(ev)
  }

  // react-native-gesture-handler's `Gesture.Native()` on this view (SPEC.md, "Gestures", Android contract item 7): what its
  // `ScrollViewHook` says for a React Native scroll view, and the touch the handler feeds the view goes the way a dispatched
  // touch does, through the bridge's velocity tracker (the handler calls `onTouchEvent` itself).
  override fun shouldCancelRootViewGestureHandlerIfNecessary() = true

  override fun sendTouchEvent(view: View?, event: MotionEvent): Boolean {
    bridge.onDispatch(event)
    return onTouchEvent(event)
  }

  override fun fling(velocityX: Int) {
    if (bridge.snapping) bridge.flingAndSnap(velocityX) else super.fling(velocityX)
  }

  override fun scrollToPx(x: Int, y: Int, animated: Boolean) {
    if (animated) {
      bridge.beginProgrammatic()
      smoothScrollTo(x, y)
    } else {
      bridge.abortScroller()
      scrollTo(x, y)
    }
  }

  override fun scrollToEndPx(animated: Boolean) {
    val w = getChildAt(0)?.width ?: 0
    scrollToPx(expo.modules.svelteengine.KeyboardRules.endOffset(w, width, paddingLeft, paddingRight), scrollY, animated)
  }

  override fun flashIndicators() {
    awakenScrollBars()
  }
}
