package expo.modules.svelteengine.views

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.util.Log

/**
 * Builds the view the first screen of the app creates, once, on a thread of its own while the JavaScript thread is still starting.
 *
 * Why: the first transaction of the app creates an [EngineSpinner] (the loading indicator). A framework `ProgressBar` of Samsung's
 * One UI inflates its five indeterminate drawables when it is constructed (`sem_progress_bar_indeterminate_{xsmall..xlarge}`, each an
 * animated vector with its animators): about 23 ms of the 30 ms the main thread spends on that transaction, which is on the way to
 * the first frame (Perfetto, Galaxy A16). The parsed drawables are cached by the `Resources` and the theme of the context that
 * inflated them, so the first instance built anywhere with that context makes the later ones cheap. The main thread is idle from the
 * end of the Activity's start-up until the first transaction arrives (the JavaScript thread needs about 100 ms more), so the
 * instance is built then, at background priority.
 */
object ViewWarmup {
  /**
   * Call from the Activity's `onCreate`. The engine's views are built with a context that wraps the Application's
   * (`MountingManager.viewContext`), and the drawable cache is keyed by the theme the context carries, so the indicator is built
   * with the Application's theme, not the Activity's: with the Activity's, the first screen found nothing cached.
   */
  @JvmStatic fun begin(activity: Context) {
    val context = activity.applicationContext
    val thread = HandlerThread("svelte-view-warm", Process.THREAD_PRIORITY_BACKGROUND)
    thread.start()
    Handler(thread.looper).post {
      try {
        EngineSpinner(context, 0)
      } catch (error: RuntimeException) {
        Log.w("SvelteEngine", "ViewWarmup: could not build the indicator ahead of the first screen", error)
      } finally {
        thread.quitSafely()
      }
    }
  }
}
