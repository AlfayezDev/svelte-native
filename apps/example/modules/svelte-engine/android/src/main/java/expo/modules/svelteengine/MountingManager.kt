package expo.modules.svelteengine

import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.Trace
import android.util.Log
import android.util.SparseArray
import android.view.View
import android.view.ViewGroup
import expo.modules.svelteengine.views.EngineForeign
import expo.modules.svelteengine.views.EngineHScroll
import expo.modules.svelteengine.views.EngineHeader
import expo.modules.svelteengine.views.EngineHeaderSlot
import expo.modules.svelteengine.views.EngineImage
import expo.modules.svelteengine.views.EngineInput
import expo.modules.svelteengine.views.EngineModal
import expo.modules.svelteengine.views.EngineNode
import expo.modules.svelteengine.views.EngineRoot
import expo.modules.svelteengine.views.EngineScreen
import expo.modules.svelteengine.views.EngineScroll
import expo.modules.svelteengine.views.EngineSheet
import expo.modules.svelteengine.views.EngineStack
import expo.modules.svelteengine.views.EngineSpinner
import expo.modules.svelteengine.views.EngineSwitch
import expo.modules.svelteengine.views.EngineTab
import expo.modules.svelteengine.views.EngineTabIcon
import expo.modules.svelteengine.views.EngineTabs
import expo.modules.svelteengine.views.EngineText
import expo.modules.svelteengine.views.EngineView
import expo.modules.svelteengine.views.Frames
import expo.modules.svelteengine.views.ViewPool
import kotlin.math.roundToInt

private const val OP_CREATE = 1
private const val OP_DELETE = 2
private const val OP_INSERT = 3
private const val OP_REMOVE = 4
private const val OP_UPDATE_PROPS = 5
private const val OP_UPDATE_LAYOUT = 6
private const val OP_UPDATE_STATE = 7
private const val OP_END = 9

private const val DELETED_TAGS = 1024
private const val SWEEP_DELAY_MS = 500L
private const val MAX_EARLY_ANIMATED = 64
private const val EARLY_ANIMATED_MS = 1000L

private const val KIND_TEXT = 2
private const val KIND_SCROLL = 4
private const val KIND_INPUT = 5
private const val KIND_SWITCH = 6
private const val KIND_PROGRESS = 7
private const val KIND_IMAGE = 8
private const val KIND_MODAL = 9
private const val KIND_STACK = 10
private const val KIND_SCREEN = 11
private const val KIND_HEADER = 12
private const val KIND_HEADER_SLOT = 13
private const val KIND_TABS = 14
private const val KIND_TAB = 15
private const val KIND_TAB_ICON = 16
private const val KIND_FOREIGN = 17

/** Applies C++ mounting batches to the engine view tree. Main thread only. */
class MountingManager(context: Context) {
  private val appContext = context.applicationContext
  private val handler = Handler(Looper.getMainLooper())
  private val registry = SparseArray<View>(512)
  private val scratch = PropSet()
  private val dirtyTexts = ArrayList<EngineText>()
  private var native: SvelteEngineNative? = null
  private val pool = ViewPool()

  /** Views other libraries own, mounted by React Native's own mounting (SPEC.md, "Foreign views"). */
  val foreign = ForeignViews()

  /** Delivers a batch's layout events right after its mount (see [EventBeat]). */
  internal val events = EventBeat()

  /** A screen INSERT waiting for the end of its batch (see [flushScreens]). */
  private class PendingScreen(val stack: EngineStack, val screen: EngineScreen, val index: Int)
  private val pendingScreens = ArrayList<PendingScreen>(2)

  /** Tags deleted recently, newest overwrites oldest: an animated write to one of them is an expected late write. */
  private val deletedTags = IntArray(DELETED_TAGS) { -1 }
  private val deletedAt = LongArray(DELETED_TAGS)
  private var deletedNext = 0

  val root: EngineRoot = EngineRoot(context)

  init {
    TextLayouts.init(context.assets)
    appContext.registerComponentCallbacks(object : ComponentCallbacks2 {
      override fun onTrimMemory(level: Int) {
        if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
          handler.post { pool.clear(); TextLayouts.clearCache() }
        }
      }

      // Font scale, locale and layout direction all change what a text layout looks like.
      override fun onConfigurationChanged(newConfig: Configuration) {
        handler.post { TextLayouts.clearCache() }
      }

      @Deprecated("Superseded by onTrimMemory")
      override fun onLowMemory() {
        handler.post { pool.clear(); TextLayouts.clearCache() }
      }
    })
  }

  /** The mounted view for a React tag (main thread only), or null. Used by Commands. */
  fun viewFor(tag: Int): View? = registry.get(tag)

  private var loggedUnknownAnimated = 0

  // Counters behind [stats]. The animated ones classify every Reanimated write that found no view (see [applyAnimated]).
  private var viewsCreated = 0
  private var viewsDeleted = 0
  private var lateWrites = 0
  private var staleWrites = 0
  private var replayedWrites = 0
  private var expiredWrites = 0
  private var overflowWrites = 0

  /**
   * Live counts for the soak runner (`SvelteEngine.stats()`, `qa/soak`): engine views mounted under a React tag, views
   * waiting in the pool, deleted views still attached and held back, and the animated-write classes (`lateWrites`: a
   * tag deleted a moment ago, expected; `staleWrites`: the same more than [EARLY_ANIMATED_MS] after the delete, an
   * animation that outlives its node). Main thread only.
   */
  fun stats(): Map<String, Int> = mapOf(
    "alive" to registry.size(),
    "pooled" to pool.size,
    "held" to pool.heldCount,
    "created" to viewsCreated,
    "deleted" to viewsDeleted,
    "lateWrites" to lateWrites,
    "staleWrites" to staleWrites,
    "replayedWrites" to replayedWrites,
    "expiredWrites" to expiredWrites,
    "overflowWrites" to overflowWrites,
    "earlyPending" to earlyAnimated.size(),
    "emitters" to (native?.emitterCount() ?: -1),
    "scrollStates" to (native?.scrollStateCount() ?: -1),
  )

  /**
   * Animated writes that arrived before their view exists, newest per tag. Reanimated's UI task for a new node runs
   * ahead of the mounting batch that creates it, so the first write of a CSS animation or mapper finds no view; it is
   * kept and applied on top of the committed props when the view is created (the order a view mounted first would see),
   * and dropped with a warning when no batch creates the tag within [EARLY_ANIMATED_MS].
   */
  private val earlyAnimated = SparseArray<com.facebook.react.bridge.ReadableMap>(4)
  private val earlyAt = SparseArray<Long>(4)

  /**
   * Reanimated's UI-thread prop write (via SvelteEngineHook). A mapper or CSS animation also outlives its node for a few
   * frames, so a write for a tag deleted a moment ago is expected and dropped silently; falling through to React Native's
   * path would throw a RetryableMountingLayerException on every frame. A write for a tag not mounted yet waits for its
   * view (see [earlyAnimated]). Views come back through [ViewPool] only under a new tag, and tags are never reused, so a
   * late write cannot land on another node.
   */
  fun applyAnimated(tag: Int, props: com.facebook.react.bridge.ReadableMap): Boolean {
    val view = registry.get(tag)
    if (view == null) {
      // A view React Native's mounting owns (inside a foreign view): Reanimated's own path writes it.
      if (native?.isForeign(tag) == true) return false
      val deleted = deletedIndex(tag)
      if (deleted >= 0) {
        lateWrites++
        if (SystemClock.uptimeMillis() - deletedAt[deleted] > EARLY_ANIMATED_MS) staleWrites++
      } else if (earlyAnimated.size() < MAX_EARLY_ANIMATED) {
        earlyAnimated.put(tag, props)
        earlyAt.put(tag, SystemClock.uptimeMillis())
      } else overflowWrites++
      return true
    }
    AnimatedProps.apply(view, props)
    return true
  }

  /** Applies the write a view's tag was waiting for, right after the view got its committed props. */
  private fun replayEarlyAnimated(tag: Int, view: View) {
    val props = earlyAnimated.get(tag) ?: return
    earlyAnimated.remove(tag)
    earlyAt.remove(tag)
    replayedWrites++
    AnimatedProps.apply(view, props)
  }

  /** Drops the waiting writes whose view never came; the first few are reported, they point at a real mismatch. */
  private fun expireEarlyAnimated() {
    if (earlyAnimated.size() == 0) return
    val now = SystemClock.uptimeMillis()
    for (i in earlyAnimated.size() - 1 downTo 0) {
      val tag = earlyAnimated.keyAt(i)
      if (now - (earlyAt.get(tag) ?: now) < EARLY_ANIMATED_MS) continue
      earlyAnimated.removeAt(i)
      earlyAt.remove(tag)
      expiredWrites++
      if (loggedUnknownAnimated++ < 3) Log.w("SvelteEngine", "animated write for tag $tag, no view was mounted for it (registry size ${registry.size()}), dropped")
    }
  }

  private fun deletedIndex(tag: Int): Int {
    for (i in deletedTags.indices) if (deletedTags[i] == tag) return i
    return -1
  }

  fun attach(native: SvelteEngineNative) {
    this.native = native
    root.native = native
    A11y.clicks = { tag -> native.dispatchClick(tag) }
  }

  /** Called from C++ on the JS thread. */
  @Suppress("unused")
  fun onTransaction(surfaceId: Int, ops: IntArray, strings: Array<String>, objects: Array<Any?>) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      apply(surfaceId, ops, strings, objects)
    } else {
      handler.post { apply(surfaceId, ops, strings, objects) }
    }
  }

  /** Views deleted while a screen's exit still showed them come back to the pool after the exit. */
  private val sweepPool = Runnable {
    sweepQueued = false
    if (pool.sweep()) scheduleSweep()
  }
  private var sweepQueued = false

  private fun scheduleSweep() {
    if (sweepQueued) return
    sweepQueued = true
    handler.postDelayed(sweepPool, SWEEP_DELAY_MS)
  }

  private fun apply(surfaceId: Int, ops: IntArray, strings: Array<String>, objects: Array<Any?>) {
    if (pool.hasHeld) pool.sweep()
    Trace.beginSection("SvelteEngine.mount")
    val t0 = System.nanoTime()
    var decodeNs = 0L
    var createNs = 0L; var insertNs = 0L; var layoutNs = 0L; var deleteNs = 0L; var textsNs = 0L; var screensNs = 0L
    var create = 0; var update = 0; var layout = 0; var insert = 0; var remove = 0; var delete = 0
    // The surface changes when the Activity is recreated (a font-scale change): touches go to the one that mounts.
    if (root.surfaceId != surfaceId) root.surfaceId = surfaceId
    val p = scratch
    var i = 0
    try {
      loop@ while (i < ops.size) {
        when (ops[i++]) {
          OP_CREATE -> {
            val tag = ops[i++]; val kind = ops[i++]; val n = ops[i++]
            val d0 = System.nanoTime()
            p.reset()
            i = Props.decode(ops, i, n, strings, objects, p)
            val d1 = System.nanoTime()
            decodeNs += d1 - d0
            createView(tag, kind, p)
            createNs += System.nanoTime() - d1
            create++
          }
          OP_DELETE -> {
            val d0 = System.nanoTime()
            val tag = ops[i++]
            val view = registry.get(tag)
            (view as? EngineModal)?.onDrop()
            (view as? EngineForeign)?.let { foreign.dropped(tag, it) }
            if (view is EngineScreen) dropPending(view)
            registry.remove(tag)
            if (view != null) {
              viewsDeleted++
              deletedTags[deletedNext] = tag
              deletedAt[deletedNext] = SystemClock.uptimeMillis()
              deletedNext = (deletedNext + 1) % DELETED_TAGS
              // A text queued for a rebuild keeps its marker until the rebuild; forget it before the pool clears it.
              if (view is EngineText && view.builtWidth == -1) dirtyTexts.remove(view)
              if (pool.release(view)) scheduleSweep()
            }
            deleteNs += System.nanoTime() - d0
            delete++
          }
          OP_INSERT -> {
            val d0 = System.nanoTime()
            val parentTag = ops[i++]; val childTag = ops[i++]; val index = ops[i++]
            val child = registry.get(childTag)
            val parent = if (parentTag == surfaceId) root else registry.get(parentTag) as? ViewGroup
            if (child != null && parent != null) {
              (child.parent as? ViewGroup)?.removeView(child)
              // Fabric inserts top-down: the screen arrives before its subtree. Attaching it at the end of the batch
              // lets the subtree be built, measured and laid out detached, and starts the transition on a finished tree.
              if (parent is EngineStack && child is EngineScreen) pendingScreens.add(PendingScreen(parent, child, index))
              else parent.addView(child, minOf(index, parent.childCount))
            } else {
              Log.w("SvelteEngine", "insert dropped parent=$parentTag child=$childTag")
            }
            insertNs += System.nanoTime() - d0
            insert++
          }
          OP_REMOVE -> {
            val parentTag = ops[i++]; val childTag = ops[i++]; val index = ops[i++]
            val child = registry.get(childTag)
            val parent = if (parentTag == surfaceId) root else registry.get(parentTag) as? ViewGroup
            if (parent is EngineStack && child is EngineScreen) {
              // A screen whose REMOVE arrives in the batch that inserted it never reaches the stack.
              if (!dropPending(child)) parent.removeScreen(child) // keeps the view attached while its exit plays; the DELETE that follows only drops the registry entry
            } else if (child != null && parent != null) {
              if (index < parent.childCount && parent.getChildAt(index) === child) parent.removeViewAt(index)
              else parent.removeView(child)
            }
            remove++
          }
          OP_UPDATE_PROPS -> {
            val tag = ops[i++]; val kind = ops[i++]; val n = ops[i++]
            val d0 = System.nanoTime()
            p.reset()
            i = Props.decode(ops, i, n, strings, objects, p)
            decodeNs += System.nanoTime() - d0
            registry.get(tag)?.let { applyProps(it, kind, p, false) }
            update++
          }
          OP_UPDATE_LAYOUT -> {
            val d0 = System.nanoTime()
            val tag = ops[i]
            applyLayout(registry.get(tag), ops, i + 1)
            i += 10
            layoutNs += System.nanoTime() - d0
            layout++
          }
          OP_UPDATE_STATE -> {
            val tag = ops[i++]; val kind = ops[i++]; val n = ops[i++]
            val d0 = System.nanoTime()
            p.reset()
            i = Props.decode(ops, i, n, strings, objects, p)
            decodeNs += System.nanoTime() - d0
            val v = registry.get(tag)
            if (v is EngineText && kind == KIND_TEXT) {
              v.spec = Props.textSpecFrom(p)
              markDirty(v)
            } else if (v is EngineInput && kind == KIND_INPUT) {
              v.applyState(p.views)
            }
            update++
          }
          OP_END -> break@loop
          else -> {
            Log.e("SvelteEngine", "unknown op ${ops[i - 1]} at ${i - 1}")
            break@loop
          }
        }
      }
      Trace.beginSection("SvelteEngine.texts")
      val t1 = System.nanoTime()
      try {
        for (k in 0 until dirtyTexts.size) {
          val t = dirtyTexts[k]
          t.rebuild()
        }
      } finally {
        textsNs = System.nanoTime() - t1
        Trace.endSection()
      }
      val t2 = System.nanoTime()
      flushScreens()
      screensNs = System.nanoTime() - t2
      expireEarlyAnimated()
    } finally {
      dirtyTexts.clear()
      pendingScreens.clear()
      Trace.endSection()
    }
    val totalNs = System.nanoTime() - t0
    // The acceptance line, built by hand: a Formatter per transaction is garbage on the thread that mounts.
    val line = StringBuilder(128)
      .append("surface=").append(surfaceId).append(" ops=").append(ops.size)
      .append(" create=").append(create).append(" update=").append(update).append(" layout=").append(layout)
      .append(" insert=").append(insert).append(" remove=").append(remove).append(" delete=").append(delete)
      .append(" decode=")
    appendMillis(line, decodeNs)
    line.append("ms apply=")
    appendMillis(line, totalNs - decodeNs)
    line.append("ms")
    if (create + delete + layout + insert > 0) {
      line.append(" [create="); appendMillis(line, createNs)
      line.append(" insert="); appendMillis(line, insertNs)
      line.append(" layout="); appendMillis(line, layoutNs)
      line.append(" delete="); appendMillis(line, deleteNs)
      line.append(" texts="); appendMillis(line, textsNs)
      line.append(" screens="); appendMillis(line, screensNs)
      line.append(']')
    }
    Log.i("SvelteEngine", line.toString())
    // Fabric's mount hooks (Reanimated drops removed nodes in its) only run when a mount is reported. Reported from the
    // next main-looper message, never from inside this batch: a commit made on the main thread (a size change in
    // `ReactSurfaceView.onMeasure`, a rotation) runs this batch inline from Fabric's `MountingCoordinator::pullTransaction`
    // with the coordinator's mutex held, and `UIManager::reportMount` takes that mutex again (a deadlock, an ANR after 5 s,
    // the landscape layout never applied).
    val mounted = surfaceId
    handler.post { native?.reportMount(mounted) }
    events.induce()
  }

  /** [ns] in milliseconds with one decimal ("1.2"), rounded half up like `%.1f`. */
  private fun appendMillis(out: StringBuilder, ns: Long) {
    val tenths = (ns + 50_000L) / 100_000L
    out.append(tenths / 10).append('.').append(tenths % 10)
  }

  private fun dropPending(screen: EngineScreen): Boolean {
    for (i in pendingScreens.indices) {
      if (pendingScreens[i].screen === screen) {
        pendingScreens.removeAt(i)
        return true
      }
    }
    return false
  }

  /**
   * Hands the batch's inserted screens to their stacks, in order, after every op and the text layouts are done. The
   * screen's own frame is placed first (while it is detached no parent does it), which measures and lays out the whole
   * subtree; the stack then attaches it once and its transition starts from a complete tree.
   */
  private fun flushScreens() {
    if (pendingScreens.isEmpty()) return
    Trace.beginSection("SvelteEngine.screens")
    try {
      for (i in 0 until pendingScreens.size) {
        val p = pendingScreens[i]
        if (p.screen.node.hasFrame) Frames.place(p.screen)
        p.stack.insertScreen(p.screen, p.index)
      }
    } finally {
      pendingScreens.clear()
      Trace.endSection()
    }
  }

  private fun markDirty(t: EngineText) {
    t.builtWidth = -1
    if (!dirtyTexts.contains(t)) dirtyTexts.add(t)
  }

  /** A view of [slot] from the pool, or a new one (`SvelteEngine.newView` marks the constructions in a trace). */
  private inline fun pooled(slot: Int, construct: () -> View): View {
    pool.obtain(slot)?.let { return it }
    Trace.beginSection("SvelteEngine.newView")
    try {
      return construct()
    } finally {
      Trace.endSection()
    }
  }

  private fun createView(tag: Int, kind: Int, p: PropSet) {
    val view: View = when (kind) {
      KIND_TEXT -> pooled(ViewPool.TEXT) { EngineText(appContext) }
      KIND_SCROLL -> if (p.horizontal == 1) {
        (pooled(ViewPool.HSCROLL) { EngineHScroll(appContext) } as EngineHScroll).also { it.bridge.native = native }
      } else {
        (pooled(ViewPool.SCROLL) { EngineScroll(appContext) } as EngineScroll).also { it.bridge.native = native }
      }
      KIND_INPUT -> EngineInput(appContext)
      KIND_SWITCH -> EngineSwitch(appContext)
      KIND_PROGRESS -> EngineSpinner(appContext, p.views.spinnerStyle)
      KIND_IMAGE -> EngineImage(appContext)
      KIND_STACK -> EngineStack(appContext)
      KIND_SCREEN -> if (p.nav.presentation >= 3) EngineSheet(appContext) else EngineScreen(appContext)
      KIND_HEADER -> EngineHeader(appContext)
      KIND_HEADER_SLOT -> EngineHeaderSlot(appContext)
      KIND_TABS -> EngineTabs(appContext)
      KIND_TAB -> EngineTab(appContext)
      KIND_TAB_ICON -> EngineTabIcon(appContext)
      KIND_FOREIGN -> EngineForeign(appContext)
      KIND_MODAL -> EngineModal(appContext, root)
      else -> pooled(ViewPool.VIEW) { EngineView(appContext) }
    }
    (view as EngineNode).node.tag = tag
    viewsCreated++
    registry.put(tag, view)
    applyProps(view, kind, p, true)
    replayEarlyAnimated(tag, view)
    if (view is EngineForeign) foreign.created(tag, view)
  }

  private fun applyProps(view: View, kind: Int, p: PropSet, create: Boolean) {
    val node = (view as EngineNode).node
    Props.applyCommon(view, node, p, create)
    when (view) {
      is EngineText -> if (create || p.textSeen) {
        val spec = Props.textSpecFrom(p)
        // A props-only update (no state in the transaction) keeps the content of the last state.
        val old = view.spec
        if (old != null && spec.fragments == null && spec.prepared == null) {
          spec.fragments = old.fragments
          spec.prepared = old.prepared
        }
        view.spec = spec
        markDirty(view)
      }
      is EngineInput -> view.apply(p.views, create)
      is EngineSwitch -> view.apply(p.views)
      is EngineSpinner -> view.apply(p.views)
      is EngineImage -> view.apply(p.views)
      is EngineModal -> view.apply(p.views)
      is EngineScreen -> view.apply(p.nav)
      is EngineHeader -> view.apply(p.nav)
      is EngineHeaderSlot -> view.apply(p.nav)
      is EngineTabs -> view.apply(p.nav)
      is EngineTab -> view.apply(p.nav)
      is EngineTabIcon -> view.apply()
      is EngineScroll -> {
        view.bridge.configure(p, create)
        view.isVerticalScrollBarEnabled = p.indicator == 1
      }
      is EngineHScroll -> {
        view.bridge.configure(p, create)
        view.isHorizontalScrollBarEnabled = p.indicator == 1
      }
    }
  }

  private fun applyLayout(view: View?, ops: IntArray, at: Int) {
    if (view == null) return
    val node = (view as EngineNode).node
    val x = Float.fromBits(ops[at]); val y = Float.fromBits(ops[at + 1])
    val w = Float.fromBits(ops[at + 2]); val h = Float.fromBits(ops[at + 3])
    node.l = x.roundToInt(); node.t = y.roundToInt()
    node.r = (x + w).roundToInt(); node.b = (y + h).roundToInt()
    node.hasFrame = true
    val pl = Float.fromBits(ops[at + 4]); val pt = Float.fromBits(ops[at + 5])
    val pr = Float.fromBits(ops[at + 6]); val pb = Float.fromBits(ops[at + 7])
    val padChanged = pl != node.padL || pt != node.padT || pr != node.padR || pb != node.padB
    node.padL = pl; node.padT = pt; node.padR = pr; node.padB = pb
    val vis = if (ops[at + 8] == 1) View.GONE else View.VISIBLE
    if (view is EngineScreen) {
      view.displayNone = vis == View.GONE
      view.stack?.refresh()
    } else if (view is EngineTab) {
      // The tab container decides which pane shows; Yoga only says whether it is part of the layout.
      view.displayNone = vis == View.GONE
      view.tabs?.refresh()
    } else if (view is EngineHeaderSlot) {
      view.displayNone = vis == View.GONE
      view.header?.slotChanged(view)
    } else if (view.visibility != vis) view.visibility = vis
    if (view is EngineText && (padChanged || view.builtWidth != (node.w - pl - pr).toInt() || view.heightMatters && view.builtHeight != (node.h - pt - pb).toInt())) markDirty(view)
    if (view is EngineInput) view.syncPadding()
    // A view of a detached subtree (a screen attached at the end of the batch, see flushScreens) is measured and laid
    // out once, with its screen: placing each view now would be repeated by every ancestor's own pass.
    if (!view.isAttachedToWindow) return
    val parent = view.parent
    if (parent is EngineView || parent is EngineRoot) Frames.place(view) else parent?.requestLayout()
  }
}
