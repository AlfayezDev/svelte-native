package expo.modules.svelteengine.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.ViewPropertyAnimator
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.activity.findViewTreeOnBackPressedDispatcherOwner
import expo.modules.svelteengine.DownPointer
import expo.modules.svelteengine.GestureRules
import expo.modules.svelteengine.NavEvents
import expo.modules.svelteengine.TransitionRules
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The navigation container (SPEC.md "Navigation"): [EngineScreen] children, the last live one on top.
 *
 * Push: an inserted top screen comes in. A push screen plays a transition between it and the screen below ([system], [TransitionRules]): by default the
 * movement of Android's activity transition (96 dp, 450 ms) with a fade-through, else what its `stackAnimation` names (Android's activity transition as
 * it is, or react-native-screens' fade, slides and fade from the bottom). A modal, a sheet or a form sheet comes from the bottom and a transparent modal
 * fades in, over 250 ms, decelerating ([animate]); `none` skips. Pop: the mutation
 * stream removes the screen, the stack keeps the view attached while its exit plays and detaches it afterwards
 * (Fabric's `delete` only drops the registry entry). A user dismissal (back button, header back button, predictive
 * back, edge swipe, sheet drag or scrim) plays the exit first, then sends `onDismissed`; the removal JavaScript performs
 * next finds the screen marked `dismissed` and detaches it. A sheet's scrim is a view of the stack just below the sheet.
 */
class EngineStack(context: Context) : EngineView(context), NativeClaim {
  private val density = resources.displayMetrics.density
  private val slop = ViewConfiguration.get(context).scaledTouchSlop
  private val edge = EDGE_DP * density
  private val interpolator = DecelerateInterpolator(DECELERATION)
  /** How far the default and the activity transitions move both screens (96 dp), in px. */
  private val shift = TransitionRules.SHIFT_DP * density
  private val edgePaint = Paint()

  private var dragging = false
  private var edgeCandidate = false
  private var downX = 0f
  private var downY = 0f
  /** The pointer of the touch's DOWN: the swipe is measured on it, not on whichever pointer is first once it has lifted (`ClaimRules.kt`). */
  private val downPointer = DownPointer()
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
    s.gesturing = true
    s.holdLayer()
  }

  private fun releaseGesture() {
    gestureScreen?.let { it.gesturing = false; it.releaseLayer() }
    gestureScreen = null
  }

  private val backCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackStarted(backEvent: BackEventCompat) {
      val top = top() ?: return
      if (!top.gestureEnabled || !top.dismissible) return
      freeUnder(top)
      cancelRunning(top)
      // A transition it cut short (a push still fading in) leaves the screen opaque: it follows the gesture whole.
      top.alpha = 1f
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

  /** A screen a transition moves less than the width is drawn on across the strip it uncovers, on the side it moved away from (the framework's `extend`). */
  override fun drawChild(canvas: Canvas, child: View, drawingTime: Long): Boolean {
    val s = child as? EngineScreen
    // Under the screen below a fade-through, the coming screen's surface: what shows while neither screen does.
    s?.silhouette?.let { if (s.visibility == View.VISIBLE) drawSurface(canvas, it, 0f, width.toFloat(), 1f, REACH_ACROSS) }
    val drawn = super.drawChild(canvas, child, drawingTime)
    if (s != null && s.extendsEdge && s.visibility == View.VISIBLE && s.alpha > 0f) drawEdge(canvas, s)
    // A fade-through draws the screen whole and lays the surface it fades against over it, at the opacity the screen lacks ([system]).
    if (s != null && s.veil > 0f && s.visibility == View.VISIBLE && s.alpha > 0f) s.veilOf?.let {
      drawSurface(canvas, it, s.left + s.translationX, s.right + s.translationX, s.veil, REACH_ACROSS, s.top + s.translationY)
    }
    return drawn
  }

  /** The strip in the screen's own colours, on the side it moved away from. */
  private fun drawEdge(canvas: Canvas, s: EngineScreen) {
    val tx = s.translationX
    val x0 = TransitionRules.stripStart(s.left.toFloat(), s.right.toFloat(), tx)
    val x1 = TransitionRules.stripEnd(s.left.toFloat(), s.right.toFloat(), tx)
    if (x1 <= x0) return
    drawSurface(canvas, s, x0, x1, s.alpha * (1f - s.veil), if (tx < 0f) REACH_RIGHT else REACH_LEFT)
  }

  /**
   * [s]'s surface from [x0] to [x1] at [alpha]: its background, then each first-level child that paints a solid one and [reach]es the part drawn (the
   * right edge, the left edge, or across the whole screen), the headers last, down to their visible bottom (a large or translucent header lies over the content).
   * [top] is where the surface's top is drawn: [s]'s own, or that of the screen it is laid over (a veil).
   */
  private fun drawSurface(canvas: Canvas, s: EngineScreen, x0: Float, x1: Float, alpha: Float, reach: Int, top: Float = s.top + s.translationY) {
    // The fills are composited band by band and each band drawn once ([TransitionRules.bands]): at an opacity below 1 (a veil, a fading screen's strip) the
    // fills drawn one by one would let the background show through a header.
    val fills = surfaceFills
    fills.clear()
    fun fill(color: Int?, a: Float, y0: Float, y1: Float) { if (color != null) fills.add(TransitionRules.Fill(y0, y1, color, a)) }
    fill(solidColor(s.background), 1f, top, top + s.height)
    for (pass in 0..1) {
      for (i in 0 until s.childCount) {
        val c = s.getChildAt(i)
        if (c.visibility != View.VISIBLE || (c is EngineHeader) != (pass == 1)) continue
        val reaches = when (reach) {
          REACH_RIGHT -> c.right >= s.width
          REACH_LEFT -> c.left <= 0
          else -> c.left <= 0 && c.right >= s.width
        }
        if (!reaches) continue
        val y = top + c.top + c.translationY
        if (c is EngineHeader) fill(c.edgeColor(), c.alpha, y, y + c.edgeBottom())
        else fill(solidColor(c.background), c.alpha, y, y + c.height)
      }
    }
    for (band in TransitionRules.bands(fills)) fillEdge(canvas, band.color, alpha, x0, band.top, x1, band.bottom)
  }

  private val surfaceFills = ArrayList<TransitionRules.Fill>(8)

  private fun fillEdge(canvas: Canvas, color: Int?, alpha: Float, x0: Float, y0: Float, x1: Float, y1: Float) {
    if (color == null) return
    val a = (Color.alpha(color) * alpha).roundToInt()
    if (a <= 0) return
    edgePaint.color = color
    edgePaint.alpha = a
    canvas.drawRect(x0, y0, x1, y1, edgePaint)
  }

  private fun solidColor(d: Drawable?): Int? = when (d) {
    is ColorDrawable -> d.color
    is GradientDrawable -> d.color?.defaultColor
    else -> null
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
    // A landing may remove the screen (a pop cut short), so the list is taken first.
    val screens = (0 until childCount).mapNotNull { getChildAt(it) as? EngineScreen }
    for (s in screens) land(s)
  }

  /**
   * The stack leaves the window with a transition in flight (the overlay moves to a recreated Activity): the screen lands
   * where the transition was going and the transition's end runs, so what JavaScript waits for (`exited`, `dismissed`, the
   * removal of a popped view) is not lost with the animator. Safe here: the children are detached already, and a removal
   * only touches this group's own list.
   */
  private fun land(s: EngineScreen) {
    val landing = s.landing
    cancelRunning(s)
    landing?.invoke()
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
      s.setHidden(!s.displayNone && ((!s.leaving && (s.activityState == 0 || covered(screens, s))) || s.exited))
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
    child.exited = false
    child.alpha = 1f
    child.translationX = 0f
    child.scaleX = 1f
    child.scaleY = 1f
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
    if (child.activityState == 0) {
      // Mounted already inactive: nothing to animate, it reports its exit at once (SPEC, "Screen exit").
      exitScreen(child)
      return
    }
    val kind = child.transitionKind()
    if (atTop && others.isNotEmpty() && kind != 0 && isLaidOut && width > 0) {
      enterFrom(child, kind)
      child.transitioning = true
      val settled = {
        child.transitioning = false
        (child as? EngineSheet)?.snapToRest()
        refresh()
      }
      if (TransitionRules.paired(kind)) system(child, others.lastOrNull { it.activityState == 2 }?.takeIf { movesUnder(it) }, true, kind, settled)
      else animate(child, 0f, child.restY, 1f, 1f, DURATION, settled)
    }
    refresh()
  }

  /**
   * JavaScript set a mounted screen's `activityState` to 0 (SPEC, "Screen exit"): the screen leaves exactly as a removed
   * one would (the top pushed screen with its exit transition, anything else at once), but the view tree stays attached
   * and hidden until JavaScript removes it, and `topExited` is sent once the stack is at rest again: a turn after the
   * transition's end (after `appear` of the new top and `disappear` of this screen), or at once for a screen with nothing
   * to animate. A screen already leaving (dismissed by the user, or exited) is not animated again.
   */
  fun exitScreen(child: EngineScreen) {
    if (child.exited || child.parent !== this) return
    if (child.dismissed) {
      // The user is dismissing it and JavaScript retired it meanwhile (a back of its own at the same time): the dismissal's
      // end reports the exit (see dismissTop), nothing brings the screen back, and a dismissal that ended already reports now.
      child.dismissed = false
      child.leaving = true
      if (child.running == null) {
        child.exited = true
        refresh()
        post { if (child.parent === this && child.exited) NavEvents.exited(child.node.tag) }
      }
      return
    }
    if (child.leaving) return
    val others = live().filter { it !== child }
    val index = indexOfChild(child)
    var above = false
    for (i in index + 1 until childCount) if (getChildAt(i) is EngineScreen) above = true
    val kind = child.transitionKind()
    val animate = !above && others.isNotEmpty() && kind != 0 && isLaidOut && width > 0 &&
      child.visibility == View.VISIBLE && !child.hidden && child.appeared
    child.leaving = true
    if (!animate) {
      // A screen still entering (popped within its push) stops where it is; hidden, it must not keep fading in.
      cancelRunning(child)
      child.transitioning = false
      child.exited = true
      refresh()
      post { if (child.parent === this && child.exited) NavEvents.exited(child.node.tag) }
      return
    }
    cancelRunning(child)
    child.transitioning = true
    refresh()
    exitTo(child, kind, DURATION) {
      child.transitioning = false
      child.exited = true
      // The screen below appears and this one disappears before JavaScript hears the exit ended.
      refresh()
      post { if (child.parent === this && child.exited) NavEvents.exited(child.node.tag) }
    }
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
    val m = TransitionRules.motion(kind, true)
    if (m != null) {
      val d = distance(m) * m.direction
      if (m.vertical) s.translationY = d else s.translationX = d
      m.top?.let { s.alpha = it.from }
      return
    }
    when (kind) {
      1 -> s.alpha = 0f
      2 -> s.translationX = width.toFloat()
      3 -> s.translationY = height.toFloat()
    }
  }

  /** How far a motion moves the screens, in px. */
  private fun distance(m: TransitionRules.Motion): Float = when (m.unit) {
    TransitionRules.WIDTH -> m.amount * width
    TransitionRules.HEIGHT -> m.amount * height
    else -> m.amount * density
  }

  /** [moveUnder] false: the screen below is in place already (a gesture showed it), so the exit leaves it there. */
  private fun exitTo(s: EngineScreen, kind: Int, duration: Long, moveUnder: Boolean = true, done: () -> Unit) {
    if (TransitionRules.paired(kind)) {
      system(s, if (moveUnder) top()?.takeIf { it !== s && movesUnder(it) } else null, false, kind, done)
      return
    }
    when (kind) {
      1 -> animate(s, s.translationX, s.translationY, 0f, 1f, duration, done)
      2 -> animate(s, width.toFloat(), s.translationY, s.alpha, 1f, duration, done)
      else -> animate(s, s.translationX, height.toFloat(), s.alpha, 1f, duration, done)
    }
  }

  /** A full screen takes part in a transition between two screens; a sheet, a form sheet or a transparent modal stays where it is. */
  private fun movesUnder(u: EngineScreen) = u.presentation <= 1 && u !is EngineSheet && !u.displayNone

  /** [s] is being moved as the screen below another one's transition: that transition lands first, so only one animation moves [s]. */
  private fun freeUnder(s: EngineScreen) {
    s.mover?.let { land(it) }
  }

  /**
   * A transition between [s] and [below], the full screen under it ([TransitionRules.motion] of [kind], SPEC.md "Navigation"): [s] comes in (a push,
   * [entering]) or goes (a pop) from wherever it is. When the motion moves the screen below, it moves the other way, kept a distance from [s] by the same
   * animator ([TransitionRules.underX]); when it fades it, the stack draws the coming screen's surface under both ([drawChild]). A screen that moves less than
   * the width is drawn on across the strip it uncovers. A cancelled transition puts the screen below back in place and whole; one that takes over (a pop
   * during the push) moves and fades it again from where the screens were, in the same frame: how far the push had faded it is read from where the screen on
   * top is ([TransitionRules.resumedFade]).
   */
  private fun system(s: EngineScreen, below: EngineScreen?, entering: Boolean, kind: Int, done: () -> Unit) {
    val m = TransitionRules.motion(kind, entering) ?: run { done(); return }
    // The screen below takes part when the motion moves or fades it.
    val under = below?.takeIf { m.moveUnder || m.under != null }
    // A fade-through (the default) shows one screen at a time, and each fades against the surface the stack draws under both. Both screens are then drawn
    // whole, with no layer, and the stack lays that surface over the one fading at the opacity it lacks ([fade], [drawChild]): the picture the screen's alpha
    // over the surface gives, without a full-screen layer built for each screen and composited every frame. Those layers made the first push of a session
    // spend 20 to 60 ms of one frame building them, and up to 100 ms after other screens had come and gone, and their composites kept the GPU of a Galaxy
    // A16 past the 11 ms of a 90 Hz frame until its clock came up (#111). A screen scaled by a back gesture, or one with no opaque background to lay over the
    // other, keeps the layer and its alpha.
    val veiled = m.fadeThrough && under != null && s.scaleX == 1f && opaque(s) && opaque(under)
    if (!veiled) s.holdLayer()
    freeUnder(s)
    cancelRunning(s)
    val vertical = m.vertical
    val distance = distance(m) * m.direction
    val from = if (vertical) s.translationY else s.translationX
    // A pop that takes over a push in its first 35 % brings the screen below back from where the push had faded it, not from nothing.
    val underFade = m.under?.let { if (entering) it else TransitionRules.resumedFade(it, from, distance) }
    val resumed = underFade !== m.under
    if (under != null) {
      freeUnder(under)
      if (under.running != null) land(under)
      under.mover = s
      under.extendsEdge = m.extend && m.moveUnder
      // The surface under a fade is the coming screen's; a pop that goes on from a push keeps that push's, so the background does not change at the cut.
      under.silhouette = if (underFade == null) null else if (entering || resumed) s else under
      // It moves or fades too: composited from a layer for the transition, as the moving screen is.
      if (!veiled) under.holdLayer()
    }
    var underHeld = under != null && !veiled
    fun releaseUnder() {
      if (!underHeld) return
      underHeld = false
      under?.releaseLayer()
    }
    // Without a screen below taking part (a gesture has shown it in place) there is no strip to draw: the strip would cover what the gesture showed.
    s.extendsEdge = m.extend && under != null
    // A pop goes on from where a gesture left the screen, never back towards its place.
    val to = when {
      entering -> 0f
      vertical -> distance
      distance >= 0f -> max(distance, from)
      else -> min(distance, from)
    }
    val fromAlpha = s.alpha
    // Predictive back scales the screen down; the exit brings it back to 1 as the other transitions do, so a screen shown again is whole.
    val fromScale = s.scaleX
    fun frame(f: Float) {
      // The default's fade-through follows the movement's progress, as Material's fades do, so the screen going away is gone by about 70 ms.
      val p = TransitionRules.curve(m.curve, f)
      val ms = f * m.durationMs
      val at = from + (to - from) * p
      if (vertical) s.translationY = at else s.translationX = at
      if (fromScale != 1f) { s.scaleX = fromScale + (1f - fromScale) * p; s.scaleY = s.scaleX }
      m.top?.let {
        val shown = if (entering) it.at(ms, p) else fromAlpha * it.at(ms, p)
        if (veiled) fade(s, shown, under?.silhouette) else s.alpha = shown
      }
      if (under != null) {
        if (m.moveUnder) under.translationX = TransitionRules.underX(s.translationX, distance)
        // A screen below that JavaScript took away meanwhile (hidden by the stack) stays hidden.
        if (underFade != null && !under.hidden) {
          val shown = underFade.at(ms, p)
          if (veiled) fade(under, shown, under.silhouette) else under.alpha = shown
        }
      }
      // The strips are drawn by the stack, from where the screens are now.
      invalidate()
    }
    fun putBack() {
      if (under == null || (under.mover != null && under.mover !== s)) return
      under.mover = null
      under.extendsEdge = false
      under.silhouette = null
      under.veil = 0f
      under.veilOf = null
      under.translationX = 0f
      // Whole again: a push's end has hidden it (refresh) and it stays so; anything else shows it.
      under.alpha = if (under.hidden) 0f else 1f
    }
    val a = ValueAnimator.ofFloat(0f, 1f).setDuration(m.durationMs)
    a.interpolator = LinearInterpolator()
    a.addUpdateListener { frame(it.animatedFraction) }
    var cancelled = false
    a.addListener(object : AnimatorListenerAdapter() {
      override fun onAnimationCancel(animation: Animator) { cancelled = true }
      override fun onAnimationEnd(animation: Animator) {
        if (s.running === a) { s.running = null; s.landing = null }
        s.extendsEdge = false
        // A transition that takes over goes on from how far this one had faded the screen in.
        if (cancelled && s.veil > 0f) s.alpha *= 1f - s.veil
        s.veil = 0f
        s.veilOf = null
        // A push's end hides the screen below (refresh) before it goes back in place, so it is never seen jumping.
        if (!cancelled) done()
        putBack()
        releaseUnder()
        invalidate()
        if (!veiled) s.releaseLayer()
      }
    })
    s.running = a
    s.landing = {
      if (vertical) s.translationY = to else s.translationX = to
      s.veil = 0f
      s.veilOf = null
      s.alpha = if (entering) 1f else m.top?.let { fromAlpha * it.to } ?: s.alpha
      s.scaleX = 1f
      s.scaleY = 1f
      s.extendsEdge = false
      done()
      putBack()
      releaseUnder()
    }
    frame(0f)
    a.start()
  }

  /** A screen of a fade-through [shown] this far (0 out of sight, 1 whole): drawn whole under [surface] laid over it at the rest ([drawChild]), or not at all. */
  private fun fade(x: EngineScreen, shown: Float, surface: EngineScreen?) {
    x.alpha = if (shown <= 0f) 0f else 1f
    x.veil = if (shown <= 0f || shown >= 1f) 0f else 1f - shown
    x.veilOf = surface
  }

  /** The screen's own background is an opaque colour: its surface, laid over another screen, hides that one completely. */
  private fun opaque(x: EngineScreen): Boolean {
    val d = x.background
    // Rounded corners let what is under the screen show at them, where a veil would lay the surface.
    if (d is GradientDrawable && (d.cornerRadius > 0f || d.cornerRadii != null)) return false
    return solidColor(d)?.let { Color.alpha(it) == 255 } == true
  }

  private fun animate(s: EngineScreen, x: Float, y: Float, alpha: Float, scale: Float, duration: Long, done: () -> Unit) {
    // The moving screen is composited from a layer for the whole animation; taken before the old animation is cancelled so
    // the layer is handed over, not rebuilt.
    s.holdLayer()
    freeUnder(s)
    cancelRunning(s)
    val a = s.animate().translationX(x).translationY(y).alpha(alpha).scaleX(scale).scaleY(scale)
      .setDuration(duration).setInterpolator(interpolator)
    var cancelled = false
    a.setListener(object : AnimatorListenerAdapter() {
      override fun onAnimationCancel(animation: Animator) { cancelled = true }
      override fun onAnimationEnd(animation: Animator) {
        s.animate().setListener(null)
        if (s.running === a) { s.running = null; s.landing = null }
        // `done` refreshes the stack, which may make this screen keep its layer as the settled top: that hold is taken
        // before the transition's hold goes, so the layer type never flips and the layer is not rebuilt.
        if (!cancelled) done()
        s.releaseLayer()
      }
    })
    s.running = a
    s.landing = {
      s.translationX = x
      s.translationY = y
      s.alpha = alpha
      s.scaleX = scale
      s.scaleY = scale
      done()
    }
    a.start()
  }

  private fun cancelRunning(s: EngineScreen) {
    (s as? EngineSheet)?.cancelSettle()
    s.landing = null
    val running = s.running ?: return
    s.running = null
    when (running) {
      is ViewPropertyAnimator -> running.cancel()
      is Animator -> running.cancel()
    }
  }

  // User dismissal -----------------------------------------------------------------------------------------------

  /** Plays the exit of the top screen from its current position, then tells JavaScript. */
  internal fun dismissTop(dragged: Boolean = false) {
    val s = top() ?: return
    var kind = s.transitionKind().let { if (it == 0) 2 else it }
    // A gesture (predictive back, the edge swipe) has shown the screen below in place: the exit leaves it there, and goes the way the gesture moved the
    // screen, to the right. A screen of the default or the activity transition moves on and fades out, unless the edge swipe ([dragged]) took it further
    // than their 96 dp; any other screen slides off across the width (a slide_from_left screen would otherwise sweep left against the finger).
    val byGesture = s.gesturing
    val small = kind == TransitionRules.KIND_DEFAULT || kind == TransitionRules.KIND_ACTIVITY
    if (byGesture && TransitionRules.paired(kind) && (!small || (dragged && TransitionRules.exitsAcross(s.translationX, shift)))) kind = 2
    freeUnder(s)
    cancelRunning(s)
    s.leaving = true
    s.dismissed = true
    s.transitioning = true
    refresh()
    val remaining = if (kind == 2) 1f - s.translationX / max(1, width) else 1f
    val duration = max(120L, (DURATION * remaining).toLong())
    exitTo(s, kind, duration, moveUnder = !byGesture) {
      s.transitioning = false
      if (s.parent !== this) return@exitTo
      if (!s.dismissed) {
        // JavaScript retired the screen while the user dismissed it (exitScreen): it waits for the exit, not a dismissal.
        s.exited = true
        refresh()
        post { if (s.parent === this && s.exited) NavEvents.exited(s.node.tag) }
        return@exitTo
      }
      // The screen below appears and this one disappears before JavaScript hears it was dismissed.
      syncAppearance()
      NavEvents.dismissed(s.node.tag)
      postDelayed({ if (s.parent === this && s.dismissed) restore(s) }, RESTORE_MS)
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

  /**
   * A drag that went [dx], [dy] from the touch-down is the edge swipe when it started in the edge zone, has covered a touch slop
   * (as far as a default Pan's `minDist`, so that the two reach it on the same move) and goes mostly to the right, and the top screen can still be
   * dragged then (a push may have started since the touch went down: the swipe must not move a screen a transition is moving).
   */
  private fun swipesBack(dx: Float, dy: Float) = edgeCandidate && !dragging && GestureRules.edgeSwipe(dx, dy, slop.toFloat()) && canDrag()

  override fun claims(dx: Float, dy: Float) = swipesBack(dx, dy)

  override fun claim(ev: MotionEvent) = startDrag(ev)

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    // A drag that the root claimed before the gesture handlers saw the move: Android cancels the child now.
    if (dragging && ev.actionMasked != MotionEvent.ACTION_DOWN) return true
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downPointer.down(ev.getPointerId(0))
        downX = ev.x; downY = ev.y
        edgeCandidate = ev.x <= edge && canDrag()
        GestureTrace.log { "stack down: edge candidate=$edgeCandidate" }
      }
      MotionEvent.ACTION_MOVE -> if (edgeCandidate && !dragging) {
        // The finger that went down in the edge zone, wherever it is in this event; once it has lifted there is no swipe to measure.
        val index = ev.findPointerIndex(downPointer.id)
        if (index < 0) return false
        val dx = ev.getX(index) - downX
        GestureTrace.log { "stack move: dx=${dx / density} dp (slop ${slop / density})" }
        if (swipesBack(dx, ev.getY(index) - downY)) {
          GestureTrace.log { "stack takes the edge swipe" }
          startDrag(ev)
          return true
        }
      }
      MotionEvent.ACTION_POINTER_UP -> {
        downPointer.up(ev.getPointerId(ev.actionIndex))
        if (!downPointer.present) edgeCandidate = false
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { edgeCandidate = false; downPointer.clear() }
    }
    return false
  }

  private fun startDrag(ev: MotionEvent) {
    var p = parent
    while (p != null) {
      if (p is EngineRoot) { p.cancelActiveTouch(); break }
      p = p.parent
    }
    // The touch lock, like a scroll view's drag and the sheet's: it cancels every gesture handler of the root (a pan under the
    // swipe would otherwise stay alive next to it) and keeps an ancestor scroll view from taking the gesture. Given back
    // when the drag ends.
    parent?.requestDisallowInterceptTouchEvent(true)
    dragging = true
    dragX = 0f
    top()?.let { freeUnder(it); holdGesture(it) }
    tracker?.recycle()
    tracker = VelocityTracker.obtain().also { it.addMovement(ev) }
    refresh()
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!dragging) return super.onTouchEvent(event)
    tracker?.addMovement(event)
    val top = top()
    when (event.actionMasked) {
      MotionEvent.ACTION_POINTER_UP -> downPointer.up(event.getPointerId(event.actionIndex))
      MotionEvent.ACTION_MOVE -> {
        // The drag follows the finger that started it; while that finger is up the screen stays where it was left.
        val index = event.findPointerIndex(downPointer.id)
        if (index >= 0) {
          dragX = (event.getX(index) - downX).coerceIn(0f, width.toFloat())
          top?.translationX = dragX
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        val t = tracker
        t?.computeCurrentVelocity(1000)
        val velocity = (t?.xVelocity ?: 0f) / density
        t?.recycle()
        tracker = null
        dragging = false
        edgeCandidate = false
        downPointer.clear()
        parent?.requestDisallowInterceptTouchEvent(false)
        if (top != null && event.actionMasked == MotionEvent.ACTION_UP && (dragX > width / 3f || velocity > FLING_DP)) {
          dismissTop(dragged = true)
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
    /** What part of a screen's surface [drawSurface] draws children for: those along its right edge, along its left edge, or across it. */
    private const val REACH_RIGHT = 0
    private const val REACH_LEFT = 1
    private const val REACH_ACROSS = 2

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
