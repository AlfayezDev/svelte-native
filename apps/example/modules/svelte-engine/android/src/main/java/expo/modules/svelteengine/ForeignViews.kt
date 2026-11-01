package expo.modules.svelteengine

import android.os.SystemClock
import android.util.Log
import android.util.SparseArray
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import java.lang.ref.WeakReference
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.fabric.FabricUIManager
import expo.modules.svelteengine.views.EngineForeign
import expo.modules.svelteengine.views.EngineNode
import expo.modules.svelteengine.views.HitTest
import expo.modules.svelteengine.views.EngineRoot

/**
 * Foreign views (SPEC.md, "Foreign views"): views another library owns and React Native's Java mounting creates, such as
 * a WebView, a map or a video player. The C++ delegate keeps their nodes (and everything under them) out of the engine's
 * batches and hands the mutations back to React Native; the engine only holds a frame for each root, an [EngineForeign],
 * and this class puts React Native's view inside that frame.
 *
 * React Native inserts a foreign root into the surface's own root view, which is attached to the window, and then inserts
 * the children into it: a view manager may rely on its view being attached by then (a map starts its lifecycle on attach
 * and adds its markers to what that creates). The engine moves the view into its frame afterwards.
 *
 * React Native mounts on its own schedule, so the view may exist before the engine creates the frame (the mount item ran
 * first) or after it (the usual order: the engine's batch is posted first). The frame asks for the view when it is
 * created, and the ones that did not get it wait for React Native's mount listener, which runs right after each batch of
 * React Native mount items on the main thread, before the next draw: the view is in place in the frame it was created in.
 *
 * Main thread only, except the thread-safe counters of [stats].
 */
@OptIn(UnstableReactNativeAPI::class)
class ForeignViews : UIManagerListener {
  // Set on the thread that installs the engine, read on the main thread.
  @Volatile private var fabric: FabricUIManager? = null

  /** Every live frame, by React tag. */
  private val live = SparseArray<EngineForeign>(4)

  /** Frames whose view React Native has not created yet. */
  private val waiting = ArrayList<EngineForeign>(2)

  /** The tags of the last [DROPPED_TAGS] frames the engine deleted; React Native must not resolve any of them any more. */
  private val droppedTags = IntArray(DROPPED_TAGS)
  private var droppedNext = 0

  /** The views React Native created for the frames, weakly: a view still here after its node was deleted and a collection is retained. */
  private val adopted = ArrayList<WeakReference<View>>()

  private var created = 0
  private var dropped = 0
  private var adoptedAtCreate = 0
  private var adoptedAtMount = 0

  fun install(fabric: FabricUIManager) {
    this.fabric = fabric
    fabric.addUIManagerEventListener(this)
  }

  fun uninstall() {
    fabric?.removeUIManagerEventListener(this)
    fabric = null
    live.clear()
    waiting.clear()
  }

  /** The engine created the frame of foreign node [tag]. */
  fun created(tag: Int, frame: EngineForeign) {
    created++
    live.put(tag, frame)
    val view = resolve(tag)
    if (view != null) {
      frame.adopt(view)
      adopted.add(WeakReference(view))
      adoptedAtCreate++
    } else {
      waiting.add(frame)
    }
  }

  /** The engine deleted the frame of foreign node [tag]; React Native deletes (and drops) the view on its own. */
  fun dropped(tag: Int, frame: EngineForeign) {
    droppedTags[droppedNext] = tag
    droppedNext = (droppedNext + 1) % DROPPED_TAGS
    dropped++
    live.remove(tag)
    waiting.remove(frame)
    frame.release()
  }

  /** The view React Native created for [tag], or null while it has not. */
  private fun resolve(tag: Int): View? = fabric?.resolveView(tag)

  /** The view React Native made for foreign node [tag] or for a node inside a foreign view, for the lab's readback ([Inspect]); null for an engine node. */
  fun viewFor(tag: Int): View? = live.get(tag)?.content ?: resolve(tag)

  override fun didMountItems(uiManager: UIManager) {
    if (waiting.isNotEmpty()) {
      var i = waiting.size - 1
      while (i >= 0) {
        val frame = waiting[i]
        val view = resolve(frame.node.tag)
        if (view != null) {
          frame.adopt(view)
          adopted.add(WeakReference(view))
          adoptedAtMount++
          waiting.removeAt(i)
        }
        i--
      }
    }
  }

  override fun willDispatchViewUpdates(uiManager: UIManager) {}

  override fun willMountItems(uiManager: UIManager) {}

  override fun didDispatchMountItems(uiManager: UIManager) {}

  override fun didScheduleMountItems(uiManager: UIManager) {}

  /**
   * Counts for the lab and the soak runner: frames alive, frames still waiting for their view, how each frame got its view,
   * and two leak checks. `registryLeaks` is how many of the last deleted frames' tags React Native's mounting manager
   * still resolves a view for (its own registry of view states: it must be none, whatever the library does with the view
   * object). `reactViews` is how many of the views React Native created for the adopted frames are still reachable: they
   * are held weakly and a full collection runs first when [collect] is set, so a view that survives it after its node was
   * deleted is retained by something (the library, when it is not the engine's registries above).
   */
  fun stats(collect: Boolean): Map<String, Int> {
    if (collect) {
      Runtime.getRuntime().gc()
      System.runFinalization()
      Runtime.getRuntime().gc()
    }
    adopted.removeAll { it.get() == null }
    var registryLeaks = 0
    for (tag in droppedTags) if (tag != 0 && resolve(tag) != null) registryLeaks++
    return mapOf(
      "frames" to live.size(),
      "registryLeaks" to registryLeaks,
      "waiting" to waiting.size,
      "reactViews" to adopted.size,
      "created" to created,
      "dropped" to dropped,
      "adoptedAtCreate" to adoptedAtCreate,
      "adoptedAtMount" to adoptedAtMount,
    )
  }

  companion object {
    private const val TAP_HOLD_MS = 80L
    private const val DROPPED_TAGS = 256

    /**
     * A tap at ([xDp], [yDp]) in the overlay's coordinates, delivered the way a finger's DOWN and UP reach it: through
     * [root]'s `dispatchTouchEvent`. For the lab, which cannot press the screen itself.
     */
    fun tap(root: EngineRoot, xDp: Float, yDp: Float) {
      val density = root.resources.displayMetrics.density
      val x = xDp * density
      val y = yDp * density
      val down = SystemClock.uptimeMillis()
      val target = HitTest.find(root, x, y)
      Log.i("SvelteEngine", "tap ($xDp, $yDp) dp: hit ${target?.javaClass?.simpleName ?: "nothing"}, engine tag ${(target as? EngineNode)?.node?.tag ?: 0}${describe(target)}")
      send(root, down, down, MotionEvent.ACTION_DOWN, x, y)
      root.postDelayed({ send(root, down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y) }, TAP_HOLD_MS)
    }

    /**
     * A drag from ([fromX], [fromY]) to ([toX], [toY]) dp in [steps] moves over [durationMs], the way a finger pans a map: DOWN, MOVEs,
     * UP, each through [root]'s `dispatchTouchEvent`. For the lab.
     */
    fun drag(root: EngineRoot, fromX: Float, fromY: Float, toX: Float, toY: Float, durationMs: Long, steps: Int) {
      val density = root.resources.displayMetrics.density
      val down = SystemClock.uptimeMillis()
      val target = HitTest.find(root, fromX * density, fromY * density)
      Log.i("SvelteEngine", "drag from ($fromX, $fromY) dp: hit ${target?.javaClass?.simpleName ?: "nothing"}, engine tag ${(target as? EngineNode)?.node?.tag ?: 0}${describe(target)}")
      send(root, down, down, MotionEvent.ACTION_DOWN, fromX * density, fromY * density)
      val count = steps.coerceAtLeast(1)
      for (i in 1..count) {
        val fraction = i / count.toFloat()
        val action = if (i == count) MotionEvent.ACTION_UP else MotionEvent.ACTION_MOVE
        root.postDelayed({
          send(root, down, SystemClock.uptimeMillis(), action, (fromX + (toX - fromX) * fraction) * density, (fromY + (toY - fromY) * fraction) * density)
        }, durationMs * i / count)
      }
    }

    /** The views a touch lands in below [view] (class, bounds, visibility), two levels deep: what the platform's dispatch walks. */
    private fun describe(view: View?, depth: Int = 2): String {
      if (view == null) return ""
      val self = " [${view.javaClass.simpleName} ${view.left},${view.top},${view.right},${view.bottom}${if (view.visibility == View.VISIBLE) "" else " hidden"}"
      if (view !is android.view.ViewGroup || depth == 0) return "$self]"
      return self + (0 until view.childCount).joinToString("") { describe(view.getChildAt(it), depth - 1) } + "]"
    }

    private fun send(root: EngineRoot, downTime: Long, eventTime: Long, action: Int, x: Float, y: Float) {
      val event = MotionEvent.obtain(downTime, eventTime, action, x, y, 0)
      // A finger on the screen, as gesture detectors (a map's) check the source.
      event.source = InputDevice.SOURCE_TOUCHSCREEN
      try {
        root.dispatchTouchEvent(event)
      } finally {
        event.recycle()
      }
    }
  }
}
