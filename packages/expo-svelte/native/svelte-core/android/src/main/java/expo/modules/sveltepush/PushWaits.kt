package expo.modules.sveltepush

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * The completion ids of the `background` events and the latches Firebase's worker thread waits on (PUSH.md, "Android"): `onMessageReceived` opens one, sends the event
 * with its id and waits, and JavaScript's `backgroundDone(id)` releases it. While that thread is inside `onMessageReceived` the system keeps the process alive, which
 * is what lets a hook run in a process nobody started a screen in; the wait ends at the limit (a hook that never finishes must not hold the process for ever).
 */
class BackgroundWaits {
  private val counter = AtomicLong()
  private val latches = ConcurrentHashMap<String, CountDownLatch>()

  /** A new completion id, known to [done] from now on, so that an answer that comes before the wait starts is not lost. */
  fun open(): String {
    val id = "background-${counter.incrementAndGet()}"
    latches[id] = CountDownLatch(1)
    return id
  }

  /** Blocks until [done] is called for this id, or `timeoutMs` passes. True when the hook finished, false when the wait ran out. The id is closed either way. */
  fun await(id: String, timeoutMs: Long): Boolean {
    val latch = latches[id] ?: return false
    try {
      return latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    } finally {
      latches.remove(id)
    }
  }

  /** The hook settled. False for an id that is not waited on (it ran out, or was never opened): there is nothing to release. */
  fun done(id: String): Boolean {
    val latch = latches[id] ?: return false
    latch.countDown()
    return true
  }
}

/**
 * The one second a message in the foreground waits for JavaScript's `show` (PUSH.md: "the native side waits for `show` at most 1 s, then shows it with all three
 * `true`"). The thread that received the message holds a message with [hold], and [await] returns the answer, or null when none came: that thread then shows the
 * message itself. `show` only [answer]s, so a message is shown by one party exactly once, and an answer that comes after the default is refused (idempotent per id).
 */
class ShowGate {
  /** One message waiting for its answer. [Waiting] becomes [Answered] when JavaScript answers or [Closed] when the wait ends first, and never changes again. */
  class Hold internal constructor(internal val id: String) {
    internal val latch = CountDownLatch(1)
    internal val state = AtomicReference<State>(State.Waiting)
  }

  internal sealed class State {
    object Waiting : State()

    class Answered(val presentation: Presentation) : State()

    object Closed : State()
  }

  private val holds = ConcurrentHashMap<String, Hold>()

  /** Starts waiting for the answer for message `id`. A second hold of the same id (a message delivered twice) takes the answer; the first ends at its time. */
  fun hold(id: String): Hold {
    val hold = Hold(id)
    holds[id] = hold
    return hold
  }

  /** Blocks until the answer, or `timeoutMs`. The answer, or null when it did not come in time (and then it never will be accepted). */
  fun await(hold: Hold, timeoutMs: Long): Presentation? {
    try {
      hold.latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    } finally {
      // Whoever wins this swap decides: an answer that landed first is used, one that comes later finds the hold closed.
      hold.state.compareAndSet(State.Waiting, State.Closed)
      holds.remove(hold.id, hold)
    }
    return (hold.state.get() as? State.Answered)?.presentation
  }

  /** JavaScript's `show`. True when the message was still waiting and now has its presentation; false for a late, repeated or unknown answer, which does nothing. */
  fun answer(id: String, presentation: Presentation): Boolean {
    val hold = holds[id] ?: return false
    if (!hold.state.compareAndSet(State.Waiting, State.Answered(presentation))) return false
    hold.latch.countDown()
    return true
  }
}
