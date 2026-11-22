package expo.modules.sveltelocation

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log

private const val LOG_TAG = "SvelteLocation"

/**
 * The application's `<meta-data>`, which is how the config plugin (`capabilities.ts`) tells this code that location is on in this build ([enabled]). Read once per process, since the manifest
 * cannot change while it lives: the app without location pays for one package manager call, at the module's first question.
 */
internal object LocationManifest {
  @Volatile
  private var enabledAnswer: Boolean? = null

  /** Whether location is on in this build (`LocationRules.enabled`). Every entry into this code asks first and does nothing when it is off: no provider is asked, nothing is started. */
  @Suppress("DEPRECATION")
  fun enabled(context: Context): Boolean {
    enabledAnswer?.let { return it }
    val answer = try {
      val manager = context.packageManager
      val info =
        if (Build.VERSION.SDK_INT >= 33) {
          manager.getApplicationInfo(context.packageName, PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()))
        } else {
          manager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        }
      val meta = info.metaData
      LocationRules.enabled { name -> meta?.get(name) }
    } catch (error: PackageManager.NameNotFoundException) {
      Log.w(LOG_TAG, "the application's own manifest could not be read, so location is off: $error")
      false
    }
    enabledAnswer = answer
    return answer
  }
}
