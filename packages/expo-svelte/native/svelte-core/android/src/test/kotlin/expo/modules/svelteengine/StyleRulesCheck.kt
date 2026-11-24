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

private fun rules() {
  val ring = 0xFF66666F.toInt()
  val halo = 0x1209090B
  val clear = 0x00000000

  // The layers: every one counts, a transparent one too (the focus ring switched off keeps React Native's drawables, and so the border drawn by them).
  val two = layer(0f, 0f, 0f, 1f, ring, false) + layer(0f, 0f, 0f, 4f, halo, false)
  expect("a layer that is off still has the view drawn by React Native's drawables", StyleRules.needsReactDrawables(layer(0f, 0f, 0f, 0f, clear, false), floatArrayOf(0f, 0f, 0f, 0f)), true)
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

  // Who draws the box: the plain background (a fill), or React Native's drawables (a shadow, a border that shows).
  val none = floatArrayOf(0f, 0f, 0f, 0f)
  expect("a plain box", StyleRules.needsReactDrawables(null, none), false)
  expect("a plain border is React Native's too: the plain stroke is not its line", StyleRules.needsReactDrawables(null, floatArrayOf(3f, 3f, 3f, 3f)), true)
  expect("a border on one side only", StyleRules.needsReactDrawables(null, floatArrayOf(0f, 0f, 0f, 3f)), true)
  expect("a border of different widths", StyleRules.needsReactDrawables(null, floatArrayOf(3f, 6f, 3f, 3f)), true)
  expect("a shadow", StyleRules.needsReactDrawables(two, none), true)
  expect("a shadow and a border", StyleRules.needsReactDrawables(two, floatArrayOf(3f, 3f, 3f, 3f)), true)
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

  expect("sides that agree", listOf(StyleRules.uniform(floatArrayOf(3f, 3f, 3f, 3f)), StyleRules.uniform(floatArrayOf(3f, 3f, 3f, 0f)), StyleRules.uniform(intArrayOf(ring, ring, ring, ring)), StyleRules.uniform(intArrayOf(ring, ring, ring, 0))), listOf(true, false, true, false))

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
  val calls = listOf("setBorderRadius(view, BorderRadiusProp", "setBorderWidth(view, LogicalEdge", "setBorderColor(view, LogicalEdge", "setBorderStyle(view, BorderStyle",
    "setBackgroundColor(view, p.bg)", "setBoxShadow(view, layers(shadows))").map { box.indexOf(it) }
  expect("BoxStyle makes every call", calls.all { it > 0 }, true)
  expect("radii, widths, colours, border style, background, shadows", calls, calls.sorted())
  expect("BoxStyle converts the engine's px to React Native's dp", box.contains("p.border[side] / density") && box.contains("p.radii[k] / density"), true)
  expect("BoxStyle sets the ALL width and colour for sides that agree", box.contains("setBorderWidth(view, LogicalEdge.ALL, if (uniform)") && box.contains("setBorderColor(view, LogicalEdge.ALL, if (uniform)"), true)

  // The engine's own views.
  val view = source("$java/views/EngineView.kt")
  val draw = Regex("""override fun dispatchDraw\(canvas: Canvas\) \{(.*?)\n  \}""", RegexOption.DOT_MATCHES_ALL).find(view)?.groupValues?.get(1) ?: error("EngineView does not override dispatchDraw")
  expect("an overflow view with React Native's drawables clips to React Native's padding box", draw.contains("BackgroundStyleApplicator.clipToPaddingBox(this, canvas)"), true)
  expect("the other overflow views keep the border-width rectangle", draw.contains("canvas.clipRect(widths[0], widths[1], width - widths[2], height - widths[3])"), true)
  val props = source("$java/Props.kt")
  val common = props.substring(props.indexOf("fun applyCommon("))
  expect("applyCommon asks StyleRules which drawables draw the box", common.contains("StyleRules.needsReactDrawables(shadows, p.border)"), true)
  expect("applyCommon does not clip a view with outset shadows to its outline", common.contains("!(st.boxStyle && (view is EngineView || st.boxOutset))"), true)
  expect("the pivot is the origin's, at every layout and every transform write", source("$java/views/EngineView.kt").contains("if (st.transformed) Props.applyPivot(child, st)") && common.contains("setTransform("), true)
  val setTransform = props.substring(props.indexOf("fun setTransform("), props.indexOf("fun applyPivot("))
  expect("setTransform pivots on the origin and not on the centre", setTransform.contains("applyPivot(view, st)") && !setTransform.contains("width / 2f"), true)
  val animated = source("$java/AnimatedProps.kt")
  expect("an animated background and radius go through BoxStyle for such a view", animated.contains("BoxStyle.setBackground(view, st, color)") && animated.contains("BoxStyle.setRadii(view, st, tl, tr, br, bl)"), true)
  expect("an animated transformOrigin is read", animated.contains("props.hasKey(\"transformOrigin\")"), true)
  expect("a recycled view lets go of the drawables", source("$java/views/ViewPool.kt").contains("if (st.boxStyle) BoxStyle.drop(view, st)"), true)
  expect("Props decodes the style records", props.contains("in 140..149 -> i = out.style.decode(id, ops, i)"), true)

  // The encoder: the transform record leaves the origin out (the view pivots on it), and the three records come from StyleWire.h.
  val encoder = source("$main/cpp/PropsEncoder.cpp")
  expect("the transform is resolved without the origin", encoder.contains("BaseViewProps::resolveTransform(") && encoder.contains("TransformOrigin{}") && !encoder.contains("p.resolveTransform("), true)
  for (call in listOf("stylewire::encodeSides(", "stylewire::encodeOrigin(", "stylewire::encodeShadows(")) expect("PropsEncoder.cpp calls $call", encoder.contains(call), true)
  expect("a border side that has a colour is told from one that has none by resolving with two defaults", encoder.contains("p.borderColors.resolve(rtl, SharedColor(1))") && encoder.contains("p.borderColors.resolve(rtl, SharedColor(2))") && encoder.contains("sides.set[i] = *one[i] == *two[i];"), true)
  expect("a shadow's colour goes as it came", encoder.contains("shadow.color = colorInt(layer.color);"), true)
}

fun main(args: Array<String>) {
  fixture(args[0])
  rules()
  reactNative(args[1], args[2])
  engine(args[3])
  if (failures > 0) {
    System.err.println("$failures of $checks checks failed")
    exitProcess(1)
  }
  println("StyleRulesCheck: $checks checks passed")
}
