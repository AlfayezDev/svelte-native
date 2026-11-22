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
 * returns with its work done (what it did before, when nothing waited). A transaction from another thread asks the main looper for a message that applies one
 * transaction, the first that is queued, so the main looper is free for a frame between two; a message that finds the queue empty does nothing.
 *
 * Commits that belong together are the JavaScript thread's to say. It often commits twice in a row for one change, and the second commit is not independent of the first:
 * `animate:flip` reads the layout of the new order, which the host commits for it, and then commits the items' first frames, and a frame drawn between the two shows the new
 * order with no transform. The host asks for a layout first (the sign of an `animate:` or a transition that measures), so it [hold]s the queue at that read and [release]s it after
 * the second commit: what is queued while held is applied by one message after the release, before the frame queued behind it, or by the main thread's own submit, which applies
 * everything queued before it whatever the hold. A hold that is not released is the caller's to end (`MountingManager` ends it after a timeout).
 *
 * From 11 to 12 November 2026 every message drained the queue (all that was queued, and what was queued while it applied), as React Native's `MountItemDispatcher` does, to keep
 * a flip's two commits together on a slow main thread. It cost the commits that do not belong together their frame between them: on the Samsung A16 the windowed list of the
 * QA lab (`list-300-virtual`, which mounts rows as it scrolls) read 17 late frame intervals in twenty runs with it and 3 with the order of before it (12 Nov, SPEC.md). The hold
 * keeps a flip's commits together without it, so only the message a release posts drains.
 *
 * What bounds that drain is its time, [budgetNanos] (50 ms): a message that has applied for that long, and finds more queued, applies no more and posts the rest as a message
 * of its own, so a frame can run. A transaction is applied whatever the budget, so every message makes progress.
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
  /** The message a transaction from another thread asks for: it applies one. */
  private val applyOne = Runnable { take(budgeted = true, all = false) }
  /** The message a [release] posts: what was held belongs together, and it applies all of it, within the budget. */
  private val drain = Runnable { take(budgeted = true, all = true) }

  /** Whether messages leave the queue alone: set by [hold], from any thread. */
  @Volatile private var held = false

  /** Main thread only: an [apply] that submits a transaction is not applied inside itself. */
  private var applying = false

  /** Queues [transaction] behind the ones already queued; the main thread applies it, and everything before it, before it returns. */
  fun submit(transaction: T) {
    pending.add(transaction)
    if (!onMain() || applying) { if (!held) post(applyOne) } else take(budgeted = false, all = true)
  }

  /** What is queued from now on is applied only after [release], or by the main thread's own [submit]. Any thread. */
  fun hold() {
    held = true
  }

  /** Ends a [hold]: one message applies what is queued (all of it, within the budget). Any thread; with nothing queued nothing happens. */
  fun release() {
    held = false
    if (!pending.isEmpty()) post(drain)
  }

  private fun take(budgeted: Boolean, all: Boolean) {
    if (applying) return
    applying = true
    try {
      val start = now()
      var applied = 0
      while (true) {
        if (budgeted && held) return // release() posts the next message
        if (!all && applied > 0) return
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
    /** 50 ms: a few frames, long enough for the commits a hold kept together, short enough that a long held queue does not hold the looper for good. */
    const val DEFAULT_BUDGET_NANOS = 50_000_000L
  }
}
