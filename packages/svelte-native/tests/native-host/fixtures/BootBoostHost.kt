import expo.modules.svelteengine.BootBoostCore
import expo.modules.svelteengine.BootEnvironment

// Host-side check of the boot boost's rules (BootBoostCore.kt, no Android types) against a fake platform. One scenario name per line on
// stdin, one line of events per scenario on stdout; tests/native-host/boot-boost.test.ts holds the expectations.

/** A platform that records what the rules ask of it. Threads run at once on the caller; timers wait for [fire]. */
internal class FakePlatform(
  private val cores: Long? = 0xc0,
  /** The cores the kernel leaves the Application's thread after the cpuset (what a request is intersected with). */
  private val cpuset: Long = 0xff,
  private val loaderFails: Boolean = false,
  private val failingLibrary: String? = null,
) : BootEnvironment {
  val events = ArrayList<String>()
  private val masks = HashMap<Int, Long>()
  private val timers = ArrayList<Pair<Long, () -> Unit>>()
  private var clock = 1000L
  private var currentThread = 7

  fun advance(ms: Long) { clock += ms }
  /** Runs every timer due within [ms], in order of delay. */
  fun fire(ms: Long) {
    for ((delay, task) in timers.sortedBy { it.first }) if (delay <= ms) task()
  }

  override fun bigCores() = cores
  override fun affinityOf(tid: Int): Long = masks[tid] ?: 0xff
  override fun setAffinity(tid: Int, mask: Long): Boolean {
    val effective = mask and cpuset
    if (effective == 0L) return false
    masks[tid] = effective
    events.add("set ${if (tid == 0) "self" else "tid$tid"} ${java.lang.Long.toHexString(effective)}")
    return true
  }
  override fun reopen(pinned: Long, open: Long) { events.add("reopen ${java.lang.Long.toHexString(pinned)} ${java.lang.Long.toHexString(open)}") }
  override fun currentTid() = currentThread
  override fun postToMain(delayMs: Long, task: () -> Unit) { timers.add(delayMs to task) }
  override fun startThread(name: String, task: () -> Unit) {
    events.add("thread $name")
    task()
  }
  override fun initLoader() {
    events.add("init")
    if (loaderFails) throw java.io.IOException("no apk")
  }
  override fun loadLibrary(name: String) {
    events.add("load $name")
    if (name == failingLibrary) throw UnsatisfiedLinkError("$name not found")
  }
  override fun nowMs() = clock
  override fun info(message: String) { events.add("info $message") }
  override fun warn(message: String, error: Throwable) { events.add("warn $message (${error.javaClass.simpleName})") }
  override fun released() { events.add("released") }
}

internal val libraries = listOf("a", "b", "c")

internal fun run(name: String): List<String> {
  when (name) {
    // The process was started for the screen: the Activity says so, the first mount releases, and the timers that come later do nothing more.
    "screen" -> {
      val p = FakePlatform()
      val core = BootBoostCore(p, libraries)
      core.begin(); core.handOver(); p.advance(180); core.activityCreated(); core.release(); p.fire(10_000)
      return p.events
    }
    // Nothing makes an Activity: the headless timer releases the pin, once, and the timeout after it does nothing.
    "headless" -> {
      val p = FakePlatform()
      val core = BootBoostCore(p, libraries)
      core.begin(); core.handOver(); p.fire(BootBoostCore.TIMEOUT_MS)
      return p.events
    }
    // The first mount never comes but the Activity does: the pin holds past the headless timer and goes at the timeout.
    "late-mount" -> {
      val p = FakePlatform()
      val core = BootBoostCore(p, libraries)
      core.begin(); core.activityCreated(); p.fire(BootBoostCore.HEADLESS_MS)
      val before = p.events.size
      p.fire(BootBoostCore.TIMEOUT_MS)
      return p.events.drop(before)
    }
    "alike-cores" -> { val p = FakePlatform(cores = null); BootBoostCore(p, libraries).begin(); return p.events }
    // A cpuset that leaves the thread no big core: the request is undone and nothing is armed.
    "no-big-core-allowed" -> { val p = FakePlatform(cpuset = 0x3f); val core = BootBoostCore(p, libraries); core.begin(); return p.events }
    "release-before-begin" -> { val p = FakePlatform(); val core = BootBoostCore(p, libraries); core.release(); return p.events }
    "release-twice" -> {
      val p = FakePlatform()
      val core = BootBoostCore(p, libraries)
      core.begin(); core.release(); core.release(); p.fire(10_000)
      return p.events.filter { it == "released" || it.startsWith("reopen") }
    }
    "preload" -> { val p = FakePlatform(); BootBoostCore(p, libraries).preloadLibraries(); return p.events }
    "preload-twice" -> { val p = FakePlatform(); val core = BootBoostCore(p, libraries); core.preloadLibraries(); core.preloadLibraries(); return p.events.filter { it == "init" } }
    "preload-alike-cores" -> { val p = FakePlatform(cores = null); BootBoostCore(p, libraries).preloadLibraries(); return p.events }
    "preload-loader-fails" -> { val p = FakePlatform(loaderFails = true); BootBoostCore(p, libraries).preloadLibraries(); return p.events }
    "preload-library-fails" -> { val p = FakePlatform(failingLibrary = "b"); BootBoostCore(p, libraries).preloadLibraries(); return p.events }
    else -> throw IllegalArgumentException(name)
  }
}


fun main() {
  for (line in generateSequence(::readLine)) {
    val name = line.trim()
    if (name.startsWith("main-process ")) {
      val parts = name.removePrefix("main-process ").split(' ')
      println(BootBoostCore.isMainProcess(parts[0].takeIf { it != "null" }, parts[1]))
    } else {
      println(run(name).joinToString(" | "))
    }
  }
}
