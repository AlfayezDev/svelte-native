package expo.modules.svelteengine

/**
 * What [BootBoostCore] needs from the platform, so that the rules run on the host in a test (`tests/boot-boost.test.ts`): no Android type
 * appears in this file.
 */
internal interface BootEnvironment {
  /** The cores the start-up threads are pinned to, or null on a device whose cores are alike (or when `svelteaffinity` could not be loaded). */
  fun bigCores(): Long?
  fun affinityOf(tid: Int): Long
  fun setAffinity(tid: Int, mask: Long): Boolean
  /** Gives every thread of the process whose mask lies inside [pinned] the mask [open] (see [Affinity.reopen]). */
  fun reopen(pinned: Long, open: Long)
  fun currentTid(): Int
  fun postToMain(delayMs: Long, task: () -> Unit)
  fun startThread(name: String, task: () -> Unit)
  /** `SoLoader.init` as `loadReactNative` does it; throws when SoLoader cannot start. */
  fun initLoader()
  fun loadLibrary(name: String)
  fun nowMs(): Long
  fun info(message: String)
  fun warn(message: String, error: Throwable)
  /** The pin was given up (the first mount, the timeout or a start with no Activity). Called once. */
  fun released()
}

/**
 * The rules of the boot boost; [BootBoost] gives them the platform. See there for why.
 *
 * [begin] pins the calling thread to the big cores and arms two timers: [TIMEOUT_MS] (the first mount never came) and [HEADLESS_MS]
 * (no [activityCreated] by then: the process was started for something that is not on screen). [release] is idempotent and may be called from
 * any thread; it gives the pinned threads their masks back and tells the platform once.
 */
internal class BootBoostCore(private val env: BootEnvironment, private val libraries: List<String>) {
  private val lock = Any()
  @Volatile private var released = true
  @Volatile private var activityCreated = false
  @Volatile private var preloading = false
  @Volatile private var pinnedAt = 0L
  /** The cores the threads were pinned to: what the kernel kept of the request after the cpuset. */
  private var big = 0L
  private var open = 0L
  /** The thread that was pinned, by id: [release] runs on any thread and must not touch its own. */
  private var callerTid = 0
  private var callerPinned = false

  /**
   * Initializes the loader and loads [libraries], in order, on one thread of its own that is held to the big cores. A loader that cannot start,
   * or a library that cannot load, is logged and the host fails again, with its cause, where it needs the library; nothing is thrown from here.
   *
   * One thread, not one per library: `dlopen` holds the linker's single lock for the whole of a load, so loads on several threads run one
   * after the other anyway, and the extra threads only compete with the main thread (which needs the first two libraries itself, right after
   * the content providers) and the pool thread for the two big cores. Interleaved on the Galaxy A16 (20 warm launches each, one build, a system
   * property chose the variant): a thread per library with the first two pinned 324 ms, one pinned thread 314 ms (median `Displayed`).
   */
  fun preloadLibraries() {
    if (preloading) return
    preloading = true
    try {
      env.initLoader()
    } catch (error: Exception) {
      env.warn("BootBoost: could not initialize SoLoader ahead of React Native, no library preload", error)
      return
    }
    val cores = env.bigCores()
    env.startThread("svelte-boot-load") {
      if (cores != null) env.setAffinity(0, cores)
      for (name in libraries) {
        try {
          env.loadLibrary(name)
        } catch (error: Throwable) {
          env.warn("BootBoost: could not preload $name", error)
        }
      }
    }
  }

  fun begin() {
    val mask = env.bigCores() ?: return
    synchronized(lock) {
      val before = env.affinityOf(0)
      if (before <= 0 || before == mask) return
      if (!env.setAffinity(0, mask)) return
      val effective = env.affinityOf(0)
      if (effective <= 0 || effective == before) {
        // The cpuset left no cores to choose from.
        env.setAffinity(0, before)
        return
      }
      big = effective
      open = before
      callerTid = env.currentTid()
      callerPinned = true
      released = false
      pinnedAt = env.nowMs()
      env.info("BootBoost: pinned to ${java.lang.Long.toHexString(effective)}")
    }
    env.postToMain(TIMEOUT_MS) { release() }
    env.postToMain(HEADLESS_MS) {
      if (!activityCreated) {
        env.info("BootBoost: no activity after $HEADLESS_MS ms, a start for something that is not on screen")
        release()
      }
    }
  }

  /** The Activity exists: the process was started for the screen, so the pin holds until the first mount. */
  fun activityCreated() {
    activityCreated = true
    if (pinnedAt != 0L && !released) env.info("BootBoost: activity created ${env.nowMs() - pinnedAt} ms after the pin")
  }

  /** The calling thread (the one that called [begin]) gets its own mask back; the threads it started keep the big mask until [release]. */
  fun handOver() {
    synchronized(lock) {
      if (callerPinned) env.setAffinity(callerTid, open)
      callerPinned = false
    }
  }

  fun release() {
    if (released) return
    synchronized(lock) {
      if (released) return
      released = true
      if (callerPinned) env.setAffinity(callerTid, open)
      callerPinned = false
      env.reopen(big, open)
      env.info("BootBoost: released")
    }
    env.released()
  }

  companion object {
    const val TIMEOUT_MS = 3000L
    /**
     * A process started for the screen has created its Activity within this long after the pin; one that has not was started for something
     * else. The gap was 35 to 88 ms over 160 launches of the Galaxy A16 (median 41, p90 54); the margin over the largest is about six times,
     * since a late Activity costs the launch its boost, while a headless process only holds the pin for this long.
     */
    const val HEADLESS_MS = 500L

    /**
     * Whether this is the process the app's screen lives in: the process name is the package name. A process the manifest names otherwise
     * (a service of its own) runs the same Application and would pin its threads and load the libraries for nothing. A name that cannot be
     * read counts as the main process, which is what every start was before this check.
     */
    fun isMainProcess(processName: String?, packageName: String): Boolean = processName == null || processName == packageName
  }
}
