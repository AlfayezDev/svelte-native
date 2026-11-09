package expo.modules.svelteengine

import android.os.Handler
import android.os.Process

/**
 * Keeps the main thread and the RenderThread on the big cores while a large batch is applied and its first frames are drawn.
 *
 * A navigation that starts from JavaScript (a push the router makes after a timer, a deep link, a response) follows no touch,
 * so nothing has told the phone's governor that work is coming: the main thread is idle on a little core at 500 MHz when
 * the batch arrives, and the RenderThread, which draws the first frame of the new screen, is on a little core too. On the
 * Galaxy A16 a 128-view push applied in 12 to 21 ms there (`SvelteEngine.mount`, 7 to 9 ms of it `screens`, the measure
 * and layout of the detached subtree) against 4.4 ms behind a real tap, and the first frame took 17 to 22 ms (`DrawFrames`
 * 21 ms on cpu 4) against 12: two late frames for every push (SPEC "The late frames of a push"). Pinning both threads
 * to the big cores for the batch and the frames that follow it moves them at once, and the big cores' own clocks step up
 * within a few milliseconds of work arriving.
 *
 * Two things start it. The creation of a screen (a push, a sheet) does, and it ends [HOLD_MS] after the last one (a transition is 250 ms).
 * JavaScript's word that one commit attached many animated nodes does too (`MountingManager.animatedBatch`): Worklets registers them in
 * one main-thread message and the RenderThread draws their first frames on the same cold cores. The size of a batch does not: a batch
 * that creates no screen (a windowed list's first rows: 6 600 ops, a 300-row list) is not boosted. The
 * first version started at any batch of 2 500 ops or more; it held the two threads on the big cores while the JavaScript thread
 * mounted the next scenario's list in the lab, which then took 14 to 24 ms instead of 12. A device whose cores are alike is left alone.
 * Main thread only.
 */
internal class MountBoost(private val handler: Handler) {
  private var probed = false
  private var held = false
  /** The main thread, by id, so that [release] puts back the mask of the thread it took it from. */
  private var mainTid = 0
  private var mainBefore = 0L
  /** What the kernel kept of the request after the cpuset; threads that inherited it are put back by [release]. */
  private var pinned = 0L
  @Volatile private var renderTid = 0
  private var looking = false
  private var renderBefore = 0L
  private val release = Runnable { release() }

  /** A screen is being created in a batch, on the main thread. */
  fun begin() {
    if (!probed) {
      probed = true
      mainTid = Process.myTid()
    }
    val mask = Affinity.bigCores() ?: return
    if (!held) {
      val before = Affinity.affinityOf(0)
      if (before <= 0 || before == mask) return
      if (!Affinity.setAffinity(0, mask)) return
      pinned = Affinity.affinityOf(0)
      if (pinned <= 0 || pinned == before) {
        Affinity.setAffinity(0, before)
        return
      }
      held = true
      mainBefore = before
      val render = renderTid
      if (render == 0 && !looking) {
        // Finding the thread reads every thread's name: not on the main thread, in the middle of a batch. The first push goes without it.
        looking = true
        Thread({
          renderTid = Affinity.threadNamed("RenderThread")
          looking = false // a lookup that found nothing is tried again at the next screen
        }, "svelte-render-id").apply { isDaemon = true }.start()
      }
      renderBefore = if (render != 0) Affinity.affinityOf(render) else 0L
      if (renderBefore > 0 && renderBefore != mask) Affinity.setAffinity(render, mask) else renderBefore = 0L
    }
    handler.removeCallbacks(release)
    handler.postDelayed(release, HOLD_MS)
  }

  /** Gives the threads their masks back, and every thread that inherited the pinned mask. Main thread. */
  fun release() {
    handler.removeCallbacks(release)
    if (!held) return
    held = false
    Affinity.setAffinity(mainTid, mainBefore)
    if (renderBefore > 0) Affinity.setAffinity(renderTid, renderBefore)
    renderBefore = 0L
    // Threads the pinned main thread started during the window (an image loader's pool, a handler thread) inherited the big mask.
    Affinity.reopen(pinned, mainBefore)
  }

  private companion object {
    const val HOLD_MS = 400L
  }
}
