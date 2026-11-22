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
 * [register] adds a library to load later. [firstMount] schedules the load on a thread of its own [DELAY_MS] later; [awaitAll] returns once every
 * registered library is in, loading the pending ones on the calling thread. A library loads once, whoever asks first, and one at a time: each
 * library's `JNI_OnLoad` adds its hybrid objects to Nitro's registry, a map with no lock of its own, so two loads must never overlap (the
 * linker's lock covers `dlopen`, not `JNI_OnLoad`). One that cannot load is logged when it fails, and [awaitAll] throws its error every time it
 * is called: the code that needs the library fails there, with the cause, as it failed at the start when the library loaded then.
 */
internal class DeferredLoadsCore(private val env: DeferredEnvironment) {
  /** Held for the whole of a load, and while a library is taken from [pending]: when a thread holds it and finds nothing pending, nothing is loading. */
  private val loads = ReentrantLock()
  private val pending = LinkedHashSet<String>()
  private val loaded = HashSet<String>()
  private val failures = LinkedHashMap<String, Throwable>()
  /** Read on every mount transaction (the main thread), so the calls after the first do not take [loads], which a load holds. */
  @Volatile private var scheduled = false
  private val scheduling = Any()

  fun register(name: String) = loads.withLock {
    if (name !in loaded) pending.add(name)
  }

  /** The first screen is being mounted: what is pending loads [DELAY_MS] later, after the first frames, on a thread of its own. Once. */
  fun firstMount() {
    if (scheduled) return
    synchronized(scheduling) {
      if (scheduled) return
      scheduled = true
    }
    env.postToMain(DELAY_MS) { env.startThread(THREAD) { loadPending() } }
  }

  /** Every registered library is loaded when this returns: the pending ones on this thread, after a load in progress on another one. */
  fun awaitAll() {
    loadPending()
    loads.withLock {
      val failure = failures.entries.firstOrNull() ?: return
      throw UnsatisfiedLinkError("Svelte native: the native library ${failure.key} could not be loaded: ${failure.value.message}").apply { initCause(failure.value) }
    }
  }

  private fun loadPending() {
    while (true) {
      loads.withLock {
        val name = pending.firstOrNull() ?: return
        pending.remove(name)
        try {
          env.load(name)
        } catch (error: Throwable) {
          failures[name] = error
          env.warn("Svelte native: could not load the native library $name", error)
        }
        loaded.add(name)
      }
    }
  }

  companion object {
    /** After the first mount, before the background load: the first frames are drawn by then, and a load holds the linker's lock (see [DeferredLibraries]). */
    const val DELAY_MS = 1000L
    const val THREAD = "svelte-deferred-load"
  }
}
