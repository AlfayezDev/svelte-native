package expo.modules.svelteengine.views

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.view.animation.DecelerateInterpolator
import android.widget.ScrollView
import expo.modules.svelteengine.ChromeRules
import expo.modules.svelteengine.DownPointer
import expo.modules.svelteengine.GestureRules
import expo.modules.svelteengine.NavEvents
import expo.modules.svelteengine.NavProps
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * A `sheet` or `formSheet` screen (SPEC.md "Native screens, Android"). The screen's Yoga box is bottom anchored and as
 * tall as the tallest detent; the sheet moves that box up and down between detents with its own drag and never resizes
 * it, so the content keeps one layout and only its visible part changes. The stack slides the sheet in and out; the
 * scrim is a view of the stack right under it, its alpha follows the sheet's position.
 *
 * Drag: a vertical drag that starts anywhere in the box moves the sheet unless a scroll view under the finger can still
 * scroll that way (a scroll view at its top hands a downward drag over; below the top detent an upward drag moves the
 * sheet first). Release snaps to the nearest detent, a fling over 1000 dp/s goes to the next one in its direction; past
 * a quarter of the lowest detent below it, or a fling down from it, the sheet is dismissed when it is dismissible.
 */
class EngineSheet(context: Context) : EngineScreen(context), NativeClaim {
  private val density = resources.displayMetrics.density
  private val slop = ViewConfiguration.get(context).scaledTouchSlop
  private val interpolator = DecelerateInterpolator(1.5f)
  private val corner = CORNER_DP * density

  /** Heights as fractions of the available height, -1 for "auto" (the box's own height); as given, not sorted. */
  private var detents = floatArrayOf(0.5f, 1f)
  private var initialIndex = 0
  private var grabber = true
  private var dismissibleFlag = true
  var backdropNone = false
    private set
  /** The detent (index into [detents]) the sheet rests at. */
  private var current = 0
  private var reported = 0
  private var configured = false

  /** Dimming view of the stack, just under the sheet; only part of the stack's children while the sheet has a backdrop. */
  val scrim: View = object : View(context) {
    // A solid color: its alpha needs no offscreen layer, which would otherwise be composited for the whole stack's width and height.
    override fun hasOverlappingRendering(): Boolean = false
  }.apply {
    setBackgroundColor(Color.BLACK)
    alpha = 0f
    isClickable = true
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    setOnClickListener { if (dismissibleFlag) stack?.dismissTop() }
  }

  private val grabberPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x66808080 }
  private val grabberRect = RectF()

  private var settler: ValueAnimator? = null
  private var dragging = false
  /** The drag holds the sheet's layer until the settle (or the dismissal) that follows has its own. */
  private var dragLayer = false
  private var downX = 0f
  private var downY = 0f
  /** The pointer of the touch's DOWN: the drag is measured on it, not on whichever pointer is first once it has lifted (`ClaimRules.kt`). */
  private val downPointer = DownPointer()
  private var startTranslation = 0f
  private var scrollUnderFinger: ScrollView? = null
  // Recent finger positions (screen px) for the release velocity: translation moves the view, so view coordinates would cancel out.
  private val sampleTime = LongArray(SAMPLES)
  private val sampleY = FloatArray(SAMPLES)
  private var samples = 0

  private val preDraw = ViewTreeObserver.OnPreDrawListener {
    updateScrim()
    syncToolbar()
    true
  }

  /** How far the toolbar band sits above its Yoga place, px ([syncToolbar]); NaN until it was first placed. */
  private var toolbarShift = Float.NaN

  init {
    setWillNotDraw(false)
    outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {
        // The box is rounded at the top only: the bottom corners are pushed out of the box.
        outline.setRoundRect(0, 0, view.width, view.height + corner.toInt(), corner)
      }
    }
    clipToOutline = true
  }

  override val dismissible: Boolean get() = dismissibleFlag

  override fun apply(p: NavProps) {
    super.apply(p)
    if (!p.sheetSeen || p.detents.isEmpty()) return
    val changed = !configured || !p.detents.contentEquals(detents) || p.initialDetent != initialIndex
    detents = p.detents
    initialIndex = min(max(0, p.initialDetent), detents.size - 1)
    val grabberChanged = grabber != p.grabber
    grabber = p.grabber
    dismissibleFlag = p.dismissible
    backdropNone = p.backdropNone
    scrim.isClickable = !backdropNone
    scrim.visibility = if (backdropNone) GONE else VISIBLE
    if (grabberChanged) invalidate()
    if (changed) {
      configured = true
      // New detents, or the first ones: back to the initial detent unless the user is mid-drag.
      if (!dragging) {
        current = min(initialIndex, detents.size - 1)
        reported = current
        moveToRest(false)
      }
    }
  }

  // Geometry --------------------------------------------------------------------------------------------------------

  /** Height below the top inset, px: what the detent fractions are fractions of. Read at layout and when a drag starts, not per touch event. */
  private var availableCache = -1

  private fun refreshAvailable() {
    val st = stack ?: return
    val top = SafeArea.top(st)
    topSeen = top ?: -1
    availableCache = max(0, st.height - (top ?: 0))
  }

  /** The status bar inset (px, -1 for none) [available] was last worked out with. */
  private var topSeen = -1

  // The window dispatches insets again when they change: the detents are fractions of the height below the status bar, so the sheet lays out again when it moved.
  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    if (ChromeRules.insetStale(topSeen, stack?.let { SafeArea.top(it) })) requestLayout()
    return super.onApplyWindowInsets(insets)
  }

  private fun available(): Int {
    if (availableCache < 0) refreshAvailable()
    return max(0, availableCache)
  }

  /** The visible height of detent [index], px: a fraction of the available height, or the whole box for "auto". */
  private fun visibleFor(index: Int): Int {
    val box = node.h
    val avail = available()
    if (box <= 0 || avail <= 0) return box
    val d = detents[index]
    return if (d < 0f) min(box, avail) else min(box, max(1, (d * avail).roundToInt()))
  }

  private fun offsetFor(index: Int): Float = max(0, node.h - visibleFor(index)).toFloat()

  /** Where detent [index] is now, for a settle that began with it: the detents may have been replaced since, and an index must not read past them. */
  private fun offsetAt(index: Int): Float = if (detents.isEmpty()) 0f else offsetFor(min(index, detents.size - 1))

  override val restY: Float get() = if (detents.isEmpty()) 0f else offsetFor(min(current, detents.size - 1))

  // Every write of the translation (a drag, a settle, the rest, the stack's own) goes through here; the stack's animator does
  // not, and the pre-draw pass catches that one.
  override fun setTranslationY(translationY: Float) {
    super.setTranslationY(translationY)
    syncToolbar()
  }

  /**
   * The toolbar band is the bottom of the Yoga box, whose height is the tallest detent; the sheet shows only the box's top
   * `height - translationY` rows, so at a lower detent the band would sit below the visible part. It is moved up by how far
   * the sheet is moved down (`translationY` of the band, inside the sheet's own layer, so it travels with the sheet in every
   * transition and keeps the hit test and the accessibility bounds right): its bottom edge is the sheet's visible bottom, at the
   * detent it rests at, follows the detent as the sheet settles, and follows a drag between the top detent and the lowest one
   * (below the lowest the whole sheet moves down, bar included; above the top the resistance does not move it). While the stack
   * plays an enter or an exit the band stays where the sheet rests (or last was); the band's own layout stays Yoga's, so its
   * inset (`SafeArea.bottom`, read from layout positions) is that of the screen's bottom edge, which is where the visible bottom is.
   */
  internal fun syncToolbar() {
    val bar = toolbar ?: return
    val box = node.h
    if (box <= 0 || detents.isEmpty()) return
    val wanted = when {
      dragging || settler != null -> translationY
      (transitioning || leaving) && !toolbarShift.isNaN() -> toolbarShift
      else -> restY
    }
    val shift = wanted.coerceIn(topOffset(), sortedLowestOffset()).coerceAtMost(max(0, box - bar.height).toFloat())
    toolbarShift = shift
    if (bar.translationY != -shift) bar.translationY = -shift
  }

  private fun topOffset(): Float {
    var top = Float.MAX_VALUE
    for (i in detents.indices) top = min(top, offsetFor(i))
    return if (top == Float.MAX_VALUE) 0f else top
  }

  /** Offsets of every distinct detent, top-most (smallest) first. */
  private fun sortedOffsets(): FloatArray {
    val list = ArrayList<Float>(detents.size)
    for (i in detents.indices) {
      val o = offsetFor(i)
      if (list.none { abs(it - o) < 1f }) list.add(o)
    }
    list.sort()
    return list.toFloatArray()
  }

  private fun indexForOffset(offset: Float): Int {
    var best = 0
    var distance = Float.MAX_VALUE
    for (i in detents.indices) {
      val d = abs(offsetFor(i) - offset)
      if (d < distance) { distance = d; best = i }
    }
    return best
  }

  /** Something else moves the sheet: a drag or its settle, a transition of the stack (the animation that cancels a back gesture included), a gesture of the stack. */
  private val busy: Boolean get() = dragging || settler != null || transitioning || leaving || running != null || gesturing

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    refreshAvailable()
    // An idle sheet rests where the layout says, not only after its own frame changed: it is inserted (and laid out detached) before its stack has a
    // size or the window a status bar, and the layouts that follow, with the same frame, work the rest out and found the sheet somewhere else. Where the
    // sheet is is read from its translation, not remembered: a settle, a snap and a move to the rest all end there.
    val rest = restY
    if (ChromeRules.sheetMoves(translationY, rest, changed, busy)) translationY = rest
  }

  /** The enter transition ended: rest at the detent the sheet has by now (new detents may have arrived while it ran). */
  fun snapToRest() {
    if (!dragging && settler == null) translationY = restY
  }

  private fun moveToRest(animated: Boolean) {
    if (leaving || transitioning || dragging) return
    val target = restY
    if (!animated || !isAttachedToWindow) {
      cancelSettle()
      translationY = target
    } else {
      settleTo(target)
    }
  }

  // Scrim and grabber -----------------------------------------------------------------------------------------------

  private fun updateScrim() {
    if (backdropNone) return
    val box = node.h
    if (box <= 0 || detents.isEmpty()) return
    val lowest = box - sortedLowestOffset()
    val visible = box - translationY
    val fraction = if (lowest <= 0f) 0f else (visible / lowest).coerceIn(0f, 1f)
    val alpha = DIM * fraction
    if (scrim.alpha != alpha) scrim.alpha = alpha
  }

  private fun sortedLowestOffset(): Float {
    var lowest = 0f
    for (i in detents.indices) lowest = max(lowest, offsetFor(i))
    return lowest
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    availableCache = -1
    viewTreeObserver.addOnPreDrawListener(preDraw)
    // The first layout ran detached, where there is no stack to take the height from and no window to take the status bar from: lay out again once
    // attached, so the rest is worked out with both (the toolbar and the header do the same).
    requestLayout()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    viewTreeObserver.removeOnPreDrawListener(preDraw)
    cancelSettle()
    endDragLayer()
  }

  override fun dispatchDraw(canvas: Canvas) {
    super.dispatchDraw(canvas)
    if (grabber) {
      val w = GRABBER_W_DP * density
      val h = GRABBER_H_DP * density
      val left = (width - w) / 2f
      val top = GRABBER_TOP_DP * density
      grabberRect.set(left, top, left + w, top + h)
      canvas.drawRoundRect(grabberRect, h / 2f, h / 2f, grabberPaint)
    }
  }

  // Drag ------------------------------------------------------------------------------------------------------------

  /** Stops a settle in progress (the stack starts its own transition, or the sheet is going away). */
  fun cancelSettle() {
    settler?.let {
      settler = null
      it.cancel()
    }
  }

  private fun scrollAt(x: Float, y: Float): ScrollView? = findScroll(this, x, y)

  private fun findScroll(group: ViewGroup, x: Float, y: Float): ScrollView? {
    for (i in group.childCount - 1 downTo 0) {
      val c = group.getChildAt(i)
      if (c.visibility != VISIBLE) continue
      val cx = x + group.scrollX - c.left
      val cy = y + group.scrollY - c.top
      if (cx < 0f || cy < 0f || cx >= c.width || cy >= c.height) continue
      if (c is ScrollView) return c
      if (c is ViewGroup) findScroll(c, cx, cy)?.let { return it }
    }
    return null
  }

  /** A finger that went [dx], [dy] from the touch-down starts the sheet's drag: mostly vertical, a touch slop far (a default Pan's `minDist`, so that the two reach it on the same move), and not for a scroll view that can still move. */
  private fun dragsSheet(dx: Float, dy: Float) = GestureRules.sheetDrag(dx, dy, slop.toFloat()) && shouldTake(dy > 0f)

  override fun claims(dx: Float, dy: Float) = !transitioning && !leaving && !dragging && dragsSheet(dx, dy)

  override fun claim(ev: MotionEvent) = startDrag(ev)

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    // The stack's own transition owns the translation while it runs.
    if (transitioning || leaving) return false
    // A drag that the root claimed before the gesture handlers saw the move: Android cancels the child now.
    if (dragging && ev.actionMasked != MotionEvent.ACTION_DOWN) return true
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downPointer.down(ev.getPointerId(0))
        downX = ev.rawX; downY = ev.rawY
        scrollUnderFinger = scrollAt(ev.x, ev.y)
        samples = 0
        addSample(ev)
      }
      MotionEvent.ACTION_MOVE -> if (!dragging) {
        // The finger that went down, wherever it is in this event; once it has lifted there is no drag to measure.
        val index = ev.findPointerIndex(downPointer.id)
        if (index < 0) return false
        val dx = rawX(ev, index) - downX
        val dy = rawY(ev, index) - downY
        GestureTrace.log { "sheet move: dy=${dy / density} dp (slop ${slop / density}), scroll under finger=${scrollUnderFinger != null}" }
        if (dragsSheet(dx, dy)) {
          GestureTrace.log { "sheet takes the drag at translation ${translationY / density} dp" }
          startDrag(ev)
          return true
        }
      }
      MotionEvent.ACTION_POINTER_UP -> downPointer.up(ev.getPointerId(ev.actionIndex))
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> downPointer.clear()
    }
    return false
  }

  /** A scroll view that can still move the way the finger goes keeps the drag; otherwise the sheet takes it. */
  private fun shouldTake(down: Boolean): Boolean {
    val scroll = scrollUnderFinger
    val offsets = sortedOffsets()
    if (down) return scroll == null || scroll.scrollY <= 0
    // Dragging up: the sheet first, until it is at its top detent; then the content scrolls.
    return translationY > offsets.first() + 1f || scroll == null
  }

  private fun startDrag(ev: MotionEvent) {
    var p = parent
    while (p != null) {
      if (p is EngineRoot) { p.cancelActiveTouch(); break }
      p = p.parent
    }
    cancelSettle()
    refreshAvailable()
    stack?.parent?.requestDisallowInterceptTouchEvent(true)
    dragging = true
    if (!dragLayer) { dragLayer = true; holdLayer() }
    startTranslation = translationY
    downY = rawY(ev, max(ev.findPointerIndex(downPointer.id), 0))
  }

  /** Screen position of pointer [index]: `rawX`/`rawY` are pointer 0's, and every pointer of an event is offset by the same amount (`getRawX(int)` is API 29). */
  private fun rawX(ev: MotionEvent, index: Int) = ev.rawX + (ev.getX(index) - ev.getX(0))

  private fun rawY(ev: MotionEvent, index: Int) = ev.rawY + (ev.getY(index) - ev.getY(0))

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!dragging) return super.onTouchEvent(event)
    addSample(event)
    when (event.actionMasked) {
      MotionEvent.ACTION_POINTER_UP -> downPointer.up(event.getPointerId(event.actionIndex))
      MotionEvent.ACTION_MOVE -> {
        // The drag follows the finger that started it; while that finger is up the sheet stays where it was left.
        val index = event.findPointerIndex(downPointer.id)
        if (index >= 0) {
          val offsets = sortedOffsets()
          val top = offsets.first()
          var y = startTranslation + (rawY(event, index) - downY)
          // Resistance above the top detent; the box never goes below its own bottom.
          if (y < top) y = top - (top - y) * RESISTANCE
          translationY = min(y, node.h.toFloat())
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        downPointer.clear()
        dragging = false
        stack?.parent?.requestDisallowInterceptTouchEvent(false)
        settle(if (event.actionMasked == MotionEvent.ACTION_UP) velocity() else 0f)
        endDragLayer()
      }
    }
    return true
  }

  private fun endDragLayer() {
    if (!dragLayer) return
    dragLayer = false
    releaseLayer()
  }

  private fun addSample(ev: MotionEvent) {
    val index = ev.findPointerIndex(downPointer.id)
    if (index < 0) return
    val i = samples % SAMPLES
    sampleTime[i] = ev.eventTime
    sampleY[i] = rawY(ev, index)
    samples++
  }

  /** Vertical velocity of the finger over the last 100 ms, px/s, positive downwards. */
  private fun velocity(): Float {
    if (samples < 2) return 0f
    val n = min(samples, SAMPLES)
    val last = (samples - 1) % SAMPLES
    val lastTime = sampleTime[last]
    var firstIndex = last
    for (k in 1 until n) {
      val i = ((samples - 1 - k) % SAMPLES + SAMPLES) % SAMPLES
      if (lastTime - sampleTime[i] > VELOCITY_WINDOW_MS) break
      firstIndex = i
    }
    val dt = lastTime - sampleTime[firstIndex]
    return if (dt <= 0L) 0f else (sampleY[last] - sampleY[firstIndex]) / dt * 1000f
  }

  private fun settle(velocity: Float) {
    val stack = stack ?: return
    val offsets = sortedOffsets()
    val y = translationY
    val lowest = offsets.last()
    val lowestVisible = node.h - lowest
    var target = offsets.minByOrNull { abs(it - y) } ?: lowest
    var dismiss = false
    if (abs(velocity) > FLING_DP * density) {
      if (velocity > 0f) {
        val next = offsets.firstOrNull { it > y + 1f }
        if (next == null) dismiss = true else target = next
      } else {
        target = offsets.lastOrNull { it < y - 1f } ?: offsets.first()
      }
    } else if (y - lowest > lowestVisible * DISMISS_FRACTION) {
      dismiss = true
    }
    GestureTrace.log { "sheet release: y=${y / density} dp, offsets=${offsets.joinToString { "%.0f".format(it / density) }} dp, velocity=${velocity / density} dp/s, target=${target / density} dp, dismiss=$dismiss" }
    if (dismiss && dismissibleFlag) {
      stack.dismissTop()
      return
    }
    if (dismiss) target = lowest
    settleTo(target)
  }

  private fun settleTo(target: Float) {
    // The layer is taken before the old settle is cancelled, so it is handed over.
    holdLayer()
    cancelSettle()
    // The settle goes to a detent, not to a place: a layout during it (the window was resized) moves the detent, and the settle follows it and ends where it is by then.
    val index = indexForOffset(target)
    val from = translationY
    val animator = ValueAnimator.ofFloat(0f, 1f).setDuration(SETTLE_MS)
    animator.interpolator = interpolator
    animator.addUpdateListener { translationY = ChromeRules.settleAt(from, offsetAt(index), it.animatedValue as Float) }
    animator.addListener(object : AnimatorListenerAdapter() {
      private var cancelled = false
      override fun onAnimationCancel(animation: Animator) { cancelled = true }
      override fun onAnimationEnd(animation: Animator) {
        if (settler === animation) settler = null
        releaseLayer()
        if (cancelled) return
        translationY = offsetAt(index)
        current = index
        // The band follows the detent the sheet now rests at (the write above still saw the old one).
        syncToolbar()
        if (index != reported) {
          reported = index
          val avail = available()
          val fraction = if (avail > 0) visibleFor(index).toFloat() / avail else 1f
          NavEvents.detentChange(node.tag, index, fraction)
        }
      }
    })
    settler = animator
    animator.start()
  }

  private companion object {
    const val CORNER_DP = 28f
    const val GRABBER_W_DP = 32f
    const val GRABBER_H_DP = 4f
    const val GRABBER_TOP_DP = 8f
    const val DIM = 0.32f
    const val FLING_DP = 1000f
    const val DISMISS_FRACTION = 0.25f
    const val RESISTANCE = 0.2f
    const val SETTLE_MS = 220L
    const val SAMPLES = 8
    const val VELOCITY_WINDOW_MS = 100L
  }
}
