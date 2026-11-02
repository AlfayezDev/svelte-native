package expo.modules.svelteengine.views

import android.content.Context
import android.os.Handler
import android.os.Looper
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
 * instance is built then.
 *
 * The cache holds its entries by weak reference, so the instance is kept (in [held]) until the first real one exists: a collection in
 * between would drop the entries and the warm-up with them. [spinnerBuilt] (called by [EngineSpinner]) lets go of it; [firstMountStarted]
 * does so [HOLD_MS] after the first mount began, for a first screen that has no indicator.
 */
object ViewWarmup {
  private const val HOLD_MS = 3000L

  /** True on the warm-up thread while it builds, so that its own instance is not taken for the first real one. */
  private val warming = ThreadLocal<Boolean>()
  @Volatile private var held: EngineSpinner? = null
  @Volatile private var mounted = false

  /**
   * Call from the Activity's `onCreate`. The engine's views are built with a context that wraps the Application's
   * (`MountingManager.viewContext`), and the drawable cache is keyed by the theme the context carries, so the indicator is built
   * with the Application's theme, not the Activity's: with the Activity's, the first screen found nothing cached. The thread is a plain
   * one at the creator's priority: `THREAD_PRIORITY_BACKGROUND` would move it to the little cores' cpuset, where the work takes twice as long.
   */
  @JvmStatic fun begin(activity: Context) {
    val context = activity.applicationContext
    Thread({
      warming.set(true)
      try {
        val view = EngineSpinner(context, 0)
        if (!mounted) held = view
      } catch (error: Throwable) {
        Log.w("SvelteEngine", "ViewWarmup: could not build the indicator ahead of the first screen", error)
      } finally {
        warming.set(false)
      }
    }, "svelte-view-warm").apply { isDaemon = true }.start()
  }

  /** An [EngineSpinner] was constructed. The first one that is not the warm-up's is the first screen's: the cache has what it needs, [held] goes. */
  internal fun spinnerBuilt() {
    if (warming.get() == true) return
    mounted = true
    held = null
  }

  /** `BootBoost.release`: the first transaction is being applied. A first screen with no indicator would keep [held] for good otherwise. */
  internal fun firstMountStarted() {
    Handler(Looper.getMainLooper()).postDelayed({ held = null }, HOLD_MS)
  }
}
