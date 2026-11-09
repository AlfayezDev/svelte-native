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
 * returns with its work done (what it did before, when nothing waited); a transaction from another thread asks the main looper to apply one more, so a message
 * still applies one transaction (the main looper stays free for a frame between two), and a message that finds the queue emptied by the main thread does nothing.
 */
internal class TransactionOrder<T : Any>(
  /** Whether the caller is the main thread. */
  private val onMain: () -> Boolean,
  /** Runs [Runnable] in a message of the main looper. */
  private val post: (Runnable) -> Unit,
  /** Applies one transaction; main thread only. */
  private val apply: (T) -> Unit,
) {
  private val pending = ConcurrentLinkedQueue<T>()
  private val applyOne = Runnable { take(all = false) }

  /** Main thread only: an [apply] that submits a transaction is not applied inside itself. */
  private var applying = false

  /** Queues [transaction] behind the ones already queued; the main thread applies it, and everything before it, before it returns. */
  fun submit(transaction: T) {
    pending.add(transaction)
    if (!onMain() || applying) post(applyOne) else take(all = true)
  }

  private fun take(all: Boolean) {
    if (applying) return
    applying = true
    try {
      do apply(pending.poll() ?: break) while (all)
    } finally {
      applying = false
    }
  }
}
