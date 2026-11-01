package expo.modules.svelteupdates

import android.content.Context
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
    val application = context.applicationContext
    val config = UpdatesConfig.read(application)
    val buildTime = BuildConfig.BUILD_TIME_MS
    if (!config.enabled) return LaunchState(config, null, null, null, buildTime, emptyMap(), "")
    val store = UpdateStore(File(application.filesDir, "svelte-updates"))
    val resetToken = QaReset.requested(application)
    if (resetToken != null) {
      val forgotten = store.reset(resetToken)
      if (forgotten != null) android.util.Log.w("SvelteUpdates", "QA reset ($resetToken): forgot $forgotten update(s), the failed list and the launch marker")
    }
    val selection = store.select(config, buildTime, markFailure)
    selection.emergencyReason?.let { android.util.Log.w("SvelteUpdates", "$it; launching the previous update or the embedded bundle") }
    val update = selection.update
    android.util.Log.i("SvelteUpdates", if (update != null) "Launching update ${update.id} (created ${update.createdAt})" else "Launching the embedded bundle (built ${selection.embeddedCreatedAt})")
    val localAssets = update?.assets.orEmpty()
      .filter { it.first != update?.launchAssetKey }
      .map { (key, extension) -> key to store.assetFile(key, extension) }
      .filter { it.second.isFile }
      .associate { (key, file) -> key to "file://${file.absolutePath}" }
    return LaunchState(
      config = config,
      store = store,
      updateId = update?.id,
      bundlePath = update?.let { store.bundleFile(it).absolutePath },
      createdAt = update?.createdAt ?: selection.embeddedCreatedAt,
      localAssets = localAssets,
      clientId = store.clientId(),
    )
  }
}
