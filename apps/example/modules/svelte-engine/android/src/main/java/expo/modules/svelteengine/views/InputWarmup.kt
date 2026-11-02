package expo.modules.svelteengine.views

import android.content.Context
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.os.Trace
import android.util.Log
import android.content.res.ColorStateList
import android.widget.EditText
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The first `EditText` after a garbage collection costs the main thread 8 to 19 ms (`create` of the batch that mounts an input, Samsung A16, `lab`):
 * its default style decodes the 9-patch background (`edit_text_material`, 4.8 ms of it), then the colour lists, the cursor and handle drawables.
 * `Resources` caches those only through weak references to their constant states, so the next collection empties the cache and the next input pays
 * again, however recently the last one was built. A throwaway `EditText` built on a thread of its own shortly after the first text view fills the
 * cache, and the constant states it ends up holding are kept for the life of the process, so the cache entries stay reachable.
 *
 * The instance is a plain framework `EditText` (not [EngineInput], which drops its background) and never reaches the main thread's state: no
 * window, no event, nothing of [expo.modules.svelteengine.TextLayouts].
 */
internal object InputWarmup {
  private const val TAG = "SvelteEngine"
  private const val DELAY_MS = 400L

  private val scheduled = AtomicBoolean(false)

  /** The constant states and colour lists of a default `EditText`; held so that `Resources` keeps finding them. */
  @Volatile private var retained: Array<Any?>? = null

  /** Called by every text view when it is built; only the first call of the process does anything. */
  fun schedule(context: Context) {
    if (!scheduled.compareAndSet(false, true)) return
    val thread = HandlerThread("svelte-input-warmup", Process.THREAD_PRIORITY_BACKGROUND)
    thread.start()
    Handler(thread.looper).postDelayed({
      try {
        warm(context)
      } catch (e: RuntimeException) {
        // A framework that refuses to build an editor off the main thread costs the optimisation, not the app.
        Log.w(TAG, "input warm-up failed", e)
      } finally {
        thread.quitSafely()
      }
    }, DELAY_MS)
  }

  private fun warm(context: Context) {
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
