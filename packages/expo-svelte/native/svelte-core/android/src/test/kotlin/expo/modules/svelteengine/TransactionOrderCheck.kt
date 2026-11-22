package expo.modules.svelteengine

import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the order the engine applies Fabric's transactions in (`TransactionOrder`, SPEC.md "Transaction order"): a stand-in main looper (one
 * thread taking messages from a queue) with stand-in producers, and the source of `MountingManager` read for the call that uses the class.
 * Usage: TransactionOrderCheck <MountingManager.kt>   (src/test/run.sh)
 */
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
    exitProcess(1)
  }
}

/** A main looper, and a [TransactionOrder] of strings that records what it applied and where. */
private class Looper(budgetNanos: Long = TransactionOrder.DEFAULT_BUDGET_NANOS) {
  private val messages = LinkedBlockingQueue<Runnable>()
  @Volatile private var quit = false
  val main: Thread = Thread {
    while (!quit) messages.poll(10, TimeUnit.MILLISECONDS)?.run()
  }.also { it.start() }

  /** What happened on the main looper, in order: the transactions applied, and the markers [later] left. */
  val events = ArrayList<String>()
  var appliedOffMain = 0

  /** Runs inside every apply, on the main thread. */
  var during: (String) -> Unit = {}

  /** A clock the test moves: every apply costs [applyCostNanos] of it. */
  @Volatile var clock = 0L
  var applyCostNanos = 0L

  val order = TransactionOrder<String>(
    onMain = { Thread.currentThread() === main },
    post = { messages.add(it) },
    apply = {
      if (Thread.currentThread() !== main) appliedOffMain++
      events.add(it)
      during(it)
      clock += applyCostNanos
    },
    budgetNanos = budgetNanos,
    now = { clock },
  )

  /** A message, not waited for. */
  fun later(block: () -> Unit) { messages.add(Runnable(block)) }

  /** A message, waited for. */
  fun onMain(block: () -> Unit) {
    val done = CountDownLatch(1)
    messages.add(Runnable { try { block() } finally { done.countDown() } })
    check(done.await(10, TimeUnit.SECONDS)) { "the main looper did not answer" }
  }

  /** A message that holds the looper until the returned function is called, then runs [block]: the main thread busy with something else, then asked to apply. */
  fun busy(block: () -> Unit = {}): () -> Unit {
    val release = CountDownLatch(1)
    messages.add(Runnable { release.await(); block() })
    return { release.countDown() }
  }

  /** Returns once the looper is quiet: every message posted so far has run, and so have the ones those posted (an apply that submits, a drain that leaves the rest). */
  fun settle() {
    // Quiet is a message of ours that finds nothing queued behind it: it runs on the main thread, so no other message is running then.
    var quiet = false
    while (!quiet) onMain { quiet = messages.isEmpty() }
  }

  fun stop() {
    quit = true
    main.join()
  }
}

private fun looper(budgetNanos: Long = TransactionOrder.DEFAULT_BUDGET_NANOS, block: Looper.() -> Unit) {
  val looper = Looper(budgetNanos)
  try { looper.block() } finally { looper.stop() }
}

private fun fromAnotherThread(block: () -> Unit) {
  val thread = Thread(block)
  thread.start()
  thread.join()
}

private fun scenarios() {
  // The sequence that broke the screen: the JavaScript thread pulled the first two transactions of a surface while the main looper was busy, then the main thread
  // measured the surface and Fabric handed it the transaction with the size. The size has to be applied after the views it is about exist.
  looper {
    val measure = busy { order.submit("size, committed by the main thread") }
    fromAnotherThread { order.submit("views of the first screens, JavaScript thread") }
    fromAnotherThread { order.submit("the stack and its screens, JavaScript thread") }
    measure()
    settle()
    expect("what the JavaScript thread pulled first is applied first", events, listOf(
      "views of the first screens, JavaScript thread",
      "the stack and its screens, JavaScript thread",
      "size, committed by the main thread",
    ))
    expect("every transaction was applied on the main thread", appliedOffMain, 0)
  }

  // The main thread's submit returns with its own transaction and everything before it applied.
  looper {
    var whenItReturned: List<String>? = null
    val measure = busy { order.submit("c"); whenItReturned = events.toList() }
    fromAnotherThread { order.submit("a") }
    fromAnotherThread { order.submit("b") }
    measure()
    settle()
    expect("submit on the main thread returns with the earlier transactions and its own applied", whenItReturned, listOf("a", "b", "c"))
  }

  // The messages the JavaScript thread posted find the queue empty and apply nothing twice; a transaction that comes later is still applied.
  looper {
    val measure = busy { order.submit("c") }
    fromAnotherThread { order.submit("a") }
    fromAnotherThread { order.submit("b") }
    measure()
    settle()
    fromAnotherThread { order.submit("d") }
    settle()
    expect("nothing is applied twice, a later one is applied", events, listOf("a", "b", "c", "d"))
  }

  // With nothing queued a transaction from the main thread is applied before its submit returns, as it always was.
  looper {
    var inside: List<String>? = null
    onMain { order.submit("only"); inside = events.toList() }
    expect("applied at once", inside, listOf("only"))
  }

  // Two transactions the JavaScript thread submitted before the main looper was free, with no hold: each is a message of its own, and the frame that is queued behind the
  // first one's message runs between them (a list that mounts rows as it scrolls commits often, and each commit keeps its frame).
  looper {
    val hold = busy()
    fromAnotherThread { order.submit("a") }
    later { events.add("a frame") }
    fromAnotherThread { order.submit("b") }
    hold()
    settle()
    expect("one transaction per message, the frame between", events, listOf("a", "a frame", "b"))
  }

  // A commit that arrives while the first is applied waits for a message of its own too, behind the frame that came due meanwhile; the commits that belong together are held.
  looper {
    during = { name -> if (name == "a") fromAnotherThread { order.submit("b, committed while a was applied") } }
    val hold = busy()
    fromAnotherThread { order.submit("a") }
    later { events.add("a frame") }
    hold()
    settle()
    expect("the one that arrived during the apply comes after the frame", events, listOf("a", "a frame", "b, committed while a was applied"))
    expect("on the main thread", appliedOffMain, 0)
  }

  // The same, with a main-thread submit in the middle: it applies what came before it, and what comes after it still waits its turn in the order.
  looper {
    during = { name -> if (name == "a") { fromAnotherThread { order.submit("b") }; order.submit("c, submitted by the main thread") } }
    val hold = busy()
    fromAnotherThread { order.submit("a") }
    fromAnotherThread { order.submit("d") }
    hold()
    settle()
    expect("one order, whoever submitted", events, listOf("a", "d", "b", "c, submitted by the main thread"))
  }

  // The budget of the drain a release posts: a message that has applied for longer than the budget and finds more queued posts the rest, so the frame queued behind it runs
  // first. Each apply costs 30 ms of the clock the check moves, the budget is 50 ms: a, then b (30 ms is under the budget), then the rest waits.
  looper(budgetNanos = 50_000_000L) {
    applyCostNanos = 30_000_000L
    val hold = busy()
    order.hold()
    for (name in listOf("a", "b", "c", "d", "e")) fromAnotherThread { order.submit(name) }
    order.release()
    later { events.add("a frame") }
    hold()
    settle()
    expect("the frame runs after the budget, and the order is kept", events, listOf("a", "b", "a frame", "c", "d", "e"))
  }

  // Every message makes progress, whatever the budget: with none (0), the drain still applies one transaction, then leaves the rest to the next.
  looper(budgetNanos = 0L) {
    val hold = busy()
    order.hold()
    fromAnotherThread { order.submit("a") }
    fromAnotherThread { order.submit("b") }
    order.release()
    later { events.add("a frame") }
    hold()
    settle()
    expect("one transaction per message with no budget", events, listOf("a", "a frame", "b"))
  }

  // Without work over the budget nothing that was held is left behind: a long held queue of cheap transactions is applied in one message.
  looper {
    applyCostNanos = 1_000_000L
    val hold = busy()
    order.hold()
    for (index in 0 until 40) fromAnotherThread { order.submit("t%02d".format(index)) }
    order.release()
    later { events.add("a frame") }
    hold()
    settle()
    expect("40 ms of held work is under the budget: every transaction, then the frame", events.indexOf("a frame"), 40)
    expect("all 40 applied", events.size, 41)
  }

  // The same 40, not held: a message each, so the frame queued behind the first one's message runs after one transaction, and none is applied twice.
  looper {
    val hold = busy()
    for (index in 0 until 40) {
      fromAnotherThread { order.submit("t%02d".format(index)) }
      if (index == 0) later { events.add("a frame") }
    }
    hold()
    settle()
    expect("the frame comes after the first transaction", events.indexOf("a frame"), 1)
    expect("all 40 applied once", events.filter { it != "a frame" }, (0 until 40).map { "t%02d".format(it) })
  }

  // The hold JavaScript asks for across a layout read's commit and the one after it: what is queued while held is not applied by any message, and one message applies it all
  // after the release, before the frame that was queued behind it.
  looper {
    order.hold()
    fromAnotherThread { order.submit("the new order") }
    settle()
    expect("nothing is applied while the queue is held", events, emptyList<String>())
    fromAnotherThread { order.submit("the items' first frames") }
    settle()
    expect("still nothing", events, emptyList<String>())
    val hold = busy()
    order.release()
    later { events.add("a frame") }
    hold()
    settle()
    expect("both commits are applied in one message, before the frame", events, listOf("the new order", "the items' first frames", "a frame"))
  }

  // A hold does not hold up the main thread's own submit: it applies everything queued before it, and then itself, as it always did.
  looper {
    order.hold()
    fromAnotherThread { order.submit("a") }
    onMain { order.submit("m, from the main thread") }
    expect("the held transaction comes first", events, listOf("a", "m, from the main thread"))
    order.release()
    settle()
    expect("the release finds nothing left", events, listOf("a", "m, from the main thread"))
  }

  // A hold that comes while a message applies stops it after the transaction it is applying; the rest waits for the release.
  looper {
    during = { name -> if (name == "a") order.hold() }
    val hold = busy()
    fromAnotherThread { order.submit("a") }
    fromAnotherThread { order.submit("b") }
    hold()
    settle()
    expect("the message stops at the hold", events, listOf("a"))
    order.release()
    settle()
    expect("the release applies the rest", events, listOf("a", "b"))
  }

  // A hold that comes while a release's drain applies stops it after the transaction it is applying; the rest waits for the next release.
  looper {
    during = { name -> if (name == "a") order.hold() }
    order.hold()
    fromAnotherThread { order.submit("a") }
    fromAnotherThread { order.submit("b") }
    order.release()
    settle()
    expect("the drain stops at the hold", events, listOf("a"))
    order.release()
    settle()
    expect("the next release applies the rest", events, listOf("a", "b"))
  }

  // A release with nothing held and nothing queued does nothing, and a transaction after a release is a message as usual.
  looper {
    order.release()
    settle()
    expect("nothing happened", events, emptyList<String>())
    fromAnotherThread { order.submit("a") }
    settle()
    expect("and a later one is applied", events, listOf("a"))
  }

  // A transaction submitted by an apply, on the main thread, waits for the apply it was made in and keeps its place in the order.
  looper {
    var depth = 0
    var deepest = 0
    during = { name ->
      depth++
      deepest = maxOf(deepest, depth)
      if (name == "outer") { order.submit("inner 1"); order.submit("inner 2") }
      depth--
    }
    onMain { order.submit("outer") }
    settle()
    expect("applied after the one that submitted them, in order", events, listOf("outer", "inner 1", "inner 2"))
    expect("no apply runs inside another", deepest, 1)
  }

  // Many commits, from several threads and from the main thread, handed over in the order Fabric's mutex fixes: they are applied in that order.
  looper {
    val mutex = Any()
    var next = 0
    val producers = (0 until 6).map { producer ->
      Thread {
        repeat(200) {
          synchronized(mutex) {
            val name = "%04d".format(next++)
            // Producer 0 commits on the main thread: the transaction is handed over inside a message of the main looper, which the commit waits for.
            if (producer == 0) onMain { order.submit(name) } else order.submit(name)
          }
        }
      }.also { it.start() }
    }
    producers.forEach { it.join() }
    settle()
    expect("every transaction was applied", events.size, 1200)
    expect("in the order they were handed over", events, events.sorted())
    expect("on the main thread", appliedOffMain, 0)
  }
}

/** What the source of `MountingManager` has to do for the order to hold: no transaction is applied except through the queue. */
private fun source(path: String) {
  val text = File(path).readText()
  val onTransaction = Regex("""fun onTransaction\([^)]*\)\s*\{(.*?)\n  \}""", RegexOption.DOT_MATCHES_ALL).find(text)?.groupValues?.get(1)
    ?: error("MountingManager.onTransaction not found in $path")
  expect("onTransaction queues the transaction", onTransaction.contains("transactions.submit("), true)
  expect("onTransaction applies nothing itself", Regex("""\bapply\(""").containsMatchIn(onTransaction), false)
  expect("onTransaction posts nothing itself", onTransaction.contains("handler.post"), false)
  expect("the queue is the engine's order class", text.contains("TransactionOrder<Transaction>("), true)
  expect("holdMounts holds the queue and ends the hold by itself", Regex("""fun holdMounts\(\)\s*\{[^}]*transactions\.hold\(\)[^}]*postDelayed\(releaseHeld""").containsMatchIn(text), true)
  expect("releaseMounts releases it", Regex("""fun releaseMounts\(\)\s*\{[^}]*transactions\.release\(\)""").containsMatchIn(text), true)
  expect("the queue is the one caller of the batch's apply", Regex("""\bapply\(it\.surfaceId""").findAll(text).count(), 1)
}

fun main(args: Array<String>) {
  scenarios()
  source(args.getOrElse(0) { error("usage: TransactionOrderCheck <MountingManager.kt>") })
  println("TransactionOrderCheck: $checks checks passed")
}
