package expo.modules.sveltepush

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * The two hooks this module needs before any JavaScript exists. Expo autolinking finds this class by its name (`*Package`) and its `expo.modules.core.interfaces.Package`
 * import (`expo-modules-autolinking`, `platforms/android/android.js`), and the app's `Application` and `MainActivity` call what it makes:
 * `ApplicationLifecycleDispatcher.onApplicationCreate` runs the application listener at `Application.onCreate`, before the React host starts, so the foreground count is
 * exact; `ReactActivityDelegateWrapper` runs the activity listeners at the Activity's `onCreate` and `onNewIntent`, which is where a tap is read.
 */
class SveltePushPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> = listOf(
    object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        PushRuntime.install(application)
      }
    },
  )

  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> = listOf(PushTapListener())
}
