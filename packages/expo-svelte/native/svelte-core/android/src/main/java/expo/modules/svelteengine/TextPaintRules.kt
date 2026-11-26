package expo.modules.svelteengine

/**
 * Which paint a text is laid out with (SPEC.md, "Text parity"): `src/test/run.sh` runs `TextPaintRulesCheck` on a plain JVM.
 *
 * `ReactTextView` is a `TextView` with the platform's default typeface: a fragment's font comes only from its `CustomStyleSpan`, so the layout's own paint is the default font at the
 * paragraph's size, and the ellipsis, which `Layout.calculateEllipsis` measures with that paint, is as wide as the default font's "…" is.
 */
object TextPaintRules {
  /**
   * Whether a text of [fragments] with these settings is laid out with no span at all, its font in the paint: a single plain fragment that can neither shrink to fit nor end in an
   * ellipsis ([maxLines] 0 is no limit). Any other text has its font in a span and the view's paint under it.
   */
  fun fontInPaint(fragments: Int, plain: Boolean, fit: Boolean, maxLines: Int): Boolean = fragments == 1 && plain && !fit && maxLines <= 0
}
