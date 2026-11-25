package expo.modules.svelteengine

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the box styles on the Kotlin side, without a device (SPEC.md, "Box styles"):
 * 1. the production decoder (`StyleRecords`) on the streams StyleWireTest.cpp verified, so both halves of the wire meet on the same bytes;
 * 2. the decisions of `StyleRules` (which shadows draw, which views leave the plain background, where a view pivots, which edge and corner a side is);
 * 3. what `StyleRules` and `BoxStyle` assume of React Native 0.88's own sources, read from `node_modules`: the order its layers are drawn in, the edges and corners it
 *    reads for each side in each direction, the default colour of a shadow, the names the glue passes, so an upgrade that changes one fails here;
 * 4. that the engine's sources make the calls these rules stand for (the encoder leaves the origin out of the transform, the view clips to React Native's padding box).
 * Usage: StyleRulesCheck <fixture> <react-native's uimanager directory> <BaseViewProps.cpp> <the engine's src/main directory>   (src/test/run.sh)
 */
private var failures = 0
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    failures++
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
  }
}

private fun number(f: Float): String = if (f == f.toInt().toFloat()) f.toInt().toString() else f.toString()
private fun color(c: Int): String = String.format("#%08x", c)

private fun render(r: StyleRecords): String {
  val parts = ArrayList<String>()
  val shadows = r.shadows
  if (shadows != null) {
    val layers = (0 until StyleRules.layerCount(shadows)).joinToString(", ") { k ->
      val at = k * StyleRecords.SHADOW_INTS
      val f = { i: Int -> number(Float.fromBits(shadows[at + i])) }
      "${f(0)} ${f(1)} ${f(2)} ${f(3)} ${color(shadows[at + 4])} ${if (StyleRules.isInset(shadows, k)) "inset" else "outset"}"
    }
    parts.add("shadows=${StyleRules.layerCount(shadows)} [$layers]")
  }
  if (r.hasSides) parts.add("sides style=${r.borderStyle} mask=${r.sideMask} colors=[${r.sideColors.joinToString(" ") { color(it) }}]")
  if (r.originXUnit != 0 || r.originYUnit != 0) parts.add("origin x=${r.originXUnit}:${r.originX} y=${r.originYUnit}:${r.originY}")
  return parts.joinToString(" ")
}

private fun decode(opsText: String): StyleRecords {
  val ops = opsText.split(',').map { it.toInt() }.toIntArray()
  val records = StyleRecords()
  var i = 1
  for (n in 0 until ops[0]) {
    val id = ops[i++]
    i = records.decode(id, ops, i)
  }
  check(i == ops.size) { "records end at $i, stream has ${ops.size} ints" }
  return records
}

private fun fixture(path: String) {
  val lines = File(path).readLines().filter { it.isNotBlank() }
  for (line in lines) {
    val cells = line.split('\t')
    val records = decode(cells[1])
    expect("wire ${cells[0]}", render(records), cells.getOrElse(2) { "" })
    expect("wire ${cells[0]} isEmpty", records.isEmpty, cells[1] == "0")
  }
  var thrown = false
  try { StyleRecords().decode(99, intArrayOf(0), 0) } catch (e: IllegalStateException) { thrown = true }
  expect("an unknown record id throws", thrown, true)
  // copyFrom: what the node keeps is a copy, and a reset record is empty.
  val all = decode(lines.first { it.startsWith("all-three\t") }.split('\t')[1])
  val kept = StyleRecords().also { it.copyFrom(all) }
  expect("a copy renders as the original", render(kept), render(all))
  all.reset()
  expect("a reset record is empty", all.isEmpty && !all.touched, true)
  expect("the copy outlives the reset", render(kept).isNotEmpty(), true)
}

private fun layer(x: Float, y: Float, blur: Float, spread: Float, color: Int, inset: Boolean): IntArray =
  intArrayOf(x.toRawBits(), y.toRawBits(), blur.toRawBits(), spread.toRawBits(), color, if (inset) 1 else 0)

/**
 * Who draws the box of a view with [shadows], these border [widths] (px; left, top, right, bottom) and [radii] (top left, top right, bottom right, bottom left), solid by default, every
 * side in one colour unless [colors] says otherwise.
 */
private fun kind(
  shadows: IntArray?,
  widths: FloatArray,
  style: Int = 0,
  colors: IntArray = IntArray(4) { 0xFF66666F.toInt() },
  radii: FloatArray = floatArrayOf(0f, 0f, 0f, 0f),
): Int = StyleRules.boxKind(shadows, widths, colors, style, radii)

private fun rules() {
  val ring = 0xFF66666F.toInt()
  val halo = 0x1209090B
  val clear = 0x00000000

  // The layers: every one counts, a transparent one too (the focus ring switched off keeps React Native's drawables, and so the border drawn by them).
  val two = layer(0f, 0f, 0f, 1f, ring, false) + layer(0f, 0f, 0f, 4f, halo, false)
  expect("a layer that is off still has the view drawn by React Native's drawables", kind(layer(0f, 0f, 0f, 0f, clear, false), floatArrayOf(0f, 0f, 0f, 0f)), StyleRules.BOX_REACT)
  expect("layer count", listOf(StyleRules.layerCount(null), StyleRules.layerCount(two)), listOf(0, 2))
  expect("an outset layer draws outside the view", listOf(StyleRules.hasOutset(two), StyleRules.hasOutset(layer(0f, 0f, 0f, 1f, ring, true)), StyleRules.hasOutset(null)), listOf(true, false, false))

  // The colour of each side: the style's, black where it gave none, the one colour of record 5 when record 141 is absent.
  val sides = StyleRecords()
  val colors = IntArray(4)
  StyleRules.sideColors(sides, 0xFF336699.toInt(), colors)
  expect("without record 141 every side has record 5's colour", colors.toList(), List(4) { 0xFF336699.toInt() })
  sides.hasSides = true; sides.sideMask = 1 or 8
  sides.sideColors[0] = 0xFFFF0000.toInt(); sides.sideColors[3] = 0xFF0000FF.toInt()
  StyleRules.sideColors(sides, 0, colors)
  expect("a side without a colour is black", colors.toList(), listOf(0xFFFF0000.toInt(), StyleRules.BLACK, StyleRules.BLACK, 0xFF0000FF.toInt()))

  // Who draws the box: the plain background (a fill with one radius), the engine's one drawable (a solid border of one width and one colour, a divider and the other borders of square
  // corners, radii that differ), or React Native's drawables (a shadow, a dashed or dotted border with round corners, sides that differ with round corners).
  val none = floatArrayOf(0f, 0f, 0f, 0f)
  val three = floatArrayOf(3f, 3f, 3f, 3f)
  val round = floatArrayOf(8f, 8f, 8f, 8f)
  val mixed = floatArrayOf(4f, 16f, 28f, 0f)
  val bottom = floatArrayOf(0f, 0f, 0f, 3f)
  val red = 0xFFFF0000.toInt()
  val translucent = 0x802563EB.toInt()
  expect("a fill with no border is the plain background", kind(null, none), StyleRules.BOX_PLAIN)
  expect("a fill with one radius for every corner is the plain background", kind(null, none, radii = round), StyleRules.BOX_PLAIN)
  expect("a fill with radii that differ is the engine's drawable: a GradientDrawable scales overflowing radii together", kind(null, none, radii = mixed), StyleRules.BOX_ENGINE)
  expect("a fill with one corner rounded is the engine's drawable", kind(null, none, radii = floatArrayOf(8f, 0f, 0f, 0f)), StyleRules.BOX_ENGINE)
  expect("a border of one width and one colour is the engine's drawable", kind(null, three), StyleRules.BOX_ENGINE)
  expect("and with round corners", kind(null, three, radii = round), StyleRules.BOX_ENGINE)
  expect("and with radii that differ", kind(null, three, radii = mixed), StyleRules.BOX_ENGINE)
  expect("a fractional width is the engine's drawable", kind(null, floatArrayOf(0.5f, 0.5f, 0.5f, 0.5f), radii = round), StyleRules.BOX_ENGINE)
  expect("a translucent colour is the engine's drawable", kind(null, three, colors = IntArray(4) { translucent }), StyleRules.BOX_ENGINE)
  expect("a transparent colour is the engine's drawable", kind(null, three, colors = IntArray(4), radii = round), StyleRules.BOX_ENGINE)
  expect("a border on one side only, with square corners (a divider), is the engine's drawable", kind(null, bottom), StyleRules.BOX_ENGINE)
  expect("sides of different widths, square, are the engine's drawable", kind(null, floatArrayOf(3f, 6f, 3f, 3f)), StyleRules.BOX_ENGINE)
  expect("sides of different colours, square, are the engine's drawable", kind(null, three, colors = intArrayOf(ring, ring, ring, red)), StyleRules.BOX_ENGINE)
  expect("a dashed border with square corners and one colour is the engine's drawable", kind(null, three, style = 1), StyleRules.BOX_ENGINE)
  expect("a dotted border of sides with widths of their own and one colour, square, is the engine's drawable", kind(null, floatArrayOf(2f, 1f, 2f, 0f), style = 2), StyleRules.BOX_ENGINE)
  expect("a dashed border whose colours differ is React Native's: its quadrilaterals keep a leftover path effect", kind(null, three, style = 1, colors = intArrayOf(ring, ring, ring, red)), StyleRules.BOX_REACT)
  expect("a dashed border of a translucent colour is React Native's", kind(null, three, style = 1, colors = IntArray(4) { translucent }), StyleRules.BOX_REACT)
  expect("a dashed border with round corners is React Native's", kind(null, three, style = 1, radii = round), StyleRules.BOX_REACT)
  expect("a dotted border with round corners is React Native's", kind(null, three, style = 2, radii = round), StyleRules.BOX_REACT)
  expect("a border on one side with round corners is React Native's", kind(null, bottom, radii = round), StyleRules.BOX_REACT)
  expect("sides of different colours with round corners are React Native's", kind(null, three, colors = intArrayOf(ring, ring, ring, red), radii = round), StyleRules.BOX_REACT)
  expect("sides of different colours with no width are a plain box", kind(null, none, colors = intArrayOf(ring, ring, ring, red)), StyleRules.BOX_PLAIN)
  expect("a dashed line with no width is a plain box", kind(null, none, style = 1), StyleRules.BOX_PLAIN)
  expect("a shadow is React Native's", kind(two, none), StyleRules.BOX_REACT)
  expect("a shadow and a border are React Native's", kind(two, three), StyleRules.BOX_REACT)
  expect("sides that agree", listOf(StyleRules.uniform(floatArrayOf(3f, 3f, 3f, 3f)), StyleRules.uniform(floatArrayOf(3f, 3f, 3f, 0f)), StyleRules.uniform(intArrayOf(ring, ring, ring, ring)), StyleRules.uniform(intArrayOf(ring, ring, ring, 0))), listOf(true, false, true, false))

  // `BorderDrawable.fastBorderCompatibleColorOrZero`: the one colour of the sides that have a width (to a pixel), 0 when a colour is translucent or the colours differ.
  expect("one colour on every side is the fast colour", StyleRules.fastBorderColor(three, IntArray(4) { ring }), ring)
  expect("a side with no width does not count: a divider's colour is the fast colour", StyleRules.fastBorderColor(bottom, intArrayOf(red, red, red, ring)), ring)
  expect("a side of 0.4 px has no width", StyleRules.fastBorderColor(floatArrayOf(0.4f, 0f, 0f, 3f), intArrayOf(red, red, red, ring)), ring)
  expect("a side of 0.5 px has one", StyleRules.fastBorderColor(floatArrayOf(0.5f, 0f, 0f, 3f), intArrayOf(red, red, red, ring)), 0)
  expect("two colours are none", StyleRules.fastBorderColor(three, intArrayOf(ring, ring, ring, red)), 0)
  expect("a translucent colour on a side with no width still takes the fast path away (all four are read)", StyleRules.fastBorderColor(bottom, intArrayOf(translucent, ring, ring, ring)), 0)

  // What `setNativeProps` does to the sides (record 141's state).
  val live = StyleRecords()
  StyleRules.setBorderColor(live, red)
  expect("`borderColor` of a border without sides changes nothing in them (record 5 carries it)", Pair(live.hasSides, live.sideMask), Pair(false, 0))
  StyleRules.setSideColor(live, 3, red, ring)
  expect("a side's colour makes the sides: the others have the border's colour", Triple(live.hasSides, live.sideMask, live.sideColors.toList()), Triple(true, 15, listOf(ring, ring, ring, red)))
  StyleRules.sideColors(live, ring, colors)
  expect("which is what the sides draw", colors.toList(), listOf(ring, ring, ring, red))
  StyleRules.setBorderColor(live, 0xFF00FF00.toInt())
  StyleRules.sideColors(live, 0xFF00FF00.toInt(), colors)
  expect("`borderColor` after that colours every side (it was ignored once there were sides)", colors.toList(), List(4) { 0xFF00FF00.toInt() })
  val dashes = StyleRecords()
  StyleRules.setBorderStyle(dashes, "dashed", ring)
  StyleRules.sideColors(dashes, ring, colors)
  expect("`borderStyle: 'dashed'` is a record 141 of the border's colour", Triple(dashes.borderStyle, dashes.hasSides, colors.toList()), Triple(1, true, List(4) { ring }))
  StyleRules.setBorderStyle(dashes, "solid", ring)
  expect("`solid` puts it back", dashes.borderStyle, 0)
  expect("a style it does not know is solid", StyleRecords().also { StyleRules.setBorderStyle(it, "wavy", ring) }.borderStyle, 0)
  val shadowList = listOf(
    mapOf("offsetX" to 2.0, "offsetY" to 4, "blurRadius" to 6.0, "spreadDistance" to 1.0, "color" to 0x66000000, "inset" to false),
    mapOf("offsetX" to 0, "offsetY" to 0, "color" to 0, "inset" to true),
    mapOf("offsetX" to 1, "offsetY" to 1),
  )
  val layersRead = StyleRules.shadowLayers(shadowList) { (it as? Number)?.toInt() }!!
  expect("a box shadow of setNativeProps is record 140's layers", StyleRules.layerCount(layersRead), 3)
  expect("a layer: offsets, blur, spread, colour, inset", layersRead.copyOfRange(0, 6).toList(), listOf(2f.toRawBits(), 4f.toRawBits(), 6f.toRawBits(), 1f.toRawBits(), 0x66000000, 0))
  expect("`transparent` stays transparent and `inset` is read", listOf(StyleRules.colorOf(layersRead, 1), StyleRules.isInset(layersRead, 1)), listOf(0, true))
  expect("a layer written without a colour is black", listOf(StyleRules.colorOf(layersRead, 2), StyleRules.isInset(layersRead, 2)), listOf(StyleRules.BLACK, false))
  expect("no layers is no shadow", listOf(StyleRules.shadowLayers(emptyList<Any>()) { 0 }, StyleRules.shadowLayers(null) { 0 }), listOf(null, null))

  // `BorderRadiusStyle.ensureNoOverlap`, in dp: nothing changes while the radii fit, two that meet on an edge shrink in proportion, a corner with no radius reads a scale of 0.
  fun overlap(vararg r: Float, width: Float, height: Float): List<Float> = r.copyOf().also { StyleRules.ensureNoOverlap(it, width, height) }.map { Math.round(it * 1000f) / 1000f }
  expect("radii that fit stay", overlap(8f, 8f, 8f, 8f, 8f, 8f, 8f, 8f, width = 150f, height = 56f), List(8) { 8f })
  expect("a pill: 999 on a 150 x 56 box is half the height, on every corner", overlap(999f, 999f, 999f, 999f, 999f, 999f, 999f, 999f, width = 150f, height = 56f), List(8) { 28f })
  expect("two radii that meet on the left edge", overlap(40f, 40f, 0f, 0f, 0f, 0f, 40f, 40f, width = 150f, height = 56f), listOf(28f, 28f, 0f, 0f, 0f, 0f, 28f, 28f))
  expect("a corner on its own keeps its radius up to the box", overlap(20f, 20f, 0f, 0f, 0f, 0f, 0f, 0f, width = 150f, height = 56f), listOf(20f, 20f, 0f, 0f, 0f, 0f, 0f, 0f))
  expect("a radius that is over the box alone is cut by the nearer edge", overlap(80f, 80f, 0f, 0f, 0f, 0f, 0f, 0f, width = 150f, height = 56f), listOf(56f, 56f, 0f, 0f, 0f, 0f, 0f, 0f))

  // Where a view pivots.
  expect("the centre when the origin gives nothing", StyleRules.pivot(StyleRules.UNIT_NONE, 7f, 200f), 100f)
  expect("a length in px", StyleRules.pivot(StyleRules.UNIT_PX, 30f, 200f), 30f)
  expect("a percentage of the extent", StyleRules.pivot(StyleRules.UNIT_PERCENT, 25f, 200f), 50f)
  expect("100 percent is the far edge", StyleRules.pivot(StyleRules.UNIT_PERCENT, 100f, 48f), 48f)
  expect("0 is the near edge", StyleRules.pivot(StyleRules.UNIT_PX, 0f, 48f), 0f)
  val axis = FloatArray(2)
  expect("a number is dp, scaled to px", Pair(StyleRules.originAxis(10.0, null, 2.5f, axis, 0), axis[0]), Pair(StyleRules.UNIT_PX, 25f))
  expect("\"50%\" is a percentage", Pair(StyleRules.originAxis(null, "50%", 2.5f, axis, 1), axis[1]), Pair(StyleRules.UNIT_PERCENT, 50f))
  expect("a keyword is no axis (JavaScript resolved it already)", StyleRules.originAxis(null, "left", 2f, axis, 0), StyleRules.UNIT_NONE)
  expect("nothing is no axis", StyleRules.originAxis(null, null, 2f, axis, 0), StyleRules.UNIT_NONE)


  // The edges and the corners.
  expect("edges, left to right", StyleRules.edges(false).toList(), listOf("START", "TOP", "END", "BOTTOM"))
  expect("edges, right to left", StyleRules.edges(true).toList(), listOf("END", "TOP", "START", "BOTTOM"))
  expect("corners, left to right", StyleRules.corners(false).toList(), listOf("BORDER_START_START_RADIUS", "BORDER_START_END_RADIUS", "BORDER_END_END_RADIUS", "BORDER_END_START_RADIUS"))
  expect("corners, right to left", StyleRules.corners(true).toList(), listOf("BORDER_START_END_RADIUS", "BORDER_START_START_RADIUS", "BORDER_END_START_RADIUS", "BORDER_END_END_RADIUS"))
  expect("border styles", StyleRules.BORDER_STYLES.toList(), listOf("solid", "dashed", "dotted"))
}

/** The first `LogicalEdge` of each chain of `a ?: b ?: ... ?: default,` in [segment]: which edge a physical side reads first. */
private fun firstEdges(segment: String): List<String> {
  val chains = segment.split(Regex("""\?:\s*(Color\.BLACK|0f),"""))
  return chains.mapNotNull { Regex("""LogicalEdge\.([A-Z_]+)\.ordinal""").find(it)?.groupValues?.get(1) }.take(4)
}

private fun reactNative(uimanager: String, baseViewProps: String) {
  val style = "$uimanager/style"
  fun source(path: String) = File(path).readText()

  // Edges: the first edge each side reads, in a left-to-right and in both right-to-left branches.
  for (file in listOf("BorderColors.kt", "BorderInsets.kt")) {
    val text = source("$style/$file")
    val rtl = text.indexOf("LayoutDirection.RTL")
    expect("$file has both directions", rtl > text.indexOf("LayoutDirection.LTR") && text.indexOf("LayoutDirection.LTR") > 0, true)
    val ltrEdges = firstEdges(text.substring(text.indexOf("LayoutDirection.LTR"), rtl))
    expect("$file, left to right: left, top, right, bottom read START, BLOCK_START, END, BLOCK_END", ltrEdges, listOf("START", "BLOCK_START", "END", "BLOCK_END"))
    val rtlText = text.substring(rtl)
    val swap = rtlText.indexOf("doLeftAndRightSwapInRTL")
    val branches = listOf(rtlText.substring(swap, rtlText.indexOf("} else {", swap)), rtlText.substring(rtlText.indexOf("} else {", swap)))
    for ((k, branch) in branches.withIndex()) {
      val edges = firstEdges(branch)
      expect("$file, right to left (branch $k): the left side reads END and the right side START", Pair(edges[0], edges[2]), Pair("END", "START"))
    }
    // The glue sets TOP and BOTTOM: BLOCK_START and BLOCK_END, read first, are left unset, and the next in each chain is the physical edge.
    expect("$file reads TOP and BOTTOM after the block edges", text.contains("edgeColors[LogicalEdge.TOP.ordinal]") || text.contains("edgeInsets[LogicalEdge.TOP.ordinal]"), true)
  }

  // Corners: the logical corner each physical one reads first.
  val radii = source("$style/BorderRadiusStyle.kt")
  val resolve = radii.substring(radii.indexOf("fun resolve("))
  val rtlAt = resolve.indexOf("LayoutDirection.RTL")
  val cornerOf = Regex("""(topLeft|topRight|bottomLeft|bottomRight)\s*=\s*\((\w+)\s*\?:""")
  fun first(text: String) = cornerOf.findAll(text).associate { it.groupValues[1] to it.groupValues[2] }
  val ltr = first(resolve.substring(0, rtlAt))
  expect("corners, left to right: top left reads startStart, top right startEnd, bottom left endStart, bottom right endEnd",
    listOf(ltr["topLeft"], ltr["topRight"], ltr["bottomRight"], ltr["bottomLeft"]), listOf("startStart", "startEnd", "endEnd", "endStart"))
  val rtlText = resolve.substring(rtlAt)
  val branches = listOf(rtlText.substring(0, rtlText.indexOf("} else {")), rtlText.substring(rtlText.indexOf("} else {")))
  for ((k, branch) in branches.withIndex()) {
    val rtl = first(branch)
    expect("corners, right to left (branch $k): top left reads startEnd, top right startStart, bottom left endEnd, bottom right endStart",
      listOf(rtl["topLeft"], rtl["topRight"], rtl["bottomRight"], rtl["bottomLeft"]), listOf("startEnd", "startStart", "endStart", "endEnd"))
  }

  // The names the glue passes exist, and the border style words are the ones `fromString` knows.
  val edgeSource = source("$style/LogicalEdge.kt")
  for (name in listOf("START", "END", "TOP", "BOTTOM")) expect("LogicalEdge.$name", Regex("""\b$name\s*\{""").containsMatchIn(edgeSource), true)
  for (name in StyleRules.corners(false).toList()) expect("BorderRadiusProp.$name", Regex("""\b$name,""").containsMatchIn(radii), true)
  val borderStyle = source("$style/BorderStyle.kt")
  for (word in StyleRules.BORDER_STYLES) expect("BorderStyle.fromString \"$word\"", borderStyle.contains("\"$word\" ->"), true)

  // The layers: shadows under the background, the border over it, inset shadows over the border; the style's first layer on top within each kind.
  val composite = source("$uimanager/drawable/CompositeBackgroundDrawable.kt")
  val order = listOf("layers.addAll(outerShadows.asReversed())", "background?.let { layers.add(it) }", "backgroundImage?.let { layers.add(it) }",
    "border?.let { layers.add(it) }", "layers.addAll(innerShadows.asReversed())", "outline?.let { layers.add(it) }").map { composite.indexOf(it) }
  expect("every layer is added", order.all { it > 0 }, true)
  expect("outset shadows, background, background image, border, inset shadows, outline", order, order.sorted())

  // A rounded border is drawn from the ALL width and colour (its dashes and dots too), and only when the four sides agree with them: the glue sets ALL for sides that agree.
  val border = source("$uimanager/drawable/BorderDrawable.kt")
  expect("a rounded border's full width is the ALL width", border.contains("this.borderWidth?.getRaw(Spacing.ALL)"), true)
  expect("a rounded border's colour is the ALL colour", border.contains("val borderColor = getBorderColor(LogicalEdge.ALL)"), true)
  expect("the dashes are made from that width", border.contains("getPathEffect(style, getFullBorderWidth())"), true)

  // The applicator: the colour of a shadow without one, the entry points the glue calls.
  val applicator = source("$uimanager/BackgroundStyleApplicator.kt")
  expect("a shadow without a colour is black", applicator.contains("val color = boxShadow.color ?: Color.BLACK"), true)
  for (signature in listOf("fun setBoxShadow(view: View, shadows: List<BoxShadow>)", "fun setBorderRadius(", "fun setBorderWidth(view: View, edge: LogicalEdge, width: Float?)",
    "fun setBorderColor(view: View, edge: LogicalEdge, @ColorInt color: Int?)", "fun setBorderStyle(view: View, borderStyle: BorderStyle?)", "fun setBackgroundColor(view: View, @ColorInt color: Int?)",
    "fun clipToPaddingBox(view: View, canvas: Canvas)", "fun reset(view: View)")) {
    expect("BackgroundStyleApplicator has $signature", applicator.contains(signature), true)
  }
  expect("border widths are dp", applicator.contains("width?.dpToPx()"), true)
  expect("the padding box clip is what an overflow view uses", source("$uimanager/../views/view/ReactViewGroup.kt").contains("clipToPaddingBox(this, canvas)"), true)

  // The origin of a transform: the point a length or a percentage names, the centre for an axis with none (what StyleRules.pivot does).
  val props = source(baseViewProps)
  expect("a length is the point itself", props.contains("origin[i] = currentOrigin.value;"), true)
  expect("a percentage is of the view's extent", props.contains("((i == 0) ? viewWidth : viewHeight) * currentOrigin.value / 100.0f"), true)
  expect("an axis with no unit keeps the centre", props.contains("std::array<float, 3> origin = {viewCenterX, viewCenterY, transformOrigin.z};"), true)
}

private fun engine(main: String) {
  val java = "$main/java/expo/modules/svelteengine"
  fun source(path: String) = File(path).readText()

  // The glue sets what a record says in the order that lets every later setter see it: shadows last, they take the radii and insets the others set.
  val box = source("$java/BoxStyle.kt")
  val apply = box.substring(box.indexOf("fun apply("), box.indexOf("private fun directionOf("))
  val calls = listOf("writeRadii(view, rtl, density, p.radii)", "writeWidths(view, rtl, density, p.border)", "writeColors(view, rtl, p.sideColors)", "setBorderStyle(view, BorderStyle",
    "setBackgroundColor(view, p.bg)", "setBoxShadow(view, layers(shadows))").map { apply.indexOf(it) }
  expect("the helpers make the calls", listOf("setBorderRadius(view, BorderRadiusProp", "setBorderWidth(view, LogicalEdge", "setBorderColor(view, LogicalEdge").map { box.contains(it) }, listOf(true, true, true))
  expect("BoxStyle makes every call", calls.all { it > 0 }, true)
  expect("radii, widths, colours, border style, background, shadows", calls, calls.sorted())
  expect("BoxStyle converts the engine's px to React Native's dp", box.contains("widths[side] / density") && box.contains("radii[k] / density"), true)
  expect("BoxStyle sets the ALL width and colour for sides that agree", box.contains("setBorderWidth(view, LogicalEdge.ALL, if (uniform)") && box.contains("setBorderColor(view, LogicalEdge.ALL, if (uniform)"), true)

  // The engine's own views.
  val view = source("$java/views/EngineView.kt")
  val draw = Regex("""override fun dispatchDraw\(canvas: Canvas\) \{(.*?)\n  \}""", RegexOption.DOT_MATCHES_ALL).find(view)?.groupValues?.get(1) ?: error("EngineView does not override dispatchDraw")
  expect("an overflow view clips to the padding box of whichever drawable draws its box, with nothing allocated", draw.contains("BoxStyle.clipToPaddingBox(this, node, canvas)"), true)
  expect("the other overflow views keep the border-width rectangle", draw.contains("canvas.clipRect(widths[0], widths[1], width - widths[2], height - widths[3])"), true)
  expect("a view whose box is drawn clips itself when its direction resolves", view.contains("BoxStyle.directionChanged(this, node, layoutDirection)"), true)
  expect("the direction can resolve in the constructor of the super class, before the node state exists", source("$java/BoxStyle.kt").contains("fun directionChanged(view: View, st: NodeState?, layoutDirection: Int)") && source("$java/BoxStyle.kt").contains("if (st == null || !st.boxStyle) return"), true)
  val props = source("$java/Props.kt")
  val common = props.substring(props.indexOf("fun applyCommon("))
  expect("applyCommon asks StyleRules who draws the box", common.contains("StyleRules.boxKind(shadows, p.border, p.sideColors, p.style.borderStyle, p.radii)"), true)
  expect("applyCommon takes the drawable a view no longer needs off, and puts the engine's on", common.contains("if (st.engineBox != null && kind != StyleRules.BOX_ENGINE) BoxStyle.dropEngine(view, st)") && common.contains("BoxStyle.applyEngine(view, st, p)"), true)
  expect("a view that clips itself to the padding box is not clipped to its outline", common.contains("val clipsItself = boxed && (view is EngineView || view is EngineText || view is EngineImage || view is EngineScrollable)") && common.contains("!clipsItself && !(boxed && st.boxOutset)"), true)
  expect("the plain background has no stroke: a border is another drawable's", !common.contains("setStroke"), true)
  expect("the scroll views, the text and the image clip to the padding box too", listOf("views/EngineScroll.kt", "views/EngineText.kt", "views/EngineImage.kt").all { source("$java/$it").contains("BoxStyle.clipToPaddingBox(") }, true)
  expect("the pivot is the origin's, at every layout and every transform write", source("$java/views/EngineView.kt").contains("if (st.transformed) Props.applyPivot(child, st)") && common.contains("setTransform("), true)
  val setTransform = props.substring(props.indexOf("fun setTransform("), props.indexOf("fun applyPivot("))
  expect("setTransform pivots on the origin and not on the centre", setTransform.contains("applyPivot(view, st)") && !setTransform.contains("width / 2f"), true)
  val animated = source("$java/AnimatedProps.kt")
  expect("an animated background and radius go through BoxStyle for such a view", animated.contains("BoxStyle.setBackground(view, st, color)") && animated.contains("BoxStyle.setRadii(view, st, tl, tr, br, bl)") &&
    animated.contains("BoxStyle.setEngineBackground(it, st, color)") && animated.contains("BoxStyle.setEngineRadii(view, it, st, tl, tr, br, bl)"), true)
  expect("an animated transformOrigin is read", animated.contains("props.hasKey(\"transformOrigin\")"), true)
  val pool = source("$java/views/ViewPool.kt")
  expect("a recycled view keeps React Native's drawables, which are rewritten when the next node of it needs them", !pool.contains("BoxStyle.drop") && !pool.contains("import expo.modules.svelteengine.BoxStyle"), true)
  expect("BoxStyle compares a node with what the drawables hold (the node state is zeroed for the pool, the drawables are not), and writes it down",
    box.contains("st.boxRadii.contentEquals(p.radii)") && box.contains("st.boxBorder.contentEquals(p.border)") && box.contains("st.boxBg != p.bg") &&
      box.contains("p.radii.copyInto(st.boxRadii)") && box.contains("p.border.copyInto(st.boxBorder)") && box.contains("st.boxBg = p.bg") &&
      !box.contains("st.radii.contentEquals") && !box.contains("st.border.contentEquals") && !box.contains("st.bg != p.bg"), true)
  expect("an animated write of a view with the drawables is written down as what they hold", box.contains("st.boxBg = color") && box.contains("r.copyInto(st.boxRadii)"), true)
  val setRadii = box.substring(box.indexOf("fun setRadii("), box.indexOf("fun clipToPaddingBox("))
  expect("an animated radius asks the view for its outline again, whatever clips to it", setRadii.contains("view.invalidateOutline()"), true)
  expect("a change of radii or widths asks for it too", apply.contains("if (outline) view.invalidateOutline()") && Regex("outline = true").findAll(apply).count() == 2, true)
  expect("the direction React Native's drawables resolve by is the view's once it has one", box.contains("if (view.isAttachedToWindow) view.layoutDirection == View.LAYOUT_DIRECTION_RTL else view.isRtlLayout()") && apply.contains("val rtl = directionOf(view)"), true)
  expect("taking the drawables off clears what is remembered of them", box.contains("st.boxRadii.fill(0f)") && box.contains("st.boxBorder.fill(0f)") && box.contains("st.boxBg = 0"), true)
  expect("Props decodes the style records", props.contains("in 140..149 -> i = out.style.decode(id, ops, i)"), true)

  // The encoder: the transform record leaves the origin out (the view pivots on it), and the three records come from StyleWire.h.
  val encoder = source("$main/cpp/PropsEncoder.cpp")
  expect("the transform is resolved without the origin", encoder.contains("BaseViewProps::resolveTransform(") && encoder.contains("TransformOrigin{}") && !encoder.contains("p.resolveTransform("), true)
  for (call in listOf("stylewire::encodeSides(", "stylewire::encodeOrigin(", "stylewire::encodeShadows(")) expect("PropsEncoder.cpp calls $call", encoder.contains(call), true)
  expect("a border side that has a colour is told from one that has none by resolving with two defaults", encoder.contains("p.borderColors.resolve(rtl, SharedColor(1))") && encoder.contains("p.borderColors.resolve(rtl, SharedColor(2))") && encoder.contains("sides.set[i] = *one[i] == *two[i];"), true)
  expect("the border widths are turned with the colours in a right-to-left layout that swaps left and right (Fabric turns the colours, the radii and the Yoga style, not the widths of the props)",
    encoder.contains("auto widths = p.getBorderWidths();") && encoder.contains("if (layout.wasLeftAndRightSwapped) stylewire::turnLeftAndRight(widths.left, widths.right, widths.start, widths.end);") &&
      encoder.contains("metrics.borderWidths = widths.resolve(layout.layoutDirection == LayoutDirection::RightToLeft, 0);"), true)
  expect("a shadow's colour goes as it came", encoder.contains("shadow.color = colorInt(layer.color);"), true)
}

/**
 * The engine's box drawable against the sources it copies: every constant and expression it takes from React Native's drawables is still there, word for word (a change of React Native's
 * drawing shows here before it shows as a pixel on a device), and the geometry it draws with (`BoxGeometry`, `StyleRules`) is run on numbers worked out by hand from those sources.
 */
private fun boxDrawable(main: String, uimanager: String) {
  fun source(path: String) = File(path).readText()
  val java = "$main/java/expo/modules/svelteengine"
  val mine = source("$java/BoxDrawable.kt")
  val clip = source("$java/PaddingBoxClip.kt")
  val geometry = source("$java/BoxGeometry.kt")
  val rules = source("$java/StyleRules.kt")
  val background = source("$uimanager/drawable/BackgroundDrawable.kt")
  val border = source("$uimanager/drawable/BorderDrawable.kt")
  val composite = source("$uimanager/drawable/CompositeBackgroundDrawable.kt")
  val applicator = source("$uimanager/BackgroundStyleApplicator.kt")
  val radii = source("$uimanager/style/BorderRadiusStyle.kt")

  // BackgroundDrawable: the fill, pulled in where a border is drawn over its rounded edge, a round rectangle for even corners, a path for the others.
  expect("the fill is pulled in by 0.8 px", background.contains("private val pathAdjustment = 0.8f") && geometry.contains("const val PATH_ADJUSTMENT = 0.8f"), true)
  expect("only where there is a border and a radius", background.contains("if (hasBorder && borderRadius?.hasRoundedBorders() == true) {") && geometry.contains("val adjust = if (hasBorder && rounded) PATH_ADJUSTMENT else 0f"), true)
  expect("on every side", background.contains("backgroundRect.left += pathAdjustment") && background.contains("backgroundRect.bottom -= pathAdjustment") &&
    geometry.contains("out[0] = left + adjust") && geometry.contains("out[3] = bottom - adjust"), true)
  expect("a border is any side with a width", background.contains("computedBorderInsets?.left != 0f ||") && mine.contains("if (widthsDp[side] != 0f) anyWidth = true"), true)
  expect("a round rectangle of the top left radii when the four agree", background.contains("computedBorderRadius?.topLeft?.horizontal?.dpToPx() ?: 0f,") && mine.contains("canvas.drawRoundRect(backgroundRect, radiiPx[0], radiiPx[1], backgroundPaint)"), true)
  expect("the fill's alpha is the view's by the fill's", background.contains("(((alpha / 255f) * (Color.alpha(backgroundColor) / 255f)) * 255f).roundToInt()") && mine.contains("(((drawAlpha / 255f) * (Color.alpha(fill) / 255f)) * 255f).roundToInt()"), true)
  expect("nothing is drawn with no alpha", background.contains("if (backgroundPaint.alpha != 0) {") && mine.contains("if (backgroundPaint.alpha != 0) {"), true)

  // BorderDrawable, square corners: whole pixels, a stroke along the middle of each side, four quadrilaterals for a translucent or mixed colour.
  expect("the width is rounded to a pixel", border.contains("val borderLeft = borderWidth.left.roundToInt()") && mine.contains("borders[side] = widthsPx[side].roundToInt()"), true)
  expect("a translucent colour is not the fast path", border.contains("Color.alpha(colorLeft) < 255 ||") && rules.contains("if ((colors[side] ushr 24) < 255) return 0"), true)
  expect("the colours of the sides that have a width are and-ed and or-ed", border.contains("if (borderLeft > 0) colorLeft else ALL_BITS_SET") && border.contains("if (borderLeft > 0) colorLeft else ALL_BITS_UNSET") &&
    rules.contains("smearAnd = smearAnd and colors[side]") && rules.contains("smearOr = smearOr or colors[side]"), true)
  expect("the left line is at left plus half its width, whole pixels", border.contains("pathForSingleBorder?.moveTo((left + width / 2).toFloat(), top.toFloat())") && source("$java/BoxGeometry.kt").contains("val x = (left + border / 2).toFloat()"), true)
  expect("the right line is at right less half its width", border.contains("pathForSingleBorder?.moveTo((right - width / 2).toFloat(), top.toFloat())") && source("$java/BoxGeometry.kt").contains("val x = (right - border / 2).toFloat()"), true)
  expect("the top and bottom lines run from left to right", border.contains("pathForSingleBorder?.moveTo(left.toFloat(), (top + width / 2).toFloat())") && border.contains("pathForSingleBorder?.moveTo(left.toFloat(), (bottom - width / 2).toFloat())") &&
    source("$java/BoxGeometry.kt").contains("val y = (top + border / 2).toFloat()") && source("$java/BoxGeometry.kt").contains("val y = (bottom - border / 2).toFloat()"), true)
  expect("the quadrilaterals have no anti-aliasing", border.contains("borderPaint.isAntiAlias = false") && mine.contains("borderPaint.isAntiAlias = false"), true)
  expect("a transparent side is not drawn", border.contains("if (fillColor == Color.TRANSPARENT) {") && mine.contains("colors[side] == Color.TRANSPARENT"), true)
  expect("the alpha of the border by the view's", border.contains("val alpha = rawAlpha + (rawAlpha shr 7)") && border.contains("colorAlpha * (alpha shr 7) shr 8") && mine.contains("val alpha = rawAlpha + (rawAlpha shr 7)") && mine.contains("colorAlpha * (alpha shr 7) shr 8"), true)
  expect("dashes are three widths long, dots one, each side's own width", border.contains("floatArrayOf(borderWidth * 3, borderWidth * 3, borderWidth * 3, borderWidth * 3)") && border.contains("DashPathEffect(floatArrayOf(borderWidth, borderWidth, borderWidth, borderWidth), 0f)") &&
    mine.contains("floatArrayOf(width * 3, width * 3, width * 3, width * 3)") && mine.contains("floatArrayOf(width, width, width, width)") && border.contains("updatePathEffect(width)"), true)
  for (side in listOf("left", "top", "right", "bottom")) expect("the stroke of the $side side is drawn when it has a width", border.contains("if (border${side.replaceFirstChar { it.uppercase() }} > 0) {"), true)

  // BorderDrawable, round corners: clip to the outer rounded rectangle, one stroke of the full width along the middle of the border.
  expect("the border is clipped to the outer rounded rectangle", border.contains("canvas.clipPath(checkNotNull(outerClipPathForBorderRadius))") && mine.contains("canvas.clipPath(outerClipPath)"), true)
  expect("a stroke as wide as the border", border.contains("borderPaint.strokeWidth = fullBorderWidth") && mine.contains("borderPaint.strokeWidth = widthPx"), true)
  expect("a round rectangle with the radius less half the width", border.contains("((computedBorderRadius?.topLeft?.toPixelFromDIP()?.horizontal ?: 0f) -") && border.contains("borderWidth.left * 0.5f),") &&
    mine.contains("radiiPx[0] - widthPx * 0.5f, radiiPx[1] - widthPx * 0.5f, borderPaint)"), true)
  expect("the middle of the border", border.contains("tempRectForCenterDrawPath?.top =") && border.contains("borderWidth.top * 0.5f") && geometry.contains("out[1] = top + half") && geometry.contains("out[2] = right - half") && geometry.contains("val half = widthPx * 0.5f"), true)
  expect("a path when the corners differ", border.contains("canvas.drawPath(checkNotNull(centerDrawPath), borderPaint)") && mine.contains("canvas.drawPath(centerPath, borderPaint)") && geometry.contains("out[k] = radiiPx[k] - half"), true)
  expect("the radii are resolved against the bounds in dp", border.contains("outerClipTempRectForBorderRadius?.width()?.pxToDp() ?: 0f,") && mine.contains("BoxGeometry.resolveRadii(radiiDp, bounds.width() / density, bounds.height() / density, computed)"), true)

  // The outline of the composite: each radius in dp and the border's width, in px, resolved against the bounds in px.
  expect("the outline is the rounded rectangle of the radii and the border", composite.contains("(it.topLeft.horizontal + (computedBorderInsets?.left ?: 0f)).dpToPx(),") && geometry.contains("out[k] = (scratch[k] + widthDp) * density"), true)
  expect("resolved against the bounds in px", composite.contains("bounds.width().toFloat(),") && geometry.contains("resolveRadii(radiiDp, boundsWidth.toFloat(), boundsHeight.toFloat(), scratch)"), true)
  expect("a rectangle without a radius", composite.contains("outline.setRect(bounds)") && mine.contains("outline.setRect(bounds)"), true)
  expect("an empty rectangle is an empty outline, which is what Outline makes of one", mine.contains("if (bounds.isEmpty) {\n      outline.setEmpty()"), true)

  // The padding box.
  expect("the padding box is the bounds less the border, in px", applicator.contains("paddingBoxRect.left = composite.bounds.left + (computedBorderInsets?.left?.dpToPx() ?: 0f)") && geometry.contains("box[0] = left + insetLeft") && geometry.contains("box[3] = bottom - insetBottom"), true)
  expect("the radii of the padding box are resolved in dp against the bounds", applicator.contains("PixelUtil.toDIPFromPixel(composite.bounds.width().toFloat()),") && geometry.contains("resolveRadii(radiiDp, (right - left) / density, (bottom - top) / density, scratch)"), true)
  expect("each radius less the border, in px", applicator.contains("computedBorderRadius?.topLeft?.horizontal?.dpToPx(),") && applicator.contains("((computedRadius ?: 0f) - (borderWidth ?: 0f)).coerceAtLeast(0f)") &&
    geometry.contains("(radiusDp * density - insetPx).coerceAtLeast(0f)"), true)
  expect("the path is moved by the view's drawing rectangle", applicator.contains("paddingBoxPath.offset(drawingRect.left.toFloat(), drawingRect.top.toFloat())") && clip.contains("path.offset(drawing.left.toFloat(), drawing.top.toFloat())"), true)

  // The radii: the same arithmetic as BorderRadiusStyle.ensureNoOverlap, edge by edge.
  val lines = listOf("val leftEdgeRadiiScale = if (leftEdgeRadii > 0) minOf(height / leftEdgeRadii, 1f) else 0f", "val topEdgeRadiiScale = if (topEdgeRadii > 0) minOf(width / topEdgeRadii, 1f) else 0f",
    "val rightEdgeRadiiScale = if (rightEdgeRadii > 0) minOf(height / rightEdgeRadii, 1f) else 0f", "val bottomEdgeRadiiScale = if (bottomEdgeRadii > 0) minOf(width / bottomEdgeRadii, 1f) else 0f")
  for (line in lines) expect("ensureNoOverlap, React Native's and the engine's: $line", radii.contains(line) && rules.contains(line), true)
  for ((theirs, ours) in listOf("val leftEdgeRadii = topLeft.vertical + bottomLeft.vertical" to "val leftEdgeRadii = tlv + blv", "val topEdgeRadii = topLeft.horizontal + topRight.horizontal" to "val topEdgeRadii = tlh + trh",
    "val rightEdgeRadii = topRight.vertical + bottomRight.vertical" to "val rightEdgeRadii = trv + brv", "val bottomEdgeRadii = bottomLeft.horizontal + bottomRight.horizontal" to "val bottomEdgeRadii = blh + brh")) {
    expect("the edges' radii: $theirs", radii.contains(theirs) && rules.contains(ours), true)
  }
  for ((theirs, ours) in listOf("topLeft.horizontal * minOf(topEdgeRadiiScale, leftEdgeRadiiScale)" to "r[0] = tlh * minOf(topEdgeRadiiScale, leftEdgeRadiiScale)",
    "topRight.horizontal * minOf(rightEdgeRadiiScale, topEdgeRadiiScale)" to "r[2] = trh * minOf(rightEdgeRadiiScale, topEdgeRadiiScale)",
    "bottomRight.horizontal * minOf(bottomEdgeRadiiScale, rightEdgeRadiiScale)" to "r[4] = brh * minOf(bottomEdgeRadiiScale, rightEdgeRadiiScale)",
    "bottomLeft.horizontal * minOf(bottomEdgeRadiiScale, leftEdgeRadiiScale)" to "r[6] = blh * minOf(bottomEdgeRadiiScale, leftEdgeRadiiScale)")) {
    expect("each corner is scaled by its two edges: $theirs", radii.contains(theirs) && rules.contains(ours), true)
  }

  expect("dp to px is a multiplication by the density, as PixelUtil does it (TypedValue.applyDimension)", mine.contains("widthsPx[side] = widthsDp[side] * density") && geometry.contains("resolvedDp[k] * density"), true)

  // The geometry, on numbers worked out by hand from the sources: a 150 x 56 dp box at 2.625 (394 x 147 px).
  val density = 2.625f
  fun near(a: List<Float>, b: List<Float>, eps: Float = 1e-3f) = a.size == b.size && a.indices.all { kotlin.math.abs(a[it] - b[it]) <= eps }
  val pill = floatArrayOf(999f, 999f, 999f, 999f)
  val resolved = FloatArray(8)
  val px = FloatArray(8)
  BoxGeometry.resolveRadii(pill, 394f / density, 147f / density, resolved)
  expect("a pill is half the height on every corner, in dp", near(resolved.toList(), List(8) { 28f }), true)
  BoxGeometry.toPx(resolved, density, px)
  expect("and 73.5 px", near(px.toList(), List(8) { 73.5f }), true)
  expect("four equal radii are uniform", BoxGeometry.uniformRadii(resolved), true)
  BoxGeometry.resolveRadii(floatArrayOf(4f, 16f, 28f, 0f), 150f, 56f, resolved)
  expect("radii that differ keep what fits and are not uniform", Pair(resolved.toList(), BoxGeometry.uniformRadii(resolved)), Pair(listOf(4f, 4f, 16f, 16f, 28f, 28f, 0f, 0f), false))
  BoxGeometry.resolveRadii(floatArrayOf(40f, 10f, 0f, 40f), 150f, 56f, resolved)
  expect("a left edge of 80 dp in 56 scales its two corners alone, per corner (a GradientDrawable scales all of them)", near(resolved.toList(), listOf(28f, 28f, 10f, 10f, 0f, 0f, 28f, 28f)), true)
  val rect = FloatArray(4)
  BoxGeometry.fillRect(0, 0, 394, 147, hasBorder = true, rounded = true, out = rect)
  expect("the fill of a bordered round box is pulled in by 0.8 px", near(rect.toList(), listOf(0.8f, 0.8f, 393.2f, 146.2f)), true)
  BoxGeometry.fillRect(0, 0, 394, 147, hasBorder = true, rounded = false, out = rect)
  expect("not where the corners are square", rect.toList(), listOf(0f, 0f, 394f, 147f))
  BoxGeometry.fillRect(5, 7, 399, 154, hasBorder = false, rounded = true, out = rect)
  expect("nor where there is no border, and it follows the bounds", rect.toList(), listOf(5f, 7f, 399f, 154f))
  BoxGeometry.centerRect(0, 0, 394, 147, 5.25f, rect)
  expect("the centre line of a 5.25 px border is 2.625 px in", near(rect.toList(), listOf(2.625f, 2.625f, 391.375f, 144.375f)), true)
  val centre = FloatArray(8)
  BoxGeometry.centerRadii(px, 5.25f, centre)
  expect("with the radii less half the width", near(centre.toList(), List(8) { 70.875f }), true)
  val outline = FloatArray(8)
  BoxGeometry.outlineRadii(pill, 2f, 394, 147, density, FloatArray(8), outline)
  expect("the outline resolves against the bounds in px as if they were dp (73.5), adds the border (2 dp) and converts: (73.5 + 2) x 2.625", near(outline.toList(), List(8) { 198.1875f }), true)
  val pbox = FloatArray(4)
  val pinner = FloatArray(8)
  val rounded = BoxGeometry.paddingBox(0, 0, 394, 147, floatArrayOf(2f, 2f, 2f, 2f), pill, density, FloatArray(8), pbox, pinner)
  expect("the padding pbox of a 2 dp border is 5.25 px in, its radii 5.25 less", Triple(rounded, near(pbox.toList(), listOf(5.25f, 5.25f, 388.75f, 141.75f)), near(pinner.toList(), List(8) { 68.25f })), Triple(true, true, true))
  val square = BoxGeometry.paddingBox(10, 20, 404, 167, floatArrayOf(1f, 2f, 3f, 4f), floatArrayOf(0f, 0f, 0f, 0f), density, FloatArray(8), pbox, pinner)
  expect("square corners are a rectangle: the widths of each side off the bounds", Pair(square, near(pbox.toList(), listOf(12.625f, 25.25f, 396.125f, 156.5f))), Pair(false, true))
  BoxGeometry.paddingBox(0, 0, 394, 147, floatArrayOf(8f, 8f, 8f, 8f), floatArrayOf(2f, 2f, 2f, 2f), density, FloatArray(8), pbox, pinner)
  expect("a border wider than its radius leaves no radius, never a negative one", pinner.toList(), List(8) { 0f })

  val ring = 0xFF66666F.toInt()
  val red = 0xFFFF0000.toInt()
  val none = floatArrayOf(0f, 0f, 0f, 0f)
  val three = floatArrayOf(3f, 3f, 3f, 3f)
  // Who draws a box when its radius is animated: a divider that is given round corners is no longer the engine drawable's, a border of one colour is, whatever the radius.
  val hairline = floatArrayOf(0f, 0f, 0f, 1f)
  val oneColour = IntArray(4) { ring }
  val roundCorners = floatArrayOf(31.5f, 31.5f, 31.5f, 31.5f)
  val squareCorners = floatArrayOf(0f, 0f, 0f, 0f)
  expect("a divider given a radius moves to React Native's", StyleRules.radiiMoveBox(StyleRules.BOX_ENGINE, hairline, oneColour, 0, roundCorners), true)
  expect("a divider given no radius stays", StyleRules.radiiMoveBox(StyleRules.BOX_ENGINE, hairline, oneColour, 0, squareCorners), false)
  expect("a border on all sides keeps the engine's drawable with a radius", StyleRules.radiiMoveBox(StyleRules.BOX_ENGINE, three, oneColour, 0, roundCorners), false)
  expect("sides with widths of their own move", StyleRules.radiiMoveBox(StyleRules.BOX_ENGINE, floatArrayOf(5f, 6f, 5f, 5f), oneColour, 0, roundCorners), true)
  expect("sides with colours of their own move", StyleRules.radiiMoveBox(StyleRules.BOX_ENGINE, three, intArrayOf(ring, ring, ring, red), 0, roundCorners), true)
  expect("dashes move", StyleRules.radiiMoveBox(StyleRules.BOX_ENGINE, three, oneColour, 1, roundCorners), true)
  expect("a fill whose radius is animated stays plain", StyleRules.radiiMoveBox(StyleRules.BOX_PLAIN, none, oneColour, 0, roundCorners), false)
  expect("a fill that is given radii that differ moves to the engine's drawable", StyleRules.radiiMoveBox(StyleRules.BOX_PLAIN, none, oneColour, 0, floatArrayOf(31.5f, 0f, 31.5f, 0f)), true)
  expect("a fill of the engine's drawable whose radii agree again moves to the plain one", StyleRules.radiiMoveBox(StyleRules.BOX_ENGINE, none, oneColour, 0, roundCorners), true)
  expect("React Native's drawables draw every box: they stay", StyleRules.radiiMoveBox(StyleRules.BOX_REACT, hairline, oneColour, 0, squareCorners), false)

  // The side a colour key of `setNativeProps` is for.
  fun side(key: String, rtl: Boolean, swap: Boolean) = StyleRules.sideOfColorKey(key, rtl, swap)
  expect("left to right: left, right, start and end are where they say", listOf("borderLeftColor", "borderRightColor", "borderStartColor", "borderEndColor").map { side(it, false, true) }, listOf(0, 2, 0, 2))
  expect("right to left without the swap: left and right are physical, start and end turn", listOf("borderLeftColor", "borderRightColor", "borderStartColor", "borderEndColor").map { side(it, true, false) }, listOf(0, 2, 2, 0))
  expect("right to left with the swap (the default): left is the trailing side, right the leading one, as Fabric has them", listOf("borderLeftColor", "borderRightColor", "borderStartColor", "borderEndColor").map { side(it, true, true) }, listOf(2, 0, 2, 0))
  expect("top and bottom do not move, a key that is not a colour has no side", listOf(side("borderTopColor", true, true), side("borderBottomColor", true, true), side("borderWidth", true, true)), listOf(1, 3, -1))

  // The geometry of square corners, from `drawRectangularBorders`: a box of 252 by 112 px at 10, 20 (left 10, top 20, right 262, bottom 132).
  val line = FloatArray(4)
  BoxGeometry.strokeLine(0, 10, 20, 262, 132, 3, line)
  expect("a 3 px left border's line is 1 px in (3 / 2 is 1)", line.toList(), listOf(11f, 20f, 11f, 132f))
  BoxGeometry.strokeLine(1, 10, 20, 262, 132, 1, line)
  expect("a 1 px top border's line is on the top edge (1 / 2 is 0)", line.toList(), listOf(10f, 20f, 262f, 20f))
  BoxGeometry.strokeLine(2, 10, 20, 262, 132, 4, line)
  expect("a 4 px right border's line is 2 px in", line.toList(), listOf(260f, 20f, 260f, 132f))
  BoxGeometry.strokeLine(3, 10, 20, 262, 132, 5, line)
  expect("a 5 px bottom border's line is 2 px in (5 / 2 is 2)", line.toList(), listOf(10f, 130f, 262f, 130f))
  val quad = FloatArray(8)
  val borders = intArrayOf(3, 2, 4, 5)
  BoxGeometry.quadrilateral(0, 10, 20, 252, 112, borders, quad)
  expect("the left quadrilateral: outer edge down the left, inner edge at the widths of the neighbours", quad.toList(), listOf(10f, 20f, 13f, 22f, 13f, 127f, 10f, 132f))
  BoxGeometry.quadrilateral(1, 10, 20, 252, 112, borders, quad)
  expect("the top quadrilateral", quad.toList(), listOf(10f, 20f, 13f, 22f, 258f, 22f, 262f, 20f))
  BoxGeometry.quadrilateral(2, 10, 20, 252, 112, borders, quad)
  expect("the right quadrilateral", quad.toList(), listOf(262f, 20f, 262f, 132f, 258f, 127f, 258f, 22f))
  BoxGeometry.quadrilateral(3, 10, 20, 252, 112, borders, quad)
  expect("the bottom quadrilateral", quad.toList(), listOf(10f, 132f, 262f, 132f, 258f, 127f, 13f, 127f))

  // The glue.
  val box = source("$java/BoxStyle.kt")
  expect("BoxStyle gives the drawable the radii and the widths in dp, the colours of the four sides and the style", box.contains("box.set(p.bg, p.sideColors, widthsDp, radiiDp, p.style.borderStyle)") && box.contains("radiiDp[k] = p.radii[k] / density") && box.contains("widthsDp[k] = p.border[k] / density"), true)
  expect("an outline that moved is asked for again", box.contains("view.invalidateOutline()"), true)
}

fun main(args: Array<String>) {
  fixture(args[0])
  rules()
  reactNative(args[1], args[2])
  boxDrawable(args[3], args[1])
  engine(args[3])
  if (failures > 0) {
    System.err.println("$failures of $checks checks failed")
    exitProcess(1)
  }
  println("StyleRulesCheck: $checks checks passed")
}
