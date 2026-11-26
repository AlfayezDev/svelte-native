package expo.modules.svelteengine

/**
 * The pointer whose DOWN started the touch, which the stack's edge swipe and a sheet's drag measure against (SPEC.md,
 * "Gestures", "Android arbitration"). The position a view compares with the down position has to be this pointer's: pointer
 * index 0 is whichever finger is first in the event, which stops being the one that went down once that finger lifts.
 *
 * Android hands a pointer id out again as soon as it is free (the lowest unused one), so an id alone does not say that the
 * pointer is the same one: [up] forgets it when it lifts, and a finger that goes down later with the same id is not it.
 */
class DownPointer {
  /** The id, or [GONE]. */
  var id = GONE
    private set

  val present: Boolean get() = id != GONE

  fun down(pointerId: Int) { id = pointerId }

  /** The pointer [pointerId] lifted (ACTION_POINTER_UP, ACTION_UP). */
  fun up(pointerId: Int) { if (pointerId == id) id = GONE }

  fun clear() { id = GONE }

  companion object {
    const val GONE = -1
  }
}

/**
 * Where a view that claims a gesture measures its drag from. A MOVE carries the samples taken since the last one, and the claim is decided at the first of them that crosses the view's
 * slop ([ClaimOutcome.sample]); the finger was at that sample's position then, and the drag follows the travel since. Starting it from the event's own position, the last sample, left the
 * travel between the two out of the drag, so a batched MOVE moved a sheet less than the same positions delivered one by one (#119).
 */
object ClaimRules {
  /**
   * How far the pointer has travelled along one axis from [sample] to the end of a MOVE with [samples] history samples: [now], its position at the end, less `historical(sample)` for a
   * sample of the history, and 0 for the event's own position (the last sample). The position a drag measures from is the event's less this.
   */
  inline fun travelSince(sample: Int, samples: Int, now: Float, historical: (Int) -> Float): Float = if (sample < samples) now - historical(sample) else 0f
}

/** What [ClaimArbiter.decide] says about one MOVE. */
class ClaimOutcome private constructor(
  val kind: Kind,
  /** The history sample (0 until `historySize`, `historySize` being the event's own position) that crossed the claimer's slop. */
  val sample: Int,
  /** The index of the claimer among the views of the touched path, outermost first. */
  val claimer: Int,
) {
  enum class Kind {
    /** Nothing to do: no claimer wants the gesture, or it is not for the root to decide (see [ClaimArbiter.mayClaim]). */
    NONE,

    /** A handler activated on a sample before the one that crossed the slop: the handlers keep the gesture. */
    HANDLER_FIRST,

    /** The view claims the gesture. */
    CLAIM,
  }

  companion object {
    val NONE = ClaimOutcome(Kind.NONE, -1, -1)
    fun handlerFirst(sample: Int, claimer: Int) = ClaimOutcome(Kind.HANDLER_FIRST, sample, claimer)
    fun claim(sample: Int, claimer: Int) = ClaimOutcome(Kind.CLAIM, sample, claimer)
  }
}

/**
 * Who may take a touch over, as rules without an Android type, so the host check
 * (`src/test/kotlin/expo/modules/svelteengine/GestureRulesCheck.kt`, run by `src/test/run.sh`) compiles this file as it is. The
 * overlay root holds one and asks it before every MOVE of a touch that started on an engine view (SPEC.md, "Gestures",
 * "Android arbitration").
 *
 * A view of the touched path that takes a gesture over with a drag of its own (the stack's edge swipe, a sheet) is asked before
 * the gesture handlers see a move, so that it wins a tie. It must not take a gesture a handler already owns, and the root
 * learns that from three places: the return of the handlers' dispatch ([handlerTookOver]), the handlers' own cancel of their root
 * handler, which is how the library tells a root view that a handler activated, and which can come between two events (a
 * LongPress timer, `Pan.activateAfterLongPress`) with no dispatch to return from, and the touch lock ([lockRequested]).
 */
class ClaimArbiter {
  /** The pointer of the touch's DOWN. */
  val pointer = DownPointer()
  var downX = 0f
    private set
  var downY = 0f
    private set

  /** A handler activated: the gesture is theirs and no view claims it. */
  var handlerOwns = false
    private set

  /** A native view took the touch lock (a claim, a scroll view that started to drag): nothing claims any more. */
  var lockTaken = false
    private set

  /** A new touch: [pointerId] went down at ([x], [y]). */
  fun down(pointerId: Int, x: Float, y: Float) {
    pointer.down(pointerId)
    downX = x
    downY = y
    handlerOwns = false
    lockTaken = false
  }

  /** The touch is over. */
  fun end() = pointer.clear()

  /** A pointer lifted. */
  fun pointerUp(pointerId: Int) = pointer.up(pointerId)

  /**
   * A handler owns the gesture: the handlers' dispatch said so, or the library's root handler was cancelled by a handler that
   * activated (`onChildStartedNativeGesture`), which also happens between events.
   */
  fun handlerTookOver() { handlerOwns = true }

  /** A view asked for the touch lock. */
  fun lockRequested() { lockTaken = true }

  /**
   * Whether the root decides anything for this event: a MOVE of the touch's DOWN pointer alone, with a view that could claim,
   * and nobody having the gesture yet. With a second finger down, or with the DOWN pointer gone, the position of the pointer at
   * index 0 is not the one the views measure from.
   */
  fun mayClaim(isMove: Boolean, claimers: Int, pointerCount: Int): Boolean =
    isMove && claimers > 0 && !handlerOwns && !lockTaken && pointerCount == 1 && pointer.present

  /**
   * The order inside one event. A MOVE carries the samples taken since the last one: sample `i` of `0 until samples` is history,
   * sample `samples` is the event's own position, and ([x] `i`, [y] `i`) is where the DOWN pointer was. The first sample that
   * [claims] a claimer (asked outermost first, with the distance from the DOWN position) decides. The handlers have not seen
   * that sample yet, but they saw the ones before it only if [handlersOwnAt] is asked: it gives the handlers sample `i - 1` and
   * says whether one is active then, in which case the handler was there first and keeps the gesture.
   */
  inline fun decide(
    isMove: Boolean,
    pointerCount: Int,
    claimers: Int,
    samples: Int,
    x: (Int) -> Float,
    y: (Int) -> Float,
    claims: (claimer: Int, dx: Float, dy: Float) -> Boolean,
    handlersOwnAt: (Int) -> Boolean,
  ): ClaimOutcome {
    if (!mayClaim(isMove, claimers, pointerCount)) return ClaimOutcome.NONE
    for (i in 0..samples) {
      val dx = x(i) - downX
      val dy = y(i) - downY
      var claimer = -1
      for (k in 0 until claimers) {
        if (claims(k, dx, dy)) { claimer = k; break }
      }
      if (claimer < 0) continue
      if (i > 0 && handlersOwnAt(i - 1)) return ClaimOutcome.handlerFirst(i, claimer)
      return ClaimOutcome.claim(i, claimer)
    }
    return ClaimOutcome.NONE
  }
}
