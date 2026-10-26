package expo.modules.svelteengine.views

import android.content.Context
import android.os.Build
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.activity.findViewTreeOnBackPressedDispatcherOwner
import expo.modules.svelteengine.NavEvents
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * The navigation container (SPEC.md "Navigation"): [EngineScreen] children, the last live one on top.
 *
 * Push: an inserted top screen slides in (from the right for push, from the bottom for modal, sheets and form sheets,
 * fade for transparentModal; `stackAnimation` overrides, `none` skips) over 250 ms, decelerating. Pop: the mutation
 * stream removes the screen, the stack keeps the view attached while its exit plays and detaches it afterwards
 * (Fabric's `delete` only drops the registry entry). A user dismissal (back button, header back button, predictive
 * back, edge swipe, sheet drag or scrim) plays the exit first, then sends `onDismissed`; the removal JavaScript performs
 * next finds the screen marked `dismissed` and detaches it. A sheet's scrim is a view of the stack just below the sheet.
 */
class EngineStack(context: Context) : EngineView(context) {
  private val density = resources.displayMetrics.density
  private val slop = ViewConfiguration.get(context).scaledTouchSlop
  private val edge = EDGE_DP * density
  private val interpolator = DecelerateInterpolator(DECELERATION)

  private var dragging = false
  private var edgeCandidate = false
  private var downX = 0f
  private var downY = 0f
  private var dragX = 0f
  private var tracker: VelocityTracker? = null
  private var predictive = false
  private var lastTop: EngineScreen? = null
  /** The screen a gesture (predictive back, edge swipe) is moving: it is in a layer until the gesture has handed it to an animation. */
  private var gestureScreen: EngineScreen? = null

  private fun holdGesture(s: EngineScreen) {
    if (gestureScreen === s) return
    releaseGesture()
    gestureScreen = s
    s.holdLayer()
  }

  private fun releaseGesture() {
    gestureScreen?.releaseLayer()
    gestureScreen = null
  }

  private val backCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackStarted(backEvent: BackEventCompat) {
      val top = top() ?: return
      if (!top.gestureEnabled || !top.dismissible) return
      cancelRunning(top)
      top.transitioning = false
      predictive = true
      holdGesture(top)
      refresh()
    }

    override fun handleOnBackProgressed(backEvent: BackEventCompat) {
      val top = top()
      if (!predictive || top == null) return
      val p = backEvent.progress
      if (top is EngineSheet) {
        // A sheet follows the gesture downwards.
        top.translationY = top.restY + p * top.height * 0.25f
        return
      }
      top.translationX = p * width * 0.2f
      top.pivotX = width / 2f
      top.pivotY = height / 2f
      top.scaleX = 1f - 0.08f * p
      top.scaleY = 1f - 0.08f * p
    }

    override fun handleOnBackPressed() {
      predictive = false
      // A sheet that is not dismissible takes the key and does nothing.
      if (top()?.dismissible == false) {
        releaseGesture()
        return
      }
      dismissTop()
      releaseGesture()
    }

    override fun handleOnBackCancelled() {
      val top = top()
      predictive = false
      if (top != null) animate(top, 0f, top.restY, 1f, 1f, 150L) { refresh() }
      releaseGesture()
      refresh()
    }
  }
  private var backRegistered = false

  // A sheet's scrim is not a Fabric node, so the mounting layer never sizes it: it always fills the stack.
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    for (i in 0 until childCount) {
      val sheet = getChildAt(i) as? EngineSheet ?: continue
      if (sheet.scrim.parent === this) sheet.scrim.measure(MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY))
    }
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    layoutScrims(r - l, b - t)
  }

  private fun layoutScrims(w: Int, h: Int) {
    for (i in 0 until childCount) {
      val sheet = getChildAt(i) as? EngineSheet ?: continue
      val scrim = sheet.scrim
      if (scrim.parent !== this) continue
      scrim.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY))
      scrim.layout(0, 0, w, h)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached.add(this)
    ensureBackCallback()
    refresh()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    attached.remove(this)
    backCallback.remove()
    backRegistered = false
    releaseGesture()
    for (i in 0 until childCount) (getChildAt(i) as? EngineScreen)?.let { cancelRunning(it) }
  }

  private fun ensureBackCallback() {
    if (backRegistered || !isAttachedToWindow) return
    val owner = findViewTreeOnBackPressedDispatcherOwner() ?: return
    owner.onBackPressedDispatcher.addCallback(owner, backCallback)
    backRegistered = true
  }

  // Screens ------------------------------------------------------------------------------------------------------

  private fun live(): List<EngineScreen> {
    val out = ArrayList<EngineScreen>(childCount)
    for (i in 0 until childCount) {
      val s = getChildAt(i) as? EngineScreen ?: continue
      if (!s.leaving) out.add(s)
    }
    return out
  }

  /** The top active screen: the last live one whose activityState is 2. */
  private fun top(): EngineScreen? = live().lastOrNull { it.activityState == 2 }

  internal fun topScreen(): EngineScreen? = top()

  /**
   * The stack answers the back key only when the screen holding it is the one in front: not under a screen another
   * stack put above it, not in a tab that is not selected (the tab's own stack must not take the key meant for the
   * modal above the tabs), and not under a `Modal` layer (it is on top of the whole overlay and holds the key).
   */
  private fun isActive(): Boolean {
    if (engineRoot()?.layerAbove(this) == true) return false
    var p = parent
    while (p != null) {
      if (p is EngineTab && !p.isSelectedPane()) return false
      if (p is EngineScreen) {
        val st = p.parent as? EngineStack
        if (st != null && st.top() !== p) return false
      }
      p = p.parent
    }
    return true
  }

  private fun canDismiss(): Boolean {
    val screens = live()
    val top = screens.lastOrNull { it.activityState == 2 } ?: return false
    return screens.size >= 2 && screens.first() !== top && top.backDismissal && isActive()
  }

  private fun updateBackCallback() {
    ensureBackCallback()
    backCallback.isEnabled = canDismiss()
  }

  /**
   * Recomputes what the screens' state implies: visibility (a settled push screen under another settled push
   * screen is hidden to save draw, never under a modal), touchability (the top screen, and the screens a sheet without
   * scrim lets through), accessibility focus, the back callback, and the appearance events.
   */
  fun refresh() {
    val screens = live()
    val top = screens.lastOrNull { it.activityState == 2 }
    for (i in 0 until childCount) {
      val s = getChildAt(i) as? EngineScreen ?: continue
      val visibility = if (s.displayNone) View.GONE else View.VISIBLE
      if (s.visibility != visibility) s.visibility = visibility
      // Inactive or covered screens are hidden through alpha, not INVISIBLE (see EngineScreen.setHidden).
      s.setHidden(!s.displayNone && !s.leaving && (s.activityState == 0 || covered(screens, s)))
      s.touchable = !s.leaving && s === top
    }
    // Below a sheet that has no scrim the screens stay interactive, down to the first screen that blocks them.
    if (top != null) {
      var through = top is EngineSheet && top.backdropNone
      for (j in screens.indexOf(top) - 1 downTo 0) {
        screens[j].touchable = through
        through = through && screens[j] is EngineSheet && (screens[j] as EngineSheet).backdropNone
      }
    }
    // A modal presentation holds accessibility focus: everything below it is hidden from services (a sheet without scrim is not modal).
    var hidden = false
    for (j in screens.indices.reversed()) {
      screens[j].setA11yHidden(hidden)
      val s = screens[j]
      if (s.presentation in 1..4 && !(s is EngineSheet && s.backdropNone)) hidden = true
    }
    updateBackCallback()
    if (top !== lastTop) {
      lastTop = top
      refreshBackCallbacks()
      SystemBars.invalidate(this)
    }
    updateResident(screens, top)
    syncAppearance()
  }

  /**
   * Once no screen of the stack is moving, the top screen above the stack's first keeps a hardware layer (see
   * [EngineScreen.setResident]); the first screen is never moved by a pop, and a screen that stops being the top lets
   * its layer go. Taken only at settle, so a screen revealed by a pop builds its layer on the quiet frame after the
   * transition, not on the transition's first frame.
   */
  private fun updateResident(screens: List<EngineScreen>, top: EngineScreen?) {
    var settled = !dragging && !predictive
    for (i in 0 until childCount) if ((getChildAt(i) as? EngineScreen)?.transitioning == true) settled = false
    for (i in 0 until childCount) {
      val s = getChildAt(i) as? EngineScreen ?: continue
      val wanted = settled && s === top && screens.size >= 2 && screens[0] !== s && !s.leaving
      s.setResident(wanted)
    }
  }

  private fun covered(screens: List<EngineScreen>, s: EngineScreen): Boolean {
    if (dragging || predictive) return false
    val index = screens.indexOf(s)
    for (j in index + 1 until screens.size) {
      val above = screens[j]
      if (above.presentation == 0 && !above.transitioning && above.activityState != 0) return true
    }
    return false
  }

  // Appearance --------------------------------------------------------------------------------------------------

  /** Whether the screen shows its content: active, laid out, and under no opaque screen (push or modal; sheets and transparent modals do not cover). */
  private fun appears(s: EngineScreen, screens: List<EngineScreen>): Boolean {
    if (s.activityState != 2 || s.displayNone || !s.node.hasFrame) return false
    for (j in screens.indexOf(s) + 1 until screens.size) {
      val above = screens[j]
      if (above.presentation <= 1 && above.activityState != 0 && !above.displayNone) return false
    }
    return true
  }

  /** The stack is on screen: attached, in a selected tab, inside screens that are themselves showing. */
  private fun showing(): Boolean {
    if (!isAttachedToWindow) return false
    var p = parent
    while (p != null) {
      if (p is EngineTab && !p.isSelectedPane()) return false
      if (p is EngineScreen && !p.appeared) return false
      p = p.parent
    }
    return true
  }

  /**
   * Sends `topAppear` and `topDisappear` for what changed since the last call. Events wait until no screen of the
   * stack is in a transition, so at the end of one the new top screen appears first, then the leaving screen disappears
   * (and `topDismissed` follows from the caller). A tab switch or a screen above the stack's own screen counts as well.
   */
  fun syncAppearance() {
    for (i in 0 until childCount) if ((getChildAt(i) as? EngineScreen)?.transitioning == true) return
    val shown = showing()
    val screens = live()
    var changed = false
    for (s in screens) {
      if (!s.appeared && shown && appears(s, screens)) {
        s.appeared = true
        changed = true
        NavEvents.appear(s.node.tag)
      }
    }
    for (i in 0 until childCount) {
      val s = getChildAt(i) as? EngineScreen ?: continue
      if (s.appeared && !(shown && !s.leaving && appears(s, screens))) {
        s.appeared = false
        changed = true
        NavEvents.disappear(s.node.tag)
      }
    }
    if (changed) syncWithin(this, false)
  }

  // Screens come and go -----------------------------------------------------------------------------------------

  /** The view a screen to be inserted before this one goes in front of: a sheet's scrim sits right under the sheet. */
  private fun anchor(s: EngineScreen): View = (s as? EngineSheet)?.scrim?.takeIf { it.parent === this } ?: s

  fun insertScreen(child: EngineScreen, index: Int) {
    cancelRunning(child)
    child.transitioning = false
    child.leaving = false
    child.dismissed = false
    child.alpha = 1f
    child.translationX = 0f
    val others = live().filter { it !== child }
    val atTop = index >= others.size
    val position = if (atTop) childCount else indexOfChild(anchor(others[index]))
    if (child is EngineSheet && !child.backdropNone) {
      addView(child.scrim, min(position, childCount))
      addView(child, min(position + 1, childCount))
    } else {
      addView(child, min(position, childCount))
    }
    if (child is EngineSheet && width > 0) layoutScrims(width, height)
    // Added after the stack knows its size: a sheet rests at its detent, not at 0.
    child.translationY = child.restY
    for (i in 0 until childCount) {
      val s = getChildAt(i) as? EngineScreen
      if (s != null && s.leaving) bringChildToFront(s)
    }
    val kind = child.transitionKind()
    if (atTop && others.isNotEmpty() && kind != 0 && isLaidOut && width > 0) {
      enterFrom(child, kind)
      child.transitioning = true
      animate(child, 0f, child.restY, 1f, 1f, DURATION) {
        child.transitioning = false
        (child as? EngineSheet)?.snapToRest()
        refresh()
      }
    }
    refresh()
  }

  fun removeScreen(child: EngineScreen) {
    val others = live().filter { it !== child }
    val index = indexOfChild(child)
    var above = false
    for (i in index + 1 until childCount) if (getChildAt(i) is EngineScreen) above = true
    val kind = child.transitionKind()
    val animate = !child.leaving && !child.dismissed && !above && others.isNotEmpty() && kind != 0 &&
      isLaidOut && width > 0 && child.visibility == View.VISIBLE && !child.hidden
    if (!animate) {
      detach(child)
      return
    }
    child.leaving = true
    cancelRunning(child)
    child.transitioning = true
    refresh()
    exitTo(child, kind, DURATION) { detach(child) }
  }

  private fun detach(child: EngineScreen) {
    cancelRunning(child)
    child.transitioning = false
    // The screen below appears first, then this one disappears; both before the view goes.
    child.leaving = true
    refresh()
    if (child.parent === this) removeView(child)
    (child as? EngineSheet)?.scrim?.let { if (it.parent === this) removeView(it) }
    refresh()
  }

  // Transitions ---------------------------------------------------------------------------------------------------

  private fun enterFrom(s: EngineScreen, kind: Int) {
    when (kind) {
      1 -> s.alpha = 0f
      2 -> s.translationX = width.toFloat()
      3 -> s.translationY = height.toFloat()
    }
  }

  private fun exitTo(s: EngineScreen, kind: Int, duration: Long, done: () -> Unit) {
    when (kind) {
      1 -> animate(s, s.translationX, s.translationY, 0f, 1f, duration, done)
      2 -> animate(s, width.toFloat(), s.translationY, s.alpha, 1f, duration, done)
      else -> animate(s, s.translationX, height.toFloat(), s.alpha, 1f, duration, done)
    }
  }

  private fun animate(s: EngineScreen, x: Float, y: Float, alpha: Float, scale: Float, duration: Long, done: () -> Unit) {
    // The moving screen is composited from a layer for the whole animation; taken before the old animation is cancelled so
    // the layer is handed over, not rebuilt.
    s.holdLayer()
    cancelRunning(s)
    val a = s.animate().translationX(x).translationY(y).alpha(alpha).scaleX(scale).scaleY(scale)
      .setDuration(duration).setInterpolator(interpolator)
    var cancelled = false
    a.setListener(object : AnimatorListenerAdapter() {
      override fun onAnimationCancel(animation: Animator) { cancelled = true }
      override fun onAnimationEnd(animation: Animator) {
        s.animate().setListener(null)
        if (s.running === a) s.running = null
        // `done` refreshes the stack, which may make this screen keep its layer as the settled top: that hold is taken
        // before the transition's hold goes, so the layer type never flips and the layer is not rebuilt.
        if (!cancelled) done()
        s.releaseLayer()
      }
    })
    s.running = a
    a.start()
  }

  private fun cancelRunning(s: EngineScreen) {
    (s as? EngineSheet)?.cancelSettle()
    val running = s.running ?: return
    s.running = null
    running.cancel()
  }

  // User dismissal -----------------------------------------------------------------------------------------------

  /** Plays the exit of the top screen from its current position, then tells JavaScript. */
  internal fun dismissTop() {
    val s = top() ?: return
    val kind = s.transitionKind().let { if (it == 0) 2 else it }
    cancelRunning(s)
    s.leaving = true
    s.dismissed = true
    s.transitioning = true
    refresh()
    val remaining = if (kind == 2) 1f - s.translationX / max(1, width) else 1f
    val duration = max(120L, (DURATION * remaining).toLong())
    exitTo(s, kind, duration) {
      s.transitioning = false
      if (s.parent === this) {
        // The screen below appears and this one disappears before JavaScript hears it was dismissed.
        syncAppearance()
        NavEvents.dismissed(s.node.tag)
        postDelayed({ if (s.parent === this && s.dismissed) restore(s) }, RESTORE_MS)
      }
    }
  }

  /** JavaScript did not remove a dismissed screen (the router refused): bring it back. */
  private fun restore(s: EngineScreen) {
    s.leaving = false
    s.dismissed = false
    s.transitioning = true
    refresh()
    animate(s, 0f, s.restY, 1f, 1f, DURATION) { s.transitioning = false; refresh() }
  }

  // Edge swipe back ----------------------------------------------------------------------------------------------

  private fun canDrag(): Boolean {
    val top = top() ?: return false
    return top.gestureEnabled && top.presentation == 0 && top.backDismissal && !top.transitioning && canDismiss()
  }

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = ev.x; downY = ev.y
        edgeCandidate = ev.x <= edge && canDrag()
      }
      MotionEvent.ACTION_MOVE -> if (edgeCandidate && !dragging) {
        val dx = ev.x - downX
        if (dx > slop && dx > abs(ev.y - downY)) {
          startDrag(ev)
          return true
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> edgeCandidate = false
    }
    return false
  }

  private fun startDrag(ev: MotionEvent) {
    var p = parent
    while (p != null) {
      if (p is EngineRoot) { p.cancelActiveTouch(); break }
      p = p.parent
    }
    dragging = true
    dragX = 0f
    top()?.let { holdGesture(it) }
    tracker?.recycle()
    tracker = VelocityTracker.obtain().also { it.addMovement(ev) }
    refresh()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!dragging) return super.onTouchEvent(event)
    tracker?.addMovement(event)
    val top = top()
    when (event.actionMasked) {
      MotionEvent.ACTION_MOVE -> {
        dragX = (event.x - downX).coerceIn(0f, width.toFloat())
        top?.translationX = dragX
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        val t = tracker
        t?.computeCurrentVelocity(1000)
        val velocity = (t?.xVelocity ?: 0f) / density
        t?.recycle()
        tracker = null
        dragging = false
        edgeCandidate = false
        if (top != null && event.actionMasked == MotionEvent.ACTION_UP && (dragX > width / 3f || velocity > FLING_DP)) {
          dismissTop()
        } else if (top != null) {
          top.transitioning = true
          animate(top, 0f, 0f, 1f, 1f, 150L) { top.transitioning = false; refresh() }
          refresh()
        } else refresh()
        // The animation that took over holds its own layer.
        releaseGesture()
      }
    }
    return true
  }

  companion object {
    /** The transition time and deceleration of screens; modal layers use the same ([ModalLayer]). */
    internal const val DURATION = 250L
    internal const val DECELERATION = 1.5f
    private const val EDGE_DP = 24f
    private const val FLING_DP = 800f
    private const val RESTORE_MS = 1500L

    /** Stacks in a window, so a change in front (a modal above tabs, a tab switch) can re-evaluate the back callbacks of the ones behind. */
    private val attached = ArrayList<EngineStack>(4)

    fun refreshBackCallbacks() {
      for (i in attached.indices) attached[i].updateBackCallback()
    }

    /** Runs [syncAppearance] for every stack below [root] (and [root] itself when [self]); outer stacks first. */
    fun syncWithin(root: ViewGroup, self: Boolean = true) {
      if (self && root is EngineStack) root.syncAppearance()
      for (i in 0 until root.childCount) {
        val child = root.getChildAt(i)
        if (child is EngineStack) child.syncAppearance()
        if (child is ViewGroup) syncWithin(child, false)
      }
    }
  }
}
