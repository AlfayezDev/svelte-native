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
private class Looper {
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

  val order = TransactionOrder<String>(
    onMain = { Thread.currentThread() === main },
    post = { messages.add(it) },
    apply = {
      if (Thread.currentThread() !== main) appliedOffMain++
      events.add(it)
      during(it)
    },
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

  /** Returns once every message posted so far has run. */
  fun settle() = onMain {}

  fun stop() {
    quit = true
    main.join()
  }
}

private fun looper(block: Looper.() -> Unit) {
  val looper = Looper()
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

  // A transaction from another thread is a message of its own: the main looper runs what was posted between two of them before the second.
  looper {
    val hold = busy()
    fromAnotherThread { order.submit("a") }
    later { events.add("a frame") }
    fromAnotherThread { order.submit("b") }
    hold()
    settle()
    expect("one transaction per message", events, listOf("a", "a frame", "b"))
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
  expect("the queue is the one caller of the batch's apply", Regex("""\bapply\(it\.surfaceId""").findAll(text).count(), 1)
}

fun main(args: Array<String>) {
  scenarios()
  source(args.getOrElse(0) { error("usage: TransactionOrderCheck <MountingManager.kt>") })
  println("TransactionOrderCheck: $checks checks passed")
}
