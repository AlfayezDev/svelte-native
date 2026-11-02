package expo.modules.svelteengine.views

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.Trace
import android.util.Log
import android.widget.EditText
import expo.modules.svelteengine.Affinity
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * What the engine builds for its inputs before an input is asked for, on a thread of its own.
 *
 * **The caches.** The first `EditText` after a garbage collection costs the main thread 8 to 19 ms (`create` of the batch that mounts an input, Samsung A16,
 * `lab`): its default style decodes the 9-patch background (`edit_text_material`, 4.8 ms of it), then the colour lists, the cursor and handle drawables.
 * `Resources` caches those only through weak references to their constant states, so the next collection empties the cache and the next input pays
 * again, however recently the last one was built. A throwaway `EditText` built shortly after the first text view fills the cache, and the constant states
 * it ends up holding are kept for the life of the process, so the cache entries stay reachable.
 *
 * **The spare.** The constructor still runs on a cold core (5 to 9 ms), so an [EngineInput] is built ahead of time with the context the engine's views use
 * and [EngineInput.obtain] hands it to the mount. The next one is built [stock] after a spare is taken or missed.
 *
 * Everything runs on one plain thread (no Looper: an OEM constructor that wants a `Handler` fails and logs, instead of binding one to a dying Looper)
 * that exists while there is work and goes after 20 s, started from the main looper's next message rather than from inside a batch. It is kept off the big
 * cores, which belong to the main thread and the RenderThread while [expo.modules.svelteengine.MountBoost] holds them (a thread started during a boost
 * inherits its mask). Nothing it touches is shared with the main thread's state: no window, no event, nothing of [expo.modules.svelteengine.TextLayouts].
 */
internal object InputWarmup {
  private const val TAG = "SvelteEngine"
  private const val DELAY_MS = 400L
  private const val IDLE_SECONDS = 20L

  private val scheduled = AtomicBoolean(false)

  /** A build is queued or running: a second request waits for it instead of queueing another. */
  private val pending = AtomicBoolean(false)

  private val main = Handler(Looper.getMainLooper())

  /** The constant states and colour lists of a default `EditText`; held so that `Resources` keeps finding them. */
  @Volatile private var retained: Array<Any?>? = null

  private val worker: ScheduledThreadPoolExecutor by lazy {
    ScheduledThreadPoolExecutor(1) { task ->
      Thread({
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
        Affinity.keepOffBigCores()
        task.run()
      }, "svelte-input-warmup").apply { isDaemon = true }
    }.apply {
      setKeepAliveTime(IDLE_SECONDS, TimeUnit.SECONDS)
      allowCoreThreadTimeOut(true)
    }
  }

  /** Called when the engine builds a text view; only the first call of the process does anything: the caches and the first spare. */
  fun schedule(context: Context) {
    if (!scheduled.compareAndSet(false, true)) return
    enqueue(context, DELAY_MS, retain = true)
  }

  /** Builds the next input ahead of time, [delayMs] from now ([EngineInput.obtain]). Any thread. */
  fun stock(context: Context, delayMs: Long) = enqueue(context, delayMs, retain = false)

  private fun enqueue(context: Context, delayMs: Long, retain: Boolean) {
    if (!pending.compareAndSet(false, true)) return
    // The thread starts from the main looper's next message: this is called inside a batch.
    main.post {
      try {
        worker.schedule({ build(context, retain) }, delayMs, TimeUnit.MILLISECONDS)
      } catch (e: Throwable) {
        pending.set(false)
        Log.w(TAG, "input warm-up could not start its thread", e)
      }
    }
  }

  private fun build(context: Context, retain: Boolean) {
    var stale = false
    try {
      if (retain) retainCaches(context)
      Trace.beginSection("SvelteEngine.inputStock")
      try {
        stale = !EngineInput.stockSpare(context)
      } finally {
        Trace.endSection()
      }
    } catch (e: Throwable) {
      // A framework that refuses to build an editor off the main thread costs the optimisation, not the app; an uncaught error here would end the process.
      Log.w(TAG, "input warm-up failed", e)
    } finally {
      pending.set(false)
    }
    // A discard came while the input was being built (a configuration change): the one for the current generation is built now.
    if (stale) enqueue(context, 0L, retain = false)
  }

  private fun retainCaches(context: Context) {
    Trace.beginSection("SvelteEngine.inputWarmup")
    try {
      val edit = EditText(context)
      val held = ArrayList<Any?>(8)
      held.add(edit.background?.constantState)
      held.add(edit.textColors)
      held.add(edit.hintTextColors)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        for (drawable in arrayOf<Drawable?>(edit.textCursorDrawable, edit.textSelectHandle, edit.textSelectHandleLeft, edit.textSelectHandleRight)) {
          held.add(drawable?.constantState)
        }
      }
      held.add(ColorStateList.valueOf(edit.highlightColor))
      retained = held.toTypedArray()
    } finally {
      Trace.endSection()
    }
  }
}
