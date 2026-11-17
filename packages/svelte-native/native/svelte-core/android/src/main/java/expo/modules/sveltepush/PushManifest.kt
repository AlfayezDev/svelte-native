package expo.modules.sveltepush

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log

/**
 * The application's `<meta-data>`, which is how the config plugin (`capabilities.ts`) tells this code anything: whether push is on in this build ([enabled]), and the channel, icon and
 * color. Read once per process, since the manifest cannot change while it lives. This is the one place that asks the package manager, so that the app without push pays for one call,
 * at the first of the places that ask (the package's listeners at `Application.onCreate`, or the module).
 */
internal object PushManifest {
  private var meta: Bundle? = null
  private var metaRead = false

  @Volatile
  private var enabledAnswer: Boolean? = null

  /** The application's `<meta-data>`, or null when there is none or the manifest could not be read (logged). */
  @Synchronized
  @Suppress("DEPRECATION")
  fun metaData(context: Context): Bundle? {
    if (metaRead) return meta
    try {
      val manager = context.packageManager
      val info =
        if (Build.VERSION.SDK_INT >= 33) {
          manager.getApplicationInfo(context.packageName, PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()))
        } else {
          manager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        }
      meta = info.metaData
    } catch (error: PackageManager.NameNotFoundException) {
      Log.w(LOG_TAG, "the application's own manifest could not be read, so push is off and the channel, icon and color are the defaults: $error")
    }
    metaRead = true
    return meta
  }

  /**
   * Whether push is on in this build (`PushRules.enabled`). Every entry into this code asks first and does nothing when it is off: no listener, no ledger, no channel, and no class of
   * Firebase, which an app without push does not have.
   */
  @Suppress("DEPRECATION")
  fun enabled(context: Context): Boolean {
    enabledAnswer?.let { return it }
    val answer = PushRules.enabled { name -> metaData(context)?.get(name) }
    enabledAnswer = answer
    return answer
  }
}
