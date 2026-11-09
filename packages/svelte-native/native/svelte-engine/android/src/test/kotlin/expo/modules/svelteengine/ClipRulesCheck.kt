package expo.modules.svelteengine

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of what clips a scroll view's content to its viewport (`ClipRules`, SPEC.md "Scroll viewport clip"). The view tree is Android's and cannot run
 * here, so the check has two halves: the rectangle a scroll view clips to, from its bounds, border and scroll offset, and the sources of the views read for the one
 * thing the rectangle is useless without, a clip applied around the children's draw in every scroll view the engine has. A scroll view that draws its children
 * without it shows them over whatever sits before it in the screen (the header, the status bar) once they have scrolled past its edge.
 * Usage: ClipRulesCheck <views directory>   (src/test/run.sh)
 */
private var checks = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
    exitProcess(1)
  }
}

private val noBorder = FloatArray(4)

private fun viewport(overflow: Int, scrollX: Int, scrollY: Int, width: Int, height: Int, border: FloatArray = noBorder): List<Float>? {
  val out = FloatArray(4) { -1f }
  return if (ClipRules.scrollViewport(overflow, scrollX, scrollY, width, height, border, out)) out.toList() else null
}

private fun rules() {
  // A vertical scroll view of the showcase's screens: 1080 x 2062 px under a 275 px header, `overflow: scroll` (record 7 is 1), not scrolled.
  expect("a scroll view clips to its bounds", viewport(1, 0, 0, 1080, 2062), listOf(0f, 0f, 1080f, 2062f))
  // The canvas `dispatchDraw` gets is already moved by the scroll offset: the rectangle moves with it, its size stays.
  expect("the viewport follows the scroll offset", viewport(1, 0, 598, 1080, 2062), listOf(0f, 598f, 1080f, 2660f))
  expect("a horizontal scroll view follows its x offset", viewport(1, 540, 0, 1080, 300), listOf(540f, 0f, 1620f, 300f))
  // `overflow: visible` on a scroll view is the author's choice (React Native does not clip it): nothing is clipped and nothing is written.
  expect("visible clips nothing", viewport(ClipRules.OVERFLOW_VISIBLE, 0, 300, 1080, 2062), null)
  val untouched = FloatArray(4) { 7f }
  ClipRules.scrollViewport(ClipRules.OVERFLOW_VISIBLE, 5, 5, 10, 10, noBorder, untouched)
  expect("visible leaves the output alone", untouched.toList(), listOf(7f, 7f, 7f, 7f))
  // The padding box, as React Native's clipToPaddingBox: the border widths are taken off, left, top, right, bottom.
  expect("the border is taken off the viewport", viewport(1, 0, 100, 1000, 800, floatArrayOf(2f, 3f, 4f, 5f)), listOf(2f, 103f, 996f, 895f))
  // A large or translucent header pads the scroll view by its own height and turns clipToPadding off: the content has to reach the top edge of the view, under the header.
  // Android's padding is not an input of the rule, so the viewport is the whole view however much it is padded.
  expect("padding does not shrink the viewport", viewport(1, 0, 0, 1080, 2337), listOf(0f, 0f, 1080f, 2337f))
  // A scroll view that is not laid out yet clips to nothing, not to a negative rectangle.
  expect("an empty view has an empty viewport", viewport(1, 0, 0, 0, 0), listOf(0f, 0f, 0f, 0f))
}

/** The text of the class declared at [header], up to the next top-level declaration. */
private fun classBody(text: String, header: String, file: String): String {
  val start = text.indexOf(header)
  if (start < 0) error("$header not found in $file")
  val next = Regex("""\n(class|object|interface|private fun|fun) """).find(text, start + header.length)?.range?.first ?: text.length
  return text.substring(start, next)
}

private fun source(views: String) {
  val dir = File(views)
  val files = dir.listFiles { f -> f.name.endsWith(".kt") }?.sortedBy { it.name } ?: error("no views directory at $views")

  val scroll = File(dir, "EngineScroll.kt").readText()

  // The bridge's one call: the rule, with the view's overflow, scroll offset, size and border, then the canvas clip with the rectangle the rule wrote.
  val bridge = classBody(scroll, "class ScrollBridge(", "EngineScroll.kt")
  val clip = Regex("""fun clipToViewport\(canvas: Canvas\): Int \{(.*?)\n  \}""", RegexOption.DOT_MATCHES_ALL).find(bridge)?.groupValues?.get(1)
    ?: error("ScrollBridge.clipToViewport not found")
  expect("the bridge asks the rule with the view's own state", clip.contains("ClipRules.scrollViewport(node.overflow, view.scrollX, view.scrollY, view.width, view.height, node.border, viewport)"), true)
  expect("nothing is saved or clipped when the rule says no", clip.indexOf("return -1") in 0 until clip.indexOf("canvas.save()"), true)
  expect("the canvas is clipped to the rectangle the rule wrote", clip.contains("canvas.clipRect(viewport[0], viewport[1], viewport[2], viewport[3])"), true)
  expect("the save count comes back for the restore", clip.trimEnd().endsWith("return saved"), true)

  // Every scroll view the engine has: the clip goes on before its children draw and comes off after, the save count of the first being the restore of the second.
  val scrollViews = files.flatMap { f ->
    Regex("""(?m)^(?:open |internal )?class (\w+)\([^)]*\) : (?:Horizontal)?ScrollView\(""").findAll(f.readText()).map { f to it.groupValues[1] }.toList()
  }
  expect("the engine's scroll views", scrollViews.map { it.second }.sorted(), listOf("EngineHScroll", "EngineScroll"))
  for ((file, name) in scrollViews) {
    val body = classBody(file.readText(), "class $name(", file.name)
    val draw = Regex("""override fun dispatchDraw\(canvas: Canvas\) \{(.*?)\n  \}""", RegexOption.DOT_MATCHES_ALL).find(body)?.groupValues?.get(1)
      ?: error("$name does not override dispatchDraw")
    val steps = draw.lines().map { it.trim() }.filter { it.isNotEmpty() }
    expect("$name clips, draws its children, restores", steps, listOf(
      "val saved = bridge.clipToViewport(canvas)",
      "super.dispatchDraw(canvas)",
      "if (saved >= 0) canvas.restoreToCount(saved)",
    ))
  }
}

fun main(args: Array<String>) {
  rules()
  source(args.getOrElse(0) { error("usage: ClipRulesCheck <views directory>") })
  println("ClipRulesCheck: $checks checks passed")
}
