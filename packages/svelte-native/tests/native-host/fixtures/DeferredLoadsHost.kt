import expo.modules.sveltecore.DeferredEnvironment
import expo.modules.sveltecore.DeferredLoadsCore
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Host-side check of the deferred native libraries' rules (DeferredLoadsCore.kt, no Android types) against a fake platform. One scenario name per
// line on stdin, one line of events per scenario on stdout; tests/native-host/deferred-libraries.test.ts holds the expectations.

/** A platform that records what the rules ask of it. Timers wait for [fire]; threads run at once on the caller unless [realThreads]. */
internal class FakePlatform(
  private val failing: String? = null,
  private val realThreads: Boolean = false,
  /** Called when a library starts loading, on the loading thread, before the load is recorded as done. */
  private val onLoad: (String) -> Unit = {},
) : DeferredEnvironment {
  val events: MutableList<String> = Collections.synchronizedList(ArrayList())
  private val timers = ArrayList<Pair<Long, () -> Unit>>()
  val threads = ArrayList<Thread>()

  fun fire() {
    for ((_, task) in timers.sortedBy { it.first }) task()
  }

  override fun load(name: String) {
    events.add("load $name")
    onLoad(name)
    if (name == failing) throw UnsatisfiedLinkError("dlopen failed: lib$name.so not found")
  }
  override fun startThread(name: String, task: () -> Unit) {
    events.add("thread $name")
    if (realThreads) threads.add(Thread(task, name).apply { start() }) else task()
  }
  override fun postToMain(delayMs: Long, task: () -> Unit) {
    events.add("post $delayMs")
    timers.add(delayMs to task)
  }
  override fun warn(message: String, error: Throwable) { events.add("warn $message (${error.javaClass.simpleName})") }
}

private fun awaitAll(core: DeferredLoadsCore, p: FakePlatform) {
  try {
    core.awaitAll()
    p.events.add("ready")
  } catch (error: UnsatisfiedLinkError) {
    p.events.add("throws ${error.message} (cause ${error.cause?.javaClass?.simpleName})")
  }
}

internal fun run(name: String): List<String> {
  when (name) {
    // Nothing asks first: the first mount schedules the load, which runs on its own thread, in the order the libraries were registered.
    "background" -> {
      val p = FakePlatform(); val core = DeferredLoadsCore(p)
      core.register("a"); core.register("b"); core.firstMount(); p.events.add("mounted"); p.fire()
      return p.events
    }
    // A second first mount (another surface, a later call) schedules nothing more.
    "first-mount-twice" -> {
      val p = FakePlatform(); val core = DeferredLoadsCore(p)
      core.register("a"); core.firstMount(); core.firstMount(); p.fire()
      return p.events
    }
    // JavaScript asks before the background load: the libraries load on the asking thread, and the background thread finds nothing left.
    "asked-first" -> {
      val p = FakePlatform(); val core = DeferredLoadsCore(p)
      core.register("a"); core.register("b"); core.firstMount(); awaitAll(core, p); p.fire()
      return p.events
    }
    // Loaded is loaded: a library registered again is not loaded again; one registered later is loaded by the next ask.
    "register-again" -> {
      val p = FakePlatform(); val core = DeferredLoadsCore(p)
      core.register("a"); awaitAll(core, p); core.register("a"); core.register("c"); awaitAll(core, p); awaitAll(core, p)
      return p.events
    }
    // Nothing registered: asking returns at once.
    "nothing" -> {
      val p = FakePlatform(); val core = DeferredLoadsCore(p)
      awaitAll(core, p); core.firstMount(); p.fire()
      return p.events
    }
    // A library that cannot load is logged, the next one loads, and every ask throws its error (it is not loaded again).
    "failure" -> {
      val p = FakePlatform(failing = "a"); val core = DeferredLoadsCore(p)
      core.register("a"); core.register("b"); awaitAll(core, p); awaitAll(core, p)
      return p.events
    }
    // The background load fails: it is logged there, and the first ask throws it.
    "background-failure" -> {
      val p = FakePlatform(failing = "a"); val core = DeferredLoadsCore(p)
      core.register("a"); core.firstMount(); p.fire(); awaitAll(core, p)
      return p.events
    }
    // The ask comes while the background thread is in the middle of a load: the asking thread waits for it (two loads never overlap: each one's
    // JNI_OnLoad writes Nitro's registry), and then the rest is loaded, by one thread or the other, before the ask returns.
    "while-loading" -> {
      val started = CountDownLatch(1)
      val finish = CountDownLatch(1)
      val p = FakePlatform(realThreads = true, onLoad = { name -> if (name == "a") { started.countDown(); finish.await(5, TimeUnit.SECONDS) } })
      val core = DeferredLoadsCore(p)
      core.register("a"); core.register("b"); core.firstMount(); p.fire()
      started.await(5, TimeUnit.SECONDS)
      val asker = Thread { awaitAll(core, p) }.apply { start() }
      // The asker waits for a: it has neither loaded b nor said "ready".
      Thread.sleep(200)
      p.events.add("a finishes")
      finish.countDown()
      asker.join(5000); p.threads.forEach { it.join(5000) }
      return p.events.toList()
    }
    else -> throw IllegalArgumentException(name)
  }
}

fun main() {
  for (line in generateSequence(::readLine)) println(run(line.trim()).joinToString(" | "))
}
