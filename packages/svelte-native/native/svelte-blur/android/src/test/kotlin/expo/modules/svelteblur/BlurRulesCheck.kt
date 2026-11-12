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

  // Why a pre-draw does nothing: the order of the reasons is the order they are looked at, and the walks up the parents are asked only when everything before them lets them be.
  var asked = mutableListOf<String>()
  fun idle(
    width: Int = 300, height: Int = 100, intensity: Double = 50.0, shown: Boolean = true, windowVisible: Boolean = true,
    onScreen: Boolean = true, isRoot: Boolean = false, layered: Boolean = false,
  ): BlurRules.Idle? = BlurRules.idleReason(
    width, height, intensity, shown, windowVisible,
    { asked.add("onScreen"); onScreen }, { asked.add("isRoot"); isRoot }, { asked.add("layered"); layered },
  )
  expect("a view that can show draws", idle(), null)
  expect("a view without a width", idle(width = 0), BlurRules.Idle.NO_SIZE)
  expect("a view without a height", idle(height = 0), BlurRules.Idle.NO_SIZE)
  expect("intensity 0", idle(intensity = 0.0), BlurRules.Idle.NO_INTENSITY)
  expect("a view that is not shown", idle(shown = false), BlurRules.Idle.NOT_SHOWN)
  expect("a window that is not visible", idle(windowVisible = false), BlurRules.Idle.WINDOW_HIDDEN)
  expect("a view with nothing of it on the screen", idle(onScreen = false), BlurRules.Idle.OFF_SCREEN)
  expect("a view that is the root", idle(isRoot = true), BlurRules.Idle.IS_ROOT)
  expect("a view under a layer", idle(layered = true), BlurRules.Idle.LAYER)
  expect("the facts of the view come before the walks up its parents", idle(width = 0, onScreen = false, isRoot = true, layered = true), BlurRules.Idle.NO_SIZE)
  expect("being off the screen comes before a layer", idle(onScreen = false, layered = true), BlurRules.Idle.OFF_SCREEN)
  asked = mutableListOf()
  idle(intensity = 0.0)
  expect("a view that draws nothing asks nothing of its parents", asked, listOf<String>())
  asked = mutableListOf()
  idle(onScreen = false)
  expect("a view that is off the screen does not look for a layer", asked, listOf("onScreen"))
  asked = mutableListOf()
  idle()
  expect("a view that draws asks all three, in order", asked, listOf("onScreen", "isRoot", "layered"))

  // A view under a layer asks for one frame, and only while the layer stands: the layer a screen keeps at rest goes on the first invalidation under it, and a screen at rest has no frame to run the pre-draw in.
  expect("under a layer, for the first time, it asks", BlurRules.asksForFrame(BlurRules.Idle.LAYER, asked = false), true)
  expect("under the same layer, it does not ask again", BlurRules.asksForFrame(BlurRules.Idle.LAYER, asked = true), false)
  for (reason in BlurRules.Idle.values()) if (reason != BlurRules.Idle.LAYER) expect("$reason does not ask for a frame", BlurRules.asksForFrame(reason, asked = false), false)
  expect("a pre-draw that draws does not ask", BlurRules.asksForFrame(null, asked = false), false)
  // A picture is recorded when it differs from the one on show, when the view has been under a layer since that one, and when the node has lost it.
  expect("a new picture is recorded", BlurRules.shouldRecord(sameAsShown = false, stale = false, nodeEmpty = false), true)
  expect("the same picture is not recorded again", BlurRules.shouldRecord(sameAsShown = true, stale = false, nodeEmpty = false), false)
  expect("the same picture is recorded again after a layer", BlurRules.shouldRecord(sameAsShown = true, stale = true, nodeEmpty = false), true)
  expect("a new picture is recorded after a layer too", BlurRules.shouldRecord(sameAsShown = false, stale = true, nodeEmpty = false), true)
  expect("the same picture is recorded again when the node is empty", BlurRules.shouldRecord(sameAsShown = true, stale = false, nodeEmpty = true), true)
  expect("an empty node after a layer", BlurRules.shouldRecord(sameAsShown = true, stale = true, nodeEmpty = true), true)

  // The renderer drops the display list of a node that no display list refers to for a frame: a view that was ready and whose node answers that it has none lost it.
  expect("a ready view whose node has a display list has lost nothing", BlurRules.nodeLost(ready = true, hasDisplayList = true), false)
  expect("a ready view whose node has none has lost it", BlurRules.nodeLost(ready = true, hasDisplayList = false), true)
  expect("a view that is not ready has recorded nothing to lose", BlurRules.nodeLost(ready = false, hasDisplayList = false), false)
  expect("nor one that is not ready and has a list", BlurRules.nodeLost(ready = false, hasDisplayList = true), false)
  expect("the view asks for a frame once for a loss", listOf(BlurRules.asksForFrameAfterLoss(lost = true, asked = false), BlurRules.asksForFrameAfterLoss(lost = true, asked = true)), listOf(true, false))
  expect("and never when nothing was lost", listOf(BlurRules.asksForFrameAfterLoss(lost = false, asked = false), BlurRules.asksForFrameAfterLoss(lost = false, asked = true)), listOf(false, false))
  // The list row of the device runs: the picture is recorded at intensity 70, a frame at intensity 0 draws nothing (the renderer drops the node's list), and at intensity 100 the picture behind the view is the
  // same one. The decision of that pre-draw, which is what the lab's three checks of the row read, is a record; the pre-draw of a frame that drew the node is not.
  fun decision(ready: Boolean, hasDisplayList: Boolean, sameAsShown: Boolean, stale: Boolean = false): Boolean {
    val lost = BlurRules.nodeLost(ready, hasDisplayList)
    return BlurRules.shouldRecord(sameAsShown, stale, lost)
  }
  expect("a view's first picture is recorded", decision(ready = false, hasDisplayList = false, sameAsShown = false), true)
  expect("the same picture, node drawn since: left as it is", decision(ready = true, hasDisplayList = true, sameAsShown = true), false)
  expect("the same picture after a frame without the node (intensity 0, then 100): recorded again", decision(ready = true, hasDisplayList = false, sameAsShown = true), true)
  expect("a new picture is recorded whatever the node holds", listOf(decision(true, true, false), decision(true, false, false)), listOf(true, true))

  // A view under a layer looks again after a quiet while: the one request it made was a frame of the transition that held the layer, and the layer the stack keeps once it has settled came after it.
  expect("no layer any more: stop", BlurRules.afterQuietWait(layered = false, framesRan = false, asked = false), BlurRules.Quiet.STOP)
  expect("no layer and frames: stop", BlurRules.afterQuietWait(layered = false, framesRan = true, asked = false), BlurRules.Quiet.STOP)
  expect("frames went by under the layer: the window moves, wait again", BlurRules.afterQuietWait(layered = true, framesRan = true, asked = false), BlurRules.Quiet.WAIT)
  expect("no frame under the layer: a screen at rest, ask", BlurRules.afterQuietWait(layered = true, framesRan = false, asked = false), BlurRules.Quiet.ASK)
  expect("asked for this layer already: stop, a layer nothing lets go of must not keep the view drawing", BlurRules.afterQuietWait(layered = true, framesRan = false, asked = true), BlurRules.Quiet.STOP)
  expect("asked, with frames going by: stop too", BlurRules.afterQuietWait(layered = true, framesRan = true, asked = true), BlurRules.Quiet.STOP)
  expect("the wait is a tenth of a second, longer than any frame of a transition", BlurRules.QUIET_MS in 50L..250L, true)
  // The sequence of the quiet page of the lab: the first pre-draw is a frame of the push (layered, asks), the stack hands the layer to its resident one and no frame follows: the wait ends quiet and asks again, once.
  var pre = 3
  var framesAtWait = pre // the wait is posted by the first pre-draw under the layer
  pre++ // the pre-draw that the request of that first one made
  val actions = mutableListOf<BlurRules.Quiet>()
  var askedQuiet = false
  repeat(3) {
    val action = BlurRules.afterQuietWait(layered = true, framesRan = pre != framesAtWait, asked = askedQuiet)
    actions.add(action)
    if (action == BlurRules.Quiet.ASK) askedQuiet = true
    framesAtWait = pre // no frame follows on a screen at rest
  }
  expect("a frame, then quiet: wait, ask, stop", actions, listOf(BlurRules.Quiet.WAIT, BlurRules.Quiet.ASK, BlurRules.Quiet.STOP))

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
  expect("a layer on the view or an ancestor stops the drawing (a software draw would build the layer's cache on a canvas of its own)", Regex("""\{ view\.rootView === view \}, \{ layered\(\) \}""").containsMatchIn(backdrop) && Regex("""if \(\w+\.layerType != View\.LAYER_TYPE_NONE\) return true""").findAll(backdrop).count() == 2, true)
  expect("every reason the pre-draw does nothing for is one of the rules' (the gate is BlurRules.idleReason, and its answer returns before anything is drawn)", Regex("""val reason = BlurRules\.idleReason\([\s\S]*?\)\s*if \(reason != null\) \{[\s\S]*?return\s*\}""").containsMatchIn(backdrop), true)
  expect("a view that waits for a layer asks for a frame, once: the request is the view's own invalidate, made when the rule says so and marked, and the picture that follows is recorded whatever it equals", Regex("""if \(BlurRules\.asksForFrame\(reason, asked\)\) \{\s*asked = true\s*stale = true\s*view\.invalidate\(\)\s*\}""").containsMatchIn(backdrop) && Regex("""BlurRules\.shouldRecord\(last != null && last\.sameAs\(bitmap\), stale, lost\)""").containsMatchIn(backdrop) && Regex("""stale = false\s*current = next\s*record\(shape, bitmap\)""").containsMatchIn(backdrop), true)
  expect("the node is asked whether it still has its display list, before the window is drawn, and a node that has not is recorded again whatever the picture equals (the renderer drops the list of a node no display list refers to for a frame: a frame at intensity 0)", Regex("""val lost = BlurRules\.nodeLost\(ready, node\.hasDisplayList\(\)\)[\s\S]*?root\.draw\(canvas\)""").containsMatchIn(backdrop) && Regex("""BlurRules\.shouldRecord\(last != null && last\.sameAs\(bitmap\), stale, lost\)\) return\s*stale = false\s*current = next\s*record\(shape, bitmap\)""").containsMatchIn(backdrop), true)
  expect("the view asks for a frame once for a loss (the rule says so, and the request is marked until the node has its list again), so that a node the renderer keeps dropping does not keep the view drawing", Regex("""if \(!lost\) askedAfterLoss = false""").containsMatchIn(backdrop) && Regex("""\} else if \(lost\) \{\s*logLost\(\)[\s\S]*?if \(BlurRules\.asksForFrameAfterLoss\(lost, askedAfterLoss\)\) \{\s*askedAfterLoss = true\s*view\.invalidate\(\)\s*\}""").containsMatchIn(backdrop) && Regex("""askedAfterLoss = false\s*noted = -2""").containsMatchIn(backdrop), true)
  expect("the request is forgotten when the reason is not a layer any more, so that the next layer asks again", Regex("""underLayer = reason == BlurRules\.Idle\.LAYER\s*if \(underLayer\) waitForQuiet\(\) else \{\s*asked = false\s*askedQuiet = false\s*\}""").containsMatchIn(backdrop) && Regex("""\}\s*asked = false\s*askedQuiet = false\s*underLayer = false\s*val root = view\.rootView""").containsMatchIn(backdrop), true)
  expect("a view that found a layer looks again after a quiet while: the wait is posted from the pre-draw under the layer, asks through the view's own invalidation once for a layer that stands, and is removed when the view detaches", Regex("""private fun waitForQuiet\(\) \{\s*if \(waiting \|\| askedQuiet\) return\s*waiting = true\s*framesAtWait = frames\s*view\.postDelayed\(quiet, BlurRules\.QUIET_MS\)""").containsMatchIn(backdrop) && Regex("""BlurRules\.afterQuietWait\(underLayer && layered\(\), frames != framesAtWait, askedQuiet\)""").containsMatchIn(backdrop) && Regex("""BlurRules\.Quiet\.ASK -> \{\s*askedQuiet = true\s*stale = true\s*logQuiet\(\)\s*view\.invalidate\(\)""").containsMatchIn(backdrop) && Regex("""fun release\(\) \{\s*view\.removeCallbacks\(quiet\)""").containsMatchIn(backdrop) && Regex("""fun update\(\) \{\s*frames\+\+""").containsMatchIn(backdrop), true)
  expect("the render effect is put on the node again with each recording, from the one effect made for the radius", Regex("""node\.endRecording\(\)\s*\}\s*[^\n]*\n\s*node\.setRenderEffect\(effect\)""").containsMatchIn(backdrop) && Regex("""effect = if \(BlurRules\.hasEffect\(radius\)\) RenderEffect\.createBlurEffect\(radius, radius, Shader\.TileMode\.CLAMP\) else null\s*node\.setRenderEffect\(effect\)""").containsMatchIn(backdrop), true)
  expect("what the view does is in the log: a state change is a line, and the first picture says what it holds", backdrop.contains("private fun note(state: Int)") && backdrop.contains("private fun logReady(") && backdrop.contains("points opaque"), true)
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
