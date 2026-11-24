package expo.modules.svelteengine

import android.graphics.Canvas
import android.view.View
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.uimanager.LengthPercentage
import com.facebook.react.uimanager.LengthPercentageType
import com.facebook.react.uimanager.style.BorderRadiusProp
import com.facebook.react.uimanager.style.BorderStyle
import com.facebook.react.uimanager.style.BoxShadow
import com.facebook.react.uimanager.style.LogicalEdge
import expo.modules.svelteengine.views.NodeState
import expo.modules.svelteengine.views.isRtlLayout

/**
 * A view's background, border and box shadows drawn by React Native's own drawables (SPEC.md, "Box styles"): `BackgroundStyleApplicator`, which is what
 * `ReactViewManager` calls for the same props, so the pixels are React Native's by construction (outset and inset shadows, dashed and dotted borders with round corners, sides of
 * different widths or colours with round corners, the order they are drawn in). The engine's plain background (a `GradientDrawable`, `Props.applyCommon`) stays for every view that needs
 * none of it: it is cheaper to make, and a fill with no border is all it has to draw. [StyleRules.boxKind] says which is which; [BoxDrawable] is the engine's own drawable for the
 * common bordered boxes, which copies what these drawables draw for them in one drawable; a view moves from one to another when its style does.
 *
 * The values are the ones Fabric resolved (the border widths, colours and radii of the physical sides, in px): React Native's drawables take dp and resolve their edges again
 * by the layout direction of the view, so the lengths are divided by the density and the sides go to `START` and `END` as that direction says ([StyleRules.edges]). The direction is the
 * app's configuration while the view is detached, where it has none yet (a view in the pool, a screen laid out before it is attached), and the view's own once it resolves it
 * ([directionChanged], called by the view's `onRtlPropertiesChanged`), which is the direction the drawables resolve by. Main thread only.
 */
internal object BoxStyle {
  /** Writes the box of [p] onto [view] through React Native's drawables, setting only what differs from what [st] says is on the view. */
  fun apply(view: View, st: NodeState, p: PropSet, shadows: IntArray?) {
    val fresh = !st.boxStyle
    val rtl = directionOf(view)
    val density = view.resources.displayMetrics.density
    if (fresh) {
      // The plain background goes: React Native's drawables are layered over whatever the view has.
      st.drawable = null
      view.background = null
      st.boxStyle = true
    }
    val all = fresh || st.boxRtl != rtl
    st.boxRtl = rtl

    // The outline of the view (what a clip to it and the shadow of `elevation` follow) is asked for again when the radii or the widths changed: the drawables say so to the view only
    // when it is attached, and a view that is not asks for it when it is.
    var outline = false
    if (all || !st.boxRadii.contentEquals(p.radii)) {
      writeRadii(view, rtl, density, p.radii)
      p.radii.copyInto(st.boxRadii)
      outline = true
    }
    p.radii.copyInto(st.radii)
    // Widths and colours: `borderWidth` and `borderColor` (the ALL edge) when the sides agree, a side each when they do not. React Native's rounded border draws its
    // dashes and dots only from the ALL width and colour (`BorderDrawable.drawRoundedBorders`), as a style of `borderWidth` and `borderColor` sets them.
    if (all || !st.boxBorder.contentEquals(p.border)) {
      writeWidths(view, rtl, density, p.border)
      p.border.copyInto(st.boxBorder)
      outline = true
    }
    p.border.copyInto(st.border)
    if (all || !st.boxColors.contentEquals(p.sideColors)) {
      writeColors(view, rtl, p.sideColors)
      p.sideColors.copyInto(st.boxColors)
    }
    st.borderColor = p.borderColor
    if (all || st.boxBorderStyle != p.style.borderStyle) {
      BackgroundStyleApplicator.setBorderStyle(view, BorderStyle.fromString(StyleRules.BORDER_STYLES[p.style.borderStyle]))
      st.boxBorderStyle = p.style.borderStyle
    }
    if (all || st.boxBg != p.bg) {
      BackgroundStyleApplicator.setBackgroundColor(view, p.bg)
      st.boxBg = p.bg
    }
    st.bg = p.bg
    val applied = st.boxShadows
    val same = if (applied == null || shadows == null) applied == null && shadows == null else applied.contentEquals(shadows)
    if (!same) {
      BackgroundStyleApplicator.setBoxShadow(view, layers(shadows))
      st.boxShadows = shadows
      st.boxOutset = StyleRules.hasOutset(shadows)
    }
    if (outline) view.invalidateOutline()
  }

  /** The direction React Native's drawables resolve by: the view's own once it is attached (it resolves it then), the app's configuration before (a detached view answers left to right, whatever the app is). */
  private fun directionOf(view: View): Boolean =
    if (view.isAttachedToWindow) view.layoutDirection == View.LAYOUT_DIRECTION_RTL else view.isRtlLayout()

  private fun writeRadii(view: View, rtl: Boolean, density: Float, radii: FloatArray) {
    val corners = StyleRules.corners(rtl)
    for (k in 0..3) {
      val radius = if (radii[k] > 0f) LengthPercentage(radii[k] / density, LengthPercentageType.POINT) else null
      BackgroundStyleApplicator.setBorderRadius(view, BorderRadiusProp.valueOf(corners[k]), radius)
    }
  }

  private fun writeWidths(view: View, rtl: Boolean, density: Float, widths: FloatArray) {
    val edges = StyleRules.edges(rtl)
    val uniform = StyleRules.uniform(widths)
    BackgroundStyleApplicator.setBorderWidth(view, LogicalEdge.ALL, if (uniform) widths[0] / density else null)
    for (side in 0..3) BackgroundStyleApplicator.setBorderWidth(view, LogicalEdge.valueOf(edges[side]), if (uniform) null else widths[side] / density)
  }

  private fun writeColors(view: View, rtl: Boolean, colors: IntArray) {
    val edges = StyleRules.edges(rtl)
    val uniform = StyleRules.uniform(colors)
    BackgroundStyleApplicator.setBorderColor(view, LogicalEdge.ALL, if (uniform) colors[0] else null)
    for (side in 0..3) BackgroundStyleApplicator.setBorderColor(view, LogicalEdge.valueOf(edges[side]), if (uniform) null else colors[side])
  }

  /**
   * The view resolved its layout direction (`View.onRtlPropertiesChanged`, which comes just before its drawables are given the same direction): React Native's drawables resolve their edges
   * by it, so the sides, written by the configuration's direction while the view had none, go to the edges that direction names. Nothing to do for the engine's own drawable, which has
   * physical sides, or for a view React Native's drawables do not draw.
   */
  fun directionChanged(view: View, st: NodeState, layoutDirection: Int) {
    if (!st.boxStyle) return
    val rtl = layoutDirection == View.LAYOUT_DIRECTION_RTL
    if (st.boxRtl == rtl) return
    st.boxRtl = rtl
    val density = view.resources.displayMetrics.density
    writeRadii(view, rtl, density, st.boxRadii)
    writeWidths(view, rtl, density, st.boxBorder)
    writeColors(view, rtl, st.boxColors)
    view.invalidateOutline()
  }

  private val radiiDp = FloatArray(4)
  private val widthsDp = FloatArray(4)

  /** Writes the box of [p] onto [view] through its [BoxDrawable] (made when the view has none), which does what React Native's drawables do for it. */
  fun applyEngine(view: View, st: NodeState, p: PropSet) {
    var box = st.engineBox
    if (box == null) {
      box = BoxDrawable()
      // The plain background goes: the drawable is the view's background.
      st.drawable = null
      view.background = box
      st.engineBox = box
    }
    val density = view.resources.displayMetrics.density
    for (k in 0..3) {
      radiiDp[k] = p.radii[k] / density
      widthsDp[k] = p.border[k] / density
    }
    if (box.set(p.bg, p.sideColors, widthsDp, radiiDp, p.style.borderStyle)) view.invalidateOutline()
    p.radii.copyInto(st.radii)
    p.border.copyInto(st.border)
    st.bg = p.bg
    st.borderColor = p.borderColor
  }

  /** Takes the [BoxDrawable] off [view] (a recycled view keeps it while its next node has one too): `Props.applyCommon` builds the box from nothing. */
  fun dropEngine(view: View, st: NodeState) {
    if (view.background === st.engineBox) view.background = null
    st.engineBox = null
    st.bg = 0
    st.radii.fill(0f)
    st.border.fill(0f)
    st.borderColor = 0
  }

  /** The layers of record 140 as React Native's `BoxShadow`s (dp, as the style gave them), in the style's order. */
  private fun layers(raw: IntArray?): List<BoxShadow> {
    val count = StyleRules.layerCount(raw)
    if (raw == null || count == 0) return emptyList()
    val per = StyleRecords.SHADOW_INTS
    return List(count) { k ->
      val at = k * per
      BoxShadow(
        offsetX = Float.fromBits(raw[at]),
        offsetY = Float.fromBits(raw[at + 1]),
        color = raw[at + 4],
        blurRadius = Float.fromBits(raw[at + 2]),
        spreadDistance = Float.fromBits(raw[at + 3]),
        inset = raw[at + 5] != 0,
      )
    }
  }

  /** Takes React Native's drawables off [view]: the view is a plain box again (or a recycled one), and `Props.applyCommon` builds its background from nothing. */
  fun drop(view: View, st: NodeState) {
    BackgroundStyleApplicator.reset(view)
    if (view.background != null) view.background = null
    st.boxStyle = false
    st.boxShadows = null
    st.boxOutset = false
    st.boxBorderStyle = 0
    st.boxColors.fill(0)
    st.boxRadii.fill(0f)
    st.boxBorder.fill(0f)
    st.boxBg = 0
    // What the plain path compares with: nothing is drawn, so every colour, width and radius of the next record is a change.
    st.bg = 0
    st.radii.fill(0f)
    st.border.fill(0f)
    st.borderColor = 0
  }

  /** An animated `backgroundColor` or corner radius (px, in the order of record 3) of a view whose box is a [BoxDrawable]. */
  fun setEngineBackground(box: BoxDrawable, st: NodeState, color: Int) {
    st.bg = color
    box.setFill(color)
  }

  fun setEngineRadii(view: View, box: BoxDrawable, st: NodeState, tl: Float, tr: Float, br: Float, bl: Float) {
    val r = st.radii
    r[0] = tl; r[1] = tr; r[2] = br; r[3] = bl
    val density = view.resources.displayMetrics.density
    for (k in 0..3) radiiDp[k] = r[k] / density
    box.setRadii(radiiDp)
    view.invalidateOutline()
  }

  /** An animated `backgroundColor` of a view React Native's drawables draw. */
  fun setBackground(view: View, st: NodeState, color: Int) {
    st.bg = color
    st.boxBg = color
    BackgroundStyleApplicator.setBackgroundColor(view, color)
  }

  /** An animated corner radius (px, in the order of record 3) of a view React Native's drawables draw. */
  fun setRadii(view: View, st: NodeState, tl: Float, tr: Float, br: Float, bl: Float) {
    val r = st.radii
    r[0] = tl; r[1] = tr; r[2] = br; r[3] = bl
    r.copyInto(st.boxRadii)
    val density = view.resources.displayMetrics.density
    val corners = StyleRules.corners(st.boxRtl)
    for (k in 0..3) {
      val radius = if (r[k] > 0f) LengthPercentage(r[k] / density, LengthPercentageType.POINT) else null
      BackgroundStyleApplicator.setBorderRadius(view, BorderRadiusProp.valueOf(corners[k]), radius)
    }
    // The clip to the view's outline (a view that is not an `EngineView`) and the shadow of `elevation` follow the corners: the outline is asked for again.
    view.invalidateOutline()
  }

  /**
   * `overflow: hidden` for a view whose box is drawn by [BoxDrawable] or React Native's drawables: the clip to the padding box (`BackgroundStyleApplicator.clipToPaddingBox`), with nothing
   * allocated for it. False when the view has neither (the caller clips as it does for a plain box).
   */
  fun clipToPaddingBox(view: View, st: NodeState, canvas: Canvas): Boolean {
    val box = st.engineBox
    if (box != null) {
      box.clipToPaddingBox(view, canvas)
      return true
    }
    if (!st.boxStyle) return false
    val clip = st.boxClip ?: PaddingBoxClip().also { st.boxClip = it }
    clip.clipPx(view, canvas, st.boxRadii, st.boxBorder)
    return true
  }
}
