package expo.modules.svelteengine

/**
 * How the window's insets and frame reach JavaScript (SPEC.md, "Insets"): `src/test/run.sh` runs `InsetRulesCheck` on a plain JVM.
 *
 * `react-native-safe-area-context` serializes them as `PixelUtil.toDIPFromPixel(px)`: the pixels divided by the density, in a float, not rounded. A top inset of 128 px at 2.625 is
 * 48.761906 dp there; rounded to two decimals (48.76) it is 0.005 px short, which moves every view below a safe area by that much, and a layout that lands on a half pixel
 * (a card's bottom edge, a field's, an indicator's) rounds the other way than React Native's does.
 */
object InsetRules {
  /** [px] in dp as `PixelUtil.toDIPFromPixel` gives it: a float division, whole precision. */
  fun dp(px: Int, density: Float): Double = (px.toFloat() / density).toDouble()

  /**
   * A size in px as the header, the toolbar and the tab bar report it to JavaScript: a float division by the density, no rounding, as [dp] does for the inset. JavaScript's estimate of the
   * same size (the inset's dp plus the bar's) and what the native side measured are then the same number, so a screen that lays out with one and then with the other does not move.
   */
  fun metric(px: Float, density: Float): Float = px / density
}
