package expo.modules.svelteupdates

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import org.json.JSONObject

/**
 * The build's updates configuration, read from the `AndroidManifest.xml` meta-data that Expo's config plugin writes from
 * `updates` and `runtimeVersion` in the app config (the same keys expo-updates reads), so `expo prebuild` and EAS Build need
 * nothing from this module.
 */
internal data class UpdatesConfig(
  val enabled: Boolean,
  val updateUrl: String?,
  val runtimeVersion: String?,
  val requestHeaders: Map<String, String>,
  val checkOnLaunch: String,
  val launchWaitMs: Int,
  val hasEmbeddedUpdate: Boolean,
) {
  companion object {
    private const val PREFIX = "expo.modules.updates."

    @Suppress("DEPRECATION")
    fun read(context: Context): UpdatesConfig {
      val meta = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData
      fun value(key: String): String? = meta?.get(PREFIX + key)?.toString()
      val url = value("EXPO_UPDATE_URL")?.takeIf { it.isNotEmpty() }
      val runtimeVersion = value("EXPO_RUNTIME_VERSION")?.takeIf { it.isNotEmpty() }
      // A debuggable build runs from Metro, so there is nothing to launch or fetch.
      val debuggable = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
      return UpdatesConfig(
        enabled = value("ENABLED").toBoolean() && url != null && runtimeVersion != null && !debuggable,
        updateUrl = url,
        runtimeVersion = runtimeVersion,
        requestHeaders = value("UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY")?.let { headers(it) } ?: emptyMap(),
        checkOnLaunch = value("EXPO_UPDATES_CHECK_ON_LAUNCH")?.takeIf { it in CHECK_MODES } ?: "ALWAYS",
        launchWaitMs = value("EXPO_UPDATES_LAUNCH_WAIT_MS")?.toIntOrNull() ?: 0,
        hasEmbeddedUpdate = value("HAS_EMBEDDED_UPDATE")?.toBoolean() ?: true,
      )
    }

    private val CHECK_MODES = setOf("ALWAYS", "NEVER", "WIFI_ONLY", "ERROR_RECOVERY_ONLY")

    private fun headers(json: String): Map<String, String> {
      val source = JSONObject(json)
      return source.keys().asSequence().associateWith { source.getString(it) }
    }
  }
}
