package expo.modules.svelteappearance

import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.appcompat.app.AppCompatDelegate
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Sets the app's night mode from its `userInterfaceStyle` ([AppearanceRules]) at `Application.onCreate`, before any activity exists, so the first activity starts in its mode
 * and is not made again. React Native's `Appearance`, and so `colorScheme`, the screens' and texts' default colours (`src/system-colors.ts`) and the engine's own views, read
 * the mode of the activity, which AppCompat gives the night mode set here. Expo autolinking finds the class by its name and its `Package` import, as `SveltePushPackage`.
 */
class SvelteAppearancePackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> {
    val night = AppearanceRules.night(style(context)) ?: return emptyList()
    return listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          AppCompatDelegate.setDefaultNightMode(
            when (night) {
              AppearanceRules.Night.FOLLOW_SYSTEM -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
              AppearanceRules.Night.NO -> AppCompatDelegate.MODE_NIGHT_NO
              AppearanceRules.Night.YES -> AppCompatDelegate.MODE_NIGHT_YES
            },
          )
        }
      },
    )
  }

  @Suppress("DEPRECATION")
  private fun style(context: Context): String? =
    try {
      val manager = context.packageManager
      val info =
        if (Build.VERSION.SDK_INT >= 33) {
          manager.getApplicationInfo(context.packageName, PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()))
        } else {
          manager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        }
      info.metaData?.getString(AppearanceRules.META_STYLE)
    } catch (error: PackageManager.NameNotFoundException) {
      Log.w("SvelteAppearance", "the application's own manifest could not be read, so the night mode is the system's: $error")
      null
    }
}
