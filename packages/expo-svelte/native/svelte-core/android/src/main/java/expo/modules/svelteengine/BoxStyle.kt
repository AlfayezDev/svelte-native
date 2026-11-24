package expo.modules.svelteengine

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
 * `ReactViewManager` calls for the same props, so the pixels are React Native's by construction (outset and inset shadows, dashed and dotted borders, a colour per side,
 * the order they are drawn in). The engine's plain background (a `GradientDrawable`, `Props.applyCommon`) stays for every view that needs none of it: it is cheaper to
 * make, and a fill with no border is all it has to draw. [StyleRules.needsReactDrawables] says which is which (a shadow, or a border that shows, is React Native's); a view moves
 * from one to the other when its style does.
 *
 * The values are the ones Fabric resolved (the border widths, colours and radii of the physical sides, in px): React Native's drawables take dp and resolve their edges again
 * by the layout direction of the view, so the lengths are divided by the density and the sides go to `START` and `END` as the app's direction says ([StyleRules.edges]).
 * Main thread only.
 */
internal object BoxStyle {
  /** Writes the box of [p] onto [view] through React Native's drawables, setting only what differs from what [st] says is on the view. */
  fun apply(view: View, st: NodeState, p: PropSet, shadows: IntArray?) {
    val fresh = !st.boxStyle
    val rtl = view.isRtlLayout()
    val density = view.resources.displayMetrics.density
    if (fresh) {
      // The plain background goes: React Native's drawables are layered over whatever the view has.
      st.drawable = null
      view.background = null
      st.boxStyle = true
    }
    val all = fresh || st.boxRtl != rtl
    st.boxRtl = rtl

    if (all || !st.boxRadii.contentEquals(p.radii)) {
      val corners = StyleRules.corners(rtl)
      for (k in 0..3) {
        val radius = if (p.radii[k] > 0f) LengthPercentage(p.radii[k] / density, LengthPercentageType.POINT) else null
        BackgroundStyleApplicator.setBorderRadius(view, BorderRadiusProp.valueOf(corners[k]), radius)
      }
      p.radii.copyInto(st.boxRadii)
    }
    p.radii.copyInto(st.radii)
    // Widths and colours: `borderWidth` and `borderColor` (the ALL edge) when the sides agree, a side each when they do not. React Native's rounded border draws its
    // dashes and dots only from the ALL width and colour (`BorderDrawable.drawRoundedBorders`), as a style of `borderWidth` and `borderColor` sets them.
    if (all || !st.boxBorder.contentEquals(p.border)) {
      val edges = StyleRules.edges(rtl)
      val uniform = StyleRules.uniform(p.border)
      BackgroundStyleApplicator.setBorderWidth(view, LogicalEdge.ALL, if (uniform) p.border[0] / density else null)
      for (side in 0..3) BackgroundStyleApplicator.setBorderWidth(view, LogicalEdge.valueOf(edges[side]), if (uniform) null else p.border[side] / density)
      p.border.copyInto(st.boxBorder)
    }
    p.border.copyInto(st.border)
    if (all || !st.boxColors.contentEquals(p.sideColors)) {
      val edges = StyleRules.edges(rtl)
      val uniform = StyleRules.uniform(p.sideColors)
      BackgroundStyleApplicator.setBorderColor(view, LogicalEdge.ALL, if (uniform) p.sideColors[0] else null)
      for (side in 0..3) BackgroundStyleApplicator.setBorderColor(view, LogicalEdge.valueOf(edges[side]), if (uniform) null else p.sideColors[side])
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
  }
}
