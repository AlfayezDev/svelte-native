package expo.modules.svelteengine

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of which foreign views pass a touch on to JavaScript (`ForeignTouchRules`, SPEC.md "Foreign views"): the views are Android classes, so the rule is checked on its inputs and
 * the sources of `HitTest` and `EngineForeign` are read for what feeds it and what it decides. Usage: ForeignTouchRulesCheck <views/HitTest.kt> <views/EngineForeign.kt>   (src/test/run.sh)
 */
private var failures = 0
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    failures++
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
  }
}

private fun normalized(path: String) = File(path).readText().replace(Regex("\\s+"), " ")

// Stand-ins for the platform's classes, named by what they do. The bases are what `EngineForeign` accepts (React Native's `ReactViewGroup`, Expo's `ExpoView`), the framework's plain view and container,
// and the widgets that take a touch themselves.
@Suppress("UNUSED_PARAMETER")
private open class Base { open fun onTouchEvent(event: Any): Boolean = true; open fun dispatchTouchEvent(event: Any): Boolean = true; open fun onInterceptTouchEvent(event: Any): Boolean = false }
private open class Framework
// react-native-svg's views: a base, and nothing of touch below it.
private open class SvgLike : Base()
private class ShapeLike : SvgLike()
// react-native-maps' MapView: declares only `dispatchTouchEvent`, over a gms MapView that declares none.
private open class GmsMap : Base()
private class MapLike : GmsMap() { override fun dispatchTouchEvent(event: Any): Boolean = true }
// A view that takes its touch through `onTouchEvent` (expo-video's VideoView), and one through `onInterceptTouchEvent`.
private class VideoLike : SvgLike() { override fun onTouchEvent(event: Any): Boolean = true }
private class InterceptingLike : SvgLike() { override fun onInterceptTouchEvent(event: Any): Boolean = true }
// Two levels below the base, the declaring class is not the view's own.
private open class Middle : SvgLike()
private class DeepMapLike : Middle() { override fun dispatchTouchEvent(event: Any): Boolean = true }
private class DeepPlainLike : Middle()
// A class of a library the engine has not seen: not through a base.
private class UnknownWidget : Framework()
// What may be inside: a widget that takes the touch (a TextView), and one that does not (an ImageView).
private open class PlainWidget : Framework()
private class TouchWidget : Framework() { fun onTouchEvent(event: Any): Boolean = true }

private fun rule() {
  val ownBases = setOf<Class<*>>(Base::class.java)
  val insideBases = ownBases + setOf<Class<*>>(Framework::class.java)
  val declares = ForeignTouchRules::declaresTouch
  fun ownPlain(type: Class<*>?) = ForeignTouchRules.takesNoTouch(type, ownBases, declares)
  fun insidePlain(type: Class<*>?) = ForeignTouchRules.takesNoTouch(type, insideBases, declares)

  expect("the touch methods are the three through which a view takes a touch", ForeignTouchRules.touchMethods, listOf("onTouchEvent", "dispatchTouchEvent", "onInterceptTouchEvent"))
  expect("a view of a base with nothing of touch below it (react-native-svg's) takes none", ownPlain(SvgLike::class.java), true)
  expect("so does one two levels below the base", ownPlain(ShapeLike::class.java), true)
  expect("and one three levels below it", ownPlain(DeepPlainLike::class.java), true)
  expect("a map that declares only dispatchTouchEvent (react-native-maps) takes touches, though its base declares no onTouchEvent", ownPlain(MapLike::class.java), false)
  expect("a video view that declares onTouchEvent does", ownPlain(VideoLike::class.java), false)
  expect("a view that declares onInterceptTouchEvent does", ownPlain(InterceptingLike::class.java), false)
  expect("a declaration two levels below the view's own class is found", ownPlain(DeepMapLike::class.java), false)
  expect("a class that is none of the bases (a WebView, a library's container) keeps its touches", ownPlain(UnknownWidget::class.java), false)
  expect("the base itself is known", ownPlain(Base::class.java), true)
  expect("no class is none", ownPlain(null), false)
  expect("what is inside a view may be framework's plain view", insidePlain(PlainWidget::class.java), true)
  expect("but not a widget that takes a touch (a TextView, a PlayerView)", insidePlain(TouchWidget::class.java), false)
  expect("or a view of a base that does", insidePlain(MapLike::class.java), false)
  // The check that reads the methods: the declared ones, by name, not what a class inherits.
  expect("a class declares what it declares", ForeignTouchRules.declaresTouch(MapLike::class.java), true)
  expect("and not what it inherits", ForeignTouchRules.declaresTouch(SvgLike::class.java), false)

  fun passes(plainClass: Boolean = true, plainDescendants: Boolean = true, clickable: Boolean = false, longClickable: Boolean = false, clickListener: Boolean = false, touchListener: Boolean = false) =
    ForeignTouchRules.passesToParent(plainClass, plainDescendants, clickable, longClickable, clickListener, touchListener)
  expect("a view of a known base that nothing asked for a touch of passes it on", passes(), true)
  expect("a class that takes touches does not", passes(plainClass = false), false)
  expect("a view with a child that takes touches (a map's surface, a player) does not", passes(plainDescendants = false), false)
  expect("a clickable view takes it", passes(clickable = true), false)
  expect("so does a long-clickable one", passes(longClickable = true), false)
  expect("and one with a click listener", passes(clickListener = true), false)
  expect("and one with a touch listener (setOnTouchListener on a view that declares nothing)", passes(touchListener = true), false)
}

private fun sources(hit: String, foreign: String) {
  val hitText = normalized(hit)
  // A view that takes its touches is the target itself, as before; any other leaves the hit test to the frame's own rule (a target unless pointerEvents is box-none), which has the tag.
  expect("a touch that lands in a foreign view that takes touches itself has the view as its target", hitText.contains("if (content != null && inside && content.visibility == View.VISIBLE && !v.passesTouchesToParent()) return content"), true)
  expect("no other path hands the view out", Regex("return content\\b").findAll(hitText).count(), 1)
  val text = normalized(foreign)
  val passes = text.substringAfter("fun passesTouchesToParent(): Boolean {").substringBefore("override fun onMeasure")
  expect("the class is judged first, from the cache, and a class that does not pass ends it: the walk and the listener reads are for a class that passed", passes.contains("if (!plain(view.javaClass, ownBases, ownVerdicts)) return false return ForeignTouchRules.passesToParent("), true)
  expect("the rest is asked with the inside, and what the view asked for", passes.contains("plainClass = true, plainDescendants = !(view is ViewGroup && insideTakesTouch(view)), clickable = view.isClickable, longClickable = view.isLongClickable, clickListener = view.hasOnClickListeners(), touchListener = hasTouchListener(view), )"), true)
  expect("the class is not read a second time", Regex("plain\\(view\\.javaClass").findAll(passes).count(), 1)
  expect("a view that is not there yet takes the touch itself, as before", passes.contains("val view = content ?: return false"), true)
  expect("the bases are React Native's view group and Expo's view, by class and not by name (R8 renames names)", text.contains("val ownBases: Set<Class<*>> = setOf(ReactViewGroup::class.java, ExpoView::class.java)"), true)
  expect("inside, the framework's plain view and container are known too", text.contains("val insideBases: Set<Class<*>> = ownBases + setOf(View::class.java, ViewGroup::class.java)"), true)
  expect("a class is looked at once, not at every touch", text.contains("verdicts.getOrPut(type) {"), true)
  expect("a class whose methods cannot be read keeps its touches, and is logged once", text.contains("if (!warned) { warned = true Log.w(") && text.contains("} true } }"), true)
  expect("the children are looked at for clicks, listeners and classes, all the way down", text.contains("if (child.isClickable || child.isLongClickable || child.hasOnClickListeners() || hasTouchListener(child) || !plain(child.javaClass, insideBases, insideVerdicts)) return true") && text.contains("if (child is ViewGroup && insideTakesTouch(child)) return true"), true)
  val listener = text.substringAfter("fun hasTouchListener(view: View): Boolean {")
  expect("a view whose listener fields cannot be read is not passed on: it keeps its touches, as it always did", listener.contains("if (info == null || field == null) return true"), true)
  expect("so does one whose listener cannot be read from the view", listener.contains("} catch (_: Throwable) { true }"), true)
  expect("only a view with listener info and no touch listener in it has none", listener.contains("listeners != null && field.get(listeners) != null"), true)
  expect("a touch listener is read from the view's listener info", text.contains("getDeclaredField(\"mListenerInfo\")") && text.contains("getDeclaredField(\"mOnTouchListener\")"), true)
  // No declaring-class lookup, no per-framework-class entries: the walk is the rule's.
  for (gone in listOf("getMethod(", "declaringClass", "FrameLayout", "LinearLayout", "RelativeLayout"))
    expect("EngineForeign no longer has $gone", text.contains(gone), false)
}

fun main(args: Array<String>) {
  rule()
  if (args.size > 1) sources(args[0], args[1])
  if (failures > 0) {
    System.err.println("$failures of $checks checks failed")
    exitProcess(1)
  }
  println("foreign touch rules: $checks checks passed")
}
