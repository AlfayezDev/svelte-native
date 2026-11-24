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
  lift.end(750, 3250)
  expect("always: padding holds", lift.padding, 750)
  lift.start(0, 3250, viewport, content)
  expect("always: closing keeps the padding until the end", lift.padding, 750)
  expect("always: closing, 500 px", lift.move(500, 3250, viewport, content), 3000)
  expect("always: closed", lift.move(0, 2600, viewport, content), 2500)
  lift.end(0, 2500)
  expect("always: padding is gone", lift.padding, 0)
  // Up the list (500): `always` lifts there too, `whenAtEnd` does not and holds, `never` neither.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 500, viewport, content)
  expect("always, up the list", lift.move(750, 500, viewport, content), 1250)
  lift = ChatLift(ChatLift.WHEN_AT_END, 0, threshold)
  lift.start(750, 500, viewport, content)
  expect("whenAtEnd up the list: the padding is still made", lift.padding, 750)
  expect("whenAtEnd up the list: no frame moves it", lift.move(400, 500, viewport, content), null)
  lift.end(750, 500)
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
  lift.end(750, 2500)
  lift.start(0, 3000, viewport, content)
  expect("never: closing clamps", lift.move(100, 3000, viewport, content), 2600)
  expect("never: closing inside the range", lift.move(100, 2600, viewport, content), null)
  // The keyboard turns around: closing, with the content 500 px into the way back (3000), it opens again. The new start goes on from the same baseline (2500), so the next
  // frame is where the content is, not 600 px past it.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 2500, viewport, content)
  lift.move(750, 2500, viewport, content)
  lift.end(750, 3250)
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
  lift.end(0, 2500)
  expect("turn: closed", lift.padding, 0)
  // Registered again with the keyboard up (a change of `offset` or `keyboardLiftBehavior`): what the close goes back by is kept.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.start(750, 2500, viewport, content)
  lift.move(750, 2500, viewport, content)
  lift.end(750, 3250)
  lift.retune(ChatLift.ALWAYS, 0)
  lift.start(0, 3250, viewport, content)
  expect("retuned: the close goes back to where the content was", lift.move(0, 3250, viewport, content), 2500)
  // A scroll view that arrives with the keyboard up holds the room and moves nothing.
  lift = ChatLift(ChatLift.ALWAYS, 0, threshold)
  lift.attach(750, 2400, viewport, content)
  expect("attached: the room", lift.padding, 750)
  lift.start(0, 2400, viewport, content)
  expect("attached: the close leaves the content where it is", lift.move(0, 2400, viewport, content), 2400)
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
  scroll.end(1000)
  scroll.start(0, 700, 1700, 2400)
  expect("closing keeps the room until the end", scroll.padding, 1000)
  expect("closing goes back along the same way", scroll.move(500, 700, 1500, 4000), 550)
  scroll.end(0)
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
  keep.end(1000)
  keep.start(0, 700, 1700, 2400)
  expect("no scroll on hide", keep.move(500, 700, 1500, 4000), null)
  // The room it holds until the end still extends the range as the keyboard closes: a content scrolled into it is held inside what is left, as the chat lift's is, so it does not jump when the room goes.
  expect("no scroll on hide, held inside the range that is left", keep.move(500, 3300, 1500, 4000), 3000)
  expect("no scroll on hide, nearly closed", keep.move(100, 2700, 1500, 4000), 2600)
  expect("no scroll on hide, inside the range", keep.move(100, 2600, 1500, 4000), null)
  // Another input takes the focus while the keyboard is up: the way to it, from where the scroll view is.
  val next = AwareScroll(0, 0, true)
  next.start(1000, 0, 1700, 2400)
  next.end(1000)
  expect("refocus", next.refocus(700, 1900, 2400), 1200)
  // The keyboard turns around while it opens: the way goes on from the same base and distance, not from where the scroll view is now.
  val turn = AwareScroll(0, 0, true)
  turn.start(1000, 400, 1700, 2400)
  expect("turn: a third open", turn.move(500, 400, 1500, 4000), 550)
  turn.start(0, 550, 1700, 2400)
  expect("turn: closing from the third", turn.move(300, 550, 1500, 4000), 490)
  turn.start(1000, 490, 1900, 2400)
  expect("turn: opening again keeps the base", turn.move(600, 490, 1500, 4000), 580)
  turn.end(1000)
  expect("turn: the room", turn.padding, 1000)
}


/** Why a view in a Modal is left alone: the modal's layer makes room for the keyboard in its own layout, by the whole of what the keyboard covers of it. */
private fun modal() {
  val inset = IntArray(4)
  expo.modules.svelteengine.views.ModalLayout.contentInsets(0, 63, 0, 63, 1050, statusBarTranslucent = false, navigationBarTranslucent = false, out = inset)
  expect("a modal's content ends where the keyboard begins", inset[3], 1050)
  expo.modules.svelteengine.views.ModalLayout.contentInsets(0, 63, 0, 63, 0, statusBarTranslucent = false, navigationBarTranslucent = false, out = inset)
  expect("and above the bar without it", inset[3], 63)
}

private fun frames() {
  var f = KeyboardFrames()
  // One animation: prepare, start, frames, end.
  f.prepare(); f.start(750)
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
  f.prepare(); f.prepare(); f.reset()
  expect("a window that goes forgets its animations", f.running, 0)
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
  val seen = ArrayList<String>()
  fun adapter(translucent: Boolean) = ReanimatedKeyboard(translucent, 2.625f, { 63 }) { state, dp -> seen.add("$state:$dp") }
  // Opening, the navigation bar not translucent: 1050 px is 376 dp (987 px past the bar's 63), the state is opening on the way and open at the end.
  var k = adapter(false)
  k.start(); k.frame(525); k.frame(1050); k.end(1050)
  expect("open, bar not translucent", seen.toList(), listOf("1:176", "1:376", "2:376"))
  seen.clear()
  k = adapter(true)
  k.start(); k.frame(525); k.frame(1050); k.end(1050)
  expect("open, bar translucent: the whole 400 dp", seen.toList(), listOf("1:200", "1:400", "2:400"))
  seen.clear()
  k.start(); k.frame(525); k.frame(0); k.end(0)
  expect("closing ends closed, at 0", seen.toList(), listOf("3:200", "3:0", "4:0"))
  seen.clear()
  // A start while another runs turns the state around; a frame of an open keyboard that reads 0 is not taken; an animation with no frame is told at its end.
  k = adapter(true)
  k.start(); k.frame(1050); k.end(1050); seen.clear()
  k.frame(0)
  expect("0 for an open keyboard is left out", seen.toList(), listOf("2:400"))
  seen.clear()
  k.start(); k.start(); k.frame(525); k.end(525)
  expect("a turn: closing, then opening again", seen.toList(), listOf("1:200", "2:200"))
  seen.clear()
  k = adapter(true)
  k.start(); k.end(1050)
  expect("no frame: told at the end", seen.toList(), listOf("1:400", "2:400"))
}

private fun read(main: File, name: String) = File(main, name).readText()

private fun wiring(main: String) {
  val dir = File(main)
  val insets = read(dir, "Insets.kt")
  expect("the IME's start reaches the drive", insets.contains("drive.start(target)"), true)
  expect("every frame of the IME's animation reaches the drive", insets.contains("drive.progress("), true)
  expect("only the IME's animation does", insets.contains("runningAnimations.any { it.typeMask and WindowInsetsCompat.Type.ime() != 0 }"), true)
  expect("its end reaches the drive", insets.contains("drive.end(px)"), true)
  expect("a change with no animation reaches it too", insets.contains("drive.settle(px)"), true)
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
  expect("a pooled scroll view forgets the room made at its bottom", scroll.contains("if (paddingBottom != 0) setPadding(paddingLeft, paddingTop, paddingRight, 0)"), true)
  expect("a running animation is counted, and the end of the last one settles", insets.contains("frames.prepare()") && insets.contains("if (!frames.end()) return") && insets.contains("frames.frame("), true)
  expect("a layout changes where a view that avoids the keyboard is", insets.contains("drive.layoutChanged()"), true)
  expect("the navigation bar Reanimated's callers are told of is the one the overlay does not cover", insets.contains("drive.navigationBar = {"), true)
  expect("the coordinates of the keyboard's top are the overlay's", read(dir, "MountingManager.kt").contains("root.getLocationInWindow(at)"), true)
  val drive = read(dir, "KeyboardDrive.kt")
  expect("a subscription made on the JavaScript thread is made on the main thread, where the frames go", drive.contains("runMain {") && drive.contains("nextListener = AtomicInteger(-1)") && drive.contains("fun unsubscribe(id: Int) {\n    runMain { listeners.remove(id) }"), true)
  expect("Reanimated's callers are given their own numbers and createKeyboardMotion's subscription the engine's", drive.contains("ReanimatedKeyboard(navigationBarTranslucent") && drive.contains("val raw = rawFlag.getAndSet(false)"), true)
  expect("a lift registered again is tuned, not started over", drive.contains("known.retune(behavior, px)") && drive.contains("rules.attach("), true)
  expect("a view in a modal is left to the modal", drive.contains("if (parent is ModalLayer) return true") && drive.contains("if (inModal(view)) { drive(view, view, 0f); return true }") && drive.split("!inModal(view)").size - 1 >= 4, true)
  expect("an input is what the focus goes to", drive.contains("if (found is EditText)"), true)
  expect("the report of a scroll view's end is forgotten with the view", drive.split("ends.remove(tag)").size - 1 >= 4, true)
  expect("the room is outside the clip, as the keyboard's scroll decorator makes it", drive.contains("view.clipToPadding = false"), true)
}

fun main(args: Array<String>) {
  rules()
  chat()
  aware()
  frames()
  modal()
  reanimated(args.getOrNull(1) ?: error("usage: KeyboardRulesCheck <main directory> <vendor/react-native-reanimated>"))
  wiring(args.firstOrNull() ?: error("usage: KeyboardRulesCheck <main directory> <vendor/react-native-reanimated>"))
  println("KeyboardRulesCheck: $checks checks passed")
}
