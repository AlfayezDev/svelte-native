package expo.modules.svelteappearance

import android.content.res.Configuration
import android.content.res.Resources
import androidx.appcompat.app.AppCompatDelegate

/**
 * Whether the app is in its dark mode: AppCompat's night mode when the app set one (its `userInterfaceStyle`, through [SvelteAppearancePackage] or expo-system-ui, or
 * `Appearance.setColorScheme`), else the system's. React Native's `Appearance` reports the same, so the screens and texts JavaScript colours and the engine's own views (the
 * header, the tab bar, the toolbar, the system bars' icons, the blur's default tint) agree. A view's resources carry the system's mode, which an app that keeps itself
 * light does not follow: read alone, they drew a dark header over a light screen.
 */
internal fun isNight(resources: Resources): Boolean =
  when (AppCompatDelegate.getDefaultNightMode()) {
    AppCompatDelegate.MODE_NIGHT_YES -> true
    AppCompatDelegate.MODE_NIGHT_NO -> false
    else -> resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
  }
