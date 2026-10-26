package expo.modules.svelteengine.views

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import expo.modules.svelteengine.SvelteEngineNative

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
 */
class EngineRoot(context: Context) : FrameLayout(context) {
  var native: SvelteEngineNative? = null
  var surfaceId = 0
  private val density = resources.displayMetrics.density

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
    if (action == MotionEvent.ACTION_DOWN) {
      count = 0
      cancelled = false
      val target = HitTest.find(this, ev.x, ev.y)
      onEngine = target != null
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
    // Let Android dispatch continue so scroll views can scroll; the gesture is ours either way.
    super.dispatchTouchEvent(ev)
    return true
  }

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
    const val TYPE_START = 0
    const val TYPE_MOVE = 1
    const val TYPE_END = 2
    const val TYPE_CANCEL = 3
  }
}
