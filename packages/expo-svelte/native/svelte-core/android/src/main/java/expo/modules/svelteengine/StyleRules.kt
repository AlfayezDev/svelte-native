package expo.modules.svelteengine

/**
 * What the engine decides about box styles without asking Android, as plain numbers and names so the host can check it (SPEC.md, "Box styles"): which views leave the plain
 * background to React Native's own drawables, which edge and corner of React Native's styles stand for a side of the box, where a view pivots.
 */
internal object StyleRules {
  const val BLACK = 0xFF000000.toInt()

  /** `borderStyle` of record 141. */
  val BORDER_STYLES = arrayOf("solid", "dashed", "dotted")

  // The layers of a `boxShadow` are record 140's ints ([StyleRecords.SHADOW_INTS] each, the style's order, first on top: `BackgroundStyleApplicator` stacks them the other way round).
  // Every layer counts, a fully transparent one too (`0 0 0 0 transparent`, the focus ring switched off): React Native makes a drawable for it and draws the view's border with its own
  // `BorderDrawable`, so the view's border is drawn the same whether the ring is on or off.
  fun colorOf(layers: IntArray, k: Int): Int = layers[k * StyleRecords.SHADOW_INTS + 4]
  fun isInset(layers: IntArray, k: Int): Boolean = layers[k * StyleRecords.SHADOW_INTS + 5] != 0
  fun layerCount(layers: IntArray?): Int = if (layers == null) 0 else layers.size / StyleRecords.SHADOW_INTS

  /** True when one of the layers is outset: it draws outside the view's bounds, which a clip to the view's outline would cut off. */
  fun hasOutset(layers: IntArray?): Boolean {
    for (k in 0 until layerCount(layers)) if (!isInset(layers!!, k)) return true
    return false
  }

  /**
   * The colour of each side (left, top, right, bottom) the way React Native draws it: the colour the style gave the side, black when it gave none. [uniform] is record 5, the one
   * colour of a border whose sides agree, and what every side has when record 141 is absent.
   */
  fun sideColors(style: StyleRecords, uniform: Int, out: IntArray) {
    for (side in 0..3) {
      out[side] = if (!style.hasSides) uniform else if (style.sideMask and (1 shl side) != 0) style.sideColors[side] else BLACK
    }
  }

  fun uniform(values: FloatArray): Boolean = values[0] == values[1] && values[1] == values[2] && values[2] == values[3]
  fun uniform(values: IntArray): Boolean = values[0] == values[1] && values[1] == values[2] && values[2] == values[3]

  /** Who draws a view's box. */
  const val BOX_PLAIN = 0
  const val BOX_ENGINE = 1
  const val BOX_REACT = 2

  fun hasRadius(radii: FloatArray): Boolean = radii[0] > 0f || radii[1] > 0f || radii[2] > 0f || radii[3] > 0f

  /**
   * `BorderDrawable.fastBorderCompatibleColorOrZero` for the engine's px widths ([widths]: left, top, right, bottom, each rounded to a pixel as `drawRectangularBorders` rounds it) and
   * colours ([colors], the same order): the one colour every side that has a width has, when none of the four colours is translucent, else 0. Such a border is drawn as one stroke along the
   * middle of each side; any other as four quadrilaterals.
   */
  fun fastBorderColor(widths: FloatArray, colors: IntArray): Int {
    for (side in 0..3) if ((colors[side] ushr 24) < 255) return 0
    var smearAnd = -1
    var smearOr = 0
    for (side in 0..3) if (Math.round(widths[side]) > 0) {
      smearAnd = smearAnd and colors[side]
      smearOr = smearOr or colors[side]
    }
    return if (smearAnd == smearOr) smearAnd else 0
  }

  /**
   * Who draws the box of a view (`Props.applyCommon`; SPEC.md, "Box styles"):
   * - [BOX_PLAIN], the engine's `GradientDrawable`: a fill with no border and one radius for every corner (the same pixels as React Native's).
   * - [BOX_ENGINE], `BoxDrawable`, which draws what React Native's `BackgroundDrawable` and `BorderDrawable` draw for it, in one drawable with no layers: a fill with corners of different
   *   radii (a `GradientDrawable` scales radii that overflow together, React Native's scale each corner); a solid border of one width and one colour with any radii; a border of square
   *   corners whose sides have their own widths or colours (a divider is a bottom border only), solid, or dashed and dotted when it is one colour.
   * - [BOX_REACT], React Native's own drawables (`BackgroundStyleApplicator`): a box shadow (a layer that is off counts), and a border that is dashed or dotted with round corners, or of
   *   sides of different widths or colours with round corners.
   * [widths], [colors] (see [sideColors]) and [radii] are the four sides and corners in px, left, top, right, bottom and top left, top right, bottom right, bottom left.
   */
  fun boxKind(shadows: IntArray?, widths: FloatArray, colors: IntArray, borderStyle: Int, radii: FloatArray): Int {
    if (shadows != null) return BOX_REACT
    val rounded = hasRadius(radii)
    if (widest(widths) <= 0f) return if (rounded && !uniform(radii)) BOX_ENGINE else BOX_PLAIN
    if (!rounded) return if (borderStyle == 0 || fastBorderColor(widths, colors) != 0) BOX_ENGINE else BOX_REACT
    return if (borderStyle == 0 && uniform(widths) && uniform(colors)) BOX_ENGINE else BOX_REACT
  }

  /**
   * Whether new corner [radii] (an animated `borderRadius`; px) change who draws a box whose drawable is [current] (a `BOX_*`), the widths in px, colours and style being what the box
   * has: a divider that is given a radius is a border of round corners with one side, which only React Native's drawables draw. React Native's draw every box, so they stay.
   */
  fun radiiMoveBox(current: Int, widths: FloatArray, colors: IntArray, borderStyle: Int, radii: FloatArray): Boolean =
    current != BOX_REACT && boxKind(null, widths, colors, borderStyle, radii) != current

  fun widest(widths: FloatArray): Float = maxOf(maxOf(widths[0], widths[1]), maxOf(widths[2], widths[3]))

  /**
   * `BorderRadiusStyle.ensureNoOverlap`: corner radii (dp; [r] holds top left, top right, bottom right and bottom left, a horizontal and a vertical radius each) reduced in proportion
   * where two of them would meet on an edge of the box ([width] and [height], dp). A side with no radius has a scale of 0, as in React Native, which only a corner without a radius reads.
   */
  fun ensureNoOverlap(r: FloatArray, width: Float, height: Float) {
    val tlh = r[0]; val tlv = r[1]; val trh = r[2]; val trv = r[3]
    val brh = r[4]; val brv = r[5]; val blh = r[6]; val blv = r[7]
    val leftEdgeRadii = tlv + blv
    val topEdgeRadii = tlh + trh
    val rightEdgeRadii = trv + brv
    val bottomEdgeRadii = blh + brh
    val leftEdgeRadiiScale = if (leftEdgeRadii > 0) minOf(height / leftEdgeRadii, 1f) else 0f
    val topEdgeRadiiScale = if (topEdgeRadii > 0) minOf(width / topEdgeRadii, 1f) else 0f
    val rightEdgeRadiiScale = if (rightEdgeRadii > 0) minOf(height / rightEdgeRadii, 1f) else 0f
    val bottomEdgeRadiiScale = if (bottomEdgeRadii > 0) minOf(width / bottomEdgeRadii, 1f) else 0f
    r[0] = tlh * minOf(topEdgeRadiiScale, leftEdgeRadiiScale)
    r[1] = tlv * minOf(topEdgeRadiiScale, leftEdgeRadiiScale)
    r[2] = trh * minOf(rightEdgeRadiiScale, topEdgeRadiiScale)
    r[3] = trv * minOf(rightEdgeRadiiScale, topEdgeRadiiScale)
    r[4] = brh * minOf(bottomEdgeRadiiScale, rightEdgeRadiiScale)
    r[5] = brv * minOf(bottomEdgeRadiiScale, rightEdgeRadiiScale)
    r[6] = blh * minOf(bottomEdgeRadiiScale, leftEdgeRadiiScale)
    r[7] = blv * minOf(bottomEdgeRadiiScale, leftEdgeRadiiScale)
  }

  /**
   * The side (0 left, 1 top, 2 right, 3 bottom) a colour key of `setNativeProps` is for, -1 for a key that is not one. `start` and `end` are the leading and trailing side; in a right-to-left
   * layout that swaps left and right (`swapLeftAndRight`: React Native's default on Android, `I18nUtil.doLeftAndRightSwapInRTL`) `left` is the trailing side and `right` the leading one,
   * as Fabric's props and `BorderColors.resolve` have them.
   */
  fun sideOfColorKey(key: String, rtl: Boolean, swapLeftAndRight: Boolean): Int = when (key) {
    "borderTopColor" -> 1
    "borderBottomColor" -> 3
    "borderStartColor" -> if (rtl) 2 else 0
    "borderEndColor" -> if (rtl) 0 else 2
    "borderLeftColor" -> if (rtl && swapLeftAndRight) 2 else 0
    "borderRightColor" -> if (rtl && swapLeftAndRight) 0 else 2
    else -> -1
  }

  /**
   * What `setNativeProps` does to the sides of [style] (record 141's state), as React Native's `setBorderColor` and `setBorderStyle` do to the edges of its drawables, so far as the
   * engine can tell the edges apart (it holds the colour each side resolved to, not which edge gave it): `borderColor` colours every side; the colour of one side takes that side only
   * (the others keep what they had, or [uniform], the border's own colour, when the border had one colour); `borderStyle` dashed or dotted makes the border one that needs record 141.
   */
  fun setBorderColor(style: StyleRecords, color: Int) {
    if (style.hasSides) {
      style.sideMask = 15
      style.sideColors.fill(color)
    }
  }

  fun setSideColor(style: StyleRecords, side: Int, color: Int, uniform: Int) {
    if (!style.hasSides) {
      style.hasSides = true
      style.sideMask = 15
      style.sideColors.fill(uniform)
    }
    style.sideColors[side] = color
    style.sideMask = style.sideMask or (1 shl side)
  }

  fun setBorderStyle(style: StyleRecords, name: String?, uniform: Int) {
    val code = BORDER_STYLES.indexOf(name)
    style.borderStyle = if (code < 0) 0 else code
    if (code > 0 && !style.hasSides) {
      style.hasSides = true
      style.sideMask = 15
      style.sideColors.fill(uniform)
    }
  }

  /**
   * The layers of a `boxShadow` that `setNativeProps` was given (the list `processBoxShadow` makes of it: maps of `offsetX`, `offsetY`, `blurRadius`, `spreadDistance`, `color`, `inset`) as
   * record 140's ints, null for none. A layer with no colour is black, as in React Native; [color] reads a colour (null for one it cannot).
   */
  fun shadowLayers(layers: List<*>?, color: (Any?) -> Int?): IntArray? {
    if (layers == null) return null
    val maps = layers.filterIsInstance<Map<*, *>>()
    if (maps.isEmpty()) return null
    val out = IntArray(maps.size * StyleRecords.SHADOW_INTS)
    for ((k, layer) in maps.withIndex()) {
      val at = k * StyleRecords.SHADOW_INTS
      fun length(name: String) = ((layer[name] as? Number)?.toFloat() ?: 0f).toRawBits()
      out[at] = length("offsetX")
      out[at + 1] = length("offsetY")
      out[at + 2] = length("blurRadius")
      out[at + 3] = length("spreadDistance")
      out[at + 4] = if (layer["color"] == null) BLACK else color(layer["color"]) ?: BLACK
      out[at + 5] = if (layer["inset"] == true || (layer["inset"] as? Number)?.toInt() == 1) 1 else 0
    }
    return out
  }

  /**
   * The names of React Native's `LogicalEdge` for the left, top, right and bottom side of a border whose sides differ (when they agree the style's own `borderWidth` and
   * `borderColor`, the `ALL` edge, are what React Native draws the rounded line from). The engine's widths and colours are the ones Fabric resolved for the physical
   * sides (right to left already applied), and React Native's drawables resolve their own edges again by the layout direction of the view they sit in; `START` and `END`
   * are the edges both of its right-to-left branches read for the left and the right side (`BorderColors.resolve`, `BorderInsets.resolve`), so the sides land where Fabric put
   * them whichever way the view resolves its direction. [rtl] is the app's layout direction (`View.isRtlLayout`).
   */
  fun edges(rtl: Boolean): Array<String> = if (rtl) EDGES_RTL else EDGES_LTR
  private val EDGES_LTR = arrayOf("START", "TOP", "END", "BOTTOM")
  private val EDGES_RTL = arrayOf("END", "TOP", "START", "BOTTOM")

  /** The names of `BorderRadiusProp` for the corners in the order of record 3 (top left, top right, bottom right, bottom left); the logical corners, which every branch of `BorderRadiusStyle.resolve` reads first. */
  fun corners(rtl: Boolean): Array<String> = if (rtl) CORNERS_RTL else CORNERS_LTR
  private val CORNERS_LTR = arrayOf("BORDER_START_START_RADIUS", "BORDER_START_END_RADIUS", "BORDER_END_END_RADIUS", "BORDER_END_START_RADIUS")
  private val CORNERS_RTL = arrayOf("BORDER_START_END_RADIUS", "BORDER_START_START_RADIUS", "BORDER_END_START_RADIUS", "BORDER_END_END_RADIUS")

  const val UNIT_NONE = 0
  const val UNIT_PX = 1
  const val UNIT_PERCENT = 2

  /** Where a view pivots on one axis, in px from its start: the centre when the origin gives the axis nothing. [extent] is the view's width or height in px. */
  fun pivot(unit: Int, value: Float, extent: Float): Float = when (unit) {
    UNIT_PX -> value
    UNIT_PERCENT -> extent * value / 100f
    else -> extent / 2f
  }

  /**
   * One axis of `transformOrigin` from an array of an animated write or of `setNativeProps` (`[x, y, z]`: a number is dp, a string `"50%"` a percentage; the keywords are
   * resolved by JavaScript's `processTransformOrigin` before they get here): the unit, written to [out] at [at] together with the value in px.
   */
  fun originAxis(number: Double?, text: String?, density: Float, out: FloatArray, at: Int): Int {
    if (number != null) {
      out[at] = (number * density).toFloat()
      return UNIT_PX
    }
    val t = text?.trim() ?: return UNIT_NONE
    if (!t.endsWith("%")) return UNIT_NONE
    val percent = t.dropLast(1).toFloatOrNull() ?: return UNIT_NONE
    out[at] = percent
    return UNIT_PERCENT
  }
}
