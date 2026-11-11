package expo.modules.svelteblur

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of what the blur view decides without Android (`BlurRules`): the intensity, which tints are light, dark or follow the night mode, the colour and
 * alpha over the blur (and over nothing, when there is no blur), the radius the effect gets, the size of the backdrop picture and of the bitmaps that hold it, the
 * size of a hardware bitmap's software copy; and, in the sources, the module's view and props, that the view leaves itself out of its own backdrop, that it draws
 * nothing under a layer and that a hardware bitmap is copied, not drawn.
 * Usage: BlurRulesCheck <SvelteBlurModule.kt> <SvelteBlurView.kt> <Backdrop.kt> <SoftCopies.kt> [expo-blur's TintStyle.kt]   (src/test/run.sh)
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

private fun alpha(color: Int) = (color ushr 24) and 0xFF
private fun rgb(color: Int) = color and 0xFFFFFF

fun main(args: Array<String>) {
  // Intensity: 50 when it is missing or not a number, otherwise clamped to 0 to 100.
  expect("a missing intensity is the default", BlurRules.intensity(null), 50.0)
  expect("NaN is the default", BlurRules.intensity(Double.NaN), 50.0)
  expect("infinity is the default", BlurRules.intensity(Double.POSITIVE_INFINITY), 50.0)
  expect("a negative intensity is 0", BlurRules.intensity(-5.0), 0.0)
  expect("an intensity over 100 is 100", BlurRules.intensity(140.0), 100.0)
  expect("an intensity in range is kept", BlurRules.intensity(37.5), 37.5)

  // Tints: light, extraLight and the Light materials; dark and the Dark materials; everything else follows the night mode.
  for (name in listOf("light", "extraLight", "systemMaterialLight", "systemThinMaterialLight", "systemChromeMaterialLight", "systemUltraThinMaterialLight"))
    expect("$name is light", BlurRules.group(name), BlurRules.Group.LIGHT)
  for (name in listOf("dark", "systemMaterialDark", "systemThickMaterialDark", "systemChromeMaterialDark"))
    expect("$name is dark", BlurRules.group(name), BlurRules.Group.DARK)
  for (name in listOf("default", "regular", "prominent", "systemMaterial", "systemUltraThinMaterial", "systemThickMaterial", "systemChromeMaterial", "", "nonsense", "Light "))
    expect("'$name' is adaptive", BlurRules.group(name), BlurRules.Group.ADAPTIVE)
  expect("no tint is adaptive", BlurRules.group(null), BlurRules.Group.ADAPTIVE)

  // Colours: white or black, with an alpha that grows with the intensity.
  expect("default by day is white", rgb(BlurRules.overlayColor("default", 50.0, night = false, blurred = true)), 0xFFFFFF)
  expect("default at night is black", rgb(BlurRules.overlayColor("default", 50.0, night = true, blurred = true)), 0x000000)
  expect("an unknown tint follows the night mode", rgb(BlurRules.overlayColor("nonsense", 50.0, night = true, blurred = true)), 0x000000)
  expect("light is white at night", rgb(BlurRules.overlayColor("light", 50.0, night = true, blurred = true)), 0xFFFFFF)
  expect("dark is black by day", rgb(BlurRules.overlayColor("dark", 50.0, night = false, blurred = true)), 0x000000)
  expect("intensity 0 draws nothing", BlurRules.overlayColor("light", 0.0, night = false, blurred = true), 0)
  expect("intensity 0 draws nothing without a blur either", BlurRules.overlayColor("light", 0.0, night = false, blurred = false), 0)
  expect("the blurred alpha at 100 is 0.45", alpha(BlurRules.overlayColor("light", 100.0, night = false, blurred = true)), 115)
  expect("the blurred alpha at 50", alpha(BlurRules.overlayColor("light", 50.0, night = false, blurred = true)), 73)
  expect("the plain alpha at 100 is 0.75", alpha(BlurRules.overlayColor("light", 100.0, night = false, blurred = false)), 191)
  expect("the plain alpha at 50", alpha(BlurRules.overlayColor("light", 50.0, night = false, blurred = false)), 134)
  var previousBlurred = 0
  var previousPlain = 0
  for (step in 1..100) {
    val blurred = alpha(BlurRules.overlayColor("dark", step.toDouble(), night = false, blurred = true))
    val plain = alpha(BlurRules.overlayColor("dark", step.toDouble(), night = false, blurred = false))
    expect("the blurred alpha never falls at $step", blurred >= previousBlurred, true)
    expect("the plain alpha never falls at $step", plain >= previousPlain, true)
    expect("without a blur the tint hides more at $step", plain > blurred, true)
    expect("the blurred alpha at $step stays in 0.12 to 0.45", blurred in 31..115, true)
    previousBlurred = blurred
    previousPlain = plain
  }

  // Radius: linear in the intensity, 25 dp at 100, in pixels of the picture that is a quarter of the view.
  expect("the radius at 100 on a 2.625 density", BlurRules.radius(100.0, 2.625f, 0.25f), 25f * 2.625f * 0.25f)
  expect("the radius at 50 is half of it", BlurRules.radius(50.0, 2.625f, 0.25f), 12.5f * 2.625f * 0.25f)
  expect("the radius at 0 is 0", BlurRules.radius(0.0, 3f, 0.25f), 0f)
  expect("a radius under half a pixel of the picture has no effect", BlurRules.hasEffect(BlurRules.radius(1.0, 1f, 0.25f)), false)
  expect("intensity 10 on a 2.75 density has one", BlurRules.hasEffect(BlurRules.radius(10.0, 2.75f, 0.25f)), true)

  // The backdrop picture: a quarter of the view each way, at least a pixel, a bigger divisor for a view that would make more than a million pixels.
  expect("a view without a size has no picture", BlurRules.picture(0, 100), null)
  expect("a view without a height has none", BlurRules.picture(100, 0), null)
  BlurRules.picture(1080, 2400)!!.let {
    expect("a screen is a quarter each way", listOf(it.pictureWidth, it.pictureHeight, it.divisor), listOf(270, 600, 4))
    expect("its scale is exact", listOf(it.scaleX, it.scaleY), listOf(4f, 4f))
  }
  BlurRules.picture(1, 1)!!.let { expect("one pixel stays one", listOf(it.pictureWidth, it.pictureHeight), listOf(1, 1)) }
  BlurRules.picture(401, 3)!!.let {
    expect("the picture is rounded up", listOf(it.pictureWidth, it.pictureHeight), listOf(101, 1))
    expect("the scale takes the rounding", it.scaleX, 401f / 101f)
  }
  BlurRules.picture(8000, 8000)!!.let {
    expect("a very large view takes a bigger divisor", listOf(it.divisor, it.pictureWidth, it.pictureHeight), listOf(8, 1000, 1000))
    expect("and stays within the limit", it.pictureWidth * it.pictureHeight <= BlurRules.MAX_PIXELS, true)
  }

  // The bitmaps that hold the picture grow in steps of 32 pixels and are made again only when the picture no longer fits them or is under half of them.
  expect("the first bitmap rounds up to a step", listOf(BlurRules.capacity(1, 0), BlurRules.capacity(32, 0), BlurRules.capacity(33, 0), BlurRules.capacity(40, 0)), listOf(32, 32, 64, 64))
  expect("a smaller picture fits the bitmap it is in", listOf(BlurRules.capacity(64, 64), BlurRules.capacity(33, 64), BlurRules.capacity(32, 64)), listOf(64, 64, 64))
  expect("under half of the bitmap it is made again", BlurRules.capacity(31, 64), 32)
  expect("a bigger picture makes a bigger bitmap", listOf(BlurRules.capacity(65, 64), BlurRules.capacity(200, 64)), listOf(96, 224))
  var side = 0
  var made = 0
  for (needed in 100..400) {
    val capacity = BlurRules.capacity(needed, side)
    expect("the bitmap always holds the picture at $needed", capacity >= needed, true)
    if (capacity != side) {
      made++
      side = capacity
    }
  }
  expect("a size that grows a pixel at a time from 100 to 400 makes the bitmaps ten times", made, 10)
  for (needed in 399 downTo 150) {
    val capacity = BlurRules.capacity(needed, side)
    expect("the bitmap always holds the picture at $needed going down", capacity >= needed, true)
    if (capacity != side) {
      made++
      side = capacity
    }
  }
  expect("and going back down to 150 makes them once more, when the picture is under half of them", made, 11)
  // A hardware bitmap's software copy: twice the backdrop's resolution, at most the bitmap's own.
  expect("the copy at the first divisor is half", BlurRules.copyScale(4), 0.5f)
  expect("the copy at divisor 8 is a quarter", BlurRules.copyScale(8), 0.25f)
  expect("the copy is never bigger than the bitmap", listOf(BlurRules.copyScale(1), BlurRules.copyScale(2)), listOf(1f, 1f))
  expect("a side of the copy", listOf(BlurRules.copySide(1080, 0.5f), BlurRules.copySide(1081, 0.5f), BlurRules.copySide(1, 0.25f)), listOf(540, 541, 1))

  // Where the real blur is possible.
  expect("API 30 cannot blur", BlurRules.canBlur(30, hardwareAccelerated = true), false)
  expect("API 31 can", BlurRules.canBlur(31, hardwareAccelerated = true), true)
  expect("a software canvas cannot", BlurRules.canBlur(34, hardwareAccelerated = false), false)

  // The sources: the module's view and props are what the component sends, and the view leaves itself out of its backdrop.
  val module = File(args[0]).readText()
  expect("the module is SvelteBlur", Regex("""Name\("SvelteBlur"\)""").containsMatchIn(module), true)
  expect("it has one view, SvelteBlurView", Regex("""\bView\(\w+::class\)""").findAll(module).count(), 1)
  expect("the view is named SvelteBlurView", Regex("""View\(SvelteBlurView::class\)\s*\{\s*Name\("SvelteBlurView"\)""").containsMatchIn(module), true)
  expect("its props are intensity and tint", Regex("""\bProp\("(\w+)"\)""").findAll(module).map { it.groupValues[1] }.toList(), listOf("intensity", "tint"))

  val view = File(args[1]).readText()
  val draw = Regex("""override fun dispatchDraw\(canvas: Canvas\) \{([\s\S]*?)\n  \}""").find(view)?.groupValues?.get(1) ?: ""
  expect("the view returns before it draws anything while the backdrop is drawn", draw.trimStart().startsWith("if (snapshotting) {"), true)
  expect("and stops the canvas there", draw.contains("(canvas as? BackdropCanvas)?.stop()") && draw.indexOf("stop()") < draw.indexOf("super.dispatchDraw"), true)
  expect("the pre-draw listener is added once attached and removed when detached", view.contains("addOnPreDrawListener(preDraw)") && view.contains("removeOnPreDrawListener(preDraw)"), true)

  val backdrop = File(args[2]).readText()
  expect("a layer on the view or an ancestor stops the drawing (a software draw would build the layer's cache on a canvas of its own)", Regex("""if \(root === view \|\| layered\(\)\) return""").containsMatchIn(backdrop) && Regex("""if \(\w+\.layerType != View\.LAYER_TYPE_NONE\) return true""").findAll(backdrop).count() == 2, true)
  expect("the canvas takes a hardware bitmap through its software copy, in every drawBitmap", Regex("""override fun drawBitmap\(""").findAll(backdrop).count() == 4 && Regex("""isHardware\(bitmap\)""").findAll(backdrop).count() >= 5, true)
  expect("and skips what it cannot take instead of throwing", backdrop.contains("override fun drawRenderNode") && backdrop.contains("catch (_: RuntimeException)"), true)
  val copies = File(args[3]).readText()
  expect("a copy is made once per bitmap and kept weakly", copies.contains("WeakHashMap<Bitmap, Copy>") && copies.contains("known.generation == source.generationId") && copies.contains("Bitmap.Config.ARGB_8888, false"), true)
  expect("and within a budget", copies.contains("BlurRules.COPY_BUDGET_BYTES"), true)
  expect("the flag is set around the window's drawing and cleared in a finally", Regex("""view\.snapshotting = true[\s\S]*?try \{\s*root\.draw\(canvas\)[\s\S]*?finally \{\s*view\.snapshotting = false""").containsMatchIn(backdrop), true)
  expect("no bitmap is made per frame: only fit makes them, and only through the capacity rule", Regex("""createBitmap""").findAll(backdrop).count() == 1 && backdrop.indexOf("createBitmap") > backdrop.indexOf("private fun fit") && backdrop.contains("BlurRules.capacity(shape.pictureWidth, capacityWidth)"), true)

  if (args.size > 4 && File(args[4]).exists()) {
    // Every tint expo-blur knows is a name this view takes, with the same light or dark meaning where the name says it.
    val names = Regex("""\w+\("(\w+)"\)""").findAll(File(args[4]).readText()).map { it.groupValues[1] }.toList()
    expect("expo-blur's tints are read", names.size >= 20, true)
    for (name in names) {
      val expected = when {
        name == "light" || name == "extraLight" || name.endsWith("Light") -> BlurRules.Group.LIGHT
        name == "dark" || name.endsWith("Dark") -> BlurRules.Group.DARK
        else -> BlurRules.Group.ADAPTIVE
      }
      expect("expo-blur's $name", BlurRules.group(name), expected)
    }
  } else {
    System.err.println("expo-blur is not installed: its tint names are not compared")
  }
  System.err.println("BlurRulesCheck: $checks checks, $failures failures")
  if (failures > 0) exitProcess(1)
}
