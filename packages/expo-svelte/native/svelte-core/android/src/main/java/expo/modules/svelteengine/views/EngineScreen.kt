package expo.modules.svelteengine.views

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.PointerEvents
import expo.modules.svelteappearance.isNight
import expo.modules.svelteengine.GestureRules
import expo.modules.svelteengine.NavProps
import expo.modules.svelteengine.SystemBarsRules
import expo.modules.svelteengine.TransitionRules
import kotlin.math.max

/** The system bar options of a screen (record 125); styles are 0 auto, 1 light icons, 2 dark icons. */
data class SystemBarsSpec(val statusStyle: Int, val statusHidden: Boolean, val hasNavColor: Boolean, val navColor: Int, val navStyle: Int)

/**
 * One screen of an [EngineStack]: an absolutely filled [EngineView] (Yoga's frame) plus the navigation state the stack
 * reads. Its translation and alpha belong to the stack's transitions, never to the committed transform/opacity props.
 * Sheets and form sheets are [EngineSheet]s.
 */
open class EngineScreen(context: Context) : EngineView(context) {
  /** 0 detached/inactive, 1 transitioning, 2 active. */
  var activityState = 2
  /** 0 push, 1 modal, 2 transparentModal, 3 sheet, 4 formSheet. */
  var presentation = 0
  var gestureEnabled = true
  /** 0 default, 1 none, 2 fade, 3 slide_from_right, 4 slide_from_bottom, 5 slide_from_left, 6 fade_from_bottom, 7 android_activity, 8 flip, 9 simple_push. */
  var animation = 0
  var backDismissal = true
  /** Record 125; null when the screen sets no system bar option. */
  var bars: SystemBarsSpec? = null

  /** Yoga's `display: none`; the stack decides everything else about visibility. */
  var displayNone = false

  /** Popping (JavaScript removed it, or the user dismissed it): still attached while its exit plays, no longer part of the stack. */
  var leaving = false
  /** JavaScript set `activityState` to 0 and the stack took the screen away ("Screen exit" in SPEC): `topExited` was sent; the view waits, hidden, for its removal. */
  var exited = false
  /** Dismissed by the user: `onDismissed` was (or is about to be) sent; the removal that follows needs no animation. */
  var dismissed = false
  /** A transition is running on this view. */
  var transitioning = false
  /** A gesture of the stack (predictive back, edge swipe) is moving this view, from its start until it has been handed to an animation or has ended ([EngineStack.holdGesture]). */
  var gesturing = false
  /** Only the top active screen takes touches ([HitTest]). */
  var touchable = true

  /** The same rule for react-native-gesture-handler, which does not ask [HitTest]: a screen that takes no touches is none. */
  override val pointerEvents: PointerEvents get() = GestureRules.pointerEvents(node.pointer, touchable)
  /** `topAppear` was sent and `topDisappear` has not followed ([EngineStack.syncAppearance]). */
  var appeared = false
  /** A screen above holds focus for accessibility services: this one is hidden from them. */
  private var a11yHidden = false

  /** The transition moving this view: a `ViewPropertyAnimator` (one screen), or the `ValueAnimator` of a transition between two screens ([EngineStack.system]). */
  internal var running: Any? = null
  /** The screen whose transition moves or fades this one as the full screen below it ([EngineStack.system]); null otherwise. */
  internal var mover: EngineScreen? = null
  /** Whether [mover]'s transition moves this screen (a push that moves the one below aside) or only fades it: a fade leaves its position to whoever else moves it. */
  internal var movedByMover = false
  /** A transition is moving this screen less than the width: the stack draws the strip it uncovers in the screen's own colours (the framework's `extend`). */
  internal var extendsEdge = false
  /** While this screen is the one below a transition that fades it ([EngineStack.system]): the screen whose surface the stack draws under it, the one coming. */
  internal var silhouette: EngineScreen? = null
  /**
   * In a fade-through ([EngineStack.system]) the screen is drawn whole, with no layer, and the stack lays [veilOf]'s surface over it at this opacity: 1 minus
   * how far the screen has faded in. 0 when nothing is laid over it.
   */
  internal var veil = 0f
  internal var veilOf: EngineScreen? = null
  /** Where the running transition lands and what its end does; the stack runs it when it leaves the window mid-transition. */
  internal var landing: (() -> Unit)? = null

  /**
   * Hidden by the stack: inactive, or settled under another settled push screen. The view keeps its subtree and every
   * display list and the renderer skips it (alpha 0). It used to be `INVISIBLE`, which Android dispatches to every
   * descendant: each one with a background drawable is invalidated, so the whole screen re-recorded when it came back
   * (5–13 ms on the main thread per pop for a screen of a hundred views).
   */
  var hidden = false
    private set

  fun setHidden(hidden: Boolean) {
    if (this.hidden == hidden) return
    this.hidden = hidden
    veil = 0f
    if (hidden) {
      if (hasFocus()) clearFocus()
      alpha = 0f
    } else {
      alpha = 1f
    }
    applyA11y()
  }

  private var layerHolds = 0

  /**
   * The settled top screen above the first one keeps its hardware layer between transitions (see [EngineStack.refresh]):
   * it is the screen the next pop or back gesture moves, and building the layer on that first frame cost 6–18 ms of GPU
   * driver time for a fresh full-screen framebuffer. The hold is taken before the transition's own hold is released, so
   * the layer is handed over, never rebuilt.
   *
   * A layer is only free while its content stands still: every invalidation under the screen (an animated tile, a
   * scrolling list, a keystroke) makes the renderer draw the whole screen into the layer again and then composite it,
   * 0.5–14 ms per frame on top of the drawing itself on a Mali-G57. So the resident hold lets go on the first descendant
   * invalidation and is not taken again until the next settle: rebuilding it after a quiet period costs a full-screen
   * render (20–35 ms for a 300-row list on the A16) on a frame nobody asked for, and a pop after content changed pays
   * the first-frame build instead, which is the rarer of the two. [onDescendantInvalidated] exists since API 26; older
   * devices never hold a resident layer.
   */
  var resident = false
    private set
  private var residentHeld = false

  fun setResident(resident: Boolean) {
    val wanted = resident && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
    if (this.resident == wanted) return
    this.resident = wanted
    if (wanted) {
      residentHeld = true
      holdLayer()
    } else if (residentHeld) {
      residentHeld = false
      releaseLayer()
    }
  }

  override fun onDescendantInvalidated(child: View, target: View) {
    super.onDescendantInvalidated(child, target)
    if (residentHeld) {
      residentHeld = false
      releaseLayer()
    }
  }

  /**
   * Renders the screen into a hardware layer while something moves it (a transition, a drag), so each frame composites a
   * texture instead of replaying every row and text of the screen. The default push and pop (a fade-through) take none: they
   * draw the screens whole under a veil ([veil], [EngineStack.system]). Holds are counted: overlapping movements share the layer,
   * and the layer type goes back to none when the last one lets go, so no layer outlives the movement and later content
   * changes are drawn the ordinary way.
   */
  fun holdLayer() {
    if (layerHolds++ == 0) setLayerType(LAYER_TYPE_HARDWARE, null)
  }

  fun releaseLayer() {
    if (layerHolds > 0 && --layerHolds == 0) setLayerType(LAYER_TYPE_NONE, null)
  }

  val stack: EngineStack? get() = parent as? EngineStack

  /** The header node of this screen, or null. */
  val header: EngineHeader?
    get() {
      for (i in 0 until childCount) (getChildAt(i) as? EngineHeader)?.let { return it }
      return null
    }

  /** The toolbar band of this screen, or null. */
  val toolbar: EngineToolbar?
    get() {
      for (i in childCount - 1 downTo 0) (getChildAt(i) as? EngineToolbar)?.let { return it }
      return null
    }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    // Content may have arrived since the last pass: a large or translucent header insets the first scroll view.
    header?.queueAdopt()
  }

  /**
   * The header's stops come before the content's, whatever the header's frame is. The framework does not read the child
   * order: `ViewGroup.addChildrenForAccessibility` sorts the children by their bounds (above, then the start edge, then
   * the top, then the taller view first), and `accessibilityTraversalBefore` never reaches the node tree's order, which
   * is what uiautomator dumps and what a service walks. An in-flow header sits above the content view and sorts first by
   * itself. A large or translucent header is absolute over a content view that fills the screen: both start at the same
   * corner, the taller content view won the tie and the header (title, back button, slots) came after the last row. The
   * Fabric child order (header, content, toolbar) and the header's `zIndex` (drawing and hit order) are right and stay;
   * only the node tree's order is set here, as [EngineRoot] and [EngineHeader] set theirs. The rest keeps the
   * framework's order (the toolbar at the bottom sorts after the content by itself).
   */
  override fun addChildrenForAccessibility(outChildren: ArrayList<View>) {
    val bar = header
    if (bar == null) {
      super.addChildrenForAccessibility(outChildren)
      return
    }
    val all = ArrayList<View>()
    super.addChildrenForAccessibility(all)
    val rest = ArrayList<View>(all.size)
    for (v in all) if (isInside(v, bar)) outChildren.add(v) else rest.add(v)
    outChildren.addAll(rest)
  }

  private fun isInside(view: View, ancestor: View): Boolean {
    var p: View? = view
    while (p != null && p !== ancestor) p = p.parent as? View
    return p != null
  }

  /** How far below its Yoga frame the screen rests, px: 0, or the detent a sheet sits at. */
  open val restY: Float get() = 0f

  /** Whether the user may dismiss the screen (back key, swipe, scrim); sheets can opt out. */
  open val dismissible: Boolean get() = true

  open fun apply(p: NavProps) {
    if (!p.seen) return
    val changed = activityState != p.activityState || presentation != p.presentation || gestureEnabled != p.gestureEnabled ||
      animation != p.animation || backDismissal != p.backDismissal
    // A live screen whose activityState drops to 0 leaves through the stack's exit (SPEC, "Screen exit"), not through hiding.
    val exits = p.activityState == 0 && activityState != 0
    activityState = p.activityState; presentation = p.presentation; gestureEnabled = p.gestureEnabled
    animation = p.animation; backDismissal = p.backDismissal
    val spec = if (p.barsSeen) SystemBarsSpec(p.statusStyle, p.statusHidden, p.hasNavColor, p.navColor, p.navStyle) else null
    val barsChanged = spec != bars
    bars = spec
    // The common props reset the accessibility flag on every update; the stack's choice is applied again.
    applyA11y()
    if (exits && stack != null) stack?.exitScreen(this) else if (changed) stack?.refresh()
    if (barsChanged) SystemBars.invalidate(this)
  }

  /** The stack calls this from `refresh()`: hidden while a modal presentation above holds focus. */
  fun setA11yHidden(hidden: Boolean) {
    if (a11yHidden == hidden) return
    a11yHidden = hidden
    applyA11y()
  }

  private fun applyA11y() {
    if (a11yHidden || hidden) {
      if (importantForAccessibility != IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS) importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    } else if (importantForAccessibility == IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS) {
      importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_AUTO
    }
  }

  /**
   * The transition this screen plays: 0 none, and for a modal, a transparent modal or a sheet 1 a fade, 2 from the right, 3 from the bottom (one screen
   * moves); for a push screen a transition between it and the screen below ([TransitionRules.motion]): the default, Android's activity transition, and
   * react-native-screens' fade, slides and fade from the bottom. `flip` and `simple_push` are the default on Android, as in React Navigation.
   */
  fun transitionKind(): Int {
    val push = presentation == 0
    return when (animation) {
      1 -> 0
      2 -> if (push) TransitionRules.KIND_FADE else 1
      3 -> if (push) TransitionRules.KIND_SLIDE_RIGHT else 2
      4 -> if (push) TransitionRules.KIND_SLIDE_BOTTOM else 3
      5 -> if (push) TransitionRules.KIND_SLIDE_LEFT else presentationKind()
      6 -> if (push) TransitionRules.KIND_FADE_FROM_BOTTOM else presentationKind()
      7 -> if (push) TransitionRules.KIND_ACTIVITY else presentationKind()
      else -> presentationKind()
    }
  }

  /** The default of the presentation: Android's transition between two screens for a push, from the bottom for a modal or a sheet, a fade for a transparent modal. */
  private fun presentationKind(): Int = when (presentation) {
    0 -> TransitionRules.KIND_DEFAULT
    1, 3, 4 -> 3
    else -> 1
  }
}

/** The engine overlay above [this] view, or null while it is not mounted. */
internal fun View.engineRoot(): EngineRoot? {
  var p = parent
  while (p != null) {
    if (p is EngineRoot) return p
    p = p.parent
  }
  return null
}

/**
 * The part of the window's safe-area insets that a view reaches into, in px: system bars and display cutout, reduced by
 * how far the overlay's own frame already sits inside that edge and by how far the view's edge is from the overlay's (a
 * header at the top of the screen gets the whole status bar, tabs embedded mid-screen get none). Positions come from
 * layout, so a transition running on the view or its ancestors does not move the result. Main thread only.
 */
object SafeArea {
  private val location = IntArray(2)

  /** The top inset in px, or null while the window has not reported insets (a caller must not mistake that for 0). */
  fun top(view: View): Int? = read(view, true)
  fun bottom(view: View): Int? = read(view, false)

  private fun read(view: View, top: Boolean): Int? {
    val root = view.engineRoot() ?: (view as? EngineRoot) ?: return null
    if (!root.isAttachedToWindow) return null
    val all = ViewCompat.getRootWindowInsets(root) ?: return null
    val bars = all.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    root.getLocationInWindow(location)
    var y = 0
    var v: View = view
    while (v !== root) {
      y += v.top
      v = v.parent as? View ?: break
    }
    return if (top) max(0, bars.top - location[1] - y)
    else max(0, bars.bottom - (root.rootView.height - (location[1] + root.height)) - (root.height - (y + view.height)))
  }
}

/**
 * The status and navigation bar options of the top screen (record 125), applied to the activity's window. Each stack's
 * top screen is a candidate: the deepest visible one that sets an option wins (a tab's screen over the screen that holds
 * the tabs), and when none does, the window goes back to what it was. The search walks only visible screens and runs
 * once per frame at most, after a push, pop, tab switch or option change.
 */
object SystemBars {
  private var queued = false
  private var original: Int? = null
  private var applied: SystemBarsSpec? = null
  // The window has been written at least once: without it `applied == null` is also the spec of an app that sets no option, and its default was never written.
  private var written = false
  // The appearance the icons were last written for: `auto` follows it, so a switch while the app runs writes the window again.
  private var appliedNight: Boolean? = null

  fun invalidate(view: View) {
    if (queued) return
    val root = view as? EngineRoot ?: view.engineRoot() ?: return
    queued = true
    root.post {
      queued = false
      if (root.isAttachedToWindow) apply(root, find(root))
    }
  }

  private fun find(view: View): SystemBarsSpec? {
    var found: SystemBarsSpec? = null
    when (view) {
      is EngineStack -> view.topScreen()?.let { top ->
        top.bars?.let { found = it }
        find(top)?.let { found = it }
      }
      is EngineTabs -> view.selectedPane()?.let { pane -> find(pane)?.let { found = it } }
      is android.view.ViewGroup -> for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { found = it }
    }
    return found
  }

  /**
   * The activity whose window the bars belong to. The decor view's context is the platform's `DecorContext`, which wraps the application's `ContextImpl` and not the
   * activity (Android 16, and so every device the engine runs on today), so walking the root view's context wrappers finds none and the bars were never written.
   * The view's own context is React Native's, which knows its current activity; the wrappers are the fallback for a host that has the activity in the chain.
   */
  private fun activityOf(view: View): Activity? {
    (view.context as? ReactContext)?.currentActivity?.let { return it }
    var context: Context? = view.rootView.context
    while (context is ContextWrapper) {
      if (context is Activity) return context
      context = context.baseContext
    }
    return context as? Activity
  }

  private fun apply(root: EngineRoot, spec: SystemBarsSpec?) {
    val night = isNight(root.resources)
    if (!SystemBarsRules.needsWrite(written, spec == applied, night == appliedNight)) return
    val window = activityOf(root)?.window ?: return
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    if (original == null) {
      @Suppress("DEPRECATION")
      original = window.navigationBarColor
    }
    // "light" means light icons (for a dark background): the platform flag is named for the bar, not the icons.
    controller.isAppearanceLightStatusBars = SystemBarsRules.darkIcons(spec?.statusStyle ?: SystemBarsRules.AUTO, night)
    controller.isAppearanceLightNavigationBars = SystemBarsRules.darkIcons(spec?.navStyle ?: SystemBarsRules.AUTO, night)
    if (spec?.statusHidden == true) {
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(WindowInsetsCompat.Type.statusBars())
    } else {
      controller.show(WindowInsetsCompat.Type.statusBars())
    }
    @Suppress("DEPRECATION")
    window.navigationBarColor = if (spec?.hasNavColor == true) spec.navColor else original ?: 0
    applied = spec
    appliedNight = night
    written = true
  }
}
