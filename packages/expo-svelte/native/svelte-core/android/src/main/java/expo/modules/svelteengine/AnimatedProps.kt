package expo.modules.svelteengine

import android.graphics.drawable.GradientDrawable
import android.view.View
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import expo.modules.svelteengine.views.EngineNode
import expo.modules.svelteengine.views.EngineText
import kotlin.math.atan2
import kotlin.math.hypot

/**
 * Direct property writes for Reanimated's UI-thread updates (phase 3 of packages/expo-svelte/PLAN.md).
 * Main thread only. Lengths are dp (scaled here), colours are processColor ints, angles radians or "Ndeg"/"Nrad".
 * Two entry points share the setters: [apply] takes the `ReadableMap` Reanimated's Java path builds (the fallback for
 * writes the typed path does not cover, and the replay of writes that arrived before their view), and [TypedWriter]
 * takes the flat records of AnimatedBridge (the per-frame path, no map). Both skip unknown props (width, height,
 * shadowOpacity, ...): layout goes through the shadow tree, and the committed props stay the source of truth (see
 * SPEC.md "Animation" and "Animated write path"). In [apply] keys are looked up with `hasKey` instead of iterating the
 * map, so nothing is allocated for the usual `{opacity, transform}` update.
 */
object AnimatedProps {
  private val transformKeys = arrayOf("translateX", "translateY", "scale", "scaleX", "scaleY", "rotate", "rotateZ")

  /** Returns true when [view] is an engine view and the update was handled (even if every key was ignored). */
  fun apply(view: View, props: ReadableMap): Boolean {
    val st = (view as? EngineNode)?.node ?: return false
    val density = view.resources.displayMetrics.density

    if (props.hasKey("opacity") && props.getType("opacity") == ReadableType.Number) {
      val a = props.getDouble("opacity").toFloat()
      if (view.alpha != a) view.alpha = a
    }

    if (props.hasKey("transformOrigin")) applyOrigin(view, st, props.getArray("transformOrigin"), density)
    if (props.hasKey("transform")) applyTransform(view, st, props.getArray("transform"), density)

    if (props.hasKey("backgroundColor") && props.getType("backgroundColor") == ReadableType.Number) {
      setBackground(view, st, props.getDouble("backgroundColor").toLong().toInt())
    }

    if (props.hasKey("borderRadius") && props.getType("borderRadius") == ReadableType.Number) {
      setRadius(view, st, (props.getDouble("borderRadius") * density).toFloat())
    }

    val hasZ = props.hasKey("zIndex")
    val hasElevation = props.hasKey("elevation")
    if (hasZ || hasElevation) {
      val z = if (hasZ && props.getType("zIndex") == ReadableType.Number) props.getDouble("zIndex").toFloat() else st.zIndex
      val e = if (hasElevation && props.getType("elevation") == ReadableType.Number) (props.getDouble("elevation") * density).toFloat() else st.elevation
      Props.setStacking(view, st, z, e)
    }

    if (view is EngineText) applyText(view, props, density)
    return true
  }

  /**
   * Writes the decoded records of one view (AnimatedWire) through the same setters as [apply]. One instance serves
   * every view of every frame: [bind] points it at the next view, so decoding a frame allocates nothing.
   */
  class TypedWriter : AnimatedWire.Target {
    private var view: View? = null
    private var st: expo.modules.svelteengine.views.NodeState? = null
    private var density = 1f

    /** False when [view] is not an engine view (nothing is bound then). */
    fun bind(view: View): Boolean {
      val node = (view as? EngineNode)?.node
      this.view = if (node == null) null else view
      st = node
      if (node != null) density = view.resources.displayMetrics.density
      return node != null
    }

    /** Drops the reference to the last bound view once a frame is written. */
    fun release() {
      view = null
      st = null
    }

    override fun opacity(value: Float) {
      val v = view ?: return
      if (v.alpha != value) v.alpha = value
    }

    override fun background(color: Int) {
      setBackground(view ?: return, st ?: return, color)
    }

    override fun radius(topLeft: Float, topRight: Float, bottomRight: Float, bottomLeft: Float) {
      setRadii(view ?: return, st ?: return, topLeft * density, topRight * density, bottomRight * density, bottomLeft * density)
    }

    override fun transform(tx: Float, ty: Float, sx: Float, sy: Float, rotation: Float) {
      Props.setTransform(view ?: return, st ?: return, tx * density, ty * density, sx, sy, rotation)
    }

    override fun stacking(zIndex: Float, elevation: Float) {
      val node = st ?: return
      Props.setStacking(
        view ?: return, node,
        if (zIndex.isNaN()) node.zIndex else zIndex,
        if (elevation.isNaN()) node.elevation else elevation * density,
      )
    }
  }

  /** `transformOrigin` as JavaScript's `processTransformOrigin` leaves it, `[x, y, z]`: a number is dp, `"50%"` a percentage, null the centre. The view turns about it from now on. */
  private fun applyOrigin(view: View, st: expo.modules.svelteengine.views.NodeState, origin: ReadableArray?, density: Float) {
    val values = FloatArray(2)
    var xUnit = StyleRules.UNIT_NONE
    var yUnit = StyleRules.UNIT_NONE
    if (origin != null && origin.size() >= 2) {
      for (axis in 0..1) {
        val number = if (origin.getType(axis) == ReadableType.Number) origin.getDouble(axis) else null
        val text = if (origin.getType(axis) == ReadableType.String) origin.getString(axis) else null
        val unit = StyleRules.originAxis(number, text, density, values, axis)
        if (axis == 0) xUnit = unit else yUnit = unit
      }
    }
    Props.setOrigin(view, st, xUnit, values[0], yUnit, values[1])
  }

  private fun applyTransform(view: View, st: expo.modules.svelteengine.views.NodeState, ops: ReadableArray?, density: Float) {
    if (ops == null) {
      Props.setTransform(view, st, 0f, 0f, 1f, 1f, 0f)
      return
    }
    val n = ops.size()
    // Same decomposition as prop 6 (PropsEncoder.cpp): translation, hypot of the first two rows, atan2 of row 0.
    if (n == 16 && ops.getType(0) == ReadableType.Number) {
      val m0 = ops.getDouble(0); val m1 = ops.getDouble(1)
      val m4 = ops.getDouble(4); val m5 = ops.getDouble(5)
      Props.setTransform(
        view, st,
        (ops.getDouble(12) * density).toFloat(), (ops.getDouble(13) * density).toFloat(),
        hypot(m0, m1).toFloat(), hypot(m4, m5).toFloat(),
        (atan2(m1, m0) * 180.0 / Math.PI).toFloat(),
      )
      return
    }
    // Operations accumulate like Commands.setNativeProps: exact for single-purpose transforms.
    var tx = 0f; var ty = 0f; var sx = 1f; var sy = 1f; var rot = 0f
    for (i in 0 until n) {
      if (ops.getType(i) != ReadableType.Map) continue
      val op = ops.getMap(i) ?: continue
      for (k in transformKeys.indices) {
        val key = transformKeys[k]
        if (!op.hasKey(key)) continue
        when (k) {
          0 -> if (op.getType(key) == ReadableType.Number) tx += (op.getDouble(key) * density).toFloat()
          1 -> if (op.getType(key) == ReadableType.Number) ty += (op.getDouble(key) * density).toFloat()
          2 -> if (op.getType(key) == ReadableType.Number) { val v = op.getDouble(key).toFloat(); sx *= v; sy *= v }
          3 -> if (op.getType(key) == ReadableType.Number) sx *= op.getDouble(key).toFloat()
          4 -> if (op.getType(key) == ReadableType.Number) sy *= op.getDouble(key).toFloat()
          else -> rot += angle(op, key)
        }
        break
      }
    }
    Props.setTransform(view, st, tx, ty, sx, sy, rot)
  }

  /** Degrees from a number (radians) or "12deg" / "0.5rad". */
  private fun angle(op: ReadableMap, key: String): Float {
    if (op.getType(key) == ReadableType.Number) return Math.toDegrees(op.getDouble(key)).toFloat()
    val s = op.getString(key)?.trim() ?: return 0f
    return when {
      s.endsWith("deg") -> s.removeSuffix("deg").toFloatOrNull() ?: 0f
      s.endsWith("rad") -> s.removeSuffix("rad").toDoubleOrNull()?.let { Math.toDegrees(it).toFloat() } ?: 0f
      else -> 0f
    }
  }

  private fun setBackground(view: View, st: expo.modules.svelteengine.views.NodeState, color: Int) {
    if (st.bg == color) return
    st.engineBox?.let { return BoxStyle.setEngineBackground(it, st, color) }
    if (st.boxStyle) return BoxStyle.setBackground(view, st, color)
    st.bg = color
    var d = st.drawable
    if (d == null) {
      if ((color ushr 24) == 0) return
      d = GradientDrawable()
      st.drawable = d
      view.background = d
      applyRadii(d, st.radii)
    }
    d.setColor(color)
  }

  private fun setRadius(view: View, st: expo.modules.svelteengine.views.NodeState, px: Float) = setRadii(view, st, px, px, px, px)

  /** Corner radii in px, in the order of prop record 3: top-left, top-right, bottom-right, bottom-left. */
  private fun setRadii(view: View, st: expo.modules.svelteengine.views.NodeState, tl: Float, tr: Float, br: Float, bl: Float) {
    val r = st.radii
    if (r[0] == tl && r[1] == tr && r[2] == br && r[3] == bl) return
    // A radius that makes another drawable draw the box (a divider that is given round corners) is a commit's work: the box is built again from what the node has.
    if (BoxStyle.radiiMoveBox(st, tl, tr, br, bl)) return Commands.restyle(view, st, tl, tr, br, bl)
    st.engineBox?.let { return BoxStyle.setEngineRadii(view, it, st, tl, tr, br, bl) }
    if (st.boxStyle) return BoxStyle.setRadii(view, st, tl, tr, br, bl)
    r[0] = tl; r[1] = tr; r[2] = br; r[3] = bl
    st.drawable?.let { applyRadii(it, r) }
    // An overflow-hidden view with a rounded outline clip re-reads st.radii here.
    if (st.outlineClip) view.invalidateOutline()
  }

  private fun applyRadii(d: GradientDrawable, r: FloatArray) {
    if (r[0] == r[1] && r[1] == r[2] && r[2] == r[3]) d.cornerRadius = r[0]
    else d.cornerRadii = floatArrayOf(r[0], r[0], r[1], r[1], r[2], r[2], r[3], r[3])
  }

  /** Colour and font size for text; the layout is rebuilt only when a value actually changed. */
  private fun applyText(view: EngineText, props: ReadableMap, density: Float) {
    val frags = view.spec?.fragments ?: return // prepared (native) layouts cannot be restyled
    if (frags.isEmpty()) return
    val color = if (props.hasKey("color") && props.getType("color") == ReadableType.Number) props.getDouble("color").toLong().toInt() else null
    val size = if (props.hasKey("fontSize") && props.getType("fontSize") == ReadableType.Number) (props.getDouble("fontSize") * density).toFloat() else null
    if (color == null && size == null) return
    var changed = false
    for (i in 0 until frags.size) {
      val f = frags[i]
      val c = color ?: f.color
      val s = size ?: f.size
      if (c != f.color || s != f.size) {
        frags[i] = f.restyled(s, c)
        changed = true
      }
    }
    if (changed) view.rebuild()
  }
}
