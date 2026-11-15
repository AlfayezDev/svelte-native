package expo.modules.svelteengine

import android.os.Bundle

/**
 * The root router's navigation state across an Activity's lifetime (SPEC.md, "Navigation state across recreation and process
 * death"). JavaScript writes the JSON with `SvelteEngine.saveNavigation` after every change. The Activity the app owns
 * (`MainActivity`, patched by the config plugin) keeps it in its saved instance state, which Android holds for a recreated
 * Activity and for a process that was killed while the app was in the background, and hands it back to JavaScript as
 * `initialProps.navigation` when it starts the surface again. The state of an Activity that is finishing is dropped.
 */
object NavigationState {
  private const val KEY = "svelte.navigation"
  // Bundles travel through a Binder transaction (about 1 MB for the whole process); a state this large is not kept rather than crashing the app on its way to the background.
  private const val LIMIT = 100_000

  /** The latest JSON the router wrote. */
  @Volatile private var json: String? = null

  /** Whether the Activity that was destroyed last was finishing (Back, a swipe from Recents) and not recreated: JavaScript reads it when its surface stops. */
  @Volatile var finishing = false
    private set

  fun save(value: String?) { json = value }

  /** `Activity.onSaveInstanceState`. */
  fun saveTo(outState: Bundle) {
    val current = json
    if (current != null && current.length <= LIMIT) outState.putString(KEY, current)
  }

  /** `Activity.onCreate`: what the Activity was saved with, for `initialProps.navigation`. */
  fun restoredFrom(saved: Bundle?): String? = saved?.getString(KEY)

  /** `Activity.onDestroy`, before React Native stops the surface. */
  fun destroyed(isFinishing: Boolean) {
    finishing = isFinishing
    if (isFinishing) json = null
  }
}
