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
  companion object {
    const val ALWAYS = 0
    const val WHEN_AT_END = 1
    const val NEVER = 2
  }

  /** Bottom padding of the scroll view (px): the keyboard's effective height as it started to open, 0 once it has closed. */
  var padding = 0
    private set
  private var before = 0
  private var skip = false
  private var target = 0
  private var closing = false
  private var shift = 0

  fun start(height: Int, scrollY: Int, viewport: Int, content: Int) {
    if (height > 0) {
      target = height
      closing = false
    } else {
      closing = true
    }
    val effective = KeyboardRules.effective(height, target, offset).roundToInt()
    if (height > 0) {
      padding = effective
      before = scrollY
      // `whenAtEnd`: a scroll view somewhere up its list stays where it is, and so does one that does not lift.
      skip = behavior == WHEN_AT_END && !KeyboardRules.atEnd(scrollY, viewport, content, threshold)
    } else if (!skip) {
      // Closing: the way back starts from where the open left the scroll view, so the two are symmetric.
      before = scrollY - shift
    }
  }

  /**
   * The scroll offset for a frame at [height] and the scroll view's own numbers, or null for a frame that leaves the content where it is. A scroll view that does not
   * lift keeps its place, but as the keyboard closes the padding it holds until [end] still extends its range: it is held inside what the keyboard leaves scrollable
   * (`clampScrollIfNeeded`), so the content does not jump when the padding goes.
   */
  fun move(height: Int, scrollY: Int, viewport: Int, content: Int): Int? {
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
  fun end(height: Int, scrollY: Int) {
    padding = KeyboardRules.effective(height, target, offset).roundToInt()
    if (padding > 0 && !skip) shift = scrollY - before
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

  /**
   * [height] is the keyboard's height at the end of the move, [scrollY] where the scroll view is, [inputBottom] the focused input's bottom edge and [window] the height of
   * the window (both in the window's coordinates), or [inputBottom] negative when no input of this scroll view has the focus.
   */
  fun start(height: Int, scrollY: Int, inputBottom: Int, window: Int) {
    closing = height == 0
    if (closing) return
    open = height
    base = scrollY
    padding = height + extra
    distance = if (inputBottom < 0) 0.0 else max(inputBottom + bottomOffset - (window - height), 0).toDouble()
  }

  /** A focus change while the keyboard is open, or a taller input: the distance from where the scroll view is now. */
  fun refocus(scrollY: Int, inputBottom: Int, window: Int): Int {
    base = scrollY
    distance = max(inputBottom + bottomOffset - (window - open), 0).toDouble()
    return base + distance.roundToInt()
  }

  /** The scroll offset for a frame at [height], or null when this scroll view stays. */
  fun move(height: Int): Int? {
    if (closing && !scrollOnHide) return null
    if (distance == 0.0 || open == 0) return null
    return base + (distance * height / open).roundToInt()
  }

  fun end(height: Int) {
    padding = if (height == 0) 0 else height + extra
  }
}
