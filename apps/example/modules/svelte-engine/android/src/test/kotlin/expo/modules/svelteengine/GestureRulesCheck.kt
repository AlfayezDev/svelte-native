package expo.modules.svelteengine

import com.facebook.react.uimanager.PointerEvents
import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of what the gesture handler reads from an engine view (SPEC.md, "Gestures", Android contract items 1 and 3):
 * the pointer-events mapping and the id rules of `GestureRules`, compiled as they are in the engine. Usage:
 * GestureRulesCheck <path of views/HitTest.kt> (src/test/run.sh compiles and runs it). Exits non-zero on the first miss.
 */
private var checks = 0

private fun check(name: String, ok: Boolean) {
  checks++
  if (!ok) {
    System.err.println("FAIL: $name")
    exitProcess(1)
  }
}

private fun <T> equal(name: String, actual: T, expected: T) {
  checks++
  if (actual != expected) {
    System.err.println("FAIL: $name: got $actual, expected $expected")
    exitProcess(1)
  }
}

fun main(args: Array<String>) {
  // The records the encoder writes and `HitTest` reads: 0 auto, 1 none, 2 box-none, 3 box-only.
  equal("auto", GestureRules.pointerEvents(0), PointerEvents.AUTO)
  equal("none", GestureRules.pointerEvents(1), PointerEvents.NONE)
  equal("box-none", GestureRules.pointerEvents(2), PointerEvents.BOX_NONE)
  equal("box-only", GestureRules.pointerEvents(3), PointerEvents.BOX_ONLY)
  // A record this table does not know is auto, as `HitTest` treats it.
  for (unknown in intArrayOf(-1, 4, 7, 255)) equal("unknown $unknown", GestureRules.pointerEvents(unknown), PointerEvents.AUTO)
  // A screen that takes no touches ([HitTest] skips it) is none, whatever its own pointer events say.
  for (pointer in 0..3) equal("untouchable $pointer", GestureRules.pointerEvents(pointer, touchable = false), PointerEvents.NONE)
  for (pointer in 0..3) equal("touchable $pointer", GestureRules.pointerEvents(pointer, touchable = true), GestureRules.pointerEvents(pointer))

  // What the scroll bridge answers for its own pointer events (`ScrollBridge.canBeTouchTarget`, `canChildrenBeTouchTarget`)
  // is what React Native asks of the same value.
  for (pointer in 0..3) {
    val mapped = GestureRules.pointerEvents(pointer)
    equal("canBeTouchTarget $pointer", PointerEvents.canBeTouchTarget(mapped), pointer == 0 || pointer == 3)
    equal("canChildrenBeTouchTarget $pointer", PointerEvents.canChildrenBeTouchTarget(mapped), pointer == 0 || pointer == 2)
  }

  // The numbers `HitTest` reads are the ones the mapping decodes: drift in either file is caught here.
  val hitTest = File(args[0]).readText()
  fun constant(name: String): Int = Regex("""private const val $name = (\d+)""").find(hitTest)?.groupValues?.get(1)?.toInt()
    ?: error("HitTest.kt has no constant $name")
  equal("HitTest AUTO", GestureRules.pointerEvents(constant("AUTO")), PointerEvents.AUTO)
  equal("HitTest NONE", GestureRules.pointerEvents(constant("NONE")), PointerEvents.NONE)
  equal("HitTest BOX_NONE", GestureRules.pointerEvents(constant("BOX_NONE")), PointerEvents.BOX_NONE)
  equal("HitTest BOX_ONLY", GestureRules.pointerEvents(constant("BOX_ONLY")), PointerEvents.BOX_ONLY)

  // Ids: a node's view has its tag as its id; what is not a node has none.
  equal("tag 2", GestureRules.viewId(2), 2)
  equal("tag 4096", GestureRules.viewId(4096), 4096)
  equal("tag 0", GestureRules.viewId(0), GestureRules.NO_ID)
  equal("negative tag", GestureRules.viewId(-5), GestureRules.NO_ID)
  equal("NO_ID is View.NO_ID", GestureRules.NO_ID, -1)

  // The root's id: positive (RNGH asserts it and keys its root handler on `-id`), above the internal ids and below aapt's range.
  check("root id positive", GestureRules.ROOT_ID >= 1)
  check("root id above internal ids", GestureRules.ROOT_ID > GestureRules.INTERNAL_ID_LAST)
  check("root id below aapt range", GestureRules.ROOT_ID < 0x7F000000)
  check("root handler tag is negative", -GestureRules.ROOT_ID < 0)
  // Node tags count up from 2 in steps of 2: half a billion nodes still sit below the internal ids.
  check("internal ids above a billion tags", GestureRules.INTERNAL_ID_BASE > 1_000_000_000)

  // Internal ids: distinct, inside their range, wrapping at its end.
  val seen = HashSet<Int>()
  repeat(1000) {
    val id = GestureRules.nextInternalId()
    check("internal id range $id", id in GestureRules.INTERNAL_ID_BASE..GestureRules.INTERNAL_ID_LAST)
    check("internal id distinct $id", seen.add(id))
  }
  equal("first internal id", seen.min(), GestureRules.INTERNAL_ID_BASE)

  // Arbitration with RNGH's default Pan (SPEC.md, "Gestures", "Android arbitration"): its `minDist` is `getScaledTouchSlop`
  // and it activates on `dx * dx + dy * dy >= minDist * minDist` (`PanGestureHandler.shouldActivate`, 2.32.0). The edge swipe and
  // a sheet's drag use the same distance, so whenever one of them is claimed at a move a default Pan activates there too: the
  // two tie on that move and the root asks the native view first, never later.
  fun defaultPanActivates(dx: Float, dy: Float, slop: Float) = dx * dx + dy * dy >= slop * slop
  for (slop in floatArrayOf(8f, 21f, 24f, 40f)) {
    var swipes = 0
    var drags = 0
    var x = -60f
    while (x <= 60f) {
      var y = -60f
      while (y <= 60f) {
        if (GestureRules.edgeSwipe(x, y, slop)) { swipes++; check("edge swipe $x,$y slop $slop is a default pan's activation", defaultPanActivates(x, y, slop)) }
        if (GestureRules.sheetDrag(x, y, slop)) { drags++; check("sheet drag $x,$y slop $slop is a default pan's activation", defaultPanActivates(x, y, slop)) }
        y += 0.5f
      }
      x += 0.5f
    }
    check("some edge swipes at slop $slop", swipes > 0)
    check("some sheet drags at slop $slop", drags > 0)
  }
  // A vertical drag reaches a vertical Pan from the edge zone and a horizontal drag reaches a horizontal Pan in a sheet.
  check("a vertical drag is not the edge swipe", !GestureRules.edgeSwipe(2f, 30f, 8f) && !GestureRules.edgeSwipe(0f, -30f, 8f))
  check("a leftward drag is not the edge swipe", !GestureRules.edgeSwipe(-30f, 1f, 8f))
  check("a horizontal drag is not the sheet's", !GestureRules.sheetDrag(30f, 2f, 8f))
  // Exactly a slop away on the axis, with no drift: the claim and the pan's activation are on the same move, the claim comes first.
  check("edge swipe at exactly a slop", GestureRules.edgeSwipe(8f, 0f, 8f))
  check("sheet drag at exactly a slop", GestureRules.sheetDrag(0f, 8f, 8f) && GestureRules.sheetDrag(0f, -8f, 8f))
  check("just under a slop is neither", !GestureRules.edgeSwipe(7.9f, 0f, 8f) && !GestureRules.sheetDrag(0f, 7.9f, 8f))
  // A drift of 2.6 dp across 7.6 dp along: a default Pan activates (8.03 >= 8), and the sheet claims the same move.
  check("drift: the Pan's activation is also the sheet's", defaultPanActivates(2.6f, 7.6f, 8f) && GestureRules.sheetDrag(2.6f, 7.6f, 8f))

  println("gesture rules ok: $checks checks")
}
