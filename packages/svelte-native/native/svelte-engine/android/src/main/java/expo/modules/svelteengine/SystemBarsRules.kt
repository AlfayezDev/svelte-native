package expo.modules.svelteengine

/**
 * What the status and navigation bars do when an option is not set (`statusBar` / `navigationBar` of `<Screen>`, SPEC.md, "Screen API contract": `auto`
 * follows the system appearance), without Android types so that the host check (`src/test/run.sh`, `SystemBarsRulesCheck`) can run it.
 */
object SystemBarsRules {
  /** The style numbers of record 125: 0 `auto`, 1 `light` (light icons, for a dark background), 2 `dark` (dark icons, for a light background). */
  const val AUTO = 0
  const val LIGHT = 1
  const val DARK = 2

  /**
   * Whether the bar draws dark icons. `auto` follows the system: dark icons in the light appearance, light icons in the night one, which is what the
   * engine's header draws itself in (it follows the same configuration), so the icons are readable on it whatever the app's own colours are.
   * (The platform's flag, `isAppearanceLightStatusBars`, is named for the bar's background: light bar, dark icons.)
   */
  fun darkIcons(style: Int, night: Boolean): Boolean = when (style) {
    LIGHT -> false
    DARK -> true
    else -> !night
  }

  /**
   * Whether the window has to be written for a spec. The first time it always is, even for no spec at all: an app that never sets an option has the
   * default written once, instead of whatever the activity's theme leaves (light icons on a light header, the case that was missed when `applied`
   * began as the spec of "no option" and so equalled it). Afterwards only a spec that differs from the one written is.
   */
  fun needsWrite(written: Boolean, sameAsApplied: Boolean): Boolean = !written || !sameAsApplied
}
