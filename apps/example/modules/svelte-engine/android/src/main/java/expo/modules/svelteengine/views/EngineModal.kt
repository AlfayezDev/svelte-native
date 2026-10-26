package expo.modules.svelteengine.views

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.os.Trace
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.view.accessibility.AccessibilityEvent
import android.view.animation.DecelerateInterpolator
import android.view.inputmethod.InputMethodManager
import androidx.activity.OnBackPressedCallback
import androidx.activity.findViewTreeOnBackPressedDispatcherOwner
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.svelteengine.ViewEvents
import expo.modules.svelteengine.ViewProps
import kotlin.math.abs
import kotlin.math.max

/**
 * Modal host (component "ModalHostView"). It sits in the engine tree as a frame without content: its children, as far as
 * the mutation stream is concerned, live in the content of its [ModalLayer], exactly like ReactModalHostView forwards
 * addView/removeView to its DialogRootViewGroup.
 *
 * `visible` puts the layer on top of the [EngineRoot] (above screens, sheets and headers); no window is created. The
 * layer is built with the host and kept: a show adds it to the root, a hide takes it off after its exit animation.
 */
class EngineModal(context: Context, root: EngineRoot) : ViewGroup(context), EngineNode {
  override val node = NodeState()

  private val layer = ModalLayer(context, this, root)

  fun apply(v: ViewProps) {
    // The frame is not for hit testing: the content lives in the layer.
    node.pointer = 1
    layer.configure(v.animationType, v.transparent, v.statusBarTranslucent, v.navigationBarTranslucent)
    if (v.visible) layer.show() else layer.hide()
  }

  /** The view was deleted from the tree: the layer comes off at once. */
  fun onDrop() = layer.drop()

  // Children belong to the layer's content.
  override fun addView(child: View?, index: Int) = layer.content.addView(child, index)
  override fun getChildCount(): Int = layer.content.childCount
  override fun getChildAt(index: Int): View? = layer.content.getChildAt(index)
  override fun removeView(child: View?) = layer.content.removeView(child)
  override fun removeViewAt(index: Int) = layer.content.removeViewAt(index)
  override fun addChildrenForAccessibility(outChildren: ArrayList<View>) {}
  override fun dispatchPopulateAccessibilityEvent(event: AccessibilityEvent): Boolean = false

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {}
}

/**
 * The modal's overlay layer: a full-screen [EngineView] that is the last child of the [EngineRoot] while the modal is
 * visible, so it draws, hit tests and takes the back key above everything else. Inside it: the scrim (the dim of a modal
 * that is not transparent) and the [ModalContent] holding the modal's children, inset by the system bars unless the modal
 * says it is translucent under them (and by the keyboard).
 *
 * It is not a node of the Fabric tree (tag 0): a touch that lands on the layer itself (the scrim, empty space) is held
 * by [EngineRoot] and reported to nobody, so nothing below the modal can be reached while it is up. The back key sends
 * `onRequestClose`; a tap on the scrim does nothing (React Native's Dialog behaves the same on Android), only the back key
 * and `visible = false` close a modal. Shows and hides animate with the stack's time and curve ([EngineStack.DURATION],
 * [EngineStack.DECELERATION]): slide moves the content up from the bottom edge while the dim fades in, fade fades the whole layer, none
 * is immediate. Which step follows a state change is [ModalLayout.Phase].
 */
internal class ModalLayer(context: Context, private val owner: EngineModal, private val root: EngineRoot) : EngineView(context) {
  val content = ModalContent(context, owner)
  private val scrim = View(context).apply {
    setBackgroundColor(Color.BLACK)
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  private val phase = ModalLayout.Phase()
  private val look = ModalLayout.Pose()
  private val interpolator = DecelerateInterpolator(EngineStack.DECELERATION)
  private var animationType = ModalLayout.ANIMATION_NONE
  private var transparent = false
  private var statusBarTranslucent = false
  private var navigationBarTranslucent = false
  /** 0 hidden, 1 shown; what the animation moves. */
  private var progress = 0f
  private var animator: ValueAnimator? = null

  // System bars and keyboard the layer reaches into (left, top, right, bottom, keyboard), as of the last measure.
  private val edges = IntArray(5)
  private val next = IntArray(5)
  private val inset = IntArray(4)
  private val location = IntArray(2)

  /** Shown or on its way in: takes touches, the back key and accessibility focus. */
  val active: Boolean get() = phase.active

  private val backCallback = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      ViewEvents.modal(owner.node.tag, ViewEvents.MODAL_REQUEST_CLOSE)
    }
  }

  /** `onShow` goes out once the layer has been laid out for its first frame. */
  private val firstFrame = object : ViewTreeObserver.OnPreDrawListener {
    override fun onPreDraw(): Boolean {
      viewTreeObserver.removeOnPreDrawListener(this)
      ViewEvents.modal(owner.node.tag, ViewEvents.MODAL_SHOW)
      return true
    }
  }

  init {
    addView(scrim)
    addView(content)
    // A named pane: the accessibility service announces it and moves focus into it when it appears.
    ViewCompat.setAccessibilityPaneTitle(this, "Dialog")
  }

  /** The root gives the layer its own size, which makes it a frame like any child of the root. */
  fun fitTo(width: Int, height: Int) {
    val st = node
    st.l = 0; st.t = 0; st.r = width; st.b = height
    st.hasFrame = true
  }

  fun configure(animationType: Int, transparent: Boolean, statusBarTranslucent: Boolean, navigationBarTranslucent: Boolean) {
    val relayout = statusBarTranslucent != this.statusBarTranslucent || navigationBarTranslucent != this.navigationBarTranslucent
    this.animationType = animationType
    this.transparent = transparent
    this.statusBarTranslucent = statusBarTranslucent
    this.navigationBarTranslucent = navigationBarTranslucent
    scrim.visibility = if (transparent) GONE else VISIBLE
    if (relayout && phase.state != ModalLayout.Phase.State.HIDDEN) requestLayout()
    applyLook()
  }

  // Show and hide ---------------------------------------------------------------------------------------------------

  fun show() {
    val animated = animationType != ModalLayout.ANIMATION_NONE
    when (phase.show(animated)) {
      ModalLayout.Step.ATTACH -> {
        Trace.beginSection("SvelteEngine.modal.show")
        try {
          node.pointer = 0
          backCallback.isEnabled = true
          setProgress(if (animated) 0f else 1f)
          root.addLayer(this)
          if (animated) animateTo(1f)
          announce()
          releaseFocusBelow()
          EngineStack.refreshBackCallbacks()
        } finally {
          Trace.endSection()
        }
      }
      ModalLayout.Step.RETURN -> {
        // Shown again while still leaving: it is in front of anything shown since, and its key handler runs first again.
        node.pointer = 0
        backCallback.isEnabled = true
        root.bringLayerToFront(this)
        registerBack()
        if (animated) animateTo(1f) else { cancelAnimation(); setProgress(1f) }
        announce()
        releaseFocusBelow()
        EngineStack.refreshBackCallbacks()
      }
      else -> {}
    }
  }

  fun hide() {
    when (phase.hide(animationType != ModalLayout.ANIMATION_NONE)) {
      ModalLayout.Step.LEAVE -> {
        stopListening()
        animateTo(0f)
        EngineStack.refreshBackCallbacks()
      }
      ModalLayout.Step.DETACH -> {
        stopListening()
        detach(true)
      }
      else -> {}
    }
  }

  /** The host was deleted: off at once, nobody is told. */
  fun drop() {
    if (!phase.drop()) return
    stopListening()
    detach(false)
  }

  /** From here on the layer takes no touch and no key; what is below is reachable again. */
  private fun stopListening() {
    node.pointer = 1
    backCallback.isEnabled = false
    // A focused input of the modal takes its keyboard with it, as closing the dialog's window did.
    if (findFocus() != null) {
      (context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(windowToken, 0)
    }
  }

  /** An input below the modal that keeps the focus would keep the keyboard and take the typing; the dialog's window used to take both. */
  private fun releaseFocusBelow() {
    val focused = root.findFocus() as? EngineInput ?: return
    var p: View? = focused
    while (p != null) {
      if (p === this) return
      p = p.parent as? View
    }
    focused.blur()
  }

  private fun detach(dismissed: Boolean) {
    cancelAnimation()
    viewTreeObserver.removeOnPreDrawListener(firstFrame)
    root.removeLayer(this)
    EngineStack.refreshBackCallbacks()
    if (dismissed) ViewEvents.modal(owner.node.tag, ViewEvents.MODAL_DISMISS)
  }

  private fun announce() {
    viewTreeObserver.removeOnPreDrawListener(firstFrame)
    viewTreeObserver.addOnPreDrawListener(firstFrame)
  }

  // Animation -------------------------------------------------------------------------------------------------------

  private fun setProgress(value: Float) {
    progress = value
    applyLook()
  }

  private fun applyLook() {
    look.at(progress, animationType, node.h.toFloat(), DIM)
    if (alpha != look.layerAlpha) alpha = look.layerAlpha
    if (content.translationY != look.contentOffset) content.translationY = look.contentOffset
    if (scrim.alpha != look.scrimAlpha) scrim.alpha = look.scrimAlpha
  }

  /** Moves the progress to [target] from where it is now (a show during an exit turns around without a jump). */
  private fun animateTo(target: Float) {
    cancelAnimation()
    val a = ValueAnimator.ofFloat(progress, target)
    a.duration = (EngineStack.DURATION * abs(target - progress)).toLong()
    a.interpolator = interpolator
    a.addUpdateListener { setProgress(it.animatedValue as Float) }
    a.addListener(object : AnimatorListenerAdapter() {
      private var cancelled = false
      override fun onAnimationCancel(animation: Animator) { cancelled = true }
      override fun onAnimationEnd(animation: Animator) {
        if (animator === animation) animator = null
        if (!cancelled && phase.finished() == ModalLayout.Step.DETACH) detach(true)
      }
    })
    animator = a
    a.start()
  }

  private fun cancelAnimation() {
    val running = animator ?: return
    animator = null
    running.cancel()
  }

  // Window ----------------------------------------------------------------------------------------------------------

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    registerBack()
    requestApplyInsets()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    backCallback.remove()
    viewTreeObserver.removeOnPreDrawListener(firstFrame)
  }

  /** The key handler of a layer is registered when it comes on screen, so it runs before the stacks' (and screens' own) of what is below. */
  private fun registerBack() {
    val dispatcher = findViewTreeOnBackPressedDispatcherOwner() ?: return
    backCallback.remove()
    dispatcher.onBackPressedDispatcher.addCallback(dispatcher, backCallback)
  }

  /** Reads what the system covers of the overlay and how far the keyboard reaches into it, as [Insets] does. */
  private fun readEdges(out: IntArray) {
    val all = ViewCompat.getRootWindowInsets(root)
    if (all == null || !root.isAttachedToWindow) {
      out.fill(0)
      return
    }
    val bars = all.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val keyboard = if (all.isVisible(WindowInsetsCompat.Type.ime())) all.getInsets(WindowInsetsCompat.Type.ime()).bottom else 0
    root.getLocationInWindow(location)
    val gapRight = root.rootView.width - (location[0] + root.width)
    val gapBottom = root.rootView.height - (location[1] + root.height)
    out[0] = max(0, bars.left - location[0])
    out[1] = max(0, bars.top - location[1])
    out[2] = max(0, bars.right - gapRight)
    out[3] = max(0, bars.bottom - gapBottom)
    out[4] = max(0, keyboard - gapBottom)
  }

  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    if (phase.state != ModalLayout.Phase.State.HIDDEN && isAttachedToWindow) {
      readEdges(next)
      if (!next.contentEquals(edges)) requestLayout()
    }
    return super.onApplyWindowInsets(insets)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    readEdges(edges)
    ModalLayout.contentInsets(edges[0], edges[1], edges[2], edges[3], edges[4], statusBarTranslucent, navigationBarTranslucent, inset)
    val st = content.node
    st.l = inset[0]
    st.t = inset[1]
    st.r = max(st.l, node.w - inset[2])
    st.b = max(st.t, node.h - inset[3])
    st.hasFrame = true
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    scrim.measure(MeasureSpec.makeMeasureSpec(node.w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(node.h, MeasureSpec.EXACTLY))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    scrim.layout(0, 0, r - l, b - t)
    super.onLayout(changed, l, t, r, b)
    // The slide distance is the layer's height.
    if (changed) applyLook()
  }

  private companion object {
    /** What the dialog window's `FLAG_DIM_BEHIND` (dim amount 0.5) painted behind a modal that is not transparent. */
    const val DIM = 0.5f
  }
}

/**
 * The layer's content: an [EngineView] that holds the modal's children and reports its size to Fabric (the
 * ModalHostViewState screen size Yoga lays the children out in). The report goes out from a posted runnable, never from the
 * layout pass: the new layout reaches the mounting layer synchronously on this thread.
 */
internal class ModalContent(context: Context, private val owner: EngineModal) : EngineView(context) {
  private val density = resources.displayMetrics.density
  private var reportedWidth = 0
  private var reportedHeight = 0
  private var queued = false

  private val report = Runnable {
    queued = false
    val w = width
    val h = height
    if (w <= 0 || h <= 0 || (w == reportedWidth && h == reportedHeight)) return@Runnable
    reportedWidth = w
    reportedHeight = h
    ViewEvents.modalSize(owner.node.tag, w / density, h / density)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (!queued) {
      queued = true
      post(report)
    }
  }
}
