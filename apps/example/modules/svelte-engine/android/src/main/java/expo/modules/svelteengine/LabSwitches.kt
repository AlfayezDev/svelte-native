package expo.modules.svelteengine

/**
 * The switches the QA lab turns with a launch intent: `--ez svelteEngine false` (run the same build on React Native's own mounting
 * layer), `--ez svelteGestures true` and `?gestures=1` on a launch link (install the gesture handler root at start). They change
 * what the engine does, so a release build ignores them: only the QA app and a debuggable build read them, and anyone can send an
 * intent to any exported activity. Rules without an Android type, so the host check (`src/test/run.sh`) compiles this file as it is.
 */
class LabSwitches(
  /** False when the lab asked for React Native's own mounting. */
  val engineEnabled: Boolean,
  /** True when the lab asked for the gesture root at start. */
  val gesturesAtStart: Boolean,
) {
  companion object {
    /** The QA variant's package (`app.config.ts`: `io.rasheed.svelteqa` unless `APP_VARIANT=production`). */
    const val QA_PACKAGE = "io.rasheed.svelteqa"

    /** Whether the app reads the lab switches: the QA app, or a build that is debuggable anyway. */
    fun allowed(packageName: String, debuggable: Boolean): Boolean = debuggable || packageName == QA_PACKAGE

    /**
     * The switches of a launch. The providers read the intent and are not called at all when the app does not read the switches,
     * so a release build never looks at an extra: [engineExtra] is `svelteEngine`, [gesturesExtra] `svelteGestures`, [gesturesQuery]
     * the `gestures` query parameter of the launch link.
     */
    inline fun read(
      packageName: String,
      debuggable: Boolean,
      engineExtra: () -> Boolean?,
      gesturesExtra: () -> Boolean?,
      gesturesQuery: () -> String?,
    ): LabSwitches {
      if (!allowed(packageName, debuggable)) return LabSwitches(engineEnabled = true, gesturesAtStart = false)
      return LabSwitches(engineEnabled = engineExtra() != false, gesturesAtStart = gesturesExtra() == true || gesturesQuery() == "1")
    }
  }
}
