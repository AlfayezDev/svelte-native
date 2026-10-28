package expo.modules.svelteengine.views

import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/**
 * The QA harness's in-app touch injector (SPEC.md, "Gestures", "Driving the lab"): pointer paths in, one `MotionEvent` per
 * `Choreographer` frame out, dispatched with `EngineRoot.dispatchTouchEvent`. It is the way to drive what `adb shell input` cannot:
 * two pointers (a pinch, a rotation) and drags paced by the frame, with `eventTime` the frame time, so a frame-time measurement of a
 * gesture-driven animation is not skewed by the shell's own timing. It skips `InputDispatcher` and `ViewRootImpl`, which is why every
 * single-pointer scenario also runs once through `adb input` and the counters must agree.
 *
 * It is a module of its own (`SvelteQaTouch`, listed in `expo-module.config.json`), not a function of `SvelteEngine`, and it does
 * nothing but refuse unless the app is the QA variant (`io.rasheed.svelteqa`): the production package never injects a touch.
 *
 * `run(plan)` takes JSON, `{"durationMs": 600, "pointers": [{"waypoints": [[t, x, y], ...]}, ...]}`, with `t` in milliseconds from
 * the start and `x`, `y` in window pixels (what `measureInWindow` times the density gives). A pointer goes down at its first waypoint's
 * time, follows the waypoints (straight lines, clamped at both ends) and goes up at its last waypoint's time. It resolves, after the
 * last pointer is up, with `{"frames": n, "frameTimesMs": [...], "touchSlopPx": s, "density": d, "dispatched": n}`: the frame times
 * are what the lab reproduces to say what a pinch should have read (`expectedTwoFinger` in `gestures-lab.ts`).
 */
internal const val QA_PACKAGE = "io.rasheed.svelteqa"

/** One pointer's path: times in milliseconds from the start of the gesture, positions in window pixels. */
internal class QaPointer(private val times: DoubleArray, private val xs: FloatArray, private val ys: FloatArray) {
  val startMs: Double get() = times.first()
  val endMs: Double get() = times.last()

  fun x(t: Double): Float = at(t, xs)
  fun y(t: Double): Float = at(t, ys)

  private fun at(t: Double, values: FloatArray): Float {
    if (t <= times.first()) return values.first()
    if (t >= times.last()) return values.last()
    for (i in 1 until times.size) {
      if (t > times[i]) continue
      val span = times[i] - times[i - 1]
      val f = if (span <= 0.0) 1.0 else (t - times[i - 1]) / span
      return (values[i - 1] + (values[i] - values[i - 1]) * f).toFloat()
    }
    return values.last()
  }
}

internal class QaPlan(val pointers: List<QaPointer>, val durationMs: Double) {
  companion object {
    fun parse(json: String): QaPlan {
      val root = JSONObject(json)
      val list = root.getJSONArray("pointers")
      require(list.length() in 1..MAX_POINTERS) { "a plan has 1 to $MAX_POINTERS pointers, not ${list.length()}" }
      val pointers = (0 until list.length()).map { index ->
        val waypoints = list.getJSONObject(index).getJSONArray("waypoints")
        require(waypoints.length() >= 2) { "pointer $index needs at least two waypoints" }
        val times = DoubleArray(waypoints.length())
        val xs = FloatArray(waypoints.length())
        val ys = FloatArray(waypoints.length())
        for (i in 0 until waypoints.length()) {
          val point: JSONArray = waypoints.getJSONArray(i)
          times[i] = point.getDouble(0)
          xs[i] = point.getDouble(1).toFloat()
          ys[i] = point.getDouble(2).toFloat()
          require(i == 0 || times[i] >= times[i - 1]) { "pointer $index: waypoint times must not decrease" }
        }
        QaPointer(times, xs, ys)
      }
      return QaPlan(pointers, root.optDouble("durationMs", pointers.maxOf { it.endMs }))
    }

    const val MAX_POINTERS = 4
  }
}

/** Dispatches one plan on `root`, one event per frame; `onDone` gets the result JSON, or the failure. */
internal class QaInjector(private val root: View, private val plan: QaPlan, private val onDone: (String?, Throwable?) -> Unit) : Choreographer.FrameCallback {
  private val density = root.resources.displayMetrics.density
  private val slop = ViewConfiguration.get(root.context).scaledTouchSlop
  private val offset = IntArray(2)
  private var startNanos = -1L
  private var downTime = 0L
  private val down = BooleanArray(plan.pointers.size)
  private val up = BooleanArray(plan.pointers.size)
  /** The pointers that are down, in the order they went down: their index here is the pointer index of the events. */
  private val active = ArrayList<Int>(plan.pointers.size)
  private val frameTimes = ArrayList<Double>()
  private var dispatched = 0
  private var finished = false

  fun start() {
    Handler(Looper.getMainLooper()).post { Choreographer.getInstance().postFrameCallback(this) }
  }

  override fun doFrame(frameTimeNanos: Long) {
    if (finished) return
    try {
      if (startNanos < 0) { startNanos = frameTimeNanos; downTime = frameTimeNanos / 1_000_000 }
      val elapsed = (frameTimeNanos - startNanos) / 1_000_000.0
      if (elapsed > plan.durationMs + TIMEOUT_MS) throw IllegalStateException("the plan did not finish within ${plan.durationMs + TIMEOUT_MS} ms")
      frameTimes.add(elapsed)
      root.getLocationInWindow(offset)
      val eventTime = frameTimeNanos / 1_000_000
      val moved = active.isNotEmpty()
      // Pointers whose time has come go down, one event each (the first is ACTION_DOWN, the others ACTION_POINTER_DOWN).
      for (id in plan.pointers.indices) {
        if (down[id] || plan.pointers[id].startMs > elapsed) continue
        down[id] = true
        active.add(id)
        send(if (active.size == 1) MotionEvent.ACTION_DOWN else MotionEvent.ACTION_POINTER_DOWN or ((active.size - 1) shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), eventTime, elapsed)
      }
      // The pointers that were already down move, all in one event.
      if (moved) send(MotionEvent.ACTION_MOVE, eventTime, elapsed)
      // Pointers whose time is over go up, the last of them with ACTION_UP.
      for (id in plan.pointers.indices) {
        if (!down[id] || up[id] || plan.pointers[id].endMs > elapsed) continue
        val index = active.indexOf(id)
        send(if (active.size == 1) MotionEvent.ACTION_UP else MotionEvent.ACTION_POINTER_UP or (index shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), eventTime, elapsed)
        up[id] = true
        active.removeAt(index)
      }
      if (up.all { it }) { finish(null) } else Choreographer.getInstance().postFrameCallback(this)
    } catch (error: Throwable) {
      finish(error)
    }
  }

  private fun send(action: Int, eventTime: Long, elapsed: Double) {
    val count = active.size
    val properties = Array(count) { slot -> MotionEvent.PointerProperties().also { it.id = active[slot]; it.toolType = MotionEvent.TOOL_TYPE_FINGER } }
    val coords = Array(count) { slot ->
      val pointer = plan.pointers[active[slot]]
      MotionEvent.PointerCoords().also { it.x = pointer.x(elapsed); it.y = pointer.y(elapsed); it.pressure = 1f; it.size = 1f }
    }
    val event = MotionEvent.obtain(downTime, eventTime, action, count, properties, coords, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
    // The plan is in window pixels, which is what `rawX` reports; the view wants its own coordinates.
    event.offsetLocation(-offset[0].toFloat(), -offset[1].toFloat())
    try {
      root.dispatchTouchEvent(event)
      dispatched++
    } finally {
      event.recycle()
    }
  }

  private fun finish(error: Throwable?) {
    if (finished) return
    finished = true
    if (error != null) { onDone(null, error); return }
    val times = frameTimes.joinToString(",") { "%.2f".format(java.util.Locale.ROOT, it) }
    onDone("""{"frames":${frameTimes.size},"frameTimesMs":[$times],"touchSlopPx":$slop,"density":$density,"dispatched":$dispatched}""", null)
  }

  private companion object {
    const val TIMEOUT_MS = 3000
  }
}

class SvelteQaTouchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SvelteQaTouch")

    AsyncFunction("run") { json: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null || context.packageName != QA_PACKAGE) {
        promise.reject("ERR_QA_ONLY", "SvelteQaTouch injects touches in the QA app ($QA_PACKAGE) only", null)
        return@AsyncFunction
      }
      Handler(Looper.getMainLooper()).post {
        try {
          val decor = appContext.currentActivity?.window?.decorView ?: throw IllegalStateException("no activity window to inject into")
          val root = findRoot(decor) ?: throw IllegalStateException("the engine's root view is not attached (the engine is not installed)")
          QaInjector(root, QaPlan.parse(json)) { result, error ->
            if (error != null) promise.reject("ERR_QA_TOUCH", error.message ?: error.javaClass.simpleName, error) else promise.resolve(result)
          }.start()
        } catch (error: Throwable) {
          promise.reject("ERR_QA_TOUCH", error.message ?: error.javaClass.simpleName, error)
        }
      }
    }
  }

  private fun findRoot(view: View): EngineRoot? {
    if (view is EngineRoot) return view
    if (view !is ViewGroup) return null
    for (i in 0 until view.childCount) findRoot(view.getChildAt(i))?.let { return it }
    return null
  }
}
