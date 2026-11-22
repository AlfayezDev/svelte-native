package expo.modules.sveltepush

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * The two hooks this module needs before any JavaScript exists, and the one place they are registered. Expo autolinking finds this class by its name (`*Package`) and its
 * `expo.modules.core.interfaces.Package` import (`expo-modules-autolinking`, `platforms/android/android.js`), which scans the whole of svelte-core's project, so it needs no entry in
 * `expo-module.config.json`; the app's `Application` and `MainActivity` call what it makes: `ApplicationLifecycleDispatcher.onApplicationCreate` runs the application listener at
 * `Application.onCreate`, before the React host starts, so the foreground count is exact; `ReactActivityDelegateWrapper` runs the activity listeners at the Activity's `onCreate` and
 * `onNewIntent`, which is where a tap is read.
 *
 * It is in every app, because svelte-core is, so both lists are empty unless the config plugin turned push on for Android (`PushManifest.enabled`): an app without push gets no
 * lifecycle listener, no activity callback, no ledger reads and no channel from this code.
 */
class SveltePushPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> {
    if (!PushManifest.enabled(context)) return emptyList()
    return listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) {
          PushRuntime.install(application)
        }
      },
    )
  }

  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> {
    if (!PushManifest.enabled(activityContext)) return emptyList()
    return listOf(PushTapListener())
  }
}
