package expo.modules.svelteengine

import com.facebook.react.uimanager.PointerEvents
import kotlin.math.abs
import kotlin.math.hypot

/**
 * What `react-native-gesture-handler` reads from the engine's views, as rules without an Android type, so the host check
 * (`src/test/kotlin/expo/modules/svelteengine/GestureRulesCheck.kt`, run by `src/test/run.sh`) compiles this file as it is
 * (SPEC.md, "Gestures", Android contract items 1 and 3).
 *
 * RNGH finds the handlers of a view by `View.id` and decides what a touch can reach from `ReactPointerEventsView`, so an
 * engine view answers with its node tag as its id and with the pointer events of its node.
 */
object GestureRules {
  /** `View.NO_ID`. */
  const val NO_ID = -1

  /**
   * The overlay root's id. RNGH asserts `wrappedView.id >= 1` and keys the root handler (tag `-id`) and the handlers' view
   * lookup on it, so it is positive, above any node tag (tags count up from 2 in steps of 2) and below the range aapt
   * hands out to resources (0x7F000000 and up).
   */
  const val ROOT_ID = 0x7E000000

  /**
   * The ids of the views a node does not own (the controls of a header): not tags, so a gesture handler attached to a node
   * can never be found on one of them. [View.generateViewId] counts up from 1 and would hand out the tags of the nodes
   * created first (2, 4, 6, ...), which live as long as the app.
   */
  const val INTERNAL_ID_BASE = 0x70000000
  const val INTERNAL_ID_LAST = 0x7DFFFFFF
  private var internalId = INTERNAL_ID_BASE

  /** The id an engine view of node [tag] has: the tag, and none for a view that is not a node (tag 0). */
  fun viewId(tag: Int): Int = if (tag > 0) tag else NO_ID

  /** The next id for a view that is not a node. Main thread only. */
  fun nextInternalId(): Int {
    val id = internalId
    internalId = if (id >= INTERNAL_ID_LAST) INTERNAL_ID_BASE else id + 1
    return id
  }

  /**
   * RNGH's pointer events of a node: [pointer] is the record the encoder writes (0 auto, 1 none, 2 box-none, 3 box-only, the
   * numbers `HitTest` reads) and [touchable] false is a screen that is not the top of its stack, which `HitTest` skips.
   */
  fun pointerEvents(pointer: Int, touchable: Boolean = true): PointerEvents {
    if (!touchable) return PointerEvents.NONE
    return when (pointer) {
      1 -> PointerEvents.NONE
      2 -> PointerEvents.BOX_NONE
      3 -> PointerEvents.BOX_ONLY
      else -> PointerEvents.AUTO
    }
  }

  /**
   * The edge swipe back of a stack: a finger that went ([dx], [dy]) from where it came down in the edge zone has covered a touch
   * [slop] and goes mostly to the right. The distance is the Euclidean one RNGH's `PanGestureHandler` uses for its default
   * `minDist` (`dx * dx + dy * dy >= slop * slop`, the same `ViewConfiguration.getScaledTouchSlop`), so on any move the swipe is
   * claimed no later than a default Pan activates; a Pan that is activated earlier (a smaller `activeOffsetX`) keeps the gesture.
   */
  fun edgeSwipe(dx: Float, dy: Float, slop: Float): Boolean = hypot(dx, dy) >= slop && dx > abs(dy)

  /** The drag of a sheet: the same distance rule as [edgeSwipe], going mostly up or down. */
  fun sheetDrag(dx: Float, dy: Float, slop: Float): Boolean = hypot(dx, dy) >= slop && abs(dy) > abs(dx)
}
