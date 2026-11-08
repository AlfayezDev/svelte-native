package expo.modules.svelteengine

/**
 * What a header and a sheet decide from measurements that may not be there yet: `src/test/run.sh` runs it on a plain JVM.
 *
 * The first layout of a screen runs detached (`MountingManager.flushScreens` places the screen's whole subtree before the stack attaches it), where the
 * window reports no insets and the stack around a sheet may have no size yet. What was worked out then is wrong until a later layout works it out again,
 * and a later layout that finds the view's own frame unchanged does not run `onLayout`'s `changed` branch: a header and a sheet kept what they drew detached
 * (a screen pushed onto a stack, and the first screen of the app's stack when a launch link is opened before the `<Router>` mounts).
 */
object ChromeRules {
  /**
   * The status bar inset a header takes from the window: [reported] (null while the window has none), except inside a sheet ([inSheet]). A sheet is moved
   * by its translation, not by its layout position, and its box is taller than the stack (so it starts above the stack's top): the position says nothing
   * about what the status bar covers (about 100 px too much for a sheet that rests at its lower detent), so the header keeps the padding its screen gave it.
   */
  fun headerInset(inSheet: Boolean, reported: Int?): Int? = if (inSheet) null else reported

  /** Whether a header that laid out with the inset [used] (negative: the window had reported none) is out of date now that the window says [now] (null: still none). */
  fun insetStale(used: Int, now: Int?): Boolean = now != null && now != used

  /**
   * Whether a layout puts an idle sheet at its rest again: its own frame [changed], or the rest it was last put at ([applied], NaN before the first) is not
   * the [rest] the layout works out now (the stack got its size, the window reported the status bar).
   */
  fun sheetMoves(applied: Float, rest: Float, changed: Boolean): Boolean = changed || applied != rest
}
