package expo.modules.svelteengine

/**
 * The switches the QA lab turns with a launch intent: `--ez svelteEngine false` (run the same build on React Native's own mounting
 * layer), `--ez svelteGestures true` and `?gestures=1` on a launch link (install the gesture handler root at start), and `?boost=0`
 * and `?spare=0` on a launch link (switch off the big-core boost that a bulk animated mount asks for, and the input built ahead of
 * time: the lab measures a change against the same build without it, in one run of alternating launches). They change what the
 * engine does, so a release build ignores them: only the QA app and a debuggable build read them, and anyone can send an intent to
 * any exported activity. Rules without an Android type, so the host check (`src/test/run.sh`) compiles this file as it is.
 */
class LabSwitches(
  /** False when the lab asked for React Native's own mounting. */
  val engineEnabled: Boolean,
  /** True when the lab asked for the gesture root at start. */
  val gesturesAtStart: Boolean,
  /** False when the lab switched off the boost that a commit of many animated nodes asks for (`?boost=0`). */
  val animatedBoost: Boolean = true,
  /** False when the lab switched off the input that is built ahead of time (`?spare=0`). */
  val inputSpare: Boolean = true,
) {
  companion object {
    /** The QA variant's package (`app.config.ts`: `io.rasheed.svelteqa` unless `APP_VARIANT=production`). */
    const val QA_PACKAGE = "io.rasheed.svelteqa"

    /** Whether the app reads the lab switches: the QA app, or a build that is debuggable anyway. */
    fun allowed(packageName: String, debuggable: Boolean): Boolean = debuggable || packageName == QA_PACKAGE

    /**
     * The switches of a launch. The providers read the intent and are not called at all when the app does not read the switches,
     * so a release build never looks at an extra: [engineExtra] is `svelteEngine`, [gesturesExtra] `svelteGestures`, [query] the
     * query parameter of the launch link that is asked for by name (`gestures`, `boost`, `spare`).
     */
    inline fun read(
      packageName: String,
      debuggable: Boolean,
      engineExtra: () -> Boolean?,
      gesturesExtra: () -> Boolean?,
      query: (String) -> String?,
    ): LabSwitches {
      if (!allowed(packageName, debuggable)) return LabSwitches(engineEnabled = true, gesturesAtStart = false)
      return LabSwitches(
        engineEnabled = engineExtra() != false,
        gesturesAtStart = gesturesExtra() == true || query("gestures") == "1",
        animatedBoost = query("boost") != "0",
        inputSpare = query("spare") != "0",
      )
    }
  }
}
