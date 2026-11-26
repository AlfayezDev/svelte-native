package expo.modules.svelteengine.views

import android.content.Context
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import com.facebook.react.views.view.ReactViewGroup
import expo.modules.kotlin.views.ExpoView
import expo.modules.svelteengine.ForeignTouchRules
import java.lang.reflect.Field

/**
 * The engine's frame for a view another library owns (SPEC.md, "Foreign views"): a WebView, a map, a video player. React
 * Native's own Java mounting creates that view, sets its props, lays it out and sends it commands; this node is the part
 * the engine owns, so everything about its place in the engine tree stays the engine's: its frame, transform, opacity,
 * stacking, clipping, `pointerEvents`, and removal with its parent.
 *
 * The view is the frame's only child and fills it, at the origin. React Native lays the view out at that origin in the
 * size of the frame (the C++ delegate hands it the frame's own pixel size, see `inEngineFrame`), so both layout paths
 * agree, and this class lays the view out again on every engine pass, which is what the platform needs when the view asks
 * for a layout of its own (a WebView finishing a load).
 *
 * The view arrives some time after the frame (React Native mounts on its own schedule, see [ForeignViews]), so the frame
 * starts empty. It is never pooled: [ViewPool] only takes the plain container and the text and scroll views.
 */
class EngineForeign(context: Context) : EngineView(context) {
  /** The view React Native created for this node; null until [adopt] and again after [release]. */
  var content: View? = null
    private set

  /** Puts [view], React Native's view for this node, inside the frame. */
  fun adopt(view: View) {
    if (view === content) return
    release()
    (view.parent as? ViewGroup)?.removeView(view)
    content = view
    addView(view)
    requestLayout()
  }

  /** Takes the view out of the frame. The view stays React Native's: it drops it when the node is deleted. */
  fun release() {
    val view = content ?: return
    content = null
    removeView(view)
  }

  /**
   * Whether the view inside takes no touch for itself, so that the touches on it are JavaScript's too ([ForeignTouchRules], `HitTest`): its class is React Native's or Expo's view with nothing of
   * touch declared below it, nothing inside it takes a touch or is clickable, and nothing asked for its own (a click or touch listener, `isClickable`). A view that is not there yet takes the
   * touch itself, as before. The class is judged first (cached per class) and the rest only for a class that passed: the walk through the views inside and the reflective reads of the listeners
   * are not paid for a map, a WebView or a video.
   */
  fun passesTouchesToParent(): Boolean {
    val view = content ?: return false
    if (!plain(view.javaClass, ownBases, ownVerdicts)) return false
    return ForeignTouchRules.passesToParent(
      plainClass = true,
      plainDescendants = !(view is ViewGroup && insideTakesTouch(view)),
      clickable = view.isClickable,
      longClickable = view.isLongClickable,
      clickListener = view.hasOnClickListeners(),
      touchListener = hasTouchListener(view),
    )
  }

  private fun insideTakesTouch(group: ViewGroup): Boolean {
    for (index in 0 until group.childCount) {
      val child = group.getChildAt(index)
      if (child.isClickable || child.isLongClickable || child.hasOnClickListeners() || hasTouchListener(child) || !plain(child.javaClass, insideBases, insideVerdicts)) return true
      if (child is ViewGroup && insideTakesTouch(child)) return true
    }
    return false
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
    content?.measure(MeasureSpec.makeMeasureSpec(node.w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(node.h, MeasureSpec.EXACTLY))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    content?.layout(0, 0, node.w, node.h)
  }

  // `pointerEvents`: none leaves the view out of touch handling (a native view would otherwise take a touch the engine's
  // hit test excluded), box-only keeps the touches for the frame, so a handler in JavaScript can have them.
  override fun dispatchTouchEvent(ev: MotionEvent): Boolean = node.pointer != POINTER_NONE && super.dispatchTouchEvent(ev)

  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean = node.pointer == POINTER_BOX_ONLY

  private companion object {
    const val POINTER_NONE = 1
    const val POINTER_BOX_ONLY = 3

    /** The bases whose touch handling is known: React Native's view group (every Svg view is one) and Expo's view. A foreign view is passed on only through one of these. */
    val ownBases: Set<Class<*>> = setOf(ReactViewGroup::class.java, ExpoView::class.java)

    /** What may be inside such a view: its own bases, and the framework's plain view and container, whose touch methods are the platform's defaults. */
    val insideBases: Set<Class<*>> = ownBases + setOf(View::class.java, ViewGroup::class.java)

    // Per class, on the main thread (hit tests run there): a class is looked at once, not at every touch.
    val ownVerdicts = HashMap<Class<*>, Boolean>()
    val insideVerdicts = HashMap<Class<*>, Boolean>()
    var warned = false

    fun plain(type: Class<*>, bases: Set<Class<*>>, verdicts: HashMap<Class<*>, Boolean>): Boolean = verdicts.getOrPut(type) {
      ForeignTouchRules.takesNoTouch(type, bases) { declared ->
        try {
          ForeignTouchRules.declaresTouch(declared)
        } catch (error: Throwable) {
          // A class whose methods cannot be listed (a parameter type that is not there) is not known to take no touch: it keeps its touches.
          if (!warned) {
            warned = true
            Log.w("SvelteEngine", "EngineForeign: could not read the methods of ${declared.name}; its views keep their touches", error)
          }
          true
        }
      }
    }

    // `View.mListenerInfo.mOnTouchListener`: a listener set from outside (setOnTouchListener) is not in the class. The platform's hidden-API rules may deny the fields. Then the listener cannot be
    // ruled out, and the view keeps its touches as it always did (logged once by [read]): a view that passes touches on is one that was checked.
    val listenerInfo: Field? by lazy { read("mListenerInfo") { View::class.java.getDeclaredField("mListenerInfo") } }
    val onTouchListener: Field? by lazy { read("mOnTouchListener") { Class.forName("android.view.View\$ListenerInfo").getDeclaredField("mOnTouchListener") } }

    fun read(name: String, find: () -> Field): Field? = try {
      find().also { it.isAccessible = true }
    } catch (error: Throwable) {
      Log.w("SvelteEngine", "EngineForeign: cannot read $name; a foreign view may have a touch listener, so its touches stay with it", error)
      null
    }

    fun hasTouchListener(view: View): Boolean {
      val info = listenerInfo
      val field = onTouchListener
      if (info == null || field == null) return true
      return try {
        val listeners = info.get(view)
        listeners != null && field.get(listeners) != null
      } catch (_: Throwable) {
        true
      }
    }
  }
}
