package expo.modules.svelteengine

import android.graphics.Color
import android.util.Log
import android.view.View
import com.facebook.react.modules.i18nmanager.I18nUtil
import expo.modules.svelteengine.views.EngineHScroll
import expo.modules.svelteengine.views.EngineInput
import expo.modules.svelteengine.views.EngineNode
import expo.modules.svelteengine.views.EngineScroll
import expo.modules.svelteengine.views.EngineScrollable
import expo.modules.svelteengine.views.isRtlLayout
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * JavaScript-driven commands, `setNativeProps` and `measure` for engine tags. React Native's own path
 * (FabricUIManager.dispatchCommand -> SurfaceMountingManager.receiveCommand) cannot find engine views, so JS calls
 * these through the SvelteEngine module instead. Everything here runs on the main thread.
 */
object Commands {
  private val sideColorKeys = setOf("borderLeftColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderStartColor", "borderEndColor")

  private const val TAG = "SvelteEngine"

  fun dispatch(mm: MountingManager, tag: Int, name: String, args: List<Any?>) {
    val view = mm.viewFor(tag)
    if (view == null) {
      Log.w(TAG, "dispatchCommand $name: no engine view for tag $tag")
      return
    }
    val density = view.resources.displayMetrics.density
    when (name) {
      "scrollTo" -> (view as? EngineScrollable)?.scrollToPx(
        ((num(args.getOrNull(0)) ?: 0.0) * density).roundToInt(),
        ((num(args.getOrNull(1)) ?: 0.0) * density).roundToInt(),
        bool(args.getOrNull(2)),
      )
      "scrollToEnd" -> (view as? EngineScrollable)?.scrollToEndPx(bool(args.getOrNull(0)))
      "flashScrollIndicators" -> (view as? EngineScrollable)?.flashIndicators()
      // An input's own `focus` and `blur` also open and close the keyboard. They are called directly, not found by name: R8 (on in the release build of
      // Expo SDK 58's template) strips a method nothing calls, and the lookup then fell back to `clearFocus()`, which left the keyboard open.
      "focus" -> if (view is EngineInput) view.focus() else view.requestFocus()
      "blur" -> if (view is EngineInput) view.blur() else view.clearFocus()
      // React Native's TextInput command, `ref.dispatchCommand("setTextAndSelection", [eventCount, text | null, start, end])`.
      "setTextAndSelection" -> (view as? EngineInput)?.setTextAndSelection(
        (num(args.getOrNull(0)) ?: 0.0).toInt(),
        args.getOrNull(1) as? String,
        (num(args.getOrNull(2)) ?: -1.0).toInt(),
        (num(args.getOrNull(3)) ?: -1.0).toInt(),
      )
      else -> Log.w(TAG, "dispatchCommand: unsupported command '$name' for tag $tag (${view.javaClass.simpleName})")
    }
  }

  /** `{x, y, width, height, pageX, pageY}` in dp: frame in the parent, position in the engine root (transforms and scroll applied). */
  fun measure(mm: MountingManager, tag: Int): Map<String, Double>? {
    val view = mm.viewFor(tag) ?: return null
    val node = (view as? EngineNode)?.node ?: return null
    if (view.parent == null) return null
    val d = view.resources.displayMetrics.density.toDouble()
    val loc = IntArray(2)
    val rootLoc = IntArray(2)
    view.getLocationInWindow(loc)
    mm.root.getLocationInWindow(rootLoc)
    return mapOf(
      "x" to node.l / d,
      "y" to node.t / d,
      "width" to node.w / d,
      "height" to node.h / d,
      "pageX" to (loc[0] - rootLoc[0]) / d,
      "pageY" to (loc[1] - rootLoc[1]) / d,
    )
  }

  /**
   * Applies a partial prop set: opacity, backgroundColor, borderRadius/Width/Color (and the colour of each side), borderStyle, boxShadow, transformOrigin, transform, overflow,
   * pointerEvents, zIndex, elevation, accessibility props, testID and scroll props (also under `style`). The shared
   * decoder path (`Props.applyCommon`) takes full records, so the view's current values are read back first and the
   * given ones laid over them. Lengths are dp, colors are processColor ints (or "#rrggbb" strings).
   */
  fun setNativeProps(mm: MountingManager, tag: Int, props: Map<String, Any?>) {
    val view = mm.viewFor(tag) ?: run {
      Log.w(TAG, "setNativeProps: no engine view for tag $tag")
      return
    }
    val node = (view as? EngineNode)?.node ?: return
    val density = view.resources.displayMetrics.density
    val flat = LinkedHashMap<String, Any?>()
    flatten(props, flat)

    val p = PropSet()
    snapshot(view, node, p)
    var borderColor: Int? = null
    var borderStyle: String? = null
    val sideColors = IntArray(4)
    var sideSet = 0
    val rtl = view.isRtlLayout()
    val swap = I18nUtil.instance.doLeftAndRightSwapInRTL(view.context)
    for ((k, v) in flat) {
      when (k) {
        "opacity" -> num(v)?.let { p.opacity = it.toFloat() }
        "backgroundColor" -> color(v)?.let { p.bg = it }
        "borderColor" -> color(v)?.let { borderColor = it }
        "borderStyle" -> borderStyle = v as? String
        in sideColorKeys -> color(v)?.let { c -> val side = StyleRules.sideOfColorKey(k, rtl, swap); sideColors[side] = c; sideSet = sideSet or (1 shl side) }
        "boxShadow" -> when (v) {
          null -> p.style.shadows = null
          is List<*> -> p.style.shadows = StyleRules.shadowLayers(v) { color(it) }
          else -> Log.w(TAG, "setNativeProps: boxShadow takes the list `processBoxShadow` makes of it, not $v")
        }
        "borderRadius" -> num(v)?.let { r -> p.radii.fill((r * density).toFloat()) }
        "borderTopLeftRadius" -> num(v)?.let { p.radii[0] = (it * density).toFloat() }
        "borderTopRightRadius" -> num(v)?.let { p.radii[1] = (it * density).toFloat() }
        "borderBottomRightRadius" -> num(v)?.let { p.radii[2] = (it * density).toFloat() }
        "borderBottomLeftRadius" -> num(v)?.let { p.radii[3] = (it * density).toFloat() }
        "borderWidth" -> num(v)?.let { w -> p.border.fill((w * density).toFloat()) }
        "transform" -> transform(v, density, p.transform)
        "transformOrigin" -> origin(v, density, p.style)
        "overflow" -> p.overflow = if (v == "visible") 0 else 1
        "hitSlop" -> p.hitSlop = hitSlop(v, density)
        "pointerEvents" -> p.pointer = when (v) { "none" -> 1; "box-none" -> 2; "box-only" -> 3; else -> 0 }
        "zIndex" -> num(v)?.let { p.zIndex = it.toFloat() }
        "elevation" -> num(v)?.let { p.elevation = (it * density).toFloat() }
        "accessibilityLabel" -> p.label = v as? String
        "testID" -> p.testID = v as? String
        "accessible" -> p.accessible = if (bool(v)) 1 else 0
        "accessibilityRole" -> p.role = v as? String
      }
    }
    // The border's colour, then its style, then the sides that were given a colour of their own: `borderColor` colours every side, a side's own colour wins over it as in a style.
    borderColor?.let {
      p.borderColor = it
      StyleRules.setBorderColor(p.style, it)
    }
    if (flat.containsKey("borderStyle")) StyleRules.setBorderStyle(p.style, borderStyle, p.borderColor)
    for (side in 0..3) if (sideSet and (1 shl side) != 0) StyleRules.setSideColor(p.style, side, sideColors[side], p.borderColor)
    Props.applyCommon(view, node, p, false)

    val enabled = flat["scrollEnabled"]
    val vertical = flat["showsVerticalScrollIndicator"]
    val horizontal = flat["showsHorizontalScrollIndicator"]
    val throttle = num(flat["scrollEventThrottle"])
    when (view) {
      is EngineScroll -> {
        if (enabled != null) view.bridge.scrollEnabled = bool(enabled)
        if (vertical != null) view.isVerticalScrollBarEnabled = bool(vertical)
        if (throttle != null) view.bridge.throttleMs = throttle.toFloat()
      }
      is EngineHScroll -> {
        if (enabled != null) view.bridge.scrollEnabled = bool(enabled)
        if (horizontal != null) view.isHorizontalScrollBarEnabled = bool(horizontal)
        if (throttle != null) view.bridge.throttleMs = throttle.toFloat()
      }
    }
    view.invalidate()
  }

  /** `hitSlop` as a number (all sides) or `{left, top, right, bottom}` in dp, to px. */
  private fun hitSlop(v: Any?, density: Float): FloatArray? {
    num(v)?.let { return FloatArray(4) { _ -> (it * density).toFloat() } }
    val m = v as? Map<*, *> ?: return null
    fun side(k: String) = ((num(m[k]) ?: 0.0) * density).toFloat()
    return floatArrayOf(side("left"), side("top"), side("right"), side("bottom"))
  }

  /** Applies the box of [node] again with these corner radii (px, in the order of record 3): the shared decoder path with the view's current values read back, as `setNativeProps` does. */
  fun restyle(view: View, node: expo.modules.svelteengine.views.NodeState, tl: Float, tr: Float, br: Float, bl: Float) {
    val p = PropSet()
    snapshot(view, node, p)
    p.radii[0] = tl; p.radii[1] = tr; p.radii[2] = br; p.radii[3] = bl
    Props.applyCommon(view, node, p, false)
  }

  private fun snapshot(view: View, node: expo.modules.svelteengine.views.NodeState, p: PropSet) {
    p.bg = node.bg
    p.opacity = view.alpha
    node.radii.copyInto(p.radii)
    node.border.copyInto(p.border)
    p.borderColor = node.borderColor
    node.style?.let { p.style.copyFrom(it) }
    p.transform[0] = view.translationX
    p.transform[1] = view.translationY - node.drivenY
    p.transform[2] = view.scaleX
    p.transform[3] = view.scaleY
    p.transform[4] = view.rotation
    p.overflow = node.overflow
    p.pointer = node.pointer
    p.viewFlags = node.viewFlags
    p.hitSlop = node.hitSlop?.copyOf()
    p.zIndex = node.zIndex
    p.elevation = node.elevation
    p.accessible = if (view.isFocusable) 1 else 0
    p.role = node.role
    p.testID = node.testID
    p.label = node.label
    node.a11y?.let { p.a11y.copyFrom(it); p.a11y.touched = true }
  }

  @Suppress("UNCHECKED_CAST")
  private fun flatten(src: Map<String, Any?>, out: MutableMap<String, Any?>) {
    for ((k, v) in src) {
      if (k == "style") {
        when (v) {
          is Map<*, *> -> flatten(v as Map<String, Any?>, out)
          is List<*> -> v.forEach { if (it is Map<*, *>) flatten(it as Map<String, Any?>, out) }
        }
      } else {
        out[k] = v
      }
    }
  }

  /**
   * Decomposes a transform into translate/scale/rotate (see SPEC prop 6). Operations are accumulated, so the result
   * is exact for the common single-purpose transforms but not for order-dependent mixes. Also takes a 16-number matrix.
   */
  /** `transformOrigin` (`[x, y, z]` after JavaScript's `processTransformOrigin`: a number is dp, `"50%"` a percentage) into [style]'s origin; null puts it back to the centre. */
  private fun origin(v: Any?, density: Float, style: StyleRecords) {
    val values = FloatArray(2)
    var xUnit = StyleRules.UNIT_NONE
    var yUnit = StyleRules.UNIT_NONE
    val list = v as? List<*>
    if (list != null && list.size >= 2) {
      for (axis in 0..1) {
        val unit = StyleRules.originAxis(num(list[axis]), list[axis] as? String, density, values, axis)
        if (axis == 0) xUnit = unit else yUnit = unit
      }
    }
    style.touched = true
    style.originXUnit = xUnit; style.originX = values[0]; style.originYUnit = yUnit; style.originY = values[1]
  }

  private fun transform(v: Any?, density: Float, out: FloatArray) {
    out[0] = 0f; out[1] = 0f; out[2] = 1f; out[3] = 1f; out[4] = 0f
    val list = v as? List<*> ?: return
    if (list.size == 16 && list.all { it is Number }) {
      val m = list.map { (it as Number).toFloat() }
      out[0] = m[12] * density
      out[1] = m[13] * density
      out[2] = hypot(m[0], m[1])
      out[3] = hypot(m[4], m[5])
      out[4] = (atan2(m[1], m[0]) * 180.0 / Math.PI).toFloat()
      return
    }
    for (op in list) {
      val m = op as? Map<*, *> ?: continue
      for ((key, value) in m) {
        when (key) {
          "translateX" -> num(value)?.let { out[0] += (it * density).toFloat() }
          "translateY" -> num(value)?.let { out[1] += (it * density).toFloat() }
          "scale" -> num(value)?.let { out[2] *= it.toFloat(); out[3] *= it.toFloat() }
          "scaleX" -> num(value)?.let { out[2] *= it.toFloat() }
          "scaleY" -> num(value)?.let { out[3] *= it.toFloat() }
          "rotate", "rotateZ" -> angle(value)?.let { out[4] += it }
        }
      }
    }
  }

  private fun angle(v: Any?): Float? {
    if (v is Number) return Math.toDegrees(v.toDouble()).toFloat()
    val s = (v as? String)?.trim() ?: return null
    return when {
      s.endsWith("deg") -> s.removeSuffix("deg").toFloatOrNull()
      s.endsWith("rad") -> s.removeSuffix("rad").toDoubleOrNull()?.let { Math.toDegrees(it).toFloat() }
      else -> null
    }
  }

  private fun num(v: Any?): Double? = (v as? Number)?.toDouble()

  private fun bool(v: Any?): Boolean = when (v) {
    is Boolean -> v
    is Number -> v.toInt() != 0
    else -> false
  }

  private fun color(v: Any?): Int? = when (v) {
    is Number -> v.toLong().toInt()
    is String -> try { Color.parseColor(v) } catch (_: IllegalArgumentException) { null }
    else -> null
  }
}
