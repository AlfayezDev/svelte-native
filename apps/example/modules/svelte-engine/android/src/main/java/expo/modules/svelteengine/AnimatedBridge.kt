package expo.modules.svelteengine

import android.os.Trace
import android.util.Log
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap

/**
 * Receiver of Reanimated's per-frame prop writes for engine views, without a `ReadableMap` (SPEC.md, "Animated write
 * path"). The patched Reanimated hands its serialized batch to AnimatedBridge.cpp on the UI thread; that code copies the
 * views it can write into [ints] as flat records (AnimatedWire) and calls [flush] once per frame. Main thread only.
 *
 * A record for a tag with no engine view (not mounted yet, deleted a moment ago, owned by someone else) goes through
 * [MountingManager.applyAnimated] as a small map, the same early-write replay, silent drop and ownership answer as
 * the `SvelteEngineHook.updater` path; a view that call does not take is rejected and C++ gives it back to Reanimated's
 * own path.
 */
@DoNotStrip
object AnimatedBridge {
  private const val TAG = "SvelteEngine"

  /** A view takes at least tag, record count, id and one payload word. */
  private const val MAX_VIEWS = (AnimatedWire.BUFFER_INTS - 1) / 4

  /** The records of one flush, filled by C++ (`SetIntArrayRegion`) before [flush] runs. */
  private val ints = IntArray(AnimatedWire.BUFFER_INTS)

  @Volatile private var manager: MountingManager? = null
  private val writer = AnimatedProps.TypedWriter()
  private var rejected = IntArray(16)
  private var loggedMismatch = false
  private var loggedFirst = false
  private var failures = 0

  private var installed = false

  init {
    System.loadLibrary("svelteengine")
  }

  /** Hands the buffer to C++ and registers the sink with Reanimated when its library is loaded. */
  fun install(manager: MountingManager) {
    this.manager = manager
    installed = true
    val registered = nativeInstall(ints)
    Log.i(TAG, "typed animated path ${if (registered) "registered with Reanimated" else "waiting for Reanimated"}")
  }

  /** Registers the sink when Reanimated's library was not loaded yet at [install] (the Fabric host loads it lazily). */
  fun attach() {
    if (manager == null) return
    val registered = nativeAttach()
    Log.i(TAG, "typed animated path ${if (registered) "registered with Reanimated" else "not available"}")
  }

  /** A host destroyed before the engine installed (a failed start) has nothing to clear in C++. */
  fun uninstall() {
    manager = null
    if (!installed) return
    installed = false
    nativeUninstall()
  }

  /** Called by C++ with [used] ints in [ints]. Returns the number of rejected views, whose ordinals replace the buffer from index 1. */
  @JvmStatic
  @DoNotStrip
  fun flush(used: Int): Int {
    Trace.beginSection("SvelteEngine.animated")
    try {
      val views = ints[0].coerceIn(0, MAX_VIEWS)
      val target = manager
      if (target == null || used < 1 || used > ints.size) return rejectAll(views)
      var count = 0
      var at = 1
      for (ordinal in 0 until views) {
        val tag = ints[at]
        val records = ints[at + 1]
        val view = target.viewFor(tag)
        val next: Int
        var taken = true
        if (view != null && writer.bind(view)) {
          next = AnimatedWire.decodeRecords(ints, at + 2, records, writer)
        } else {
          val map = MapWriter()
          next = AnimatedWire.decodeRecords(ints, at + 2, records, map)
          if (next >= 0) taken = target.applyAnimated(tag, map.props)
        }
        if (next < 0) {
          if (!loggedMismatch) Log.e(TAG, "typed animated buffer carries an unknown record id for tag $tag")
          loggedMismatch = true
          return rejectFrom(ordinal, views, count)
        }
        if (!taken) {
          if (count == rejected.size) rejected = rejected.copyOf(count * 2)
          rejected[count++] = ordinal
        }
        at = next
      }
      if (!loggedFirst) {
        loggedFirst = true
        Log.i(TAG, "typed animated path wrote its first frame: $views views, ${views - count} taken")
      }
      return publish(count)
    } catch (e: Throwable) {
      // The first few are logged; every view of the frame goes back to Reanimated's own path.
      if (failures++ < 3) Log.e(TAG, "typed animated flush failed", e)
      return rejectAll(ints[0].coerceIn(0, MAX_VIEWS))
    } finally {
      writer.release()
      Trace.endSection()
    }
  }

  /** The ordinals collected in [rejected] go to the front of [ints] for C++ to read back. */
  private fun publish(count: Int): Int {
    for (i in 0 until count) ints[1 + i] = rejected[i]
    return count
  }

  private fun rejectAll(views: Int): Int {
    for (i in 0 until views) ints[1 + i] = i
    return views
  }

  /** Everything from [from] on goes back to Reanimated, on top of the [count] views rejected before. */
  private fun rejectFrom(from: Int, views: Int, count: Int): Int {
    var n = count
    for (ordinal in from until views) {
      if (n == rejected.size) rejected = rejected.copyOf(n * 2)
      rejected[n++] = ordinal
    }
    return publish(n)
  }

  /**
   * The same records as the map Reanimated's Java path would have built, for [MountingManager.applyAnimated]: it keeps
   * the newest write of a tag that has no view yet and replays it through [AnimatedProps.apply] when the view arrives.
   * Allocates; only used for writes that miss a view.
   */
  private class MapWriter : AnimatedWire.Target {
    val props = JavaOnlyMap()

    override fun opacity(value: Float) = props.putDouble("opacity", value.toDouble())

    override fun background(color: Int) = props.putInt("backgroundColor", color)

    override fun radius(topLeft: Float, topRight: Float, bottomRight: Float, bottomLeft: Float) =
      props.putDouble("borderRadius", topLeft.toDouble())

    // Only the operations that differ from the identity: `AnimatedProps.apply` starts from the identity and accumulates.
    override fun transform(tx: Float, ty: Float, sx: Float, sy: Float, rotation: Float) {
      val ops = JavaOnlyArray()
      if (tx != 0f) ops.pushMap(JavaOnlyMap.of("translateX", tx.toDouble()))
      if (ty != 0f) ops.pushMap(JavaOnlyMap.of("translateY", ty.toDouble()))
      if (sx == sy) {
        if (sx != 1f) ops.pushMap(JavaOnlyMap.of("scale", sx.toDouble()))
      } else {
        if (sx != 1f) ops.pushMap(JavaOnlyMap.of("scaleX", sx.toDouble()))
        if (sy != 1f) ops.pushMap(JavaOnlyMap.of("scaleY", sy.toDouble()))
      }
      if (rotation != 0f) ops.pushMap(JavaOnlyMap.of("rotate", "${rotation}deg"))
      props.putArray("transform", ops)
    }

    override fun stacking(zIndex: Float, elevation: Float) {
      if (!zIndex.isNaN()) props.putDouble("zIndex", zIndex.toDouble())
      if (!elevation.isNaN()) props.putDouble("elevation", elevation.toDouble())
    }
  }

  /** Stores the buffer, finds Reanimated's sink setter and registers the sink; false when Reanimated is not loaded yet. */
  @JvmStatic private external fun nativeInstall(buffer: IntArray): Boolean

  @JvmStatic private external fun nativeAttach(): Boolean

  /** Clears the sink in Reanimated and drops the buffer reference. */
  @JvmStatic private external fun nativeUninstall()
}
