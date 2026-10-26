package expo.modules.svelteengine

import android.util.Log
import com.facebook.react.fabric.FabricUIManager
import com.facebook.react.uimanager.events.BatchEventDispatchedListener

/**
 * Delivers the events a batch's commit queued (`onLayout` above all) as soon as the batch is mounted.
 *
 * Fabric emits layout events at commit time into an asynchronous queue that only drains on the next event beat. On
 * Android that beat is `EventBeatManager.tick()`, which React Native calls from its event dispatcher's Choreographer
 * frame callback: a layout event reaches JavaScript one frame (16.7 ms at 60 Hz) after the mount, even when the mount
 * took 2 ms. iOS induces the beat before the main run loop sleeps, right after the mount; this does the same here. The
 * beat manager is React Native's and not reachable by API: it is found once as the dispatcher's batch listener (a private
 * `CopyOnWriteArrayList`); when that field is missing (another React Native), nothing changes.
 */
internal class EventBeat {
  private var listeners: List<BatchEventDispatchedListener>? = null

  fun install(fabric: FabricUIManager) {
    listeners = try {
      val dispatcher = fabric.eventDispatcher
      val field = dispatcher.javaClass.getDeclaredField("postEventDispatchListeners").apply { isAccessible = true }
      @Suppress("UNCHECKED_CAST")
      field.get(dispatcher) as? List<BatchEventDispatchedListener>
    } catch (e: ReflectiveOperationException) {
      Log.w("SvelteEngine", "event beat: no batch listener list on ${fabric.eventDispatcher.javaClass.simpleName}, layout events keep their frame of latency")
      null
    }
  }

  /** Main thread, after a batch was mounted. */
  fun induce() {
    val list = listeners ?: return
    for (listener in list) listener.onBatchEventDispatched()
  }
}
