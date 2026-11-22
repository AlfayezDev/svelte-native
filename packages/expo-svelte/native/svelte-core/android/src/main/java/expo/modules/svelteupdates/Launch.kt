package expo.modules.svelteupdates

import android.content.Context
import expo.modules.sveltecore.BuildConfig
import java.io.File

/** What this process launched (or will launch after a reload), and the configuration it was chosen under. */
internal class LaunchState(
  val config: UpdatesConfig,
  val store: UpdateStore?,
  val updateId: String?,
  val bundlePath: String?,
  /** The launched update's `createdAt`, or the embedded bundle's effective commit time. */
  val createdAt: Long,
  /** Asset key to `file://` URI of the launched update's downloaded files that exist on disk. */
  val localAssets: Map<String, String>,
  val clientId: String,
)

/**
 * The launch decision, made once per process before the React host reads its bundle path (`SvelteUpdatesPackage`) and shared with
 * the module's constants. A reload makes a new decision with the updates committed since.
 */
internal object Launch {
  @Volatile private var current: LaunchState? = null

  fun get(context: Context): LaunchState = current ?: synchronized(this) { current ?: decide(context, markFailure = true).also { current = it } }

  fun relaunch(context: Context): LaunchState = synchronized(this) { decide(context, markFailure = false).also { current = it } }

  private fun decide(context: Context, markFailure: Boolean): LaunchState {
    val started = System.nanoTime()
    val application = context.applicationContext
    val config = UpdatesConfig.read(application)
    val buildTime = BuildConfig.BUILD_TIME_MS
    if (!config.enabled) return LaunchState(config, null, null, null, buildTime, emptyMap(), "")
    val store = UpdateStore(File(application.filesDir, "svelte-updates"))
    // The QA reset is asked about only when the store holds something to forget; the time it takes is logged for the QA app.
    var resetReadMicros: Long? = null
    var resetToken: String? = null
    val selection = store.select(config, buildTime, markFailure) {
      val readStarted = System.nanoTime()
      QaReset.requested(application).also {
        resetToken = it
        resetReadMicros = (System.nanoTime() - readStarted) / 1000
      }
    }
    selection.resetForgotten?.let { android.util.Log.w("SvelteUpdates", "QA reset ($resetToken): forgot $it update(s), the failed list and the launch marker") }
    selection.emergencyReason?.let { android.util.Log.w("SvelteUpdates", "$it; launching the previous update or the embedded bundle") }
    val update = selection.update
    android.util.Log.i("SvelteUpdates", if (update != null) "Launching update ${update.id} (created ${update.createdAt})" else "Launching the embedded bundle (built ${selection.embeddedCreatedAt})")
    val localAssets = update?.assets.orEmpty()
      .filter { it.first != update?.launchAssetKey }
      .map { (key, extension) -> key to store.assetFile(key, extension) }
      .filter { it.second.isFile }
      .associate { (key, file) -> key to "file://${file.absolutePath}" }
    val state = LaunchState(
      config = config,
      store = store,
      updateId = update?.id,
      bundlePath = update?.let { store.bundleFile(it).absolutePath },
      createdAt = update?.createdAt ?: selection.embeddedCreatedAt,
      localAssets = localAssets,
      clientId = store.clientId(),
    )
    if (application.packageName == QaReset.PACKAGE) {
      val read = resetReadMicros?.let { "reset flag read in $it us" } ?: "reset flag not read (empty store)"
      android.util.Log.i("SvelteUpdates", "Launch decided in ${(System.nanoTime() - started) / 1000} us on thread ${Thread.currentThread().name}; $read")
    }
    return state
  }

  /**
   * A fatal JavaScript or host exception, reported by the React host (`SvelteUpdatesPackage`). When this process launched a downloaded
   * update that is still unconfirmed, the launch is marked as having failed: the next start fails the update. An exception while
   * the embedded bundle runs, or after the launch was confirmed, changes nothing.
   */
  fun recordFatal(context: Context) {
    val state = current ?: return
    val id = state.updateId ?: return
    state.store?.markFatal(id)
  }
}
