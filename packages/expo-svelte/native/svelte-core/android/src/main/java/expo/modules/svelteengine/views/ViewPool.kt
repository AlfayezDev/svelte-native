package expo.modules.svelteengine.views

import expo.modules.svelteengine.A11y

import android.view.View
import android.view.ViewGroup
import androidx.core.view.ViewCompat

/**
 * Free lists of deleted engine views, one per kind: the plain container ([EngineView] itself, not its subclasses),
 * [EngineText], [EngineScroll] and [EngineHScroll]. `MountingManager` hands every deleted view to [release] and asks
 * [obtain] before it constructs a new one, so a surface that keeps replacing rows or tiles stops creating views once
 * the pool is warm.
 *
 * Only views nobody can still reach come back. A view still attached to the window belongs to a subtree something
 * holds on to (a screen playing its exit, a layout animation): it is remembered and taken back by [sweep] once it has
 * been detached. One with an animation or a running scroll is not idle, and one with a child the engine did not create
 * (a foreign view) is left to its owner. Everything else is reset to the state of a new view before it is stored, so
 * [obtain] hands out views that need no cleanup. The pool is capped and main-thread only. Views of the other kinds are
 * not pooled: input, switch, image, spinner, modal, stack and screen hold platform state (IME, listeners, loaders,
 * back callbacks) that only their own files can clear.
 */
class ViewPool(private val capacity: Int = DEFAULT_CAPACITY) {
  private val free = Array(SLOTS) { ArrayList<View>(16) }
  /** Deleted views that were still attached to the window; their tree is held by something that will let go. */
  private val held = ArrayList<View>()

  /** A reset view of [slot] (one of the `VIEW`, `TEXT`, `SCROLL`, `HSCROLL` constants), or null when the pool has none. */
  fun obtain(slot: Int): View? {
    val list = free[slot]
    return if (list.isEmpty()) null else list.removeAt(list.size - 1)
  }

  /**
   * Takes a view the mutation stream deleted: stored now, or remembered for [sweep] when it is still attached. True when
   * the view is waiting to be swept (the caller should sweep again later).
   */
  fun release(view: View): Boolean {
    if (slotOf(view) < 0) return false
    if (view.isAttachedToWindow) {
      if (held.size >= MAX_HELD) return false
      held.add(view)
      return true
    }
    recycle(view)
    return false
  }

  /** Takes back the held views that have been detached since; true while some are still attached. */
  fun sweep(): Boolean {
    var i = held.size - 1
    while (i >= 0) {
      val view = held[i]
      if (!view.isAttachedToWindow) {
        held[i] = held[held.size - 1]
        held.removeAt(held.size - 1)
        recycle(view)
      }
      i--
    }
    return held.isNotEmpty()
  }

  val hasHeld: Boolean get() = held.isNotEmpty()

  val heldCount: Int get() = held.size

  /** True when [view] was reset and stored; false leaves it to the garbage collector. */
  private fun recycle(view: View): Boolean {
    val slot = slotOf(view)
    if (slot < 0) return false
    val list = free[slot]
    if (list.size >= capacity || !reusable(view)) return false
    reset(view)
    list.add(view)
    return true
  }

  /** Drops every stored view (memory pressure). */
  fun clear() {
    for (list in free) list.clear()
    held.clear()
  }

  val size: Int get() = free.sumOf { it.size }

  private fun slotOf(view: View): Int = when (view.javaClass) {
    EngineView::class.java -> VIEW
    EngineText::class.java -> TEXT
    EngineScroll::class.java -> SCROLL
    EngineHScroll::class.java -> HSCROLL
    else -> -1
  }

  private fun reusable(view: View): Boolean {
    if (view.isAttachedToWindow || view.animation != null || view.hasTransientState()) return false
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) if (view.getChildAt(i) !is EngineNode) return false
    }
    return when (view) {
      is EngineScroll -> view.bridge.isIdle()
      is EngineHScroll -> view.bridge.isIdle()
      else -> true
    }
  }

  private fun reset(view: View) {
    val st = (view as EngineNode).node
    // The scroll offset goes first: ScrollView ignores scrollTo once its content is gone, and the bridge must not tell
    // JavaScript about a tag that no longer exists.
    when (view) {
      is EngineScroll -> view.resetForReuse()
      is EngineHScroll -> view.resetForReuse()
    }
    // Detach before the node state resets: parents count stacked children from the values the children carried when
    // they were added. A dead tree arrives parent first or child first; either order leaves both ends detached.
    (view.parent as? ViewGroup)?.removeView(view)
    if (view is ViewGroup) view.removeAllViews()
    if (view is EngineText) view.clearForReuse()

    if (view.hasFocus()) view.clearFocus()
    if (view.alpha != 1f) view.alpha = 1f
    if (st.transformed) {
      view.translationX = 0f
      view.translationY = 0f
      view.scaleX = 1f
      view.scaleY = 1f
      view.rotation = 0f
    }
    if (view.visibility != View.VISIBLE) view.visibility = View.VISIBLE
    if (view.elevation != 0f) view.elevation = 0f
    if (view is EngineView && view.offscreenAlpha) view.offscreenAlpha = false
    if (view.layerType != View.LAYER_TYPE_NONE) view.setLayerType(View.LAYER_TYPE_NONE, null)
    st.viewFlags = 0
    // React Native's drawables (shadows, borders) stay on the view, with what `NodeState` remembers they hold: the next node of a view that needs them rewrites what differs (`BoxStyle.apply`),
    // which costs far less than making them again, and one that does not takes them off (`Props.applyCommon`).
    A11y.setClickable(view, false)
    view.tag = null
    // The id is the node tag (MountingManager.createView): a pooled view has no node, and no gesture handler is found on it.
    view.id = View.NO_ID
    view.contentDescription = null
    val focusable = view is EngineScrollable
    if (view.isFocusable != focusable) view.isFocusable = focusable
    // A text is always read (what EngineText sets when it is made); the other kinds are automatic.
    val important = if (view is EngineText) View.IMPORTANT_FOR_ACCESSIBILITY_YES else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
    if (view.importantForAccessibility != important) view.importantForAccessibility = important
    // The accessibility props: state, live region and the node publication (`st.reset()` below drops the records the delegate reads).
    if (view.isSelected) view.isSelected = false
    if (!view.isEnabled) view.isEnabled = true
    if (ViewCompat.getAccessibilityLiveRegion(view) != ViewCompat.ACCESSIBILITY_LIVE_REGION_NONE) {
      ViewCompat.setAccessibilityLiveRegion(view, ViewCompat.ACCESSIBILITY_LIVE_REGION_NONE)
    }
    st.reset()
    // The next measure and layout pass must run in full, whatever size this view had in its previous life.
    view.forceLayout()
  }

  companion object {
    const val VIEW = 0
    const val TEXT = 1
    const val SCROLL = 2
    const val HSCROLL = 3
    private const val SLOTS = 4
    const val DEFAULT_CAPACITY = 512
    private const val MAX_HELD = 1024
  }
}
