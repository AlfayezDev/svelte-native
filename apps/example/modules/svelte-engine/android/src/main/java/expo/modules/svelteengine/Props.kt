package expo.modules.svelteengine

import android.graphics.drawable.GradientDrawable
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.graphics.Outline
import expo.modules.svelteengine.views.EngineNode
import expo.modules.svelteengine.views.EngineScreen
import expo.modules.svelteengine.views.EngineView
import expo.modules.svelteengine.views.NodeState
import kotlin.math.max

class Fragment(
  val text: String,
  val size: Float,
  val color: Int,
  val weight: Int,
  val italic: Boolean,
  val family: String?,
  val letterSpacing: Float,
  val lineHeight: Float,
) {
  /** Record 24: bit 0 underline, bit 1 line-through, bit 2 has background colour. */
  var flags = 0
  /** 0 none, 1 uppercase, 2 lowercase, 3 capitalize. */
  var transform = 0
  var background = 0
  var opacity = Float.NaN
  var shadowDx = 0f
  var shadowDy = 0f
  var shadowRadius = 0f
  var shadowColor = 0
  /** `FontVariant` bit set of the Fabric attributes. */
  var variant = 0

  /** Same fragment with another colour and size (animated props). */
  fun restyled(size: Float, color: Int): Fragment {
    val f = Fragment(text, size, color, weight, italic, family, letterSpacing, lineHeight)
    f.flags = flags; f.transform = transform; f.background = background; f.opacity = opacity
    f.shadowDx = shadowDx; f.shadowDy = shadowDy; f.shadowRadius = shadowRadius; f.shadowColor = shadowColor
    f.variant = variant
    return f
  }

  /**
   * React Native gives a fragment its font span (which turns on subpixel and linear text, and so the advances it measures
   * with) only when a weight, a style or a family is set; plain default text is measured and drawn with the hinted paint.
   * Weight 0 is "not set".
   */
  val styled get() = weight != 0 || italic || family != null

  /** True when the fragment needs spans beyond what one base paint expresses. */
  val plain get() = flags == 0 && transform == 0 && opacity.isNaN() && shadowRadius == 0f && shadowDx == 0f && shadowDy == 0f && variant == 0
}

/** What the text view draws: paragraph options plus fragments, or a prepared layout. */
class TextSpec {
  var align = 0
  var maxLines = 0
  var ellipsize = 0
  /** 0 simple, 1 high quality, 2 balanced (Layout.BREAK_STRATEGY_* order differs, see TextLayouts). */
  var breakStrategy = 1
  var includeFontPadding = true
  /** 0 none, 1 normal, 2 full. */
  var hyphenation = 0
  var fit = false
  var minFontSize = Float.NaN
  /** 0 top/auto, 1 center, 2 bottom. */
  var vAlign = 0
  var rtl = false
  var fragments: ArrayList<Fragment>? = null
  var prepared: Any? = null
}

/** Scratch holder for one decoded prop record list; reused across calls. */
/** Record 15 bits (see PropsEncoder.cpp kViewFlags). */
internal const val VIEW_FLAG_OFFSCREEN_ALPHA = 1
internal const val VIEW_FLAG_HARDWARE_TEXTURE = 2
/** The node listens for `click` (a Pressable): clickable for accessibility services, see [A11y.setClickable]. */
internal const val VIEW_FLAG_CLICKABLE = 4

class PropSet {
  var bg = 0
  var opacity = 1f
  val radii = FloatArray(4)
  val border = FloatArray(4)
  var borderColor = 0
  val transform = floatArrayOf(0f, 0f, 1f, 1f, 0f)
  var overflow = 0
  var pointer = 0
  var zIndex = 0f
  var elevation = 0f
  var accessible = 0
  /** Record 15: bit 1 needsOffscreenAlphaCompositing, bit 2 renderToHardwareTextureAndroid. */
  var viewFlags = 0
  var role: String? = null
  var testID: String? = null
  var label: String? = null

  var textSeen = false
  var align = 0
  var maxLines = 0
  var ellipsize = 0
  var breakStrategy = 1
  var includeFontPadding = true
  var hyphenation = 0
  var fit = false
  var minFontSize = Float.NaN
  var vAlign = 0
  var rtl = false
  var fragments: ArrayList<Fragment>? = null
  var prepared: Any? = null

  var hitSlop: FloatArray? = null

  var horizontal = 0
  var indicator = 1
  var scrollEnabled = 1
  var scrollThrottle = 0f
  var contentOffsetX = 0f
  var contentOffsetY = 0f
  var paging = false
  var snapInterval = 0f
  /** 0 none, 1 start, 2 center, 3 end. */
  var snapAlignment = 0
  var disableIntervalMomentum = false
  var snapToStart = true
  var snapToEnd = true
  var snapOffsets: FloatArray? = null
  var decelerationRate = 0.998f
  /** 0 none, 1 on-drag, 2 interactive. */
  var keyboardDismiss = 0
  /** 0 auto, 1 always, 2 never. */
  var overScroll = 0

  /** Records of the view kinds 5..9 (PropsViews.kt). */
  val views = ViewProps()

  /** Records 110..139 of the navigation views (PropsNav.kt). */
  val nav = NavProps()

  /** A scroll record (30..39) was decoded since the last reset. */
  var scrollTouched = false

  /**
   * Called before every op's decode. Only the groups a record of the previous op touched are cleared: the common
   * fields always (every view has them), the text, scroll, view-kind and navigation groups only when one of their
   * records was decoded. A 60-row push decodes ~260 ops, and clearing ~110 fields for each of them was a third of the
   * mount's main-thread time while the engine ran interpreted.
   */
  fun reset() {
    if (views.touched) views.reset()
    if (nav.touched) nav.reset()
    bg = 0; opacity = 1f
    radii.fill(0f); border.fill(0f); borderColor = 0
    transform[0] = 0f; transform[1] = 0f; transform[2] = 1f; transform[3] = 1f; transform[4] = 0f
    overflow = 0; pointer = 0; zIndex = 0f; elevation = 0f; accessible = 0; viewFlags = 0; role = null; testID = null; label = null
    hitSlop = null
    if (textSeen) {
      textSeen = false; align = 0; maxLines = 0; ellipsize = 0; fragments = null; prepared = null
      breakStrategy = 1; includeFontPadding = true; hyphenation = 0; fit = false; minFontSize = Float.NaN; vAlign = 0; rtl = false
    }
    if (scrollTouched) {
      scrollTouched = false
      horizontal = 0; indicator = 1; scrollEnabled = 1; scrollThrottle = 0f
      contentOffsetX = 0f; contentOffsetY = 0f; paging = false; snapInterval = 0f; snapAlignment = 0
      disableIntervalMomentum = false; snapToStart = true; snapToEnd = true; snapOffsets = null
      decelerationRate = 0.998f; keyboardDismiss = 0; overScroll = 0
    }
  }
}

object Props {
  private fun f(ops: IntArray, i: Int) = Float.fromBits(ops[i])

  /** Decodes `n` records starting at [start] into [out]; returns the index after the last record. */
  fun decode(ops: IntArray, start: Int, n: Int, strings: Array<String>, objects: Array<Any?>, out: PropSet): Int {
    var i = start
    for (r in 0 until n) {
      val id = ops[i++]
      if (id in 30..39) out.scrollTouched = true
      when (id) {
        1 -> out.bg = ops[i++]
        2 -> out.opacity = f(ops, i++)
        3 -> { for (k in 0..3) out.radii[k] = f(ops, i + k); i += 4 }
        4 -> { for (k in 0..3) out.border[k] = f(ops, i + k); i += 4 }
        5 -> out.borderColor = ops[i++]
        6 -> { for (k in 0..4) out.transform[k] = f(ops, i + k); i += 5 }
        7 -> out.overflow = ops[i++]
        8 -> out.pointer = ops[i++]
        9 -> { out.zIndex = f(ops, i); out.elevation = f(ops, i + 1); i += 2 }
        10 -> out.testID = strings[ops[i++]]
        11 -> out.label = strings[ops[i++]]
        12 -> out.accessible = ops[i++]
        15 -> out.viewFlags = ops[i++]
        13 -> out.role = strings[ops[i++]]
        14 -> {
          val slop = out.hitSlop ?: FloatArray(4).also { out.hitSlop = it }
          for (k in 0..3) slop[k] = f(ops, i + k)
          i += 4
        }
        20 -> {
          out.textSeen = true
          out.align = ops[i]; out.maxLines = ops[i + 1]; out.ellipsize = ops[i + 2]; i += 3
        }
        21 -> {
          out.textSeen = true
          val frags = out.fragments ?: ArrayList<Fragment>(2).also { out.fragments = it }
          val familyIdx = ops[i + 5]
          frags.add(
            Fragment(
              text = strings[ops[i]],
              size = f(ops, i + 1),
              color = ops[i + 2],
              weight = ops[i + 3],
              italic = ops[i + 4] == 1,
              family = if (familyIdx >= 0) strings[familyIdx] else null,
              letterSpacing = f(ops, i + 6),
              lineHeight = f(ops, i + 7),
            )
          )
          i += 8
        }
        22 -> { out.textSeen = true; out.prepared = objects[ops[i++]] }
        23 -> {
          out.textSeen = true
          out.breakStrategy = ops[i]; out.includeFontPadding = ops[i + 1] == 1; out.hyphenation = ops[i + 2]
          out.fit = ops[i + 3] == 1; out.minFontSize = f(ops, i + 4); out.vAlign = ops[i + 5]; out.rtl = ops[i + 6] == 1
          i += 7
        }
        24 -> {
          val fr = out.fragments?.lastOrNull() ?: throw IllegalStateException("SvelteEngine: fragment extra without fragment")
          fr.flags = ops[i]; fr.transform = ops[i + 1]; fr.background = ops[i + 2]; fr.opacity = f(ops, i + 3)
          fr.shadowDx = f(ops, i + 4); fr.shadowDy = f(ops, i + 5); fr.shadowRadius = f(ops, i + 6); fr.shadowColor = ops[i + 7]
          fr.variant = ops[i + 8]
          i += 9
        }
        in 110..139 -> i = PropsNav.decode(id, ops, i, strings, out.nav)
        in 40..109 -> i = PropsViews.decode(id, ops, i, strings, out.views)
        30 -> out.horizontal = ops[i++]
        31 -> out.indicator = ops[i++]
        32 -> out.scrollEnabled = ops[i++]
        33 -> out.scrollThrottle = f(ops, i++)
        34 -> { out.contentOffsetX = f(ops, i); out.contentOffsetY = f(ops, i + 1); i += 2 }
        35 -> {
          out.paging = ops[i] == 1; out.snapInterval = f(ops, i + 1); out.snapAlignment = ops[i + 2]
          out.disableIntervalMomentum = ops[i + 3] == 1; out.snapToStart = ops[i + 4] == 1; out.snapToEnd = ops[i + 5] == 1
          i += 6
        }
        36 -> {
          val n = ops[i++]
          out.snapOffsets = FloatArray(n) { f(ops, i + it) }
          i += n
        }
        37 -> out.decelerationRate = f(ops, i++)
        38 -> out.keyboardDismiss = ops[i++]
        39 -> out.overScroll = ops[i++]
        else -> throw IllegalStateException("SvelteEngine: unknown prop id $id at ${i - 1}")
      }
    }
    return i
  }

  /** Applies the props every view kind shares. The record is complete, so absent props reset to defaults. */
  fun applyCommon(view: View, st: NodeState, p: PropSet, create: Boolean) {
    // background, radii, border
    val radiiChanged = create || !st.radii.contentEquals(p.radii)
    val borderChanged = create || !st.border.contentEquals(p.border) || st.borderColor != p.borderColor
    val bgChanged = create || st.bg != p.bg
    if (radiiChanged || borderChanged || bgChanged) {
      p.radii.copyInto(st.radii)
      p.border.copyInto(st.border)
      st.borderColor = p.borderColor
      st.bg = p.bg
      val hasRadius = p.radii.any { it > 0f }
      val borderW = max(max(p.border[0], p.border[1]), max(p.border[2], p.border[3]))
      val need = (p.bg ushr 24) != 0 || hasRadius || borderW > 0f
      if (need) {
        var d = st.drawable
        if (d == null) {
          d = GradientDrawable()
          st.drawable = d
          view.background = d
        }
        if (bgChanged) d.setColor(p.bg)
        if (radiiChanged) {
          val r = p.radii
          if (r[0] == r[1] && r[1] == r[2] && r[2] == r[3]) {
            d.cornerRadius = r[0]
          } else {
            d.cornerRadii = floatArrayOf(r[0], r[0], r[1], r[1], r[2], r[2], r[3], r[3])
          }
        }
        if (borderChanged) {
          d.setStroke(Math.round(borderW), p.borderColor)
        }
      } else if (st.drawable != null) {
        st.drawable = null
        view.background = null
      }
    }

    // A screen's translation and alpha belong to its stack transitions (EngineStack).
    if (view !is EngineScreen && view.alpha != p.opacity) view.alpha = p.opacity

    // transform
    val t = p.transform
    if (view !is EngineScreen) setTransform(view, st, t[0], t[1], t[2], t[3], t[4])

    // overflow and outline clip
    st.overflow = p.overflow
    val hidden = p.overflow == 1
    if (view is EngineView) view.hidesOverflow = hidden else if (view is ViewGroup) view.clipChildren = hidden
    val maxRadius = max(max(p.radii[0], p.radii[1]), max(p.radii[2], p.radii[3]))
    if (hidden && maxRadius > 0f) {
      if (!st.outlineClip) {
        st.outlineClip = true
        view.outlineProvider = RoundedOutline(st)
        view.clipToOutline = true
      } else if (radiiChanged) {
        view.invalidateOutline()
      }
    } else if (st.outlineClip) {
      st.outlineClip = false
      view.clipToOutline = false
      view.outlineProvider = ViewOutlineProvider.BACKGROUND
    }

    st.pointer = p.pointer
    val slop = p.hitSlop
    if (slop == null) {
      st.hitSlop = null
    } else {
      val dst = st.hitSlop ?: FloatArray(4).also { st.hitSlop = it }
      slop.copyInto(dst)
    }
    setStacking(view, st, p.zIndex, p.elevation)
    if (st.viewFlags != p.viewFlags) {
      st.viewFlags = p.viewFlags
      val offscreen = p.viewFlags and VIEW_FLAG_OFFSCREEN_ALPHA != 0
      if (view is EngineView && view.offscreenAlpha != offscreen) {
        view.offscreenAlpha = offscreen
        view.invalidate()
      }
      // Screens run their own layers (transitions, the resident layer); the hardware-texture prop is for ordinary views.
      if (view !is EngineScreen) {
        val type = if (p.viewFlags and VIEW_FLAG_HARDWARE_TEXTURE != 0) View.LAYER_TYPE_HARDWARE else View.LAYER_TYPE_NONE
        if (view.layerType != type) view.setLayerType(type, null)
      }
      A11y.setClickable(view, p.viewFlags and VIEW_FLAG_CLICKABLE != 0)
    }
    A11y.apply(view, st, p)
  }

  /**
   * Translate (px), scale and rotation (degrees) about the view centre; shared by committed props (prop 6) and
   * animated writes (AnimatedProps) so both decompose and pivot the same way.
   */
  fun setTransform(view: View, st: NodeState, tx: Float, ty: Float, sx: Float, sy: Float, rot: Float) {
    val identity = tx == 0f && ty == 0f && sx == 1f && sy == 1f && rot == 0f
    if (!identity || st.transformed) {
      view.translationX = tx
      view.translationY = ty
      view.scaleX = sx
      view.scaleY = sy
      view.rotation = rot
      st.transformed = !identity
      if (!identity) {
        view.pivotX = view.width / 2f
        view.pivotY = view.height / 2f
      }
    }
  }

  /** zIndex orders siblings (draw order and hit order); elevation (px) is View.elevation. See EngineView. */
  fun setStacking(view: View, st: NodeState, zIndex: Float, elevation: Float) {
    if (st.zIndex == zIndex && st.elevation == elevation) return
    val wasStacked = st.zIndex != 0f || st.elevation != 0f
    st.zIndex = zIndex
    st.elevation = elevation
    if (view.elevation != elevation) view.elevation = elevation
    (view.parent as? EngineView)?.stackingChanged(wasStacked, zIndex != 0f || elevation != 0f)
  }

  fun textSpecFrom(p: PropSet): TextSpec = TextSpec().also {
    it.align = p.align
    it.maxLines = p.maxLines
    it.ellipsize = p.ellipsize
    it.breakStrategy = p.breakStrategy
    it.includeFontPadding = p.includeFontPadding
    it.hyphenation = p.hyphenation
    it.fit = p.fit
    it.minFontSize = p.minFontSize
    it.vAlign = p.vAlign
    it.rtl = p.rtl
    it.fragments = p.fragments
    it.prepared = p.prepared
  }
}

private class RoundedOutline(private val st: NodeState) : ViewOutlineProvider() {
  override fun getOutline(view: View, outline: Outline) {
    val r = st.radii
    val radius = max(max(r[0], r[1]), max(r[2], r[3]))
    outline.setRoundRect(0, 0, view.width, view.height, radius)
  }
}
