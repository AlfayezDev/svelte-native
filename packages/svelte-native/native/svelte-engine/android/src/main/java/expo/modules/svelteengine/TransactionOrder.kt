package expo.modules.svelteengine

import java.util.concurrent.ConcurrentLinkedQueue

/**
 * The mounting transactions of the engine, applied in the order Fabric pulled them (SPEC.md, "Transaction order").
 *
 * Fabric hands a transaction to the engine on the thread that committed it, one at a time per surface (the coordinator's mutex is held for the call): the JavaScript
 * thread for what the app renders, the main thread for what the platform commits (the size the surface's view measures, a rotation). The views are the main thread's,
 * so a transaction from the JavaScript thread waits for a message of the main looper and one from the main thread used to run at once. A new Activity measures its
 * surface view while the first transactions of its surface are still waiting for their message, so the layout of the measured size ran before the views it is about
 * is created: the views did not exist, the layout was dropped, and the views were then created at the size the surface had at the start (0 wide). Fabric had
 * already delivered the new size, so it did not send it again for a node whose layout it believed unchanged: the top screen kept a 0 px wide frame, which a
 * service that reads the accessibility tree skips as invisible, for as long as the screen lived.
 *
 * Every transaction goes into one queue in the order it arrives. The main thread, asked to apply one, first applies the ones that came before it, then that one, and
 * returns with its work done (what it did before, when nothing waited). A transaction from another thread asks the main looper for a message that drains the queue: it
 * applies every transaction that is queued, and the ones that are queued while it applies, before it returns, and a message that finds the queue empty does nothing.
 *
 * Why a message does not stop after one transaction (it did, to leave the main looper free for a frame between two): the JavaScript thread often commits twice in a row
 * for one change, and the second commit is not independent of the first. `animate:flip` reads the layout of the new order, which the host commits for it, and then commits
 * the items' first frames. When the second is queued while the first is applied (an apply that is slow, a main thread that was idle and runs on a cold core), the frame
 * callback that came due meanwhile is ahead of the second one's message, and the frame it draws shows the new order with no transform. React Native's `MountItemDispatcher` has no
 * such pause: one dispatch takes every pending mount item and looks again for the ones added meanwhile.
 *
 * A drain does not make two commits one when the second is not queued yet while the first applies, which is how it is for `animate:flip` on a warm main thread (measured on the
 * emulator, one shuffle: the new order committed 3 ms after a frame, applied in 1 ms, the first frames committed 10 ms later, applied after the next frame, at 17 ms: a frame drawn between
 * them). The JavaScript thread knows which commits belong together (the host asks for a layout, which is the first sign of an `animate:` or a transition that measures), so it can [hold] the
 * queue at that read and [release] it after the second commit: what is queued while held is applied by one message after the release, or by the main thread's own submit, which applies
 * everything queued before it whatever the hold. A hold that is not released is the caller's to end (`MountingManager` ends it after a timeout).
 *
 * What bounds the drain is its time, [budgetNanos] (50 ms): a message that has applied for that long, and finds more queued, applies no more and posts the rest as a message
 * of its own, so a frame can run. Without it a JavaScript thread that commits faster than the main thread applies (every transaction of a start-up that the looper was too
 * busy to take, an animation that commits each frame) would hold the looper for as long as it lasts. A transaction is applied whatever the budget, so every message makes progress.
 */
internal class TransactionOrder<T : Any>(
  /** Whether the caller is the main thread. */
  private val onMain: () -> Boolean,
  /** Runs [Runnable] in a message of the main looper. */
  private val post: (Runnable) -> Unit,
  /** Applies one transaction; main thread only. */
  private val apply: (T) -> Unit,
  /** How long a message keeps applying what is queued before it leaves the rest to the next message. */
  private val budgetNanos: Long = DEFAULT_BUDGET_NANOS,
  /** The clock of the budget, in nanoseconds. */
  private val now: () -> Long = System::nanoTime,
) {
  private val pending = ConcurrentLinkedQueue<T>()
  private val drain = Runnable { take(budgeted = true) }

  /** Whether messages leave the queue alone: set by [hold], from any thread. */
  @Volatile private var held = false

  /** Main thread only: an [apply] that submits a transaction is not applied inside itself. */
  private var applying = false

  /** Queues [transaction] behind the ones already queued; the main thread applies it, and everything before it, before it returns. */
  fun submit(transaction: T) {
    pending.add(transaction)
    if (!onMain() || applying) { if (!held) post(drain) } else take(budgeted = false)
  }

  /** What is queued from now on is applied only after [release], or by the main thread's own [submit]. Any thread. */
  fun hold() {
    held = true
  }

  /** Ends a [hold]: one message applies what was queued meanwhile. Any thread; nothing happens when nothing was held or queued. */
  fun release() {
    held = false
    if (!pending.isEmpty()) post(drain)
  }

  private fun take(budgeted: Boolean) {
    if (applying) return
    applying = true
    try {
      val start = now()
      var applied = 0
      while (true) {
        if (budgeted && held) return // release() posts the next message
        if (budgeted && applied > 0 && now() - start >= budgetNanos && pending.isNotEmpty()) {
          post(drain)
          return
        }
        apply(pending.poll() ?: break)
        applied++
      }
    } finally {
      applying = false
    }
  }

  companion object {
    /** 50 ms: a few frames, long enough for a commit that was queued a few milliseconds behind a slow one, short enough that a start-up's queue does not hold the looper for good. */
    const val DEFAULT_BUDGET_NANOS = 50_000_000L
  }
}
