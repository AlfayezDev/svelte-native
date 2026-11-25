package expo.modules.svelteengine

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of what follows the keyboard frame by frame (`KeyboardRules`, `ChatLift`, `AwareScroll`; SPEC.md "Keyboard motion"). The numbers are the ones of
 * react-native-keyboard-controller 1.21.9's own code, worked by hand from its sources: `KeyboardStickyView`'s translation, `useChatKeyboard`'s sequence of paddings and
 * scroll targets for `always`, `whenAtEnd` and `never`, `getEffectiveHeight` and `isScrollAtEnd` with the examples its doc comments give, and `KeyboardAwareScrollView`'s
 * `maybeScroll` interpolation. The views are Android's and cannot run here, so the sources of `Insets`, `Props`, `Commands` and the scroll views are read for the calls the rules
 * are useless without: the frames of the IME animation reach the drive, and a commit or a `setNativeProps` does not take away the move the keyboard made.
 * Usage: KeyboardRulesCheck <main directory with the Kotlin sources>   (src/test/engine.sh)
 */
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
    exitProcess(1)
  }
}

private fun near(name: String, actual: Double, expected: Double) = expect(name, Math.abs(actual - expected) < 1e-9, true)

private fun rules() {
  // `abs(height / persistentKeyboardHeight)`; a keyboard that never opened has no height to be a fraction of.
  near("half way", KeyboardRules.progress(150.0, 300.0), 0.5)
  near("open", KeyboardRules.progress(300.0, 300.0), 1.0)
  near("nothing over nothing is no progress", KeyboardRules.progress(0.0, 0.0), 0.0)
  near("something over nothing is no progress", KeyboardRules.progress(5.0, 0.0), 0.0)
  // KeyboardStickyView: `height + interpolate(progress, [0, 1], [closed, opened])`, the height negative; a composer above a 34 dp bar.
  near("closed", KeyboardRules.sticky(0.0, 0.0, 0.0, 34.0, true), 0.0)
  near("half open", KeyboardRules.sticky(150.0, 0.5, 0.0, 34.0, true), -133.0)
  near("open", KeyboardRules.sticky(300.0, 1.0, 0.0, 34.0, true), -266.0)
  near("a closed offset is kept while it moves", KeyboardRules.sticky(300.0, 1.0, 10.0, 34.0, true), -266.0)
  near("closed offset alone", KeyboardRules.sticky(0.0, 0.0, 10.0, 34.0, true), 10.0)
  near("disabled stays at its closed offset", KeyboardRules.sticky(300.0, 1.0, 10.0, 34.0, false), 10.0)
  near("avoid", KeyboardRules.avoid(200.0, 0.5, true), -100.0)
  near("avoid disabled", KeyboardRules.avoid(200.0, 0.5, false), 0.0)
  // The examples of `isScrollAtEnd` and `getEffectiveHeight`.
  expect("at the end", KeyboardRules.atEnd(100, 800, 920, 20), true)
  expect("20 short of the end counts", KeyboardRules.atEnd(100, 800, 920, 20), true)
  expect("21 short of it does not", KeyboardRules.atEnd(99, 800, 920, 20), false)
  near("no offset", KeyboardRules.effective(300, 300, 0), 300.0)
  near("offset 50 at full height", KeyboardRules.effective(300, 300, 50), 250.0)
  near("offset 50 half way", KeyboardRules.effective(150, 300, 50), 125.0)
  near("no keyboard yet", KeyboardRules.effective(10, 0, 50), 10.0)
}

/** A thread of 4000 px in a scroll view of 1500, 53 px being 20 dp at 2.625: the keyboard opens to 750 and closes. */
private fun chat() {
  val viewport = 1500
  val content = 4000
  val threshold = 53
  // `always`, at the end (2500): the padding is the keyboard's whole height from the start, each frame moves the content by the frame's height, the close goes back by it.
  var lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 2500, viewport, content)
  expect("always: padding at the start", lift.padding, 750)
  expect("always: first frame", lift.move(0, 2500, viewport, content), 2500)
  expect("always: 200 px", lift.move(200, 2500, viewport, content), 2700)
  expect("always: open", lift.move(750, 3000, viewport, content), 3250)
  lift.end(750, 3250, viewport, content)
  expect("always: padding holds", lift.padding, 750)
  lift.start(0, 3250, viewport, content)
  expect("always: closing keeps the padding until the end", lift.padding, 750)
  expect("always: closing, 500 px", lift.move(500, 3250, viewport, content), 3000)
  expect("always: closed", lift.move(0, 2600, viewport, content), 2500)
  lift.end(0, 2500, viewport, content)
  expect("always: padding is gone", lift.padding, 0)
  // Up the list (500): `always` lifts there too, `whenAtEnd` does not and holds, `never` neither.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 500, viewport, content)
  expect("always, up the list", lift.move(750, 500, viewport, content), 1250)
  lift = ChatLift(ChatLift.WHEN_AT_END, 0, threshold)
  lift.start(750, 500, viewport, content)
  expect("whenAtEnd up the list: the padding is still made", lift.padding, 750)
  expect("whenAtEnd up the list: no frame moves it", lift.move(400, 500, viewport, content), null)
  lift.end(750, 500, viewport, content)
  lift.start(0, 500, viewport, content)
  expect("whenAtEnd up the list: closing, within the range", lift.move(400, 500, viewport, content), null)
  // Left up the list and then scrolled down while the keyboard was up, the content is held inside what the closing keyboard leaves scrollable.
  expect("whenAtEnd: closing clamps what the shrinking padding no longer holds", lift.move(100, 3000, viewport, content), 2600)
  // 53 px short of the end counts as the end, 54 does not.
  lift = ChatLift(ChatLift.WHEN_AT_END, 0, threshold)
  lift.start(750, 2447, viewport, content)
  expect("whenAtEnd at 53 short", lift.move(750, 2447, viewport, content), 3197)
  lift = ChatLift(ChatLift.WHEN_AT_END, 0, threshold)
  lift.start(750, 2446, viewport, content)
  expect("whenAtEnd at 54 short", lift.move(750, 2446, viewport, content), null)
  // `never`: the padding is made, no frame lifts, and closing holds the content inside the shrinking range.
  lift = ChatLift(ChatLift.NEVER, 0, threshold)
  lift.start(750, 2500, viewport, content)
  expect("never: padding", lift.padding, 750)
  expect("never: opening moves nothing", lift.move(400, 2500, viewport, content), null)
  lift.end(750, 2500, viewport, content)
  lift.start(0, 3000, viewport, content)
  expect("never: closing clamps", lift.move(100, 3000, viewport, content), 2600)
  expect("never: closing inside the range", lift.move(100, 2600, viewport, content), null)
  // The keyboard turns around: closing, with the content 500 px into the way back (3000), it opens again. The new start goes on from the same baseline (2500), so the next
  // frame is where the content is, not 600 px past it.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 2500, viewport, content)
  lift.move(750, 2500, viewport, content)
  lift.end(750, 3250, viewport, content)
  lift.start(0, 3250, viewport, content)
  expect("turn: closing, 500 px", lift.move(500, 3250, viewport, content), 3000)
  lift.start(750, 3000, viewport, content)
  expect("turn: opened again from where it is", lift.move(600, 3000, viewport, content), 3100)
  expect("turn: the room stays", lift.padding, 750)
  // Turned around while opening: the baseline of the open is what the close goes back to.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 2500, viewport, content)
  expect("turn: 400 px open", lift.move(400, 2500, viewport, content), 2900)
  lift.start(0, 2900, viewport, content)
  expect("turn: closing from 400", lift.move(300, 2900, viewport, content), 2800)
  lift.end(0, 2500, viewport, content)
  expect("turn: closed", lift.padding, 0)
  // Registered again with the keyboard up (a change of `offset` or `keyboardLiftBehavior`): what the close goes back by is kept.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 2500, viewport, content)
  lift.move(750, 2500, viewport, content)
  lift.end(750, 3250, viewport, content)
  lift.retune(ChatLift.ALWAYS, 0)
  lift.start(0, 3250, viewport, content)
  expect("retuned: the close goes back to where the content was", lift.move(0, 3250, viewport, content), 2500)
  // A scroll view that arrives with the keyboard up holds the room and moves nothing.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.attach(750, 2400, viewport, content)
  expect("attached: the room", lift.padding, 750)
  lift.start(0, 2400, viewport, content)
  expect("attached: the close leaves the content where it is", lift.move(0, 2400, viewport, content), 2400)
  // Registered while an animation runs: no start was seen, so no frame moves it, and the end takes its place from the keyboard's height. (Without it the frames scrolled the
  // content to the height of the frame, the lift of a keyboard that nobody started.)
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  expect("not armed: a frame moves nothing", lift.move(300, 2500, viewport, content), null)
  expect("not armed: the room is not made", lift.padding, 0)
  lift.end(750, 2500, viewport, content)
  expect("not armed: the end takes its place", lift.padding, 750)
  expect("armed by it", lift.armed, true)
  lift.start(0, 2500, viewport, content)
  expect("and a close from there leaves the content where it is", lift.move(0, 2500, viewport, content), 2500)
  // A scroll view that is registered again keeps its rules, a new one gets rules to start.
  val known = HashMap<Int, ChatLift>()
  val first = ChatLift.register(known, 7, ChatLift.ALWAYS, 0, threshold)
  expect("a new registration has rules to start", first != null, true)
  first!!.start(750, 2500, viewport, content)
  first.move(750, 2500, viewport, content)
  first.end(750, 3250, viewport, content)
  expect("registered again: tuned, nothing to start", ChatLift.register(known, 7, ChatLift.WHEN_AT_END, 0, threshold), null)
  first.start(0, 3250, viewport, content)
  expect("registered again: the close still goes back to where the content was", first.move(0, 3250, viewport, content), 2500)
  // A tab bar of 50 px under the scroll view: the content lifts by the keyboard less that, in proportion.
  lift = ChatLift(ChatLift.ALWAYS, 50, threshold)
  lift.start(300, 2500, viewport, content)
  expect("offset: padding is the keyboard less the offset", lift.padding, 250)
  expect("offset: half way", lift.move(150, 2500, viewport, content), 2625)
}

private fun aware() {
  // A form: the focused input's bottom edge is at 1700 px of a 2400 px window, and the keyboard opens to 1000: its top edge will be at 1400, 300 px above the input.
  val scroll = AwareScroll(0, 0, true)
  scroll.start(1000, 400, 1700, 2400)
  expect("the keyboard's room", scroll.padding, 1000)
  expect("nothing yet", scroll.move(0, 400, 1500, 4000), 400)
  expect("a third", scroll.move(500, 400, 1500, 4000), 550)
  expect("all of it", scroll.move(1000, 400, 1500, 4000), 700)
  scroll.end(1000, 0, 1700, 2400)
  scroll.start(0, 700, 1700, 2400)
  expect("closing keeps the room until the end", scroll.padding, 1000)
  expect("closing goes back along the same way", scroll.move(500, 700, 1500, 4000), 550)
  scroll.end(0, 0, 1700, 2400)
  expect("the room is gone", scroll.padding, 0)
  // `bottomOffset` keeps the input that far above the keyboard.
  val offset = AwareScroll(60, 0, true)
  offset.start(1000, 0, 1700, 2400)
  expect("bottom offset", offset.move(1000, 0, 1500, 4000), 360)
  // An input that is clear of the keyboard scrolls nothing.
  val clear = AwareScroll(0, 0, true)
  clear.start(1000, 250, 900, 2400)
  expect("clear input", clear.move(1000, 250, 1500, 4000), null)
  // `disableScrollOnKeyboardHide`: the open scrolls, the close leaves the content where it is.
  val keep = AwareScroll(0, 40, false)
  keep.start(1000, 400, 1700, 2400)
  expect("extra space is part of the room", keep.padding, 1040)
  expect("keeps scrolling on open", keep.move(1000, 400, 1500, 4000), 700)
  keep.end(1000, 0, 1700, 2400)
  keep.start(0, 700, 1700, 2400)
  expect("no scroll on hide", keep.move(500, 700, 1500, 4000), null)
  // The room it holds until the end still extends the range as the keyboard closes: a content scrolled into it is held inside what is left, as the chat lift's is, so it does not jump when the room goes.
  expect("no scroll on hide, held inside the range that is left", keep.move(500, 3300, 1500, 4000), 3000)
  expect("no scroll on hide, nearly closed", keep.move(100, 2700, 1500, 4000), 2600)
  expect("no scroll on hide, inside the range", keep.move(100, 2600, 1500, 4000), null)
  // Another input takes the focus while the keyboard is up: the way to it, from where the scroll view is.
  val next = AwareScroll(0, 0, true)
  next.start(1000, 0, 1700, 2400)
  next.end(1000, 0, 1700, 2400)
  expect("refocus", next.refocus(700, 1900, 2400), 1200)
  // The keyboard turns around while it opens: the way goes on from the same base and distance, not from where the scroll view is now.
  val turn = AwareScroll(0, 0, true)
  turn.start(1000, 400, 1700, 2400)
  expect("turn: a third open", turn.move(500, 400, 1500, 4000), 550)
  turn.start(0, 550, 1700, 2400)
  expect("turn: closing from the third", turn.move(300, 550, 1500, 4000), 490)
  turn.start(1000, 490, 1900, 2400)
  expect("turn: opening again keeps the base", turn.move(600, 490, 1500, 4000), 580)
  turn.end(1000, 0, 1700, 2400)
  expect("turn: the room", turn.padding, 1000)
  // Registered while an animation runs: not armed, no frame moves it, and the end starts it from the keyboard's height.
  val late = AwareScroll(0, 0, true)
  expect("late: a frame moves nothing", late.move(500, 400, 1500, 4000), null)
  late.end(1000, 400, 1700, 2400)
  expect("late: the end makes the room", late.padding, 1000)
  expect("late: and arms it", late.armed, true)
}

/** Why a view in a Modal is left alone, and how it is found: the modal's layer makes room for the keyboard in its own layout, by the whole of what the keyboard covers of it. */
private fun modal() {
  val inset = IntArray(4)
  expo.modules.svelteengine.views.ModalLayout.contentInsets(0, 63, 0, 63, 1050, statusBarTranslucent = false, navigationBarTranslucent = false, out = inset)
  expect("a modal's content ends where the keyboard begins", inset[3], 1050)
  expo.modules.svelteengine.views.ModalLayout.contentInsets(0, 63, 0, 63, 0, statusBarTranslucent = false, navigationBarTranslucent = false, out = inset)
  expect("and above the bar without it", inset[3], 63)
  // The walk from a view up to the layer of a modal, on a tree of the host's own: root > layer > content > row > view; root > screen > view.
  class Node(val name: String, val parent: Node?)
  val root = Node("root", null)
  val layer = Node("layer", root)
  val row = Node("row", Node("content", layer))
  val view = Node("view", row)
  val plain = Node("view", Node("screen", root))
  expect("a view in a modal's content is in the modal", KeyboardTree.hasAncestor(view, { it.parent }, { it.name == "layer" }), true)
  expect("a view of a screen is not", KeyboardTree.hasAncestor(plain, { it.parent }, { it.name == "layer" }), false)
  expect("the layer itself is not its own ancestor", KeyboardTree.hasAncestor(layer, { it.parent }, { it.name == "layer" }), false)
  // What the keyboard asks of a view in a modal is nothing: the modal has lifted it, and a second lift is the bug (820 px too high on the emulator).
  near("in a modal: not moved", KeyboardTree.unlessModal(true, KeyboardRules.sticky(883.0, 1.0, 0.0, 63.0, true)), 0.0)
  near("elsewhere: as asked", KeyboardTree.unlessModal(false, KeyboardRules.sticky(883.0, 1.0, 0.0, 63.0, true)), -820.0)
}

/** The input `setFocusTo` goes to, and the reports of the end of a list. */
private fun inputs() {
  // The tree order is: field one, a scroll view (which `focusSearch` also stops at), field two, field three; the way forward from one.
  val order = listOf("one", "scroll", "two", "three")
  val forward = { n: String -> order.getOrNull(order.indexOf(n) + 1) }
  val backward = { n: String -> order.getOrNull(order.indexOf(n) - 1) }
  val field = { n: String -> n != "scroll" }
  expect("next skips the container", KeyboardTree.nextInput("one", forward, field, 16), "two")
  expect("next from the last is none", KeyboardTree.nextInput("three", forward, field, 16), null)
  expect("previous", KeyboardTree.nextInput("two", backward, field, 16), "one")
  expect("previous from the first is none", KeyboardTree.nextInput("one", backward, field, 16), null)
  expect("a search that wraps round to where it began is none", KeyboardTree.nextInput("one", { n: String -> if (n == "one") "scroll" else "one" }, field, 16), null)
  expect("a search that finds only containers gives up", KeyboardTree.nextInput("one", { "scroll" }, field, 3), null)
  val reports = EndReports()
  expect("the first report is news", reports.changed(4, true), true)
  expect("the same again is not", reports.changed(4, true), false)
  expect("a change is", reports.changed(4, false), true)
  reports.changed(5, true)
  expect("two views are remembered", reports.size, 2)
  reports.forget(4); reports.forget(5)
  expect("a view that goes leaves nothing", reports.size, 0)
  expect("and its next report is news", reports.changed(4, false), true)
}

private fun frames() {
  var f = KeyboardFrames()
  // One animation: prepare, start, frames, end.
  f.prepare(); f.start(750)
  expect("prepared and started: one running", f.running, 1)
  expect("first frame of an open", f.frame(0), 0)
  expect("a frame", f.frame(400), 400)
  expect("the end of the only animation settles", f.end(), true)
  f.settled(750)
  // The keyboard hides, and turns around: the old animation's end comes after the new one's start.
  f.prepare(); f.start(0)
  expect("a frame of the hide", f.frame(300), 300)
  f.prepare(); f.start(750)
  expect("the 0 of a cancelled hide is left out", f.frame(0), null)
  expect("the frame after it", f.frame(320), 320)
  expect("the end of the old animation does not settle the keyboard", f.end(), false)
  expect("two animations were running", f.running, 1)
  expect("the frames go on", f.frame(500), 500)
  expect("the end of the last one does", f.end(), true)
  // A hide ends at 0, which is a frame to take: the target is 0.
  f.settled(750); f.prepare(); f.start(0)
  expect("a hide's last frame", f.frame(0), 0)
  expect("an end with none running (an animation that began before the window) is the keyboard settling", KeyboardFrames().end(), true)
  f = KeyboardFrames()
  f.prepare(); f.start(750); f.prepare(); f.start(0); f.reset()
  expect("a window that goes forgets its animations", f.busy, false)
  // Counted at the start, as Reanimated counts: an animation that was prepared and never started is waiting, and the news of an end that comes for it ends it.
  f = KeyboardFrames()
  f.prepare(0)
  expect("prepared: busy, not running", listOf(f.busy, f.running, f.waiting), listOf(true, 0, 1))
  expect("an end for it settles", f.end(10), true)
  expect("nothing is left waiting", f.busy, false)
  // One that nothing ends is given up after a time with no news; a running animation that sends frames is not.
  f = KeyboardFrames()
  f.prepare(0)
  expect("prepared, a second ago", f.stuck(1000, 2000), false)
  expect("prepared, three seconds ago", f.stuck(3000, 2000), true)
  f.start(750, 3000)
  expect("started: heard of now", f.stuck(4000, 2000), false)
  f.frame(100, 5500)
  expect("frames keep it alive", f.stuck(7000, 2000), false)
  expect("and silence does not", f.stuck(8000, 2000), true)
  f.reset()
  expect("reset: not stuck", f.stuck(99000, 2000), false)
}

/** What Reanimated's `useAnimatedKeyboard` is given (SPEC.md "Keyboard motion"): the states of its `KeyboardState` and whole dp, from the engine's frames. */
private fun reanimated(vendor: String) {
  val states = File(vendor, "android/src/main/java/com/swmansion/reanimated/keyboard/KeyboardState.kt").readText()
  for ((name, value) in listOf("UNKNOWN" to 0, "OPENING" to 1, "OPEN" to 2, "CLOSING" to 3, "CLOSED" to 4)) expect("Reanimated's KeyboardState.$name", states.contains("$name($value)"), true)
  expect("the adapter's states are Reanimated's", listOf(ReanimatedKeyboard.OPENING, ReanimatedKeyboard.OPEN, ReanimatedKeyboard.CLOSING, ReanimatedKeyboard.CLOSED), listOf(1, 2, 3, 4))
  val keyboard = File(vendor, "android/src/main/java/com/swmansion/reanimated/keyboard/Keyboard.kt").readText()
  expect("Reanimated takes the system bars off unless the navigation bar is translucent", keyboard.contains("if (isNavigationBarTranslucent) 0 else insets.getInsets(SYSTEM_BAR_TYPE_MASK).bottom"), true)
  expect("Reanimated reports whole dips", keyboard.contains("PixelUtil.toDIPFromPixel(Math.max(0, keyboardHeightDip).toFloat()).toInt()"), true)
  expect("Reanimated leaves out the 0 of an open keyboard", keyboard.contains("keyboardHeight <= 0 && mState == KeyboardState.OPEN"), true)
  val manager = File(vendor, "android/src/main/java/com/swmansion/reanimated/keyboard/KeyboardAnimationManager.kt").readText()
  expect("the patched manager hands the engine the options the subscriber gave", manager.contains("isStatusBarTranslucent, isNavigationBarTranslucent) }"), true)
}

/** A channel on the host: a main thread that is told apart from the others, and what is posted to it waits to be run. */
private class Rig(var main: Boolean = true) {
  val queue = ArrayList<() -> Unit>()
  val dropped = ArrayList<Int>()
  val channel = KeyboardChannel({ main }, { queue.add(it) }, { 63 }, { 2.625f }, { id: Int, _: Throwable -> dropped.add(id); Unit })
  fun drain() { val run = queue.toList(); queue.clear(); val was = main; main = true; run.forEach { it() }; main = was }
  /** A subscriber of Reanimated's, that records what it was told. */
  fun reanimated(translucent: Boolean, seen: MutableList<String>): Int = channel.subscribe({ state: Int, dp: Int -> seen.add("$state:$dp") }, translucent)
  fun raw(seen: MutableList<String>): Int { channel.rawNext(); return channel.subscribe({ kind: Int, px: Int -> seen.add("$kind:$px") }) }
}

/** What `useAnimatedKeyboard` is given and what `createKeyboardMotion` is, from the engine's frames, with the subscribers coming and going (SPEC.md "Keyboard motion"). */
private fun channel() {
  var rig = Rig()
  var bar = mutableListOf<String>(); var whole = mutableListOf<String>(); var raw = mutableListOf<String>()
  rig.reanimated(false, bar); rig.reanimated(true, whole); rig.raw(raw)
  // Opening: 1050 px is 376 dp past a 63 px bar and 400 dp with none; the state is opening on the way and open at the end, the same for both, and the engine's own gets the frames.
  rig.channel.start(1050); rig.channel.frame(525); rig.channel.frame(1050); rig.channel.end(1050)
  expect("open, the navigation bar not translucent", bar.toList(), listOf("1:176", "1:376", "2:376"))
  expect("open, the navigation bar translucent: the whole 400 dp", whole.toList(), listOf("1:200", "1:400", "2:400"))
  expect("the engine's own subscriber is given kind and px", raw.toList(), listOf("1:1050", "2:525", "2:1050", "3:1050"))
  // Another keyboard while it is open, with no animation: Reanimated's stays open and is told the new height; the engine's is told the height changed.
  bar.clear(); whole.clear(); raw.clear()
  rig.channel.settle(525)
  expect("a layout switch is not a close and an open: it stays open", bar.toList(), listOf("2:176"))
  expect("a layout switch, the whole height", whole.toList(), listOf("2:200"))
  expect("a layout switch for the engine's own", raw.toList(), listOf("4:525"))
  // A subscriber that arrives in the middle of a close: it is told where the keyboard is, that it is closing, and what comes is what it would have been told.
  rig = Rig(); bar = mutableListOf(); whole = mutableListOf(); raw = mutableListOf()
  rig.channel.start(1050); rig.channel.frame(1050); rig.channel.end(1050)
  rig.channel.start(0); rig.channel.frame(525)
  rig.reanimated(true, whole); rig.raw(raw)
  expect("late, mid close: closing at the height it has", whole.toList(), listOf("3:200"))
  expect("late, mid close, the engine's own: where it goes from and to, and the height", raw.toList(), listOf("1:1050", "1:0", "2:525"))
  rig.channel.frame(0); rig.channel.end(0)
  expect("late, mid close: the 0 frames are taken and it ends closed", whole.toList(), listOf("3:200", "3:0", "4:0"))
  expect("late, mid close, the engine's own, to the end", raw.toList(), listOf("1:1050", "1:0", "2:525", "2:0", "3:0"))
  // At rest and open: a Reanimated subscriber is told open, the engine's own that the keyboard is at its height.
  rig = Rig(); whole = mutableListOf(); raw = mutableListOf()
  rig.channel.start(1050); rig.channel.frame(1050); rig.channel.end(1050)
  rig.reanimated(true, whole); rig.raw(raw)
  expect("late, at rest: open", whole.toList(), listOf("2:400"))
  expect("late, at rest, the engine's own: settled at the height", raw.toList(), listOf("4:1050"))
  // A subscriber before any keyboard has been seen is told nothing, and a keyboard that never moved leaves it so.
  rig = Rig(); whole = mutableListOf()
  rig.reanimated(true, whole)
  expect("nothing to tell yet", whole.toList(), emptyList<String>())
  // The JavaScript thread's subscription: the id is there at once and the subscription is made, in order, where the frames go.
  rig = Rig(main = false); whole = mutableListOf()
  val id = rig.reanimated(true, whole)
  expect("an id from any thread, below zero", id < 0, true)
  rig.main = true
  rig.channel.start(1050); rig.channel.frame(525)
  expect("not subscribed until what was posted has run", whole.toList(), emptyList<String>())
  rig.drain()
  rig.channel.frame(1050)
  expect("subscribed after it, told where the keyboard was on its way, and then the frames", whole.toList(), listOf("1:200", "1:400"))
  rig.main = false
  rig.channel.unsubscribe(id)
  rig.main = true
  rig.channel.frame(100)
  expect("unsubscribed from the other thread: still told until it has run", whole.toList(), listOf("1:200", "1:400", "1:38"))
  rig.drain()
  rig.channel.frame(200)
  expect("and not after", whole.toList(), listOf("1:200", "1:400", "1:38"))
  // The engine's own subscription is asked for once: the next one is Reanimated's.
  rig = Rig(); raw = mutableListOf(); whole = mutableListOf()
  rig.raw(raw); rig.reanimated(true, whole)
  rig.channel.start(1050)
  expect("one raw, one not", listOf(raw.toList(), whole.toList()), listOf(listOf("1:1050"), emptyList<String>()))
  // A listener that fails is dropped and does not stop the others.
  rig = Rig(); whole = mutableListOf()
  val bad: Int = rig.channel.subscribe({ _: Int, _: Int -> throw IllegalStateException("a bad worklet") })
  rig.reanimated(true, whole)
  rig.channel.start(1050); rig.channel.frame(525); rig.channel.frame(1050)
  expect("the bad one is dropped once", rig.dropped, listOf(bad))
  expect("the others go on", whole.toList(), listOf("1:200", "1:400"))
}

/** A sink that records what the followers are told, and an optional channel behind it for the state Reanimated's callers are given. */
private class Tape(val channel: KeyboardChannel? = null) : KeyboardSink {
  val calls = ArrayList<String>()
  override fun start(target: Int) { calls.add("start $target"); channel?.start(target) }
  override fun progress(px: Int) { calls.add("progress $px"); channel?.frame(px) }
  override fun end(px: Int) { calls.add("end $px"); channel?.end(px) }
  override fun settle(px: Int) { calls.add("settle $px"); channel?.settle(px) }
}

/**
 * How the engine hears the keyboard's animations (`Insets` forwards each step of the platform's callback to a session), and what is left of one that nothing ends: the end
 * is lost with the last frame at the target (the window went, the watchdog gave up), and the followers are ended there, not left in the middle of a move.
 */
private fun session() {
  var tape = Tape()
  var session = KeyboardSession(tape)
  // A whole animation.
  session.prepare(0); session.start(750, 1); session.frame(300, 2); session.frame(750, 3)
  expect("busy until the end", session.busy, true)
  expect("the end settles it at what the insets say", session.end(4) { 750 }, true)
  expect("what the followers heard", tape.calls.toList(), listOf("start 750", "progress 300", "progress 750", "end 750"))
  expect("not busy", session.busy, false)
  // The end is lost with the last frame at the target: the watchdog heals, and the followers are ended (a settle would be ignored: the height is already 750).
  tape = Tape(); session = KeyboardSession(tape)
  session.prepare(0); session.start(750, 1); session.frame(750, 2)
  expect("nothing for two seconds", session.stuck(2500, 2000), true)
  session.heal(750)
  expect("healed: the followers are ended, not left in the middle", tape.calls.toList(), listOf("start 750", "progress 750", "end 750"))
  expect("and the session is idle", session.busy, false)
  // A hide that was lost the same way ends closed.
  tape = Tape(); session = KeyboardSession(tape)
  session.prepare(0); session.start(0, 1); session.frame(300, 2)
  session.heal(0)
  expect("a lost hide ends closed", tape.calls.toList(), listOf("start 0", "progress 300", "end 0"))
  // Prepared and never started: nothing began, so there is nothing to end, and the insets are settled.
  tape = Tape(); session = KeyboardSession(tape)
  session.prepare(0)
  expect("stuck", session.stuck(3000, 2000), true)
  session.heal(750)
  expect("a prepared animation that never started is a settle", tape.calls.toList(), listOf("settle 750"))
  // The window goes in the middle of a move: the followers are left where the last frame was.
  tape = Tape(); session = KeyboardSession(tape)
  session.prepare(0); session.start(750, 1); session.frame(400, 2)
  session.heal(session.last)
  expect("a window that goes ends the move at the last frame", tape.calls.toList(), listOf("start 750", "progress 400", "end 400"))
  // The keyboard turns around, the old end after the new start: one end for the two.
  tape = Tape(); session = KeyboardSession(tape)
  session.prepare(0); session.start(750, 1); session.frame(300, 2)
  session.prepare(3); session.start(0, 4)
  expect("the old animation's end does not settle it", session.end(5) { 300 }, false)
  session.frame(100, 6)
  expect("the last one does", session.end(7) { 0 }, true)
  expect("turned around: two starts, one end", tape.calls.toList(), listOf("start 750", "progress 300", "start 0", "progress 100", "end 0"))
  // The insets change with no animation: told as a settle, except while an animation runs.
  tape = Tape(); session = KeyboardSession(tape)
  session.idle(750)
  session.prepare(0); session.idle(900)
  expect("idle settles, busy does not", tape.calls.toList(), listOf("settle 750"))
  // What `useAnimatedKeyboard` is told after a healed move: the state it ends in is the keyboard's, not opening or closing for good.
  val rig = Rig(); val seen = mutableListOf<String>()
  rig.reanimated(true, seen)
  val live = Tape(rig.channel); session = KeyboardSession(live)
  session.prepare(0); session.start(1050, 1); session.frame(1050, 2)
  session.heal(1050)
  expect("a lost end leaves Reanimated's callers open", seen.toList(), listOf("1:400", "2:400"))
  seen.clear()
  session.prepare(10); session.start(0, 11); session.frame(0, 12)
  session.heal(0)
  expect("and a lost hide closed", seen.toList(), listOf("3:0", "4:0"))
}

/** The keyboard changes height while it is up, with no animation (an emoji pane over the letters). */
private fun resize() {
  val viewport = 1500
  val content = 4000
  val threshold = 53
  // A chat at its end: opened to 750 it is at 3250. A resize to 900 lifts it by the 150 more, which is the end of the range.
  var lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 2500, viewport, content); lift.move(750, 2500, viewport, content); lift.end(750, 3250, viewport, content)
  expect("at the end: the 150 more", lift.resize(900, 3250, viewport, content), 3400)
  expect("the room is the new height's", lift.padding, 900)
  lift.start(0, 3400, viewport, content)
  expect("and the close goes back to where it was", lift.move(0, 3400, viewport, content), 2500)
  // Anywhere else in the list the content is lifted by the difference only, not by the whole 900 again from where the lift left it (it went to 2150 before).
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 500, viewport, content); lift.move(750, 500, viewport, content); lift.end(750, 1250, viewport, content)
  expect("mid list: only the difference", lift.resize(900, 1250, viewport, content), 1400)
  lift.start(0, 1400, viewport, content)
  expect("mid list: the close goes back to where the list was", lift.move(0, 1400, viewport, content), 500)
  // The same change as an animation (the keyboard goes from 750 to 900 as a keyboard of another height comes in): the frames are the heights, and the content goes by the difference.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 500, viewport, content); lift.move(750, 500, viewport, content); lift.end(750, 1250, viewport, content)
  lift.start(900, 1250, viewport, content)
  expect("animated, first frame: where it is", lift.move(750, 1250, viewport, content), 1250)
  expect("animated, last frame: 150 more", lift.move(900, 1250, viewport, content), 1400)
  lift.end(900, 1400, viewport, content)
  lift.start(0, 1400, viewport, content)
  expect("animated: the close goes back to where the list was", lift.move(0, 1400, viewport, content), 500)
  // Smaller, as an animation, at the end of the list: the range shrinks with the room and the content goes down with it.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(900, 2500, viewport, content); lift.move(900, 2500, viewport, content); lift.end(900, 3400, viewport, content)
  lift.start(750, 3400, viewport, content)
  expect("animated smaller: the first frame is where it is", lift.move(900, 3400, viewport, content), 3400)
  expect("animated smaller: the last frame is 150 down", lift.move(750, 3400, viewport, content), 3250)
  // A list that stayed (`whenAtEnd` up the list) stays when the keyboard goes to another height.
  lift = ChatLift(ChatLift.WHEN_AT_END, 0, threshold)
  lift.start(750, 500, viewport, content); lift.move(750, 500, viewport, content); lift.end(750, 500, viewport, content)
  lift.start(900, 500, viewport, content)
  expect("animated, not lifting: no move", lift.move(900, 500, viewport, content), null)
  // Smaller: the content goes down by the difference.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(900, 500, viewport, content); lift.move(900, 500, viewport, content); lift.end(900, 1400, viewport, content)
  expect("a smaller keyboard", lift.resize(750, 1400, viewport, content), 1250)
  expect("its room", lift.padding, 750)
  // A list that does not lift keeps its place, and has the new room.
  lift = ChatLift(ChatLift.WHEN_AT_END, 0, threshold)
  lift.start(750, 500, viewport, content); lift.move(750, 500, viewport, content); lift.end(750, 500, viewport, content)
  expect("whenAtEnd up the list: stays", lift.resize(900, 500, viewport, content), null)
  expect("whenAtEnd up the list: the room", lift.padding, 900)
  // With an offset (a tab bar under the list) the difference is the one of the effective heights.
  lift = ChatLift(ChatLift.ALWAYS, 50, threshold)
  lift.start(750, 500, viewport, content); lift.move(750, 500, viewport, content); lift.end(750, 1200, viewport, content)
  expect("with an offset: 850 less 50 is 800, 750 less 50 is 700", lift.resize(850, 1200, viewport, content), 1300)
  // The aware scroll: the input is brought above the new keyboard from where the scroll view is, and the room is the new one.
  val aware = AwareScroll(0, 0, true)
  aware.start(1000, 400, 1700, 2400); aware.end(1000, 700, 1700, 2400)
  expect("aware: the input that is 100 px under the new keyboard's top", aware.resize(1200, 700, 1500, 2400), 1000)
  expect("aware: the room", aware.padding, 1200)
  expect("aware: no input has the focus", aware.resize(1100, 1000, -1, 2400), null)
}

/** A view that avoids the keyboard is registered again with another offset: its overlap is worked out with the offset it has now. */
private fun stickies() {
  val map = HashMap<Int, Sticky>()
  // The keyboard covers the anchor by its bottom edge less the keyboard's top and the offset the view is short of it (px here, as the drive passes it).
  val overlap = { sticky: Sticky, target: Int -> maxOf(2000.0 - (2400 - target - sticky.closed), 0.0) }
  val first = Sticky.register(map, 3, 10.0, 0.0, true, true, 9, 0, overlap)
  expect("registered with the keyboard down: no overlap yet", first.overlap, 0.0)
  val again = Sticky.register(map, 3, 60.0, 0.0, true, true, 9, 700, overlap)
  expect("registered again with the keyboard up: the same view", again === first, true)
  near("its overlap uses the new offset, 60, not the old one, 10", again.overlap, 360.0)
  expect("a view that does not avoid has none", Sticky.register(map, 4, 0.0, 34.0, true, false, 0, 700, overlap).overlap, 0.0)
}

/** Where `scrollToEnd` goes: the room at the bottom is part of the range. */
private fun scrollEnd() {
  expect("no room", KeyboardRules.endOffset(4000, 1500, 0, 0), 2500)
  expect("the keyboard's room under the content", KeyboardRules.endOffset(4000, 1500, 0, 883), 3383)
  expect("room at both ends", KeyboardRules.endOffset(4000, 1500, 275, 883), 3658)
  expect("a short content stays at the top", KeyboardRules.endOffset(900, 1500, 0, 0), 0)
}

private fun read(main: File, name: String) = File(main, name).readText()

private fun wiring(main: String) {
  val dir = File(main)
  val insets = read(dir, "Insets.kt")
  expect("only the IME's animation does", insets.contains("runningAnimations.any { it.typeMask and WindowInsetsCompat.Type.ime() != 0 }"), true)
  // What the session does with them is checked on its own (`session()`); here, that Insets tells it every step, and heals through it where an end can be lost.
  expect("each step of an IME animation, the insets with no animation, the watchdog and the window's going go through the session", listOf("session.prepare(now())", "session.start(imeOverlap(), now())", "session.frame(", "session.end(now()) { imeOverlap() }", "session.idle(imeOverlap())", "session.stuck(now(), STUCK_MS)", "session.heal(imeOverlap())", "session.heal(session.last)").all { insets.contains(it) }, true)
  expect("the watchdog stops with the tracker", insets.substringAfter("fun uninstall() {").substringBefore("}").contains("root.removeCallbacks(watchdog)"), true)
  expect("the record says when the keyboard is moving", insets.contains("\"keyboardAnimating\" to animating"), true)
  val props = read(dir, "Props.kt")
  expect("a commit's translation keeps the keyboard's move", props.contains("view.translationY = ty + st.drivenY"), true)
  expect("an identity transform is not one for a view the keyboard moved", props.contains("rot == 0f && st.drivenY == 0f"), true)
  expect("setNativeProps reads the translation back without the keyboard's move", read(dir, "Commands.kt").contains("view.translationY - node.drivenY"), true)
  expect("a pooled view forgets the move", read(dir, "views/EngineView.kt").contains("drivenY = 0f"), true)
  expect("a view created after its registration is driven when it arrives", read(dir, "MountingManager.kt").contains("keyboard.viewCreated(tag)"), true)
  val module = read(dir, "SvelteEngineModule.kt")
  expect("JavaScript registers a view by tag", module.contains("Function(\"keyboardDrive\")"), true)
  expect("the end of a list is told to JavaScript", module.contains("sendEvent(\"endVisible\""), true)
  expect("Reanimated's keyboard source is the engine's, with the subscriber's options", module.contains("setKeyboardSubscribe") && module.contains("Function3::class.java"), true)
  expect("createKeyboardMotion asks for the engine's own frames", module.contains("Function(\"keyboardMotionNext\")"), true)
  val scroll = read(dir, "views/EngineScroll.kt")
  expect("a watched scroll view tells the drive of each scroll and layout", scroll.split("watcher?.invoke()").size - 1, 2)
  expect("scrollToEnd goes to the end of the room too, in both scroll views", scroll.split("KeyboardRules.endOffset(").size - 1, 2)
  expect("a pooled scroll view forgets the room made at its bottom", scroll.contains("if (paddingBottom != 0) setPadding(paddingLeft, paddingTop, paddingRight, 0)"), true)
  expect("a layout changes where a view that avoids the keyboard is", insets.contains("drive.layoutChanged()"), true)
  expect("the navigation bar Reanimated's callers are told of is the one the overlay does not cover", insets.contains("drive.navigationBar = {"), true)
  expect("the coordinates of the keyboard's top are the overlay's", read(dir, "MountingManager.kt").contains("root.getLocationInWindow(at)"), true)
  val drive = read(dir, "KeyboardDrive.kt")
  // The tree rules (`KeyboardTree`) are checked above on their own; here, that the drive asks them, and in the places where a follower is moved.
  expect("a view in a modal is left to the modal", drive.contains("KeyboardTree.unlessModal(inModal(view), asked)") && drive.contains("KeyboardTree.hasAncestor<View>(view, { it.parent as? View }, { it is ModalLayer })") && drive.split("!inModal(view)").size - 1 == 4, true)
  expect("what registered before its modal is put in its place is left alone at the end of the batch", drive.contains("fun placed()") && read(dir, "MountingManager.kt").contains("if (insert > 0) keyboard.placed()"), true)
  expect("the room is outside the clip, as the keyboard's scroll decorator makes it", drive.contains("view.clipToPadding = false"), true)
}

fun main(args: Array<String>) {
  rules()
  chat()
  aware()
  frames()
  channel()
  session()
  resize()
  stickies()
  scrollEnd()
  inputs()
  modal()
  reanimated(args.getOrNull(1) ?: error("usage: KeyboardRulesCheck <main directory> <vendor/react-native-reanimated>"))
  wiring(args.firstOrNull() ?: error("usage: KeyboardRulesCheck <main directory> <vendor/react-native-reanimated>"))
  println("KeyboardRulesCheck: $checks checks passed")
}
