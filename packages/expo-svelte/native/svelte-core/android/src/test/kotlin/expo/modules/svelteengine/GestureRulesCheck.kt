package expo.modules.svelteengine

import com.facebook.react.uimanager.PointerEvents
import java.io.File
import kotlin.math.abs
import kotlin.system.exitProcess

/**
 * Plain-JVM check of what the gesture handler reads from an engine view (SPEC.md, "Gestures", Android contract items 1 and 3):
 * the pointer-events mapping, the id rules and the arbitration rules of `GestureRules` and `ClaimRules`, compiled as they are
 * in the engine, and the rule for the QA lab's launch switches (`LabSwitches`). Usage: GestureRulesCheck <views/HitTest.kt>
 * <views/EngineRoot.kt> <views/EngineStack.kt> <views/EngineSheet.kt> <RNGH's core/PanGestureHandler.kt> <SvelteEngineModule.kt>
 * (src/test/run.sh compiles and runs it). Exits non-zero on the first miss.
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

  // Arbitration with RNGH's default Pan (SPEC.md, "Gestures", "Android arbitration"): its `minDist` is `getScaledTouchSlop` and it
  // activates on the distance rule of `PanGestureHandler.shouldActivate`, which is read from the library's own source here (3.3.0:
  // `dx * dx + dy * dy >= minDist * minDist`), not retyped. The edge swipe and a sheet's drag use the same distance, so whenever one
  // of them is claimed at a move a default Pan activates there too: the two tie on that move and the root asks the native view
  // first, never later.
  val pan = PanSource(File(args[4]).readText())
  fun defaultPanActivates(dx: Float, dy: Float, slop: Float) = pan.activates(dx, dy, slop)
  for (slop in floatArrayOf(8f, 21f, 24f, 40f)) {
    var swipes = 0
    var drags = 0
    var x = -60f
    while (x <= 60f) {
      var y = -60f
      while (y <= 60f) {
        if (GestureRules.edgeSwipe(x, y, slop)) { swipes++; check("edge swipe $x,$y slop $slop is a default pan's activation", defaultPanActivates(x, y, slop)) }
        if (GestureRules.sheetDrag(x, y, slop)) { drags++; check("sheet drag $x,$y slop $slop is a default pan's activation", defaultPanActivates(x, y, slop)) }
        // And the other way round at the claim's own distance: wherever a default Pan has not activated, the claim has not either.
        if (!defaultPanActivates(x, y, slop)) check("no claim before a default pan at $x,$y slop $slop", !GestureRules.edgeSwipe(x, y, slop) && !GestureRules.sheetDrag(x, y, slop))
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

  claimChecks()
  batchedClaimChecks()
  wiringChecks(File(args[1]).readText(), File(args[2]).readText(), File(args[3]).readText())
  labSwitchChecks(File(args[5]).readText())

  println("gesture rules ok: $checks checks")
}

/**
 * The distance rule of RNGH's `PanGestureHandler.shouldActivate`, read from the library's source: the check fails when the
 * source no longer says what the claim distances were derived from (a library upgrade), instead of comparing with a copy.
 */
private class PanSource(source: String) {
  init {
    val body = Regex("""private fun shouldActivate\(\): Boolean \{([\s\S]*?)\n  \}""").find(source)?.groupValues?.get(1)
      ?: error("PanGestureHandler.kt has no shouldActivate()")
    val flat = body.replace(Regex("\\s+"), " ")
    for (expected in listOf("val dx = lastX - startX + offsetX", "val dy = lastY - startY + offsetY", "val distSq = dx * dx + dy * dy", "distSq >= minDist * minDist")) {
      check("shouldActivate still reads: $expected", flat.contains(expected))
    }
    // The default minDist is the touch slop.
    val flatSource = source.replace(Regex("\\s+"), " ")
    check("defaultMinDist is the scaled touch slop", flatSource.contains("defaultMinDist = vc.scaledTouchSlop.toFloat()"))
    check("minDist starts as defaultMinDist", flatSource.contains("minDist = defaultMinDist"))
  }

  fun activates(dx: Float, dy: Float, slop: Float): Boolean = dx * dx + dy * dy >= slop * slop
}

/** What the arbitration decides, with the events of a touch fed to it the way the root feeds them (`ClaimRules.kt`). */
private fun claimChecks() {
  val slop = 8f
  // A claimer that wants a rightward drag of a slop or more, and one that never does.
  val right = { _: Int, dx: Float, dy: Float -> GestureRules.edgeSwipe(dx, dy, slop) }
  val never = { _: Int, _: Float, _: Float -> false }

  // The history of one MOVE, positions along x on a line at y = 100, starting at x = 10 where the finger went down.
  fun decide(arbiter: ClaimArbiter, xs: FloatArray, pointerCount: Int = 1, move: Boolean = true, claimers: Int = 1, claims: (Int, Float, Float) -> Boolean = right, owns: (Int) -> Boolean = { false }): ClaimOutcome =
    arbiter.decide(move, pointerCount, claimers, xs.size - 1, { xs[it] }, { 100f }, claims, owns)

  fun fresh(): ClaimArbiter = ClaimArbiter().also { it.down(0, 10f, 100f) }

  // The plain claim: the first sample at a slop decides, and when it is the event's own position nothing is asked of the handlers.
  var probes = 0
  var outcome = decide(fresh(), floatArrayOf(11f, 14f, 19f), owns = { probes++; false })
  equal("claim kind", outcome.kind, ClaimOutcome.Kind.CLAIM)
  equal("claim sample", outcome.sample, 2)
  equal("the handlers saw the sample before it", probes, 1)
  probes = 0
  outcome = decide(fresh(), floatArrayOf(20f), owns = { probes++; false })
  equal("claim on the only sample", Pair(outcome.kind, outcome.sample), Pair(ClaimOutcome.Kind.CLAIM, 0))
  equal("no probe for the first sample", probes, 0)
  // A handler that activates on the sample before the claim keeps the gesture; the one asked is the sample before the claim's.
  val asked = ArrayList<Int>()
  outcome = decide(fresh(), floatArrayOf(11f, 14f, 19f, 25f), owns = { asked.add(it); it == 1 })
  equal("handler first", Pair(outcome.kind, outcome.sample), Pair(ClaimOutcome.Kind.HANDLER_FIRST, 2))
  equal("asked about the sample before the claim", asked, listOf(1))
  // Nothing crosses: nothing happens. A leftward or vertical drag is no claim of the edge swipe.
  equal("no claim", decide(fresh(), floatArrayOf(11f, 12f, 13f)).kind, ClaimOutcome.Kind.NONE)
  equal("no claimers", decide(fresh(), floatArrayOf(40f), claimers = 0).kind, ClaimOutcome.Kind.NONE)
  // The outermost claimer that wants the gesture is the one that takes it.
  equal("outermost first", decide(fresh(), floatArrayOf(40f), claimers = 3, claims = { k, _, _ -> k >= 1 }).claimer, 1)
  equal("a claimer that never claims", decide(fresh(), floatArrayOf(40f), claimers = 2, claims = never).kind, ClaimOutcome.Kind.NONE)
  // Only a MOVE decides.
  equal("not a move", decide(fresh(), floatArrayOf(40f), move = false).kind, ClaimOutcome.Kind.NONE)

  // Ineligible events ask nobody: neither a claimer nor the handlers.
  fun silent(arbiter: ClaimArbiter, pointerCount: Int = 1): Boolean {
    var asks = 0
    val result = arbiter.decide(true, pointerCount, 1, 2, { asks++; 40f }, { asks++; 100f }, { _, _, _ -> asks++; true }, { asks++; false })
    return result.kind == ClaimOutcome.Kind.NONE && asks == 0
  }

  // Async activation: a handler activated between two events (a LongPress's timer, `Pan.activateAfterLongPress`). The library
  // tells the root only by cancelling its root handler, which calls `onChildStartedNativeGesture`: the next move must not be
  // claimed, or the view's touch lock cancels nothing (the root handler is no longer BEGAN) and the drag never ends.
  val asynchronous = fresh()
  equal("before the handler activates the swipe would be claimed", decide(asynchronous, floatArrayOf(40f)).kind, ClaimOutcome.Kind.CLAIM)
  asynchronous.handlerTookOver()
  check("after an asynchronous activation nothing is claimed or asked", silent(asynchronous))
  equal("the handler owns", asynchronous.handlerOwns, true)
  // The next DOWN is a new gesture.
  asynchronous.down(0, 10f, 100f)
  equal("a new touch is claimable again", decide(asynchronous, floatArrayOf(40f)).kind, ClaimOutcome.Kind.CLAIM)

  // The touch lock: after a view took it (a scroll view that started to drag, a claim) nothing else claims.
  val locked = fresh()
  locked.lockRequested()
  check("after the lock nothing is claimed or asked", silent(locked))

  // Multi-pointer: A (id 0) goes down in the edge zone, B (id 1) at the centre, A lifts, B moves. The position at pointer index 0 is
  // B's, hundreds of pixels from where A went down: a distance, not a swipe.
  val two = fresh()
  check("a second finger down: not the root's to decide", silent(two, pointerCount = 2))
  two.pointerUp(0)
  equal("A lifted", two.pointer.present, false)
  check("A lifted, B moves alone: nothing is claimed or asked", silent(two, pointerCount = 1))
  // Android hands A's id out again to a finger C that goes down later; the arbiter is told of a DOWN only at ACTION_DOWN, so C is not A.
  check("a finger that reuses A's id is not the DOWN pointer", silent(two, pointerCount = 1))
  two.pointerUp(1)
  check("B lifted too", silent(two, pointerCount = 1))
  // B lifting first leaves A as the DOWN pointer, alone and claimable.
  val other = fresh()
  other.pointerUp(1)
  equal("another pointer lifting does not matter", decide(other, floatArrayOf(40f)).kind, ClaimOutcome.Kind.CLAIM)
  // The touch ended: the next one starts with its own pointer id, which need not be 0.
  other.end()
  check("an ended touch decides nothing", silent(other))
  other.down(3, 10f, 100f)
  equal("a later touch with pointer id 3", decide(other, floatArrayOf(40f)).kind, ClaimOutcome.Kind.CLAIM)

  // DownPointer on its own.
  val pointer = DownPointer()
  check("no pointer yet", !pointer.present)
  pointer.down(2)
  pointer.up(1)
  equal("another pointer lifting leaves it", pointer.id, 2)
  pointer.up(2)
  equal("the pointer lifted", pointer.id, DownPointer.GONE)
  pointer.up(2)
  equal("lifting twice is harmless", pointer.id, DownPointer.GONE)
}

/**
 * A sheet's drag is measured from the sample the claim was made at, so the same finger positions move it the same however the MOVEs batch them (#119). The finger goes down at 0 on a
 * sheet that rests at its top detent (offset 0) with a lower one at 400, touch slop 8: the report's sequences, one MOVE for each position and the first two in one MOVE (its history
 * sample, then its own position). The sheet is modelled as the view is: it claims at the first sample that crosses its slop (`ClaimArbiter.decide`, as the root asks), starts its drag from
 * the finger's position at that sample (`ClaimRules.travelSince`), and from then on has the start's translation plus the finger's travel from there.
 */
private fun batchedClaimChecks() {
  val slop = 8f
  fun drag(events: List<FloatArray>, fromClaimSample: Boolean = true): Float {
    val arbiter = ClaimArbiter().also { it.down(0, 0f, 0f) }
    var dragging = false
    var origin = 0f
    var translation = 0f
    for (ys in events) {
      val samples = ys.size - 1
      if (!dragging) {
        val outcome = arbiter.decide(true, 1, 1, samples, { 0f }, { ys[it] }, { _, dx, dy -> GestureRules.sheetDrag(dx, dy, slop) }, { false })
        if (outcome.kind == ClaimOutcome.Kind.CLAIM) {
          dragging = true
          origin = ys.last() - if (fromClaimSample) ClaimRules.travelSince(outcome.sample, samples, ys.last()) { ys[it] } else 0f
        }
      }
      if (dragging) translation = ys.last() - origin
    }
    return translation
  }
  fun settle(translation: Float) = listOf(0f, 400f).minByOrNull { abs(it - translation) }

  val separate = listOf(floatArrayOf(10f), floatArrayOf(40f), floatArrayOf(60f))
  val batched = listOf(floatArrayOf(10f, 40f), floatArrayOf(60f))
  equal("one MOVE for each position: the sheet follows the 50 px after the claim at 10", drag(separate), 50f)
  equal("the first two in one MOVE: the same 50 px, not 20", drag(batched), 50f)
  equal("what the batched drag was when it started from the event's own position (40), the report's 20", drag(batched, fromClaimSample = false), 20f)
  val separateFar = listOf(floatArrayOf(10f), floatArrayOf(40f), floatArrayOf(220f))
  val batchedFar = listOf(floatArrayOf(10f, 40f), floatArrayOf(220f))
  equal("paused at 220 the separate positions have moved the sheet 210", drag(separateFar), 210f)
  equal("and the batched ones the same, not 180", drag(batchedFar), 210f)
  equal("so a release settles at the half detent whichever way the positions arrived", Pair(settle(drag(separateFar)), settle(drag(batchedFar))), Pair(400f, 400f))
  equal("it was the full detent for the batched ones", settle(drag(batchedFar, fromClaimSample = false)), 0f)
  // A claim on the event's own position starts from it, as before; every sample of a MOVE that is all history is the same arithmetic.
  equal("a claim at the event's own position starts the drag from it", drag(listOf(floatArrayOf(5f, 30f), floatArrayOf(60f)), true), 30f)
  equal("travel from the event's own sample is nothing", ClaimRules.travelSince(1, 1, 40f) { 10f }, 0f)
  equal("travel from a sample of the history is the way to the end of the event", ClaimRules.travelSince(0, 1, 40f) { 10f }, 30f)
}

/**
 * The views are Android classes, so what the host cannot run is read from their source: that the root tells the arbiter what it
 * learns, and that the stack and the sheet measure on the DOWN pointer. Each line is the fix of a bug found in review.
 */
private fun wiringChecks(root: String, stack: String, sheet: String) {
  fun body(source: String, signature: String): String {
    val at = source.indexOf(signature)
    check("source has $signature", at >= 0)
    var depth = 0
    var i = source.indexOf('{', at)
    val begin = i
    while (i < source.length) {
      if (source[i] == '{') depth++ else if (source[i] == '}') { depth--; if (depth == 0) return source.substring(begin, i + 1) }
      i++
    }
    error("unbalanced braces after $signature")
  }
  check("the root learns of an asynchronous activation (onChildStartedNativeGesture)", body(root, "override fun onChildStartedNativeGesture").contains("arbiter.handlerTookOver()"))
  check("the root learns of the touch lock", body(root, "override fun requestDisallowInterceptTouchEvent").contains("arbiter.lockRequested()"))
  check("the root learns of the handlers' dispatch", body(root, "override fun dispatchTouchEvent").contains("arbiter.handlerTookOver()"))
  check("the root forgets a pointer that lifted", body(root, "override fun dispatchTouchEvent").contains("arbiter.pointerUp("))
  check("the root records the DOWN pointer", body(root, "override fun dispatchTouchEvent").contains("arbiter.down(ev.getPointerId(0)"))
  check("the root claims on the DOWN pointer's index", body(root, "private fun claimBeforeHandlers").contains("findPointerIndex(arbiter.pointer.id)"))
  check("the root hands the claimer the sample it crossed its slop at, not only the event", body(root, "private fun claimBeforeHandlers").contains("claimer.claim(ev, outcome.sample)"))
  check("the sheet's claim starts its drag at that sample", sheet.contains("override fun claim(ev: MotionEvent, sample: Int) = startDrag(ev, sample)"))
  check("the sheet's drag is measured from the finger's position at the claim's sample", body(sheet, "private fun startDrag").contains("downY = rawYAt(ev, max(ev.findPointerIndex(downPointer.id), 0), sample)"))
  check("that position is the event's less the finger's travel since the sample", sheet.contains("rawY(ev, index) - ClaimRules.travelSince(sample, ev.historySize, ev.getY(index)) { ev.getHistoricalY(index, it) }"))
  check("the sheet's own interception finds the first sample that is a drag, as the root does", body(sheet, "override fun onInterceptTouchEvent").contains("for (sample in 0..ev.historySize)") &&
    body(sheet, "override fun onInterceptTouchEvent").contains("startDrag(ev, sample)"))
  check("no claim reads pointer 0", !Regex("""getHistorical[XY]\(0,|getX\(0\)|getY\(0\)""").containsMatchIn(body(root, "private fun claimBeforeHandlers")))
  for ((name, source, intercept) in listOf(Triple("stack", stack, "override fun onInterceptTouchEvent"), Triple("sheet", sheet, "override fun onInterceptTouchEvent"))) {
    val text = body(source, intercept)
    check("the $name measures on the DOWN pointer", text.contains("findPointerIndex(downPointer.id)"))
    check("the $name forgets a pointer that lifted", text.contains("downPointer.up("))
    check("the $name does not read pointer 0 for the move", !Regex("""ev\.(rawX|rawY|x|y)\b\s*-\s*down[XY]""").containsMatchIn(text))
  }
}

/** The launch switches of the QA lab change what the engine does: a release build must not read them (`LabSwitches`). */
private fun labSwitchChecks(module: String) {
  val qa = LabSwitches.QA_PACKAGE
  equal("the QA package is the QA variant's", qa, "io.example.svelteqa")
  check("the QA app reads the switches", LabSwitches.allowed(qa, debuggable = false))
  check("a debuggable build reads the switches", LabSwitches.allowed("io.example.app", debuggable = true))
  check("the product does not", !LabSwitches.allowed("io.example.app", debuggable = false))
  // The package must be the QA one, not one that begins with it or contains it.
  for (other in listOf("io.example.svelteqa.evil", "evil.io.example.svelteqa", "io.example.svelteqa2", "IO.EXAMPLE.SVELTEQA", "")) {
    check("$other is not the QA app", !LabSwitches.allowed(other, debuggable = false))
  }

  // What a launch asks for, as the module reads it: the providers stand for the intent.
  fun read(packageName: String, debuggable: Boolean = false, engine: Boolean? = null, gestures: Boolean? = null, query: String? = null, boost: String? = null, spare: String? = null): Pair<LabSwitches, Int> {
    var reads = 0
    val switches = LabSwitches.read(packageName, debuggable, { reads++; engine }, { reads++; gestures }, { name -> reads++; when (name) { "gestures" -> query; "boost" -> boost; "spare" -> spare; else -> null } })
    return switches to reads
  }
  // The QA app: the engine can be switched off, the gesture root asked for at start by an extra or by `?gestures=1`.
  equal("no switches in the QA app", read(qa).first.let { Pair(it.engineEnabled, it.gesturesAtStart) }, Pair(true, false))
  equal("svelteEngine false in the QA app", read(qa, engine = false).first.engineEnabled, false)
  equal("svelteEngine true in the QA app", read(qa, engine = true).first.engineEnabled, true)
  equal("svelteGestures in the QA app", read(qa, gestures = true).first.gesturesAtStart, true)
  equal("svelteGestures false in the QA app", read(qa, gestures = false).first.gesturesAtStart, false)
  equal("?gestures=1 in the QA app", read(qa, query = "1").first.gesturesAtStart, true)
  equal("?gestures=0 in the QA app", read(qa, query = "0").first.gesturesAtStart, false)
  equal("a debuggable build reads them too", read("io.example.app", debuggable = true, engine = false, gestures = true).first.let { Pair(it.engineEnabled, it.gesturesAtStart) }, Pair(false, true))
  // The A/B switches of the lab: on unless the launch link says `0`, and only the QA app and a debuggable build ask.
  equal("boost and spare are on in the QA app", read(qa).first.let { Pair(it.animatedBoost, it.inputSpare) }, Pair(true, true))
  equal("?boost=0 in the QA app", read(qa, boost = "0").first.let { Pair(it.animatedBoost, it.inputSpare) }, Pair(false, true))
  equal("?spare=0 in the QA app", read(qa, spare = "0").first.let { Pair(it.animatedBoost, it.inputSpare) }, Pair(true, false))
  equal("?boost=1 in the QA app", read(qa, boost = "1").first.animatedBoost, true)
  equal("a debuggable build reads boost and spare", read("io.example.app", debuggable = true, boost = "0", spare = "0").first.let { Pair(it.animatedBoost, it.inputSpare) }, Pair(false, false))
  val product = read("io.example.app", boost = "0", spare = "0")
  equal("the product ignores ?boost=0 and ?spare=0", product.first.let { Pair(it.animatedBoost, it.inputSpare) }, Pair(true, true))
  equal("the product reads no parameter for them", product.second, 0)
  // The product: whatever the intent says, the engine is on, the gesture root waits for the first gesture, and no extra is even read.
  for ((engine, gestures, query) in listOf(Triple(false, true, "1"), Triple(false, false, "0"), Triple(true, true, null))) {
    val (switches, reads) = read("io.example.app", engine = engine, gestures = gestures, query = query)
    equal("the product ignores svelteEngine=$engine svelteGestures=$gestures gestures=$query", Pair(switches.engineEnabled, switches.gesturesAtStart), Pair(true, false))
    equal("the product reads no extra", reads, 0)
  }

  // The module reads the intent only through `LabSwitches.read`: no extra or query parameter is read anywhere else in it.
  val at = module.indexOf("LabSwitches.read(")
  check("SvelteEngineModule reads the switches through LabSwitches", at >= 0)
  var depth = 0
  var end = module.indexOf('(', at)
  while (end < module.length) {
    if (module[end] == '(') depth++ else if (module[end] == ')') { depth--; if (depth == 0) break }
    end++
  }
  val outside = module.removeRange(at, end + 1)
  for (read in listOf("getBooleanExtra", "getStringExtra", "getIntExtra", "getQueryParameter", "\"svelteEngine\"", "\"svelteGestures\"")) {
    check("SvelteEngineModule reads $read only inside LabSwitches.read", !outside.contains(read))
  }
}
