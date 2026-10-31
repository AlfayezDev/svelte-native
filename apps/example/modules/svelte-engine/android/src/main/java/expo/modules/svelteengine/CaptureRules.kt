package expo.modules.svelteengine

/**
 * What [Capture] decides before it draws, with no Android classes so a host check runs it (`src/test/kotlin/.../CaptureCheck.kt`).
 */
object CaptureRules {
  sealed interface Plan {
    /** Not an engine view of its own (a foreign view's frame, what is inside one, an unknown tag): the library's module draws it. */
    data object NotEngine : Plan

    /** An engine view, with an option the engine does not capture. */
    data class Reject(val message: String) : Plan

    data object Draw : Plan
  }

  fun unsupported(options: Map<String, Any?>): String? {
    val format = options["format"] as? String
    val result = options["result"] as? String
    if (format == "raw" || result == "zip-base64" || options["snapshotContentContainer"] == true) {
      return "Unsupported option for an engine view: format raw, result zip-base64 and snapshotContentContainer are not captured here"
    }
    return null
  }

  /** The view comes first: a view the engine does not own is the library's, with every option it takes. */
  fun plan(engineView: Boolean, options: Map<String, Any?>): Plan {
    if (!engineView) return Plan.NotEngine
    return unsupported(options)?.let { Plan.Reject(it) } ?: Plan.Draw
  }
}
