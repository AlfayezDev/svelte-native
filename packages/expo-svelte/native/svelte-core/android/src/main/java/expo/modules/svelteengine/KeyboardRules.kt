package expo.modules.svelteengine

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * What follows the keyboard frame by frame, as plain numbers so the host can check it (SPEC.md, "Keyboard motion"). The rules are the ones of
 * react-native-keyboard-controller 1.21.9, read from its Android source (`KeyboardAnimationCallback`, `KeyboardStickyView`, `useChatKeyboard`,
 * `KeyboardAwareScrollView`): the same height, progress and scroll targets, so a screen moves as the same screen of an app that uses it does.
 * Every length here is px, the keyboard's height is the IME's inset at that frame.
 */
internal object KeyboardRules {
  /** `AT_END_THRESHOLD` of `useChatKeyboard/helpers.ts` (dp): how far from its end a scroll view still counts as at its end. */
  const val AT_END_DP = 20.0

  /** The IME's progress: its height over the height it opens to, `abs(height / persistentKeyboardHeight)`, 0 when that is not a number. */
  fun progress(height: Double, persistent: Double): Double {
    val value = abs(height / persistent)
    return if (value.isNaN() || value.isInfinite()) 0.0 else value
  }

  /**
   * `KeyboardStickyView`'s `translateY` (px, negative is up): `height + interpolate(progress, [0, 1], [closed, opened])` with the height as a negative number,
   * `closed` for a disabled view. `interpolate` extends past its range, as Reanimated's does by default.
   */
  fun sticky(height: Double, progress: Double, closed: Double, opened: Double, enabled: Boolean): Double =
    if (enabled) -height + closed + (opened - closed) * progress else closed

  /** `KeyboardAvoidingView`'s `position` (px, negative is up): `interpolate(progress, [0, 1], [0, overlap])` up, [overlap] being how far the keyboard covers the view when it is open. */
  fun avoid(overlap: Double, progress: Double, enabled: Boolean): Double = if (enabled) -overlap * progress else 0.0

  /** `isScrollAtEnd` for a list that is not inverted: the bottom of the viewport is within [threshold] of the bottom of the content. */
  fun atEnd(scrollY: Int, viewport: Int, content: Int, threshold: Int): Boolean = scrollY + viewport >= content - threshold

  /**
   * `getEffectiveHeight`: the keyboard's height as the scroll view sees it, when [offset] of the screen's bottom is not the keyboard's (a tab bar, an inset): the
   * height over its range [0, target] mapped to [0, target - offset].
   */
  fun effective(height: Int, target: Int, offset: Int): Double =
    if (offset == 0 || target == 0) height.toDouble() else height.toDouble() * max(target - offset, 0) / target
}

/**
 * `KeyboardChatScrollView`'s lift (`useChatKeyboard`, Android, not inverted) for one scroll view. The keyboard's frames come in as `start` (the height it is going
 * to have), `move` (each frame's height) and `end` (the height it has), the scroll view's own numbers with them, and what comes back is where the scroll
 * view goes: the padding that extends its scroll range, which stays at the keyboard's full height until the keyboard has closed, and for each frame the offset
 * that keeps the content where the keyboard pushes it.
 *
 * [behavior]: [ALWAYS] lifts whatever the scroll position, [WHEN_AT_END] only when the scroll view was at its end (within [KeyboardRules.AT_END_DP]) as the
 * keyboard started, [NEVER] leaves the content where it is.
 */
internal class ChatLift(var behavior: Int, var offset: Int, private val threshold: Int) {
  /** Bottom padding of the scroll view (px): the keyboard's effective height as it started to open, 0 once it has closed. */
  var padding = 0
    private set
  private var before = 0
  private var skip = false
  private var target = 0
  private var closing = false
  private var shift = 0
  private var inFlight = false

  /** `start` has run: the rules know where the animation they are in the middle of began. A scroll view registered while an animation runs is not armed until the keyboard has settled. */
  var armed = false
    private set

  /**
   * An animation starts. One that starts while another is running (the keyboard turned around) goes on from the same baseline: `before`, the offset the content had
   * before the keyboard first moved it, is what every frame of both is measured from, and `skip` stays what the first start decided.
   */
  fun start(height: Int, scrollY: Int, viewport: Int, content: Int) {
    val reversal = inFlight
    inFlight = true
    armed = true
    if (height > 0) {
      target = height
      closing = false
    } else {
      closing = true
    }
    val effective = KeyboardRules.effective(height, target, offset).roundToInt()
    if (height > 0) {
      padding = effective
      if (!reversal) {
        before = scrollY
        // `whenAtEnd`: a scroll view somewhere up its list stays where it is, and so does one that does not lift.
        skip = behavior == WHEN_AT_END && !KeyboardRules.atEnd(scrollY, viewport, content, threshold)
      }
    } else if (!skip && !reversal) {
      // Closing: the way back starts from where the open left the scroll view, so the two are symmetric.
      before = scrollY - shift
    }
  }

  /** The scroll view is registered (or registered again) while the keyboard is up at [height]: it holds the room, and takes its place from there. */
  fun attach(height: Int, scrollY: Int, viewport: Int, content: Int) {
    start(height, scrollY, viewport, content)
    end(height, scrollY, viewport, content)
  }

  /** The parameters change (`keyboardLiftBehavior`, `offset`) while the keyboard is up: nothing about where the content is, and what the close goes back to, is forgotten. */
  fun retune(behavior: Int, offset: Int) {
    this.behavior = behavior
    this.offset = offset
  }

  /**
   * The scroll offset for a frame at [height] and the scroll view's own numbers, or null for a frame that leaves the content where it is. A scroll view that does not
   * lift keeps its place, but as the keyboard closes the padding it holds until [end] still extends its range: it is held inside what the keyboard leaves scrollable
   * (`clampScrollIfNeeded`), so the content does not jump when the padding goes.
   */
  fun move(height: Int, scrollY: Int, viewport: Int, content: Int): Int? {
    if (!armed) return null
    val effective = KeyboardRules.effective(height, target, offset)
    val total = effective.roundToInt()
    val limit = max(content - viewport + total, 0)
    if (behavior == NEVER) return if (closing && total < padding && scrollY > limit) limit else null
    if (skip) return if (closing && scrollY > limit) limit else null
    val destination = min(max(before + total, 0), limit)
    if (!closing) shift = destination - before
    return destination
  }

  /** The keyboard has settled at [height] with the scroll view at [scrollY]: the padding is what it ended at, and the open's displacement is what the close goes back by. */
  fun end(height: Int, scrollY: Int, viewport: Int, content: Int) {
    // Registered while an animation ran, so never started: it takes its place now that the keyboard has settled.
    if (!armed) { attach(height, scrollY, viewport, content); return }
    inFlight = false
    padding = KeyboardRules.effective(height, target, offset).roundToInt()
    if (padding > 0 && !skip) shift = scrollY - before
  }

  companion object {
    const val ALWAYS = 0
    const val WHEN_AT_END = 1
    const val NEVER = 2

    /**
     * Registers the scroll view of [tag]: the rules of one already registered are tuned (what the close goes back to is kept) and null comes back; for a new one, the rules,
     * which the caller starts or attaches.
     */
    fun register(map: MutableMap<Int, ChatLift>, tag: Int, behavior: Int, offset: Int, threshold: Int): ChatLift? {
      val known = map[tag]
      if (known != null) { known.retune(behavior, offset); return null }
      return ChatLift(behavior, offset, threshold).also { map[tag] = it }
    }
  }
}

/**
 * `KeyboardAwareScrollView`'s scroll (`maybeScroll`, `insets` mode) for one scroll view: the focused input has to end [bottomOffset] above the keyboard. [start]
 * works out, from where the input's bottom edge is, how far the content has to go for the keyboard's full height, and every frame goes to a fraction of it.
 */
internal class AwareScroll(var bottomOffset: Int, var extra: Int, var scrollOnHide: Boolean) {
  /** Bottom padding of the scroll view (px) while the keyboard is up: the keyboard's height and the extra space. */
  var padding = 0
    private set
  private var base = 0
  private var distance = 0.0
  private var open = 0
  private var closing = false
  private var inFlight = false

  /** `start` has run (see [ChatLift.armed]). */
  var armed = false
    private set

  /**
   * [height] is the keyboard's height at the end of the move, [scrollY] where the scroll view is, [inputBottom] the focused input's bottom edge and [window] the bottom of
   * the overlay (both in the window's coordinates), or [inputBottom] negative when no input of this scroll view has the focus. An animation that starts while another runs
   * (the keyboard turned around) goes on from the same base and distance.
   */
  fun start(height: Int, scrollY: Int, inputBottom: Int, window: Int) {
    val reversal = inFlight
    inFlight = true
    armed = true
    closing = height == 0
    if (closing) return
    open = height
    padding = height + extra
    if (reversal) return
    base = scrollY
    distance = if (inputBottom < 0) 0.0 else max(inputBottom + bottomOffset - (window - height), 0).toDouble()
  }

  /** A focus change while the keyboard is open, or a taller input: the distance from where the scroll view is now. */
  fun refocus(scrollY: Int, inputBottom: Int, window: Int): Int {
    base = scrollY
    distance = max(inputBottom + bottomOffset - (window - open), 0).toDouble()
    return base + distance.roundToInt()
  }

  /**
   * The scroll offset for a frame at [height], or null when this scroll view stays. With `disableScrollOnKeyboardHide` the close leaves the content where it is, held
   * inside what the closing keyboard leaves scrollable as [ChatLift] does, so the content does not jump when the room goes at [end].
   */
  fun move(height: Int, scrollY: Int, viewport: Int, content: Int): Int? {
    if (!armed) return null
    if (closing && !scrollOnHide) {
      val limit = max(content - viewport + height, 0)
      return if (scrollY > limit) limit else null
    }
    if (distance == 0.0 || open == 0) return null
    return base + (distance * height / open).roundToInt()
  }

  fun end(height: Int, scrollY: Int, inputBottom: Int, window: Int) {
    if (!armed) start(height, scrollY, inputBottom, window)
    inFlight = false
    padding = if (height == 0) 0 else height + extra
  }
}

/**
 * Which frames of the IME's animations reach the keyboard's followers. Android reports each animation as `onPrepare`, `onStart`, `onProgress`, `onEnd`, and when the keyboard
 * turns around the old animation's end can come after the new one's start, so what runs is counted (as Reanimated's `mActiveTransitionCounter` does, at the start) and the
 * keyboard has settled only when the last one has ended. An animation that was prepared and never started or ended (a window that took it away) would leave the keyboard
 * "moving" for good: [stuck] says so after a time with no news. A frame that reads 0 while the animation heads for a height above 0 and the keyboard has been up is the
 * one a cancelled hide shows for a moment, and is left out (Reanimated's `Keyboard.updateHeight` leaves it out too).
 */
internal class KeyboardFrames {
  /** Animations that have started and not ended. */
  var running = 0
    private set
  /** Animations that were prepared and have not started: the window has dispatched the end state, and what reads the insets waits for the start. */
  var waiting = 0
    private set
  private var target = 0
  private var height = 0
  private var at = 0L

  /** Something is going on: what publishes and what settles waits for it. */
  val busy: Boolean get() = running > 0 || waiting > 0

  fun prepare(now: Long = 0) { waiting++; at = now }

  /** The window went with animations running: the next window starts with none. */
  fun reset() { running = 0; waiting = 0 }

  /** An animation goes to [target] (0: away). */
  fun start(target: Int, now: Long = 0) {
    if (waiting > 0) waiting--
    running++
    this.target = target
    at = now
  }

  /** The height to deliver for a frame at [px], or null for a frame that is left out. */
  fun frame(px: Int, now: Long = 0): Int? {
    at = now
    if (px == 0 && target > 0 && height > 0) return null
    height = px
    return px
  }

  /** The height changed with no animation, or an animation ended at [px]. */
  fun settled(px: Int) { height = px }

  /** An animation ended: true when it was the last one, and the keyboard has settled. */
  fun end(now: Long = 0): Boolean {
    at = now
    if (running > 0) running-- else if (waiting > 0) waiting--
    return !busy
  }

  /** Nothing has been heard of an animation for [limit] ms: it will not end. */
  fun stuck(now: Long, limit: Long): Boolean = busy && now - at > limit
}

/** The rules that pick what the keyboard's followers touch, on trees the host can build (the engine's are Android views). */
internal object KeyboardTree {
  /** Whether a parent of [start] (not [start] itself) is [matches]: the walk up from a view to the layer of a modal. */
  fun <T : Any> hasAncestor(start: T, parentOf: (T) -> T?, matches: (T) -> Boolean): Boolean {
    var node = parentOf(start)
    while (node != null) {
      if (matches(node)) return true
      node = parentOf(node)
    }
    return false
  }

  /** What a follower is moved by: what the keyboard asks, or nothing in a modal, which makes room for the keyboard in its own layout. */
  fun unlessModal(inModal: Boolean, y: Double): Double = if (inModal) 0.0 else y

  /**
   * The input `KeyboardController.setFocusTo` goes to: the first [isInput] that [search] (`focusSearch` forward or backward) finds from [current], going on from what it
   * finds that is not an input (a scroll view takes the focus when it is its turn), and none when it comes back to [current] or runs out of [steps].
   */
  fun <T : Any> nextInput(current: T, search: (T) -> T?, isInput: (T) -> Boolean, steps: Int): T? {
    var from = current
    for (step in 0 until steps) {
      val found = search(from) ?: return null
      if (found === current) return null
      if (isInput(found)) return found
      from = found
    }
    return null
  }
}

/** The last report of each scroll view that watches its end (`onEndVisible`): a report is made when it changes, and a view that goes leaves nothing behind. */
internal class EndReports {
  private val last = HashMap<Int, Boolean>()
  val size: Int get() = last.size

  /** True when [visible] is news for [tag]. */
  fun changed(tag: Int, visible: Boolean): Boolean {
    if (last[tag] == visible) return false
    last[tag] = visible
    return true
  }

  fun forget(tag: Int) { last.remove(tag) }
}
