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
  expect("nothing yet", scroll.move(0), 400)
  expect("a third", scroll.move(500), 550)
  expect("all of it", scroll.move(1000), 700)
  scroll.end(1000)
  scroll.start(0, 700, 1700, 2400)
  expect("closing keeps the room until the end", scroll.padding, 1000)
  expect("closing goes back along the same way", scroll.move(500), 550)
  scroll.end(0)
  expect("the room is gone", scroll.padding, 0)
  // `bottomOffset` keeps the input that far above the keyboard.
  val offset = AwareScroll(60, 0, true)
  offset.start(1000, 0, 1700, 2400)
  expect("bottom offset", offset.move(1000), 360)
  // An input that is clear of the keyboard scrolls nothing.
  val clear = AwareScroll(0, 0, true)
  clear.start(1000, 250, 900, 2400)
  expect("clear input", clear.move(1000), null)
  // `disableScrollOnKeyboardHide`: the open scrolls, the close leaves the content where it is.
  val keep = AwareScroll(0, 40, false)
  keep.start(1000, 400, 1700, 2400)
  expect("extra space is part of the room", keep.padding, 1040)
  expect("keeps scrolling on open", keep.move(1000), 700)
  keep.end(1000)
  keep.start(0, 700, 1700, 2400)
  expect("no scroll on hide", keep.move(500), null)
  // Another input takes the focus while the keyboard is up: the way to it, from where the scroll view is.
  val next = AwareScroll(0, 0, true)
  next.start(1000, 0, 1700, 2400)
  next.end(1000)
  expect("refocus", next.refocus(700, 1900, 2400), 1200)
}

private fun read(main: File, name: String) = File(main, name).readText()

private fun wiring(main: String) {
  val dir = File(main)
  val insets = read(dir, "Insets.kt")
  expect("the IME's start reaches the drive", insets.contains("drive.start(imeOverlap())"), true)
  expect("every frame of the IME's animation reaches the drive", insets.contains("drive.progress("), true)
  expect("only the IME's animation does", insets.contains("runningAnimations.any { it.typeMask and WindowInsetsCompat.Type.ime() != 0 }"), true)
  expect("its end reaches the drive", insets.contains("drive.end(imeOverlap())"), true)
  expect("a change with no animation reaches it too", insets.contains("drive.settle(imeOverlap())"), true)
  expect("the record says when the keyboard is moving", insets.contains("\"keyboardAnimating\" to animating"), true)
  val props = read(dir, "Props.kt")
  expect("a commit's translation keeps the keyboard's move", props.contains("view.translationY = ty + st.drivenY"), true)
  expect("an identity transform is not one for a view the keyboard moved", props.contains("rot == 0f && st.drivenY == 0f"), true)
  expect("setNativeProps reads the translation back without the keyboard's move", read(dir, "Commands.kt").contains("view.translationY - node.drivenY"), true)
  expect("a pooled view forgets the move", read(dir, "views/EngineView.kt").contains("drivenY = 0f"), true)
  val module = read(dir, "SvelteEngineModule.kt")
  expect("JavaScript registers a view by tag", module.contains("Function(\"keyboardDrive\")"), true)
  expect("the end of a list is told to JavaScript", module.contains("sendEvent(\"endVisible\""), true)
  expect("Reanimated's keyboard source is the engine's", module.contains("setKeyboardSubscribe"), true)
  val scroll = read(dir, "views/EngineScroll.kt")
  expect("a watched scroll view tells the drive of each scroll and layout", scroll.split("watcher?.invoke()").size - 1, 2)
  expect("a pooled scroll view forgets the room made at its bottom", scroll.contains("if (paddingBottom != 0) setPadding(paddingLeft, paddingTop, paddingRight, 0)"), true)
  val drive = read(dir, "KeyboardDrive.kt")
  expect("the room is outside the clip, as the keyboard's scroll decorator makes it", drive.contains("view.clipToPadding = false"), true)
}

fun main(args: Array<String>) {
  rules()
  chat()
  aware()
  wiring(args.firstOrNull() ?: error("usage: KeyboardRulesCheck <main directory>"))
  println("KeyboardRulesCheck: $checks checks passed")
}
