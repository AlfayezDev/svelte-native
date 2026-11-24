package expo.modules.svelteengine

import android.util.Log
import android.view.View
import android.view.ViewTreeObserver
import android.widget.EditText
import expo.modules.svelteengine.views.EngineInput
import expo.modules.svelteengine.views.EngineNode
import expo.modules.svelteengine.views.EngineScroll
import kotlin.math.roundToInt

/**
 * What follows the keyboard, driven by the IME's own animation (SPEC.md, "Keyboard motion"). `Insets` hands it each frame of a keyboard animation on the main thread,
 * from `WindowInsetsAnimationCompat.Callback.onProgress`, the frame the window itself moves in, and it writes what moves with the keyboard there: the views of
 * `KeyboardStickyView` (a translation), the scroll views of `KeyboardChatScrollView` and `KeyboardAwareScrollView` (their offset), and the Reanimated
 * shared values behind `createKeyboardMotion()` (a synchronous call into the UI runtime, which runs its mappers at once). Nothing of it goes through JavaScript, so a busy
 * JavaScript thread does not hold the keyboard's followers back; JavaScript only registers a view once, by tag, and the registration is dropped when the view is gone.
 */
class KeyboardDrive(private val viewFor: (Int) -> View?, private val windowHeight: () -> Int) {
  companion object {
    private const val TAG = "SvelteEngine"
    /** The kinds of frame a listener hears: the keyboard is about to move to a height, it is at a height on the way, it has stopped at a height. */
    const val START = 1
    const val MOVE = 2
    const val END = 3
    private const val EARLY_MAX = 64
  }

  /**
   * A view that follows the keyboard: a sticky view (offsets [closed] and [opened], dp), or one that avoids it ([avoid]): it goes up by how far the keyboard covers
   * [anchor], the view of that tag, [closed] dp short of the keyboard's top, worked out when the keyboard starts to open ([overlap], px).
   */
  private class Sticky(var closed: Double, var opened: Double, var enabled: Boolean, var avoid: Boolean = false, var anchor: Int = 0, var overlap: Double = 0.0)

  private val stickies = HashMap<Int, Sticky>()
  private val lifts = HashMap<Int, ChatLift>()
  private val awares = HashMap<Int, AwareScroll>()
  private val ends = HashMap<Int, Boolean>()
  private val early = HashMap<Int, ArrayList<Pair<String, List<Any?>>>>()
  private val listeners = LinkedHashMap<Int, (Int, Int) -> Unit>()
  private var nextListener = -1
  private var persistent = 0
  private var progress = 0.0
  private var moving = false

  /** Told when a scroll view registered with `onEndVisible` has its end in view, and when it has not any more (`tag`, visible); the module sends it to JavaScript. */
  var endVisible: ((Int, Boolean) -> Unit)? = null

  /** The keyboard's height now, px: what the last frame said. */
  var height = 0
    private set

  private var root: View? = null
  private val focus = ViewTreeObserver.OnGlobalFocusChangeListener { _, next -> if (next is EditText && !moving && height > 0) refocus(next) }
  private var watched: ViewTreeObserver? = null

  fun install(root: View) {
    uninstall()
    this.root = root
    watched = root.viewTreeObserver.also { it.addOnGlobalFocusChangeListener(focus) }
  }

  fun uninstall() {
    watched?.takeIf { it.isAlive }?.removeOnGlobalFocusChangeListener(focus)
    watched = null
  }

  /**
   * The commands of `SvelteEngine.keyboardDrive(tag, name, args)`; lengths in dp. JavaScript registers a view when its component has been mounted, which is before the
   * commit that creates the view has reached the main thread: a command for a tag with no view waits, the last of each name, for [viewCreated].
   */
  fun command(tag: Int, name: String, args: List<Any?>) {
    if (tag >= 0 && viewFor(tag) == null) {
      if (early.size > EARLY_MAX) early.clear()
      val queued = early.getOrPut(tag) { ArrayList() }
      queued.removeAll { it.first == name || name == "release" }
      if (name != "release") queued.add(name to args) else if (queued.isEmpty()) early.remove(tag)
      return
    }
    fun num(index: Int) = (args.getOrNull(index) as? Number)?.toDouble() ?: 0.0
    fun flag(index: Int) = args.getOrNull(index) as? Boolean ?: true
    when (name) {
      "follow" -> follow(tag, num(0), num(1), flag(2))
      "avoid" -> follow(tag, num(1), 0.0, flag(2), true, num(0).toInt())
      "lift" -> lift(tag, when (args.getOrNull(0)) { "whenAtEnd" -> ChatLift.WHEN_AT_END; "never" -> ChatLift.NEVER; else -> ChatLift.ALWAYS }, num(1), flag(2))
      "aware" -> aware(tag, num(0), num(1), flag(2))
      "release" -> release(tag)
      "focus" -> focusTo(args.getOrNull(0) as? String)
      else -> Log.w(TAG, "keyboardDrive: unsupported command '$name' for tag $tag")
    }
  }

  /** The view of [tag] has been created and given its props: the commands that were waiting for it run. */
  fun viewCreated(tag: Int) {
    if (early.isEmpty()) return
    val queued = early.remove(tag) ?: return
    for ((name, args) in queued) command(tag, name, args)
  }

  fun follow(tag: Int, closed: Double, opened: Double, enabled: Boolean, avoid: Boolean = false, anchor: Int = 0) {
    val sticky = stickies.getOrPut(tag) { Sticky(closed, opened, enabled, avoid, anchor) }
    sticky.avoid = avoid
    sticky.anchor = anchor
    if (avoid && height > 0) sticky.overlap = overlapOf(sticky, height)
    sticky.closed = closed
    sticky.opened = opened
    sticky.enabled = enabled
    if (!stick(tag, sticky)) stickies.remove(tag)
  }

  fun lift(tag: Int, behavior: Int, offset: Double, watchEnd: Boolean) {
    val view = viewFor(tag) as? EngineScroll ?: return
    watch(tag, view, watchEnd)
    val px = (offset * view.resources.displayMetrics.density).roundToInt()
    val rules = lifts.getOrPut(tag) { ChatLift(behavior, px, (KeyboardRules.AT_END_DP * view.resources.displayMetrics.density).roundToInt()) }
    rules.behavior = behavior
    rules.offset = px
    // A scroll view that arrives while the keyboard is up holds the room it takes, and lifts nothing it has not been told to.
    if (height > 0 && !moving) { rules.start(height, view.scrollY, view.height, content(view)); rules.end(height, view.scrollY); pad(view, rules.padding) }
  }

  fun aware(tag: Int, bottomOffset: Double, extra: Double, scrollOnHide: Boolean) {
    val view = viewFor(tag) as? EngineScroll ?: return
    val density = view.resources.displayMetrics.density
    val rules = awares.getOrPut(tag) { AwareScroll(0, 0, true) }
    rules.bottomOffset = (bottomOffset * density).roundToInt()
    rules.extra = (extra * density).roundToInt()
    rules.scrollOnHide = scrollOnHide
    if (height > 0 && !moving) { rules.start(height, view.scrollY, focused(view), windowHeight()); rules.end(height); pad(view, rules.padding) }
  }

  /** The view stops following the keyboard and goes back to where its own style puts it. */
  fun release(tag: Int) {
    val view = viewFor(tag)
    if (view is EngineScroll) watch(tag, view, false)
    if (stickies.remove(tag) != null && view is EngineNode) drive(view, view, 0f)
    if ((lifts.remove(tag) != null || awares.remove(tag) != null) && view is EngineScroll) pad(view, 0)
  }

  /** The keyboard is about to move to [target] px (0 when it is going away): the root insets hold its end state. */
  fun start(target: Int) {
    moving = true
    if (target > 0) {
      persistent = target
      for (sticky in stickies.values) if (sticky.avoid) sticky.overlap = overlapOf(sticky, target)
    }
    eachLift { tag, view, rules -> rules.start(target, view.scrollY, view.height, content(view)); pad(view, rules.padding) }
    eachAware { _, view, rules -> rules.start(target, view.scrollY, focused(view), windowHeight()); pad(view, rules.padding) }
    notify(START, target)
  }

  /** One frame of the animation, [px] high. */
  fun progress(px: Int) {
    height = px
    progress = KeyboardRules.progress(px.toDouble(), persistent.toDouble())
    eachSticky()
    eachLift { _, view, rules -> rules.move(px, view.scrollY, view.height, content(view))?.let { scroll(view, it) } }
    eachAware { _, view, rules -> rules.move(px)?.let { scroll(view, it) } }
    notify(MOVE, px)
  }

  /** The keyboard has stopped at [px]. */
  fun end(px: Int) {
    moving = false
    height = px
    progress = if (px == 0) 0.0 else 1.0
    eachSticky()
    eachLift { _, view, rules -> rules.end(px, view.scrollY); pad(view, rules.padding) }
    eachAware { _, view, rules -> rules.end(px); pad(view, rules.padding) }
    notify(END, px)
  }

  /** The keyboard changed its height with no animation (another keyboard, a layout): the new height at once. */
  fun settle(px: Int) {
    if (moving || px == height) return
    start(px)
    progress(px)
    end(px)
  }

  /** Subscribes [listener] to the frames (Reanimated's keyboard source, SPEC.md "Keyboard motion"); it hears the keyboard's state now when it is up. */
  fun subscribe(listener: (Int, Int) -> Unit): Int {
    val id = nextListener--
    listeners[id] = listener
    if (height > 0) {
      call(id, listener, START, persistent)
      call(id, listener, END, height)
    }
    return id
  }

  fun unsubscribe(id: Int) {
    listeners.remove(id)
  }

  private fun notify(kind: Int, px: Int) {
    if (listeners.isEmpty()) return
    for ((id, listener) in listeners.entries.toList()) call(id, listener, kind, px)
  }

  /** A listener that fails is dropped, so one bad worklet does not stop the keyboard's other followers. */
  private fun call(id: Int, listener: (Int, Int) -> Unit, kind: Int, px: Int) {
    try {
      listener(kind, px)
    } catch (e: Throwable) {
      Log.w(TAG, "keyboard listener $id dropped: ${e.javaClass.simpleName} ${e.message}")
      listeners.remove(id)
    }
  }

  /** How far the keyboard, [target] px high, covers the anchor of [sticky] (px): its bottom edge in the window past the keyboard's top edge and the offset. */
  private fun overlapOf(sticky: Sticky, target: Int): Double {
    val anchor = viewFor(sticky.anchor) ?: return sticky.overlap
    val keyboardTop = windowHeight() - target - sticky.closed * anchor.resources.displayMetrics.density
    return maxOf(bottomOf(anchor) - keyboardTop, 0.0)
  }

  /** Moves the view of [tag] to where the keyboard's height puts it; false when there is no such view any more. */
  private fun stick(tag: Int, sticky: Sticky): Boolean {
    val view = viewFor(tag)
    if (view !is EngineNode) return false
    val density = view.resources.displayMetrics.density
    val y = if (sticky.avoid) KeyboardRules.avoid(sticky.overlap, progress, sticky.enabled)
      else KeyboardRules.sticky(height.toDouble(), progress, sticky.closed * density, sticky.opened * density, sticky.enabled)
    drive(view, view, y.toFloat())
    return true
  }

  /** Translates [view] by [y] px more than its own transform does: `Props.setTransform` adds [expo.modules.svelteengine.views.NodeState.drivenY] to every translation it writes. */
  private fun drive(view: View, node: EngineNode, y: Float) {
    val state = node.node
    view.translationY += y - state.drivenY
    state.drivenY = y
    if (y != 0f) state.transformed = true
  }

  private fun scroll(view: EngineScroll, y: Int) {
    if (y != view.scrollY) view.scrollToPx(view.scrollX, y, false)
  }

  private fun pad(view: EngineScroll, px: Int) {
    if (view.paddingBottom == px) return
    view.clipToPadding = false
    view.setPadding(view.paddingLeft, view.paddingTop, view.paddingRight, px)
  }

  private fun content(view: EngineScroll): Int = view.getChildAt(0)?.height ?: 0

  /** Reports the end of [view] coming into view or leaving it (`onEndVisible`), on every scroll and layout pass of it; its first report is when it has been laid out. */
  private fun watch(tag: Int, view: EngineScroll, on: Boolean) {
    ends.remove(tag)
    if (!on) { view.bridge.watcher = null; return }
    view.bridge.watcher = { checkEnd(tag, view) }
    checkEnd(tag, view)
  }

  private fun checkEnd(tag: Int, view: EngineScroll) {
    val content = content(view)
    if (view.height == 0 || content == 0) return
    val at = KeyboardRules.atEnd(view.scrollY, view.height, content, (KeyboardRules.AT_END_DP * view.resources.displayMetrics.density).roundToInt())
    if (ends[tag] == at) return
    ends[tag] = at
    endVisible?.invoke(tag, at)
  }

  /** `KeyboardController.setFocusTo`: the input after or before the focused one in the tree, or the focused one again (which brings the keyboard back). */
  private fun focusTo(direction: String?) {
    val current = root?.findFocus() as? EditText ?: return
    val target = when (direction) {
      "next" -> current.focusSearch(View.FOCUS_FORWARD)
      "prev" -> current.focusSearch(View.FOCUS_BACKWARD)
      else -> current
    }
    if (target is EngineInput) target.focus() else target?.requestFocus()
  }

  /** The bottom edge, in window coordinates, of the input of [view] that has the focus; negative when none has. */
  private fun focused(view: EngineScroll): Int {
    val input = view.findFocus() as? EditText ?: return -1
    return bottomOf(input)
  }

  private fun bottomOf(input: View): Int {
    val at = IntArray(2)
    input.getLocationInWindow(at)
    return at[1] + input.height
  }

  /** Another input took the focus while the keyboard is up: the scroll view it is in brings it above the keyboard (animated, as `KeyboardAwareScrollView` scrolls). */
  private fun refocus(input: EditText) {
    eachAware { _, view, rules ->
      var parent = input.parent
      while (parent != null && parent !== view) parent = parent.parent
      if (parent == null) return@eachAware
      view.scrollToPx(view.scrollX, rules.refocus(view.scrollY, bottomOf(input), windowHeight()), true)
    }
  }

  private fun eachSticky() {
    val iterator = stickies.entries.iterator()
    while (iterator.hasNext()) {
      val (tag, sticky) = iterator.next()
      if (!stick(tag, sticky)) iterator.remove()
    }
  }

  private inline fun eachLift(block: (Int, EngineScroll, ChatLift) -> Unit) {
    val iterator = lifts.entries.iterator()
    while (iterator.hasNext()) {
      val (tag, rules) = iterator.next()
      val view = viewFor(tag) as? EngineScroll
      if (view == null) iterator.remove() else block(tag, view, rules)
    }
  }

  private inline fun eachAware(block: (Int, EngineScroll, AwareScroll) -> Unit) {
    val iterator = awares.entries.iterator()
    while (iterator.hasNext()) {
      val (tag, rules) = iterator.next()
      val view = viewFor(tag) as? EngineScroll
      if (view == null) iterator.remove() else block(tag, view, rules)
    }
  }
}
