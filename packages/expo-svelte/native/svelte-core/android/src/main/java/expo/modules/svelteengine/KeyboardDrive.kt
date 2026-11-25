package expo.modules.svelteengine

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewTreeObserver
import android.widget.EditText
import expo.modules.svelteengine.views.EngineInput
import expo.modules.svelteengine.views.EngineNode
import expo.modules.svelteengine.views.EngineScroll
import expo.modules.svelteengine.views.ModalLayer
import kotlin.math.roundToInt

/**
 * What follows the keyboard, driven by the IME's own animation (SPEC.md, "Keyboard motion"). `Insets` hands it each frame of a keyboard animation on the main thread,
 * from `WindowInsetsAnimationCompat.Callback.onProgress`, the frame the window itself moves in, and it writes what moves with the keyboard there: the views of
 * `KeyboardStickyView` (a translation), the scroll views of `KeyboardChatScrollView` and `KeyboardAwareScrollView` (their offset), and the Reanimated
 * shared values behind `createKeyboardMotion()` (a synchronous call into the UI runtime, which runs its mappers at once). Nothing of it goes through JavaScript, so a busy
 * JavaScript thread does not hold the keyboard's followers back; JavaScript only registers a view once, by tag, and the registration is dropped when the view is gone.
 */
class KeyboardDrive(private val viewFor: (Int) -> View?, private val overlayBottom: () -> Int) : KeyboardSink {
  companion object {
    private const val TAG = "SvelteEngine"
    private const val EARLY_MAX = 64
    private const val FOCUS_STEPS = 16
  }

  private val stickies = HashMap<Int, Sticky>()
  private val lifts = HashMap<Int, ChatLift>()
  private val awares = HashMap<Int, AwareScroll>()
  private val reports = EndReports()
  private val early = HashMap<Int, ArrayList<Pair<String, List<Any?>>>>()
  private val main = Handler(Looper.getMainLooper())

  /** Who hears the frames (Reanimated's keyboard source, `createKeyboardMotion`): see [KeyboardChannel]. */
  private val channel = KeyboardChannel(
    isMain = { Looper.myLooper() == Looper.getMainLooper() },
    post = { main.post(it) },
    navigationBar = { navigationBar() },
    density = { root?.resources?.displayMetrics?.density ?: 1f },
    dropped = { id, e -> Log.w(TAG, "keyboard listener $id dropped: ${e.javaClass.simpleName} ${e.message}") },
  )
  private var persistent = 0
  private var progress = 0.0
  private var moving = false
  private var target = 0

  /** The navigation bar's px that a subscriber of Reanimated's that did not say it is translucent has taken off the keyboard's height (0 edge to edge); set by [Insets]. */
  var navigationBar: () -> Int = { 0 }

  /** Told when a scroll view registered with `onEndVisible` has its end in view, and when it has not any more (`tag`, visible); the module sends it to JavaScript. */
  var endVisible: ((Int, Boolean) -> Unit)? = null

  /** The keyboard's height now, px: what the last frame said. */
  @Volatile var height = 0
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
      if (name != "release") {
        queued.add(name to args)
      } else {
        // The component is gone and so is its view: nothing is left of the registration (a scroll view's end report included).
        if (queued.isEmpty()) early.remove(tag)
        stickies.remove(tag); lifts.remove(tag); awares.remove(tag); reports.forget(tag)
      }
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
    val sticky = Sticky.register(stickies, tag, closed, opened, enabled, avoid, anchor, height) { sticky, target -> overlapOf(sticky, target) }
    if (!stick(tag, sticky)) stickies.remove(tag)
  }

  fun lift(tag: Int, behavior: Int, offset: Double, watchEnd: Boolean) {
    val view = viewFor(tag) as? EngineScroll ?: return
    watch(tag, view, watchEnd)
    val density = view.resources.displayMetrics.density
    val px = (offset * density).roundToInt()
    // Registered again (a change of `keyboardLiftBehavior` or `offset`): the rules are tuned, where the content is and what the close goes back to stay as they are. A new one is
    // armed by the next start; while an animation runs that is the end of it, which takes its place from the keyboard's height ([ChatLift.end]).
    val rules = ChatLift.register(lifts, tag, behavior, px, (KeyboardRules.AT_END_DP * density).roundToInt()) ?: return
    if (height > 0 && !moving && !inModal(view)) { rules.attach(height, view.scrollY, view.height, content(view)); pad(view, rules.padding) }
  }

  fun aware(tag: Int, bottomOffset: Double, extra: Double, scrollOnHide: Boolean) {
    val view = viewFor(tag) as? EngineScroll ?: return
    val density = view.resources.displayMetrics.density
    val known = awares[tag]
    val rules = known ?: AwareScroll(0, 0, true).also { awares[tag] = it }
    rules.bottomOffset = (bottomOffset * density).roundToInt()
    rules.extra = (extra * density).roundToInt()
    rules.scrollOnHide = scrollOnHide
    if (known == null && height > 0 && !moving && !inModal(view)) { rules.start(height, view.scrollY, focused(view), overlayBottom()); rules.end(height, view.scrollY, focused(view), overlayBottom()); pad(view, rules.padding) }
  }

  /** The view stops following the keyboard and goes back to where its own style puts it. */
  fun release(tag: Int) {
    val view = viewFor(tag)
    if (view is EngineScroll) watch(tag, view, false)
    if (stickies.remove(tag) != null && view is EngineNode) drive(view, view, 0f)
    if ((lifts.remove(tag) != null || awares.remove(tag) != null) && view is EngineScroll) pad(view, 0)
    reports.forget(tag)
  }

  /** The keyboard is about to move to [target] px (0 when it is going away): the root insets hold its end state. */
  override fun start(target: Int) {
    startFollowers(target)
    channel.start(target)
  }

  private fun startFollowers(target: Int) {
    moving = true
    this.target = target
    if (target > 0) {
      persistent = target
      for (sticky in stickies.values) if (sticky.avoid) sticky.overlap = overlapOf(sticky, target)
    }
    eachLift { _, view, rules -> rules.start(target, view.scrollY, view.height, content(view)); pad(view, rules.padding) }
    eachAware { _, view, rules -> rules.start(target, view.scrollY, focused(view), overlayBottom()); pad(view, rules.padding) }
  }

  /** One frame of the animation, [px] high. */
  override fun progress(px: Int) {
    moveFollowers(px)
    channel.frame(px)
  }

  private fun moveFollowers(px: Int) {
    height = px
    progress = KeyboardRules.progress(px.toDouble(), persistent.toDouble())
    if (persistent > 0) for (sticky in stickies.values) if (sticky.avoid) sticky.overlap = overlapOf(sticky, persistent)
    eachSticky()
    eachLift { _, view, rules -> rules.move(px, view.scrollY, view.height, content(view))?.let { scroll(view, it) } }
    eachAware { _, view, rules -> rules.move(px, view.scrollY, view.height, content(view))?.let { scroll(view, it) } }
  }

  /** The keyboard has stopped at [px]. */
  override fun end(px: Int) {
    endFollowers(px)
    channel.end(px)
  }

  private fun endFollowers(px: Int) {
    moving = false
    height = px
    progress = if (px == 0) 0.0 else 1.0
    eachSticky()
    eachLift { _, view, rules -> rules.end(px, view.scrollY, view.height, content(view)); pad(view, rules.padding) }
    eachAware { _, view, rules -> rules.end(px, view.scrollY, focused(view), overlayBottom()); pad(view, rules.padding) }
  }

  /** The layout of the window changed: a view that avoids the keyboard works out again how far the keyboard covers its anchor (nothing moves while the keyboard is on its way: each frame does). */
  fun layoutChanged() {
    if (moving || height <= 0 || stickies.isEmpty()) return
    for (sticky in stickies.values) if (sticky.avoid) sticky.overlap = overlapOf(sticky, height)
    eachSticky()
  }

  /**
   * The keyboard changed its height with no animation (another keyboard, a layout): the new height at once. A keyboard that was up and is up goes through [resize]: what
   * is lifted goes by the difference, not by the whole new height again. Otherwise (the keyboard comes or goes with no animation) what it moves goes through a start, a
   * frame and an end, as an animation of no length. What hears the frames is told that the height changed ([KeyboardChannel.settle]), not that the keyboard started to close
   * and opened again.
   */
  override fun settle(px: Int) {
    if (moving || px == height) return
    if (px > 0 && height > 0) resize(px) else {
      startFollowers(px)
      moveFollowers(px)
      endFollowers(px)
    }
    channel.settle(px)
  }

  private fun resize(px: Int) {
    height = px
    persistent = px
    target = px
    progress = 1.0
    for (sticky in stickies.values) if (sticky.avoid) sticky.overlap = overlapOf(sticky, px)
    eachSticky()
    eachLift { _, view, rules -> rules.resize(px, view.scrollY, view.height, content(view))?.let { scroll(view, it) }; pad(view, rules.padding) }
    eachAware { _, view, rules -> rules.resize(px, view.scrollY, focused(view), overlayBottom())?.let { scroll(view, it) }; pad(view, rules.padding) }
  }

  /** The views of the tree have been put in their places (the end of a mounting batch): a view that was registered before the modal it is in was is left alone now. */
  fun placed() {
    if (stickies.isEmpty() && lifts.isEmpty() && awares.isEmpty()) return
    eachSticky()
    for ((tag, _) in lifts) (viewFor(tag) as? EngineScroll)?.let { if (inModal(it)) pad(it, 0) }
    for ((tag, _) in awares) (viewFor(tag) as? EngineScroll)?.let { if (inModal(it)) pad(it, 0) }
  }

  /** The next [subscribe] is the engine's own (`createKeyboardMotion`: kind and px as they are), not one of Reanimated's `useAnimatedKeyboard`; asked synchronously, in the JavaScript thread's order. */
  fun rawNext() = channel.rawNext()

  /** Subscribes to the frames from any thread (see [KeyboardChannel.subscribe]). */
  fun subscribe(listener: (Int, Int) -> Unit, navigationBarTranslucent: Boolean = true): Int = channel.subscribe(listener, navigationBarTranslucent)

  fun unsubscribe(id: Int) = channel.unsubscribe(id)

  /** How far the keyboard, [target] px high, covers the anchor of [sticky] (px): its bottom edge in the window past the keyboard's top edge and the offset. */
  private fun overlapOf(sticky: Sticky, target: Int): Double {
    val anchor = viewFor(sticky.anchor) ?: return sticky.overlap
    val keyboardTop = overlayBottom() - target - sticky.closed * anchor.resources.displayMetrics.density
    return maxOf(bottomOf(anchor) - keyboardTop, 0.0)
  }

  /** Moves the view of [tag] to where the keyboard's height puts it; false when there is no such view any more. */
  private fun stick(tag: Int, sticky: Sticky): Boolean {
    val view = viewFor(tag)
    if (view !is EngineNode) return false
    val density = view.resources.displayMetrics.density
    val asked = if (sticky.avoid) KeyboardRules.avoid(sticky.overlap, progress, sticky.enabled)
      else KeyboardRules.sticky(height.toDouble(), progress, sticky.closed * density, sticky.opened * density, sticky.enabled)
    // A modal lifts its own content by the keyboard (`ModalLayout.contentInsets`, once, in its layout): a view in it is not moved a second time.
    val y = KeyboardTree.unlessModal(inModal(view), asked)
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

  /** Whether [view] is in the content of a `Modal`: its layer sits on the overlay, the keyboard reaches into it and it makes room for it itself. */
  private fun inModal(view: View): Boolean = KeyboardTree.hasAncestor<View>(view, { it.parent as? View }, { it is ModalLayer })

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
    reports.forget(tag)
    if (!on) { view.bridge.watcher = null; return }
    view.bridge.watcher = { checkEnd(tag, view) }
    checkEnd(tag, view)
  }

  private fun checkEnd(tag: Int, view: EngineScroll) {
    val content = content(view)
    if (view.height == 0 || content == 0) return
    val at = KeyboardRules.atEnd(view.scrollY, view.height, content, (KeyboardRules.AT_END_DP * view.resources.displayMetrics.density).roundToInt())
    if (!reports.changed(tag, at)) return
    endVisible?.invoke(tag, at)
  }

  /**
   * `KeyboardController.setFocusTo`: the input after or before the focused one in the tree, or the focused one again (which brings the keyboard back). `focusSearch` also
   * finds containers (a scroll view takes the focus when it is its turn), which are not where the keyboard goes: the search goes on until it reaches an input, or none.
   */
  private fun focusTo(direction: String?) {
    val current = root?.findFocus() as? EditText ?: return
    val way = when (direction) { "next" -> View.FOCUS_FORWARD; "prev" -> View.FOCUS_BACKWARD; else -> 0 }
    val target: View? = if (way == 0) current else KeyboardTree.nextInput<View>(current, { it.focusSearch(way) }, { it is EditText }, FOCUS_STEPS)
    if (target is EngineInput) target.focus() else if (target is EditText) target.requestFocus()
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
      view.scrollToPx(view.scrollX, rules.refocus(view.scrollY, bottomOf(input), overlayBottom()), true)
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
      if (view == null) { iterator.remove(); reports.forget(tag) } else if (!inModal(view)) block(tag, view, rules)
    }
  }

  private inline fun eachAware(block: (Int, EngineScroll, AwareScroll) -> Unit) {
    val iterator = awares.entries.iterator()
    while (iterator.hasNext()) {
      val (tag, rules) = iterator.next()
      val view = viewFor(tag) as? EngineScroll
      if (view == null) iterator.remove() else if (!inModal(view)) block(tag, view, rules)
    }
  }
}
