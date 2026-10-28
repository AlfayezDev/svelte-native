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

  println("gesture rules ok: $checks checks")
}
