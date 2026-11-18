package expo.modules.svelteappearance

/**
 * The app's light or dark mode from its `userInterfaceStyle`, which the config plugin writes into the manifest's meta-data (`src/user-interface-style.ts`): `light` (Expo's
 * default) keeps the app light whatever the system's mode, `dark` keeps it dark, `automatic` follows the system. Plain Kotlin, so the host check runs it
 * (`src/test/appearance.sh`); [SvelteAppearancePackage] turns the answer into AppCompat's night mode.
 */
internal object AppearanceRules {
  const val META_STYLE = "expo.modules.svelteappearance.user_interface_style"

  enum class Night { FOLLOW_SYSTEM, NO, YES }

  /** The night mode of a style; null when there is none (an app with `expo-system-ui`, which sets it itself, or one not prebuilt since): the night mode is left as it is. */
  fun night(style: String?): Night? =
    when (style?.trim()?.lowercase()) {
      "automatic" -> Night.FOLLOW_SYSTEM
      "light" -> Night.NO
      "dark" -> Night.YES
      else -> null
    }
}
