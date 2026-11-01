package expo.modules.svelteengine

/**
 * What an `EngineText` has told the platform's live regions (see [A11y.textChanged]): the text of its last rebuild. Without Android types so the host check
 * (`src/test/run.sh`, `A11yLiveCheck`) can run it.
 */
class TextTold {
  private var told: String? = null

  /**
   * The rebuild produced [now]. The text is remembered on every call, whether or not anybody listens, so that a service which starts listening later does not
   * hear of a change that happened while nobody did; true when the text differs from the last one and that one was not the first (a text that appears
   * is not news). The text is copied to a string only when it changed.
   */
  fun changed(now: CharSequence?): Boolean {
    val before = told
    val same = if (now == null || before == null) now == null && before == null else now.contentEquals(before)
    if (same) return false
    told = now?.toString()
    return before != null
  }

  /** The view serves another tag now ([ViewPool]). */
  fun clear() {
    told = null
  }
}

/** An answer read once per frame: [cached] is the answer for the frame, or null when it has not been read in it; [store] keeps a fresh one. */
class FrameFlag {
  private var frame = Long.MIN_VALUE
  private var flag = false

  fun cached(frame: Long): Boolean? = if (frame == this.frame) flag else null

  fun store(frame: Long, value: Boolean): Boolean {
    this.frame = frame
    flag = value
    return value
  }
}
