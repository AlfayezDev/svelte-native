package expo.modules.svelteupdates

import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactNativeHostHandler

/**
 * Gives the React host the bundle to load. `ExpoReactHostFactory.getDefaultReactHost` asks every autolinked package's handler for
 * `getJSBundleFile` each time it builds a bundle loader (so a reload picks up a newly selected update), and falls back to the
 * bundle embedded in the app when no handler answers. Expo autolinking finds this class by its name (`*Package`) and its
 * `expo.modules.core.interfaces.Package` import.
 */
class SvelteUpdatesPackage : Package {
  override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> = listOf(
    object : ReactNativeHostHandler {
      override fun getJSBundleFile(useDeveloperSupport: Boolean): String? =
        if (useDeveloperSupport) null else Launch.get(context).bundlePath
    },
  )
}
