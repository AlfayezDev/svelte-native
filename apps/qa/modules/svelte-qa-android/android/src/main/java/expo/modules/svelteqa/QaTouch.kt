package expo.modules.svelteqa

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
import expo.modules.svelteengine.LabSwitches
import expo.modules.svelteengine.views.EngineRoot
import org.json.JSONArray
import org.json.JSONObject

/**
 * The QA harness's in-app touch injector (SPEC.md, "Gestures", "Driving the lab"): pointer paths in, one `MotionEvent` per
 * `Choreographer` frame out, dispatched with `EngineRoot.dispatchTouchEvent`. It is the way to drive what `adb shell input` cannot:
 * two pointers (a pinch, a rotation) and drags paced by the frame, with `eventTime` the frame time, so a frame-time measurement of a
 * gesture-driven animation is not skewed by the shell's own timing. It skips `InputDispatcher` and `ViewRootImpl`, which is why every
 * single-pointer scenario also runs once through `adb input` and the counters must agree.
 *
 * It is a module of its own (`SvelteQaTouch`, in the Expo module `svelte-qa-android`), not a function of `SvelteEngine`. The product
 * build leaves it out: `app.config.ts` passes it to the expo-svelte plugin's `autolinkingExclude` when `APP_VARIANT=production`,
 * which writes the exclusion into `settings.gradle`, so the class is not even compiled into that app. Should it be linked, it still
 * refuses unless the app is the QA variant (`io.rasheed.svelteqa`).
 *
 * What a finger does in the real pipeline, and what this reproduces. A touch panel samples at 120 to 240 Hz and the app receives
 * one `MotionEvent` per frame whose history holds the samples in between; the injector sends one MOVE per frame, with history
 * samples every [SAMPLE_MS] (4.17 ms, a 240 Hz panel) between this event and the last. When a frame comes late (the emulator's
 * software GL makes the main thread miss frames) the finger has still moved: the moves of the frames that were missed are sent
 * too, one per nominal period, back to back, so no event carries more than one period of travel and the arbitration of a gesture
 * does not depend on how late the frame was. `eventsMs` in the result are the times of the MOVE events (the model of a pinch needs
 * them), `lateFrames` how many frames came late.
 *
 * `run(plan)` takes JSON, `{"durationMs": 600, "pointers": [{"waypoints": [[t, x, y], ...]}, ...]}`, with `t` in milliseconds from
 * the start and `x`, `y` in window pixels (what `measureInWindow` times the density gives). A pointer goes down at its first waypoint's
 * time, follows the waypoints (straight lines, clamped at both ends) and goes up at its last waypoint's time. It resolves, after the
 * last pointer is up, with `{"frames": n, "frameTimesMs": [...], "touchSlopPx": s, "density": d, "dispatched": n, "lateFrames": n}`:
 * `frameTimesMs` are the times of every event (the DOWN, the moves, the catch-up moves) that the lab replays to say what a pinch
 * should have read (`expectedTwoFinger` in `gestures-lab.ts`).
 */
internal const val QA_PACKAGE = LabSwitches.QA_PACKAGE

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
  /** The nominal time between two frames, ms. */
  private val period = (1000f / (root.display?.refreshRate ?: 60f)).toDouble().coerceIn(8.0, 34.0)
  /** When the last event of any kind was sent, ms from the start. */
  private var lastSent = 0.0
  private var lateFrames = 0
  private var startNanos = -1L
  private var downTime = 0L
  private val down = BooleanArray(plan.pointers.size)
  private val up = BooleanArray(plan.pointers.size)
  /** The pointers that are down, in the order they went down: their index here is the pointer index of the events. */
  private val active = ArrayList<Int>(plan.pointers.size)
  private val eventTimes = ArrayList<Double>()
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
      // The pointers that were already down move, all in one event; a late frame is caught up with the moves it missed.
      if (moved) {
        if (elapsed - lastSent > period * 1.5) lateFrames++
        while (elapsed - lastSent > period * 1.5) send(MotionEvent.ACTION_MOVE, downTime + Math.round(lastSent + period), lastSent + period)
        send(MotionEvent.ACTION_MOVE, eventTime, elapsed)
      }
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

  private fun coordsAt(elapsed: Double): Array<MotionEvent.PointerCoords> = Array(active.size) { slot ->
    val pointer = plan.pointers[active[slot]]
    MotionEvent.PointerCoords().also { it.x = pointer.x(elapsed); it.y = pointer.y(elapsed); it.pressure = 1f; it.size = 1f }
  }

  /** One event at [elapsed] ms; a MOVE carries the panel's samples since the last event as its history, the last sample being the event's own. */
  private fun send(action: Int, eventTime: Long, elapsed: Double) {
    val count = active.size
    val properties = Array(count) { slot -> MotionEvent.PointerProperties().also { it.id = active[slot]; it.toolType = MotionEvent.TOOL_TYPE_FINGER } }
    val total = if (action == MotionEvent.ACTION_MOVE) ((elapsed - lastSent) / SAMPLE_MS).toInt().coerceIn(1, MAX_SAMPLES) else 1
    fun sampleAt(index: Double) = elapsed - (total - 1 - index) * SAMPLE_MS
    val first = sampleAt(0.0)
    val event = MotionEvent.obtain(downTime, if (total > 1) downTime + Math.round(first) else eventTime, action, count, properties, coordsAt(first), 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
    for (index in 1 until total) {
      val at = sampleAt(index.toDouble())
      event.addBatch(if (index == total - 1) eventTime else downTime + Math.round(at), coordsAt(at), 0)
    }
    // The plan is in window pixels, which is what `rawX` reports; the view wants its own coordinates.
    event.offsetLocation(-offset[0].toFloat(), -offset[1].toFloat())
    try {
      root.dispatchTouchEvent(event)
      dispatched++
      lastSent = elapsed
      // What a pinch's model replays: the events that put a pointer down or moved one.
      if (action != MotionEvent.ACTION_UP && (action and MotionEvent.ACTION_MASK) != MotionEvent.ACTION_POINTER_UP) eventTimes.add(elapsed)
    } finally {
      event.recycle()
    }
  }

  private fun finish(error: Throwable?) {
    if (finished) return
    finished = true
    if (error != null) { onDone(null, error); return }
    val times = eventTimes.joinToString(",") { "%.2f".format(java.util.Locale.ROOT, it) }
    onDone("""{"frames":${frameTimes.size},"frameTimesMs":[$times],"touchSlopPx":$slop,"density":$density,"dispatched":$dispatched,"lateFrames":$lateFrames}""", null)
  }

  private companion object {
    const val TIMEOUT_MS = 3000
    /** The panel's sampling interval (240 Hz) and how many samples one event holds at most. */
    const val SAMPLE_MS = 1000.0 / 240.0
    const val MAX_SAMPLES = 8
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
