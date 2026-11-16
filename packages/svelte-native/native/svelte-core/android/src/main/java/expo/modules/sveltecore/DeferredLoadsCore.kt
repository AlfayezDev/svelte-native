package expo.modules.sveltecore

import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** What [DeferredLoadsCore] needs of the platform; [DeferredLibraries] gives it Android's. */
internal interface DeferredEnvironment {
  /** `System.loadLibrary`. */
  fun load(name: String)
  fun startThread(name: String, task: () -> Unit)
  fun postToMain(delayMs: Long, task: () -> Unit)
  fun warn(message: String, error: Throwable)
}

/**
 * The rules of the deferred native libraries; [DeferredLibraries] gives them the platform. See there for why.
 *
 * [register] adds a library to load later. [firstMount] schedules the load on a thread of its own [DELAY_MS] later; [awaitAll] loads, on the
 * calling thread, every library that is still pending and waits for the ones another thread is loading, so that it returns once all of them
 * are in. A library loads once, whoever asks first. One that cannot load is logged when it fails, and [awaitAll] throws its error, every time
 * it is called: the code that needs the library fails there, with the cause, as it failed at the start when the library loaded then.
 */
internal class DeferredLoadsCore(private val env: DeferredEnvironment) {
  private val lock = ReentrantLock()
  private val settled = lock.newCondition()
  private val pending = LinkedHashSet<String>()
  private val loading = HashSet<String>()
  private val loaded = HashSet<String>()
  private val failures = LinkedHashMap<String, Throwable>()
  private var scheduled = false

  fun register(name: String) = lock.withLock {
    if (name !in loaded && name !in loading) pending.add(name)
  }

  /** The first screen is being mounted: what is pending loads [DELAY_MS] later, after the first frames, on a thread of its own. Once. */
  fun firstMount() {
    lock.withLock {
      if (scheduled) return
      scheduled = true
    }
    env.postToMain(DELAY_MS) { env.startThread(THREAD) { loadPending() } }
  }

  /** Every registered library is loaded when this returns: the pending ones on this thread, the ones in progress elsewhere waited for. */
  fun awaitAll() {
    loadPending()
    lock.withLock {
      while (loading.isNotEmpty()) settled.await()
      val failure = failures.entries.firstOrNull() ?: return
      throw UnsatisfiedLinkError("Svelte native: the native library ${failure.key} could not be loaded: ${failure.value.message}").apply { initCause(failure.value) }
    }
  }

  private fun loadPending() {
    while (true) {
      val name = lock.withLock { pending.firstOrNull()?.also { pending.remove(it); loading.add(it) } } ?: return
      var failure: Throwable? = null
      try {
        env.load(name)
      } catch (error: Throwable) {
        failure = error
        env.warn("Svelte native: could not load the native library $name", error)
      }
      lock.withLock {
        loading.remove(name)
        loaded.add(name)
        if (failure != null) failures[name] = failure
        settled.signalAll()
      }
    }
  }

  companion object {
    /** After the first mount, before the background load: the first frames are drawn by then, and a load holds the linker's lock (see [DeferredLibraries]). */
    const val DELAY_MS = 1000L
    const val THREAD = "svelte-deferred-load"
  }
}
