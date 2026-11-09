package expo.modules.svelteupdates

import android.content.Context
import android.provider.Settings

/**
 * The QA harness's way to start from an empty updates store on a device it may not clear (a shared phone takes `adb install -r` and
 * nothing that deletes the app's data). The harness puts a token in the global setting `svelte_qa_reset_updates`
 * (`adb shell settings put global`, which the shell may do and the app may read); the first start that sees a token it has not
 * honoured forgets every downloaded update and the failed list (`UpdateStore.reset`) before it chooses a bundle. Honoured only
 * in the QA app: any other package answers null without reading anything. The harness deletes the setting as soon as the first
 * launch reports the reset.
 */
internal object QaReset {
  const val PACKAGE = "io.example.svelteqa"
  const val SETTING = "svelte_qa_reset_updates"

  /** The decision, apart from Android: the token to honour, or null. `read` is not called for any package but the QA app's. */
  fun requested(packageName: String, read: () -> String?): String? {
    if (packageName != PACKAGE) return null
    return try {
      read()?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) {
      null
    }
  }

  fun requested(context: Context): String? =
    requested(context.packageName) { Settings.Global.getString(context.contentResolver, SETTING) }
}
