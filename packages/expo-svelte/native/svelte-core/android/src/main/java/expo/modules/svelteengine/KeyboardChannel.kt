package expo.modules.svelteengine

import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max

/**
 * Reanimated's `Keyboard`: the one state the keyboard has for every subscriber of `subscribeForKeyboardEvents`, as `useAnimatedKeyboard` is told it (`KeyboardState` as a number,
 * 1 opening, 2 open, 3 closing, 4 closed, and the height). The state machine and the dispatch are those of Reanimated's `Keyboard`, `KeyboardAnimationCallback` and
 * `KeyboardAnimationManager`: a frame is dispatched after the start with the state the start gave, the end with the state the height gives, a start while another animation runs
 * turns the state around, and a frame that reads 0 for an open keyboard is not taken. [deliver] is told the state and the height in px of each dispatch; what is dp is for the
 * subscriber.
 */
internal class ReanimatedKeyboard(private val deliver: (state: Int, px: Int) -> Unit) {
  companion object {
    const val UNKNOWN = 0
    const val OPENING = 1
    const val OPEN = 2
    const val CLOSING = 3
    const val CLOSED = 4
  }

  var state = UNKNOWN
    private set
  var px = 0
    private set
  private var active = 0
  private var pending = false

  fun start() {
    state = if (active > 0) (if (state == OPENING) CLOSING else OPENING) else (if (px <= 0) OPENING else CLOSING)
    active++
    pending = true
  }

  fun frame(height: Int) {
    pending = false
    if (!(height <= 0 && state == OPEN)) px = height
    deliver(state, px)
  }

  fun end(height: Int) {
    if (pending) { px = height; deliver(state, px) }
    pending = false
    active = 0
    state = if (px <= 0) CLOSED else OPEN
    deliver(state, px)
  }

  /** The animation that was running will not end (its window went): the next one starts from the state the keyboard is in. */
  fun abandon() {
    active = 0
    pending = false
  }

  /** The keyboard has another height with no animation (another keyboard, a layout): the state is the one the height gives, an open keyboard stays open, and the height is told. */
  fun settle(height: Int) {
    px = height
    pending = false
    active = 0
    state = if (px <= 0) CLOSED else OPEN
    deliver(state, px)
  }
}

/**
 * The subscribers to the keyboard's frames (SPEC.md "Keyboard motion"), with the one state of Reanimated's the callers of `useAnimatedKeyboard` share and the engine's own frames
 * for `createKeyboardMotion`. Only the main thread touches it, where the frames go: a subscription from another thread (the JavaScript thread's) is handed to [post], and is
 * made in order with the frames and with the unsubscribe. No Android type is in it, so the host runs it.
 */
internal class KeyboardChannel(
  private val isMain: () -> Boolean,
  private val post: (() -> Unit) -> Unit,
  private val navigationBar: () -> Int,
  private val density: () -> Float,
  private val dropped: (Int, Throwable) -> Unit = { _, _ -> },
) {
  companion object {
    /** The kinds of frame a raw subscriber hears: the keyboard is about to move to a height, it is at a height on the way, it has stopped at a height, its height changed with no animation. */
    const val START = 1
    const val MOVE = 2
    const val END = 3
    const val SETTLE = 4
  }

  private class Subscriber(val raw: Boolean, val navigationBarTranslucent: Boolean, val listener: (Int, Int) -> Unit)

  private val subscribers = LinkedHashMap<Int, Subscriber>()
  private val nextId = AtomicInteger(-1)
  private val rawFlag = AtomicBoolean(false)
  private val reanimated = ReanimatedKeyboard { state, px ->
    for ((id, subscriber) in subscribers.entries.toList()) if (!subscriber.raw) call(id, subscriber, state, dip(px, subscriber))
  }

  @Volatile private var height = 0
  private var persistent = 0
  private var target = 0
  private var moving = false

  /** The next [subscribe] is the engine's own (`createKeyboardMotion`: kind and px as they are), not one of Reanimated's `useAnimatedKeyboard`; asked synchronously, in the JavaScript thread's order. */
  fun rawNext() { rawFlag.set(true) }

  /**
   * Subscribes [listener]. One of Reanimated's own is given what `useAnimatedKeyboard` is given (state 1 to 4 and whole dp, less the navigation bar unless
   * [navigationBarTranslucent]); the one [rawNext] asked for gets (kind, px). It is told where the keyboard is now, as far as that can be said without telling it
   * a state the keyboard is not in: an animation that runs is not announced as over. Returns the id at once, whichever thread it is called from.
   */
  fun subscribe(listener: (Int, Int) -> Unit, navigationBarTranslucent: Boolean = true): Int {
    val id = nextId.getAndDecrement()
    val raw = rawFlag.getAndSet(false)
    onMain {
      val subscriber = Subscriber(raw, navigationBarTranslucent, listener)
      subscribers[id] = subscriber
      if (raw) {
        if (moving) {
          call(id, subscriber, START, persistent)
          if (target == 0) call(id, subscriber, START, 0)
          call(id, subscriber, MOVE, height)
        } else if (height > 0) {
          call(id, subscriber, SETTLE, height)
        }
      } else if (reanimated.state != ReanimatedKeyboard.UNKNOWN) {
        call(id, subscriber, reanimated.state, dip(reanimated.px, subscriber))
      }
    }
    return id
  }

  fun unsubscribe(id: Int) {
    onMain { subscribers.remove(id) }
  }

  /** The keyboard is about to move to [px] (0: away). */
  fun start(px: Int) {
    moving = true
    target = px
    if (px > 0) persistent = px
    reanimated.start()
    raw(START, px)
  }

  fun frame(px: Int) {
    height = px
    reanimated.frame(px)
    raw(MOVE, px)
  }

  fun end(px: Int) {
    moving = false
    height = px
    reanimated.end(px)
    raw(END, px)
  }

  /** The keyboard has another height with no animation: told as that, to both kinds of subscriber. */
  fun settle(px: Int) {
    moving = false
    height = px
    if (px > 0) persistent = px
    reanimated.settle(px)
    raw(SETTLE, px)
  }

  /** The window went with an animation running: nothing will end it. */
  fun reset() {
    moving = false
    reanimated.abandon()
  }

  private fun onMain(block: () -> Unit) {
    if (isMain()) block() else post(block)
  }

  private fun raw(kind: Int, px: Int) {
    for ((id, subscriber) in subscribers.entries.toList()) if (subscriber.raw) call(id, subscriber, kind, px)
  }

  private fun dip(px: Int, subscriber: Subscriber): Int =
    (max(0, px - (if (subscriber.navigationBarTranslucent) 0 else navigationBar())) / density()).toInt()

  /** A listener that fails is dropped, so one bad worklet does not stop the keyboard's other followers. */
  private fun call(id: Int, subscriber: Subscriber, a: Int, b: Int) {
    try {
      subscriber.listener(a, b)
    } catch (e: Throwable) {
      dropped(id, e)
      subscribers.remove(id)
    }
  }
}
