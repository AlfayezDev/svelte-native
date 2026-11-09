package expo.modules.svelteengine.views

import android.content.Context
import android.os.Trace
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.RootView
import expo.modules.svelteengine.ClaimArbiter
import expo.modules.svelteengine.ClaimOutcome
import expo.modules.svelteengine.GestureRules
import expo.modules.svelteengine.SvelteEngineNative

/**
 * What the root asks of react-native-gesture-handler's `RNGestureHandlerRootHelper` once gestures are enabled
 * (`SvelteEngine.enableGestures`, see `EngineGestures.kt`). An interface of the engine's own so that this class, which every
 * app loads, names no class of the library.
 */
internal interface GestureRoot {
  /** Runs the library's orchestrator on [ev]; true when a handler has taken the gesture over and the children get nothing more of it. */
  fun dispatchTouchEvent(ev: MotionEvent): Boolean

  /** A native view took the touch lock: every handler is cancelled. */
  fun requestDisallowInterceptTouchEvent()

  fun tearDown()
}

/**
 * A view of the touched path that takes a gesture over with a drag of its own: the stack's edge swipe, a sheet's drag (SPEC.md,
 * "Gestures", "Android arbitration"). Android asks such a view (`onInterceptTouchEvent`) only after the event went through the
 * gesture handlers, which activate on the same event that crosses the view's slop: the handler would always win a tie. With
 * gestures enabled the root therefore asks these views first, on every move of the gesture, and a view that [claims] the movement
 * [claim]s the gesture before the handlers see the event; the handlers are cancelled through the touch lock the claim takes.
 */
internal interface NativeClaim {
  /** True when a finger that has moved ([dx], [dy]) from where it went down would be taken over by this view's own interception. */
  fun claims(dx: Float, dy: Float): Boolean

  /** Takes the gesture over now, as if `onInterceptTouchEvent` had answered true for [ev]: the touch lock and the drag state. */
  fun claim(ev: MotionEvent)
}

/**
 * Overlay root: lays out the engine tree by frames, hit-tests touches and forwards them to C++ like React Native's
 * JSTouchDispatcher (all pointers, target fixed per pointer at its DOWN).
 *
 * A gesture that starts on an engine view is claimed: the root returns true for all of its events, so the
 * `ReactSurfaceView` underneath never sees them. A gesture that starts elsewhere is not touched at all.
 *
 * Modal layers ([ModalLayer]) are the last children, one per visible modal in the order they were shown, each as big as
 * the root. They come after every node of the Fabric tree, so the mutation stream's insert indexes (which count the nodes
 * only) never land behind one, and they are hit tested, drawn and heard by accessibility first. A gesture that starts on
 * a layer's own area (not on one of its engine views) is claimed and reported to nobody.
 *
 * Gestures (SPEC.md, "Gestures", Android contract): the root is a React Native `RootView`, which is what the gesture
 * handler's root helper looks for above the view it wraps, and its id is [GestureRules.ROOT_ID]. Until `enableGestures`
 * installs the helper ([gestures]) nothing of the library is touched. With it, every touch event goes to JavaScript first
 * (as React Native's root view does), then through the library's orchestrator, and the children get it only when no handler
 * has taken the gesture over.
 */
class EngineRoot(context: Context) : FrameLayout(context), RootView {
  var native: SvelteEngineNative? = null
  var surfaceId = 0
  private val density = resources.displayMetrics.density

  /** The gesture handler's root helper; null until [MountingManager.enableGestures]. */
  internal var gestures: GestureRoot? = null

  init {
    // RNGH keys its root handler and the handlers' view lookup on the id, and asserts it is positive.
    id = GestureRules.ROOT_ID
    // An id makes Android save and restore the view hierarchy through it; the engine's tree is rebuilt by JavaScript.
    isSaveEnabled = false
  }

  // Pointers of the active gesture, in the order they went down (compact arrays).
  private var count = 0
  private val ids = IntArray(MAX)
  private val tags = IntArray(MAX)
  private val views = arrayOfNulls<View>(MAX)
  private val lastX = FloatArray(MAX)
  private val lastY = FloatArray(MAX)
  private var lastTime = 0.0

  private val layers = ArrayList<ModalLayer>(2)

  private var onEngine = false
  /** Set when a native scroll took the gesture over: JavaScript got its cancel and hears nothing more until the next DOWN. */
  private var cancelled = false

  // Arbitration with the gesture handlers (see [NativeClaim]); reset at every DOWN.
  /** The views of the touched path that can claim the gesture, outermost first. */
  private val claimers = arrayOfNulls<NativeClaim>(MAX_CLAIMERS)
  private var claimerCount = 0
  /** Who may take the touch over: the DOWN position and pointer, whether a handler owns the gesture, whether a native view holds the lock (`ClaimRules.kt`, host checked). */
  private val arbiter = ClaimArbiter()

  // Arrays handed to JNI, reused.
  private val oTags = IntArray(MAX)
  private val oIds = IntArray(MAX)
  private val oPageX = FloatArray(MAX)
  private val oPageY = FloatArray(MAX)
  private val oLocalX = FloatArray(MAX)
  private val oLocalY = FloatArray(MAX)
  private val local = FloatArray(2)

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val width = MeasureSpec.getSize(widthMeasureSpec)
    val height = MeasureSpec.getSize(heightMeasureSpec)
    setMeasuredDimension(width, height)
    for (i in layers.indices) layers[i].fitTo(width, height)
    Frames.measureChildren(this)
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    Frames.layoutChildren(this)
  }

  // Modal layers --------------------------------------------------------------------------------------------------

  /** Puts [layer] in front of everything, including the layers shown before it. */
  internal fun addLayer(layer: ModalLayer) {
    layers.add(layer)
    layer.fitTo(width, height)
    addView(layer)
  }

  internal fun removeLayer(layer: ModalLayer) {
    layers.remove(layer)
    removeView(layer)
  }

  internal fun bringLayerToFront(layer: ModalLayer) {
    if (!layers.remove(layer)) return
    layers.add(layer)
    bringChildToFront(layer)
  }

  /**
   * Whether a modal layer in front of [view] holds the back key and the touches: any visible layer when the view is
   * not in a layer, a later one when it is. A stack answers the key only while this is false.
   */
  internal fun layerAbove(view: View): Boolean {
    var child: View = view
    while (child.parent !== this) child = child.parent as? View ?: return false
    val index = if (child is ModalLayer) layers.indexOf(child) else -1
    for (j in index + 1 until layers.size) if (layers[j].active) return true
    return false
  }

  /**
   * While a modal is up, accessibility services see that modal's layer and nothing else of the overlay: the front-most
   * visible layer (its own content is the modal). Done here and not through `importantForAccessibility` on the nodes
   * below because the common props reset that flag on every update of a node.
   */
  override fun addChildrenForAccessibility(outChildren: ArrayList<View>) {
    val front = layers.lastOrNull { it.active }
    if (front == null) {
      super.addChildrenForAccessibility(outChildren)
      return
    }
    val all = ArrayList<View>()
    super.addChildrenForAccessibility(all)
    for (v in all) {
      var p: View? = v
      while (p != null && p !== front) p = p.parent as? View
      if (p != null) outChildren.add(v)
    }
  }

  /** Called by a scroll view that took over the gesture: JavaScript gets one cancel for all active touches. */
  fun cancelActiveTouch() {
    if (!onEngine || cancelled) return
    cancelled = true
    if (count > 0) {
      send(TYPE_CANCEL, -1)
      count = 0
    }
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    val action = ev.actionMasked
    lastTime = ev.eventTime.toDouble()
    if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) { releaseClaimers(); arbiter.end() }
    // Android hands a pointer id out again as soon as it is free: the DOWN pointer is forgotten when it lifts.
    if (action == MotionEvent.ACTION_POINTER_UP) arbiter.pointerUp(ev.getPointerId(ev.actionIndex))
    if (action == MotionEvent.ACTION_DOWN) {
      count = 0
      cancelled = false
      GestureTrace.refresh()
      val target = HitTest.find(this, ev.x, ev.y)
      onEngine = target != null
      GestureTrace.log { "down x=${ev.x / density} y=${ev.y / density} dp, target=${target?.javaClass?.simpleName}" }
      arbiter.down(ev.getPointerId(0), ev.x, ev.y)
      collectClaimers(target)
      if (target == null) return false
      // A modal layer's own area has no node: the gesture is held, JavaScript hears nothing of it.
      if (tagOf(target) != 0) {
        track(ev, 0, target)
        send(TYPE_START, 0)
      }
    } else if (!onEngine) {
      return false
    } else {
      updatePositions(ev)
      if (!cancelled) {
        when (action) {
          MotionEvent.ACTION_POINTER_DOWN -> {
            val target = HitTest.find(this, ev.getX(ev.actionIndex), ev.getY(ev.actionIndex))
            if (target != null && tagOf(target) != 0 && count < MAX) {
              track(ev, ev.actionIndex, target)
              send(TYPE_START, count - 1)
            }
          }
          MotionEvent.ACTION_MOVE -> if (count > 0) send(TYPE_MOVE, -1)
          MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_UP -> {
            val slot = slotOf(ev.getPointerId(ev.actionIndex))
            if (slot >= 0) {
              send(TYPE_END, slot)
              remove(slot)
            }
            if (action == MotionEvent.ACTION_UP) count = 0
          }
          MotionEvent.ACTION_CANCEL -> {
            if (count > 0) send(TYPE_CANCEL, -1)
            count = 0
          }
        }
      }
    }
    // The gesture handlers see the event after JavaScript did (a Pressable and a Tap gesture both fire for one tap, as in
    // React Native), before the children. A handler that activates inside this call cancels its root handler, which comes
    // back as [onChildStartedNativeGesture]: JavaScript gets its one cancel.
    val gestureRoot = gestures
    if (gestureRoot != null) {
      Trace.beginSection("SvelteEngine.gesture")
      val intercept = try {
        if (action == MotionEvent.ACTION_MOVE && claimerCount > 0) claimBeforeHandlers(ev, gestureRoot)
        gestureRoot.dispatchTouchEvent(ev)
      } finally { Trace.endSection() }
      GestureTrace.log { "${ev.describe()} -> gesture handlers: ${if (intercept) "a handler owns the gesture" else "no handler active"}" }
      // A handler owns the gesture: the children get nothing more of it (the next DOWN's reset cancels their touch target).
      if (intercept) { arbiter.handlerTookOver(); return true }
    }
    // Let Android dispatch continue so scroll views can scroll; the gesture is ours either way.
    super.dispatchTouchEvent(ev)
    return true
  }

  private fun releaseClaimers() {
    for (i in 0 until claimerCount) claimers[i] = null
    claimerCount = 0
  }

  /** The views of [target]'s ancestors that can claim a gesture, outermost first. */
  private fun collectClaimers(target: View?) {
    releaseClaimers()
    if (gestures == null) return
    var v: View? = target
    while (v != null && v !== this) {
      if (v is NativeClaim && claimerCount < MAX_CLAIMERS) claimers[claimerCount++] = v
      v = v.parent as? View
    }
    // Collected from the innermost out; Android asks the outermost first.
    var i = 0
    var j = claimerCount - 1
    while (i < j) { val t = claimers[i]; claimers[i] = claimers[j]; claimers[j] = t; i++; j-- }
  }

  /**
   * The order inside one event: a view that takes the gesture over with its own drag (the stack's edge swipe, a sheet) is asked
   * before the gesture handlers see the move, so when one move crosses both the view's slop and a handler's activation the view
   * wins. A move carries the samples taken since the last one ([MotionEvent.getHistoricalX]); the first of them to cross the
   * view's slop decides, and the handlers see the sample before it first, so a handler that would have activated on an earlier
   * sample (a pan with a smaller `activeOffsetY`) still wins. A claim takes the touch lock, which cancels every handler. Nothing
   * is claimed once a handler owns the gesture, however it came to (`ClaimArbiter`), and the positions are those of the pointer
   * that went down, never of whichever pointer is first in the event.
   */
  private fun claimBeforeHandlers(ev: MotionEvent, gestureRoot: GestureRoot) {
    val index = ev.findPointerIndex(arbiter.pointer.id)
    val samples = ev.historySize
    val outcome = arbiter.decide(
      isMove = ev.actionMasked == MotionEvent.ACTION_MOVE,
      pointerCount = ev.pointerCount,
      claimers = claimerCount,
      samples = samples,
      x = { i -> if (i < samples) ev.getHistoricalX(index, i) else ev.getX(index) },
      y = { i -> if (i < samples) ev.getHistoricalY(index, i) else ev.getY(index) },
      claims = { k, dx, dy -> claimers[k]?.claims(dx, dy) == true },
      handlersOwnAt = { sample ->
        val probe = historicalMove(ev, index, sample)
        val owned = try { gestureRoot.dispatchTouchEvent(probe) } finally { probe.recycle() }
        GestureTrace.log { "sample $sample of $samples before the claim -> gesture handlers: ${if (owned) "a handler activated first" else "none active"}" }
        if (owned) arbiter.handlerTookOver()
        owned
      },
    )
    if (outcome.kind != ClaimOutcome.Kind.CLAIM) return
    val claimer = claimers[outcome.claimer] ?: return
    GestureTrace.log { "${claimer.javaClass.simpleName} claims the gesture at sample ${outcome.sample} of $samples" }
    claimer.claim(ev)
  }

  /** A single pointer MOVE with the position and time of history sample [sample] of pointer [pointer] of [ev]. */
  private fun historicalMove(ev: MotionEvent, pointer: Int, sample: Int): MotionEvent {
    val properties = MotionEvent.PointerProperties().also { ev.getPointerProperties(pointer, it) }
    val coords = MotionEvent.PointerCoords().also { ev.getHistoricalPointerCoords(pointer, sample, it) }
    return MotionEvent.obtain(
      ev.downTime, ev.getHistoricalEventTime(sample), MotionEvent.ACTION_MOVE, 1, arrayOf(properties), arrayOf(coords),
      ev.metaState, ev.buttonState, ev.xPrecision, ev.yPrecision, ev.deviceId, ev.edgeFlags, ev.source, ev.flags,
    )
  }

  private fun MotionEvent.describe(): String =
    "${MotionEvent.actionToString(actionMasked)} t=${eventTime - downTime} ms x=${"%.1f".format(x / density)} y=${"%.1f".format(y / density)} dp history=$historySize pointers=$pointerCount"

  /** Hover events (a stylus or mouse) are the library's to read, as in its own root view; the engine has no use for them. */
  override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
    val gestureRoot = gestures
    if (gestureRoot != null && isHover(ev.actionMasked) && gestureRoot.dispatchTouchEvent(ev)) return true
    return super.dispatchGenericMotionEvent(ev)
  }

  /**
   * A native view (a scroll view that started to drag, the stack's edge swipe, a sheet) took the touch lock: every gesture
   * handler is cancelled, as in the library's own root view. Only the request to take it counts; giving it back is nothing.
   */
  override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
    if (disallowIntercept) {
      arbiter.lockRequested()
      gestures?.requestDisallowInterceptTouchEvent()
    }
    super.requestDisallowInterceptTouchEvent(disallowIntercept)
  }

  // RootView ----------------------------------------------------------------------------------------------------------

  /**
   * A native gesture started below (a handler activated, a native view took the lock): JavaScript gets its one cancel and
   * hears nothing more of the gesture until the next DOWN. That is React Native's contract for the call. It is also how the
   * library's root helper says that a handler activated: it cancels its root handler, which calls this, and it can do so between
   * two events (a LongPress's timer, `Pan.activateAfterLongPress`), when no dispatch returns the news. The gesture is theirs
   * from then on, and a view that would claim the next move must not (its touch lock would not cancel an active handler).
   */
  override fun onChildStartedNativeGesture(childView: View?, ev: MotionEvent) {
    arbiter.handlerTookOver()
    cancelActiveTouch()
  }

  override fun onChildEndedNativeGesture(childView: View, ev: MotionEvent) {}

  override fun handleException(t: Throwable) {
    val reactContext = context as? ReactContext ?: throw t
    reactContext.handleException(if (t is Exception) t else RuntimeException(t))
  }

  private fun isHover(action: Int) =
    action == MotionEvent.ACTION_HOVER_MOVE || action == MotionEvent.ACTION_HOVER_ENTER || action == MotionEvent.ACTION_HOVER_EXIT

  private fun tagOf(view: View): Int = (view as? EngineNode)?.node?.tag ?: 0

  private fun track(ev: MotionEvent, index: Int, target: View) {
    val tag = tagOf(target)
    ids[count] = ev.getPointerId(index)
    tags[count] = tag
    views[count] = target
    lastX[count] = ev.getX(index)
    lastY[count] = ev.getY(index)
    count++
  }

  private fun remove(slot: Int) {
    for (i in slot until count - 1) {
      ids[i] = ids[i + 1]; tags[i] = tags[i + 1]; views[i] = views[i + 1]
      lastX[i] = lastX[i + 1]; lastY[i] = lastY[i + 1]
    }
    count--
    views[count] = null
  }

  private fun slotOf(pointerId: Int): Int {
    for (i in 0 until count) if (ids[i] == pointerId) return i
    return -1
  }

  private fun updatePositions(ev: MotionEvent) {
    for (p in 0 until ev.pointerCount) {
      val slot = slotOf(ev.getPointerId(p))
      if (slot >= 0) {
        lastX[slot] = ev.getX(p)
        lastY[slot] = ev.getY(p)
      }
    }
  }

  private fun send(type: Int, changedIndex: Int) {
    val n = native ?: return
    for (i in 0 until count) {
      oTags[i] = tags[i]
      oIds[i] = ids[i]
      oPageX[i] = lastX[i] / density
      oPageY[i] = lastY[i] / density
      HitTest.toLocal(this, views[i], lastX[i], lastY[i], local)
      oLocalX[i] = local[0] / density
      oLocalY[i] = local[1] / density
    }
    n.dispatchTouch(surfaceId, type, changedIndex, count, oTags, oIds, oPageX, oPageY, oLocalX, oLocalY, lastTime)
  }

  private companion object {
    const val MAX = 16
    const val MAX_CLAIMERS = 4
    const val TYPE_START = 0
    const val TYPE_MOVE = 1
    const val TYPE_END = 2
    const val TYPE_CANCEL = 3
  }
}
