package expo.modules.svelteengine

import java.io.File
import kotlin.math.abs
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the default push and pop of a stack on Android (`TransitionRules`, SPEC.md "Navigation"): the movement against the framework's activity
 * transition, frameworks/base core/res/res/anim/activity_open_enter.xml (translate 96dp to 0 over 450 on fast_out_extra_slow_in), activity_open_exit.xml
 * (0 to -96dp), activity_close_enter.xml (-96dp to 0), activity_close_exit.xml (0 to 96dp), and core/res/res/interpolator/fast_out_extra_slow_in.xml
 * (`M 0,0 C 0.05, 0, 0.133333, 0.06, 0.166666, 0.4 C 0.208333, 0.82, 0.25, 1, 1, 1`). With an Android SDK's resources (`platforms/android-36/data/res`)
 * the numbers are read from those files and compared, not only copied here. The sources of EngineScreen and EngineStack are read for the calls that make
 * it the default and keep its state right when something cuts it short.
 * Usage: TransitionRulesCheck <EngineScreen.kt> <EngineStack.kt> <cpp/PropsEncoderNavRecords.h> [<SDK res directory>]   (src/test/run.sh)
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

private fun near(name: String, actual: Float, expected: Float, tolerance: Float = 1e-4f) {
  checks++
  if (abs(actual - expected) > tolerance) {
    failures++
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected (within $tolerance)")
  }
}

/** The path evaluated in doubles, independently: its parameter for x by Newton's method from a bisection start, then its y. */
private fun reference(x: Double): Double {
  fun bez(s: Double, a: Double, b: Double, c: Double, d: Double): Double { val u = 1 - s; return u * u * u * a + 3 * u * u * s * b + 3 * u * s * s * c + s * s * s * d }
  val (xs, ys) = if (x < 0.166666) doubleArrayOf(0.0, 0.05, 0.133333, 0.166666) to doubleArrayOf(0.0, 0.0, 0.06, 0.4)
    else doubleArrayOf(0.166666, 0.208333, 0.25, 1.0) to doubleArrayOf(0.4, 0.82, 1.0, 1.0)
  var lo = 0.0
  var hi = 1.0
  repeat(60) { val m = (lo + hi) / 2; if (bez(m, xs[0], xs[1], xs[2], xs[3]) < x) lo = m else hi = m }
  return bez((lo + hi) / 2, ys[0], ys[1], ys[2], ys[3])
}

private fun timing() {
  expect("both screens move 96 dp", TransitionRules.SHIFT_DP, 96f)
  expect("over 450 ms", TransitionRules.DURATION_MS, 450L)
  // The fade-through (Material's; the predictive back guide: "At the 35% mark, neither screen is showing").
  near("the screen going away is opaque at the start", TransitionRules.fadeOut(0f), 1f)
  near("half gone at 17.5 % of the movement", TransitionRules.fadeOut(0.175f), 0.5f)
  near("gone at 35 %", TransitionRules.fadeOut(0.35f), 0f)
  near("and after", TransitionRules.fadeOut(1f), 0f)
  near("the screen coming is transparent at the start", TransitionRules.fadeIn(0f), 0f)
  near("and at 35 %", TransitionRules.fadeIn(0.35f), 0f)
  near("half there at 67.5 %", TransitionRules.fadeIn(0.675f), 0.5f)
  near("opaque at the end", TransitionRules.fadeIn(1f), 1f)
  var both = 0
  for (i in 0..1000) { val p = i / 1000f; if (TransitionRules.fadeOut(p) > 0f && TransitionRules.fadeIn(p) > 0f) both++ }
  expect("the two screens never show at once", both, 0)
  // On the movement's curve the screen going away is gone at about 70 ms of the 450, and the one coming is 90 % there at 200 ms.
  var gone = 0
  while (TransitionRules.fadeOut(TransitionRules.emphasized(gone / 450f)) > 0f) gone++
  expect("the screen going away is gone by 75 ms (at $gone ms)", gone in 60..75, true)
  near("the screen coming is about 90 % there at 200 ms", TransitionRules.fadeIn(TransitionRules.emphasized(200f / 450f)), 0.895f, 0.01f)
}

private fun curve() {
  near("fast_out_extra_slow_in starts at 0", TransitionRules.emphasized(0f), 0f)
  near("and ends at 1", TransitionRules.emphasized(1f), 1f)
  near("its two curves meet at (0.166666, 0.4)", TransitionRules.emphasized(TransitionRules.JOIN_X), TransitionRules.JOIN_Y, 1e-3f)
  var worst = 0.0
  var previous = -1f
  var monotonic = true
  for (i in 0..1000) {
    val t = i / 1000f
    val y = TransitionRules.emphasized(t)
    worst = maxOf(worst, abs(y - reference(t.toDouble())))
    if (y < previous - 1e-6f) monotonic = false
    previous = y
  }
  expect("it never goes back", monotonic, true)
  expect("it is the framework's path to within 1e-4 everywhere (worst ${"%.2e".format(worst)})", worst < 1e-4, true)
  // Most of the movement is early: 71 % of it is done in the first 100 ms of the 450, 93 % by 200 ms.
  near("71 % of the movement is done at 100 ms", TransitionRules.emphasized(100f / 450f), 0.712f, 2e-3f)
  near("93 % at 200 ms", TransitionRules.emphasized(200f / 450f), 0.932f, 2e-3f)
}

/** One fade of the table at a few moments, against what its source says. */
private fun fadeAt(name: String, fade: TransitionRules.Fade?, ms: Float, progress: Float, expected: Float) {
  checks++
  val actual = fade?.at(ms, progress)
  if (actual == null || abs(actual - expected) > 1e-3f) {
    failures++
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
  }
}

private fun motions() {
  val r = TransitionRules
  // The fade-through (the default push and pop) lets the stack draw both screens whole under a veil (EngineStack.system): that holds only while one of the
  // two is out of sight whenever the other is part faded, at every point of the movement.
  for (kind in r.KIND_DEFAULT..r.KIND_FADE_FROM_BOTTOM) for (push in listOf(true, false)) {
    val m = r.motion(kind, push) ?: continue
    expect("kind $kind ${if (push) "push" else "pop"} is a fade-through only for the default", m.fadeThrough, kind == r.KIND_DEFAULT)
    if (!m.fadeThrough) continue
    var overlap = 0
    for (i in 0..1000) {
      val p = i / 1000f
      val top = m.top!!.at(p * m.durationMs, p)
      val under = m.under!!.at(p * m.durationMs, p)
      if (top > 0f && top < 1f && under > 0f || under > 0f && under < 1f && top > 0f) overlap++
    }
    expect("the default ${if (push) "push" else "pop"} never shows one screen part faded while the other shows", overlap, 0)
  }
  // Curves: accelerate_decelerate (Android's default) is half way at half the time; decelerate_quint and accelerate_quint are 1-(1-t)^5 and t^5.
  near("accelerate_decelerate at 0.5", r.curve(r.ACCELERATE_DECELERATE, 0.5f), 0.5f)
  near("accelerate_decelerate at 0.25", r.curve(r.ACCELERATE_DECELERATE, 0.25f), 0.1464466f)
  near("decelerate_quint at 0.5", r.curve(r.DECELERATE_QUINT, 0.5f), 0.96875f)
  near("accelerate_quint at 0.5", r.curve(r.ACCELERATE_QUINT, 0.5f), 0.03125f)
  near("a curve is clamped past its end", r.curve(r.LINEAR, 1.5f), 1f)
  val kinds = (r.KIND_DEFAULT..r.KIND_FADE_FROM_BOTTOM).toList()
  expect("every paired kind has a push and a pop", kinds.all { r.motion(it, true) != null && r.motion(it, false) != null }, true)
  expect("the one-screen kinds have none", (0..3).all { r.motion(it, true) == null && !r.paired(it) }, true)
  // The default: 96 dp, 450 ms, fast_out_extra_slow_in, fading through on the movement's progress.
  val defaultPush = r.motion(r.KIND_DEFAULT, true)!!
  expect("the default moves both screens 96 dp over 450 ms on the emphasized curve", listOf(defaultPush.amount, defaultPush.unit, defaultPush.durationMs, defaultPush.curve, defaultPush.moveUnder, defaultPush.extend), listOf(96f, r.DP, 450L, r.EMPHASIZED, true, true))
  fadeAt("the default's coming screen is transparent at 35 % of the movement", defaultPush.top, 0f, 0.35f, 0f)
  fadeAt("and half there at 67.5 %", defaultPush.top, 0f, 0.675f, 0.5f)
  fadeAt("the screen below is gone at 35 %", defaultPush.under, 0f, 0.35f, 0f)
  fadeAt("on a pop the screen going is gone at 35 %", r.motion(r.KIND_DEFAULT, false)!!.top, 0f, 0.35f, 0f)
  // android_activity: the framework's (and React Navigation's native-stack default): the screen on top fades over an opaque one.
  val activity = r.motion(r.KIND_ACTIVITY, true)!!
  expect("the activity transition moves as the default does", listOf(activity.amount, activity.durationMs, activity.curve, activity.moveUnder), listOf(96f, 450L, r.EMPHASIZED, true))
  expect("and leaves the screen below opaque", activity.under, null)
  fadeAt("its pushed screen is transparent at 50 ms", activity.top, 50f, 0f, 0f)
  fadeAt("half there at 91.5 ms", activity.top, 91.5f, 0f, 0.5f)
  fadeAt("opaque at 133 ms", activity.top, 133f, 0f, 1f)
  fadeAt("its popped screen is opaque at 35 ms", r.motion(r.KIND_ACTIVITY, false)!!.top, 35f, 0f, 1f)
  fadeAt("and gone at 118 ms", r.motion(r.KIND_ACTIVITY, false)!!.top, 118f, 0f, 0f)
  // react-native-screens: rns_fade_in / rns_fade_out (150 ms, both screens at once).
  val fade = r.motion(r.KIND_FADE, true)!!
  expect("fade lasts 150 ms and moves nothing", listOf(fade.durationMs, fade.amount, fade.moveUnder), listOf(150L, 0f, false))
  fadeAt("the screen coming is half there at 75 ms", fade.top, 75f, 0f, 0.5f)
  fadeAt("while the one below is half gone", fade.under, 75f, 0f, 0.5f)
  fadeAt("on a pop the screen below comes back", r.motion(r.KIND_FADE, false)!!.under, 150f, 0f, 1f)
  // rns_slide_in_from_right / rns_slide_out_to_left, and the mirror: the whole width over config_mediumAnimTime (400 ms), both screens.
  val right = r.motion(r.KIND_SLIDE_RIGHT, true)!!
  val left = r.motion(r.KIND_SLIDE_LEFT, true)!!
  expect("slide_from_right: the whole width from the right over 400 ms, both screens, no fade",
    listOf(right.unit, right.amount, right.direction, right.durationMs, right.curve, right.moveUnder, right.top, right.extend), listOf(r.WIDTH, 1f, 1, 400L, r.ACCELERATE_DECELERATE, true, null, false))
  expect("slide_from_left: the same from the left", listOf(left.unit, left.amount, left.direction, left.durationMs), listOf(r.WIDTH, 1f, -1, 400L))
  // rns_slide_in_from_bottom: the whole height over 400 ms, the screen below staying.
  val bottom = r.motion(r.KIND_SLIDE_BOTTOM, true)!!
  expect("slide_from_bottom: the whole height over 400 ms, the screen below staying", listOf(bottom.vertical, bottom.unit, bottom.amount, bottom.durationMs, bottom.moveUnder), listOf(true, r.HEIGHT, 1f, 400L, false))
  // rns_fade_from_bottom (8 %, 350 ms, alpha over 210 ms, decelerate_quint) and rns_fade_to_bottom (250 ms on accelerate_quint, alpha from 100 ms over 150 ms).
  val up = r.motion(r.KIND_FADE_FROM_BOTTOM, true)!!
  val down = r.motion(r.KIND_FADE_FROM_BOTTOM, false)!!
  expect("fade_from_bottom rises 8 % of the height over 350 ms", listOf(up.vertical, up.unit, up.amount, up.durationMs, up.curve, up.moveUnder), listOf(true, r.HEIGHT, 0.08f, 350L, r.DECELERATE_QUINT, false))
  fadeAt("its fade is done at 210 ms", up.top, 210f, 0f, 1f)
  fadeAt("and 97 % there at half of it (decelerate_quint)", up.top, 105f, 0f, 0.96875f)
  expect("it sinks over 250 ms on accelerate_quint", listOf(down.durationMs, down.curve, down.amount), listOf(250L, r.ACCELERATE_QUINT, 0.08f))
  fadeAt("opaque until 100 ms", down.top, 100f, 0f, 1f)
  fadeAt("gone at 250 ms", down.top, 250f, 0f, 0f)
}

private fun screens() {
  val shift = 252f // 96 dp at 2.625 (420 dpi, the OVH emulator)
  near("a push starts with the screen below in place (the pushed one a full shift right)", TransitionRules.underX(shift, shift), 0f)
  near("and ends with it a full shift left", TransitionRules.underX(0f, shift), -shift)
  near("the two stay a shift apart on the way", TransitionRules.underX(100f, shift), -152f)
  near("a pop that takes the top screen past the shift leaves the one below in place", TransitionRules.underX(400f, shift), 0f)
  // The strip a screen uncovers, for a screen laid out at 0..1080.
  near("moved 100 px left: the strip is its right 100 px", TransitionRules.stripStart(0f, 1080f, -100f), 980f)
  near("to its right edge", TransitionRules.stripEnd(0f, 1080f, -100f), 1080f)
  near("moved 100 px right: the strip starts at its left edge", TransitionRules.stripStart(0f, 1080f, 100f), 0f)
  near("and is 100 px wide", TransitionRules.stripEnd(0f, 1080f, 100f), 100f)
  expect("not moved: no strip", TransitionRules.stripEnd(0f, 1080f, 0f) - TransitionRules.stripStart(0f, 1080f, 0f), 0f)
  expect("a gesture that took the screen past the shift slides it off across the width", TransitionRules.exitsAcross(300f, shift), true)
  expect("one that did not lets Android's exit finish it", TransitionRules.exitsAcross(200f, shift), false)
  // From the left (slide_from_left: the shift is negative): the screen below goes the other way, to the right.
  near("a push from the left starts with the screen below in place", TransitionRules.underX(-1080f, -1080f), 0f)
  near("and ends with it the whole width right", TransitionRules.underX(0f, -1080f), 1080f)
  near("half way, half way", TransitionRules.underX(-540f, -1080f), 540f)
}

/** A pop that takes over a push before the screen on top has faded in: the screen below is never fainter than the push left it, so never blank. */
private fun resume() {
  val r = TransitionRules
  val shift = 252f // 96 dp at 2.625
  val push = r.motion(r.KIND_DEFAULT, true)!!.under!!
  val pop = r.motion(r.KIND_DEFAULT, false)!!.under!!
  // The push has moved the screen on top (1 - done) of the way back to its place, and faded the screen below to push.at(done).
  for (done in listOf(0f, 0.02f, 0.1f, 0.2f, 0.3f, 0.34f)) {
    val fade = r.resumedFade(pop, (1f - done) * shift, shift)
    val left = push.at(0f, done)
    near("a pop at ${done * 100} % of the push starts the screen below where the push left it (${"%.2f".format(left)})", fade.at(0f, 0f), left)
    near("and has it whole at 35 % of the pop", fade.at(0f, r.FADE_THROUGH), 1f)
    var faintest = 1f
    for (i in 0..1000) faintest = minOf(faintest, fade.at(0f, i / 1000f))
    near("and never fainter than that", faintest, left)
    // The screen on top has not faded in yet, so the screen below is all there is to see: it is there from the first frame of the pop.
    near("with nothing on top yet", r.fadeIn(done), 0f)
  }
  // With the table's pop the screen below is at 0 for the same 35 %, and the screen on top is not there either.
  near("the table's pop has nothing there at 20 % of the pop", pop.at(0f, 0.2f), 0f)
  // Otherwise the pop is the table's: a push that is done, one more than 35 % there, a crossfade, a push that does not move the screens.
  expect("a settled push's pop is the table's", r.resumedFade(pop, 0f, shift), pop)
  expect("so is one cut after the screen on top began to fade in", r.resumedFade(pop, 0.5f * shift, shift), pop)
  expect("and so is one from the left (a negative shift) cut after that", r.resumedFade(pop, 0.5f * -1080f, -1080f), pop)
  val crossfade = r.motion(r.KIND_FADE, false)!!.under!!
  expect("a crossfade is not touched", r.resumedFade(crossfade, 0.9f * shift, shift), crossfade)
  expect("a motion that does not move the screens is not touched", r.resumedFade(pop, 10f, 0f), pop)
  // A negative shift (the screens moving the other way) has the same share.
  near("a push cut at 10 % with a negative shift starts the screen below as the push left it", r.resumedFade(pop, -0.9f * 1080f, -1080f).at(0f, 0f), push.at(0f, 0.1f))
}

/** The framework's own files: each number of TransitionRules against the attribute it comes from. */
private fun framework(res: File) {
  fun attrs(file: String, tag: String): Map<String, String> {
    val element = Regex("<$tag\\b([^>]*)/>").find(File(res, file).readText())?.groupValues?.get(1) ?: return emptyMap()
    return Regex("android:(\\w+)=\"([^\"]*)\"").findAll(element).associate { it.groupValues[1] to it.groupValues[2] }
  }
  // The movement only: the fade is Material's fade-through, not the framework's (which fades the screen on top over an opaque one).
  val shift = "${TransitionRules.SHIFT_DP.toInt()}dp"
  val duration = TransitionRules.DURATION_MS.toString()
  val curve = "@interpolator/fast_out_extra_slow_in"
  val openMove = attrs("anim/activity_open_enter.xml", "translate")
  expect("open_enter moves from SHIFT_DP right to its place", openMove["fromXDelta"] to openMove["toXDelta"], shift to "0")
  expect("over DURATION_MS on fast_out_extra_slow_in", openMove["duration"] to openMove["interpolator"], duration to curve)
  val belowOut = attrs("anim/activity_open_exit.xml", "translate")
  expect("open_exit moves the screen below SHIFT_DP left", belowOut["fromXDelta"] to belowOut["toXDelta"], "0" to "-$shift")
  expect("over the same time and curve", belowOut["duration"] to belowOut["interpolator"], duration to curve)
  val belowIn = attrs("anim/activity_close_enter.xml", "translate")
  expect("close_enter brings the screen below back from SHIFT_DP left", belowIn["fromXDelta"] to belowIn["toXDelta"], "-$shift" to "0")
  expect("over the same time and curve", belowIn["duration"] to belowIn["interpolator"], duration to curve)
  val closeMove = attrs("anim/activity_close_exit.xml", "translate")
  expect("close_exit moves the screen SHIFT_DP right", closeMove["fromXDelta"] to closeMove["toXDelta"], "0" to shift)
  expect("over the same time and curve", closeMove["duration"] to closeMove["interpolator"], duration to curve)
  // android_activity plays the framework's fades: activity_open_enter's alpha and activity_close_exit's.
  val openFade = attrs("anim/activity_open_enter.xml", "alpha")
  val activityIn = TransitionRules.motion(TransitionRules.KIND_ACTIVITY, true)!!.top!!
  expect("android_activity's fade-in is activity_open_enter's", listOf(openFade["fromAlpha"], openFade["toAlpha"], openFade["startOffset"], openFade["duration"], openFade["interpolator"]),
    listOf("0", "1.0", activityIn.start.toInt().toString(), activityIn.length.toInt().toString(), "@interpolator/linear"))
  val closeFade = attrs("anim/activity_close_exit.xml", "alpha")
  val activityOut = TransitionRules.motion(TransitionRules.KIND_ACTIVITY, false)!!.top!!
  expect("android_activity's fade-out is activity_close_exit's", listOf(closeFade["fromAlpha"], closeFade["toAlpha"], closeFade["startOffset"], closeFade["duration"], closeFade["interpolator"]),
    listOf("1.0", "0.0", activityOut.start.toInt().toString(), activityOut.length.toInt().toString(), "@interpolator/linear"))
  val path = attrs("interpolator/fast_out_extra_slow_in.xml", "pathInterpolator")["pathData"] ?: ""
  val numbers = Regex("-?[0-9]*\\.?[0-9]+").findAll(path).map { it.value.toFloat() }.toList()
  expect("fast_out_extra_slow_in's path is TransitionRules.PATH ($path)", numbers.size == TransitionRules.PATH.size && numbers.indices.all { abs(numbers[it] - TransitionRules.PATH[it]) < 1e-6f }, true)
}

/** The codes on the wire: the C++ encoder's number for each `animation` name is the one `transitionKind` reads. */
private fun codes(screen: String, encoder: String) {
  val kind = screen.substringAfter("fun transitionKind(): Int").substringBefore("\n  }\n")
  val table = listOf(
    Triple("none", 1, "1 -> 0"), Triple("fade", 2, "2 -> if (push) TransitionRules.KIND_FADE"), Triple("slide_from_right", 3, "3 -> if (push) TransitionRules.KIND_SLIDE_RIGHT"),
    Triple("slide_from_bottom", 4, "4 -> if (push) TransitionRules.KIND_SLIDE_BOTTOM"), Triple("slide_from_left", 5, "5 -> if (push) TransitionRules.KIND_SLIDE_LEFT"),
    Triple("fade_from_bottom", 6, "6 -> if (push) TransitionRules.KIND_FADE_FROM_BOTTOM"), Triple("android_activity", 7, "7 -> if (push) TransitionRules.KIND_ACTIVITY"),
  )
  for ((name, code, branch) in table) {
    expect("the encoder sends $name as $code", encoder.contains("if (*raw == \"$name\") return $code;"), true)
    expect("and transitionKind reads $code as $name", kind.contains(branch), true)
  }
  // flip and simple_push have codes of their own (iOS flips a modal) and are the default on Android.
  expect("the encoder sends flip as 8 and simple_push as 9", encoder.contains("if (*raw == \"flip\") return 8;") && encoder.contains("if (*raw == \"simple_push\") return 9;"), true)
}

private fun sources(screen: String, stack: String) {
  val kind = screen.substringAfter("fun transitionKind(): Int").substringBefore("\n  }\n")
  val presentationKind = screen.substringAfter("private fun presentationKind(): Int").substringBefore("\n  }\n")
  expect("a push screen with the default animation plays the default transition", presentationKind.contains("0 -> TransitionRules.KIND_DEFAULT"), true)
  for ((code, name) in listOf("2" to "KIND_FADE", "3" to "KIND_SLIDE_RIGHT", "4" to "KIND_SLIDE_BOTTOM", "5" to "KIND_SLIDE_LEFT", "6" to "KIND_FADE_FROM_BOTTOM", "7" to "KIND_ACTIVITY"))
    expect("animation $code of a push screen is $name", kind.contains("$code -> if (push) TransitionRules.$name"), true)
  expect("flip and simple_push (8, 9) are the default, as in React Navigation", kind.contains("else -> presentationKind()") && !kind.contains("8 ->") && !kind.contains("9 ->"), true)
  val insert = stack.substringAfter("fun insertScreen(").substringBefore("\n  fun exitScreen(")
  expect("a paired push runs the transition with the screen below", insert.contains("if (TransitionRules.paired(kind)) system(child,"), true)
  val exit = stack.substringAfter("private fun exitTo(").substringBefore("\n  }\n")
  expect("a paired exit runs it with the screen that will be on top", exit.contains("if (TransitionRules.paired(kind)) {") && exit.contains("system(s, if (moveUnder)"), true)
  val system = stack.substringAfter("private fun system(").substringBefore("\n  private fun animate(")
  for (call in listOf("TransitionRules.motion(kind, entering)", "TransitionRules.curve(m.curve, f)", "TransitionRules.underX(s.translationX, distance)", "setDuration(m.durationMs)", "it.at(ms, p)", "underFade.at(ms, p)", "TransitionRules.resumedFade(it, from, distance)"))
    expect("the transition uses $call", system.contains(call), true)
  val draw = stack.substringAfter("private fun drawEdge(").substringBefore("\n  private fun fillEdge(")
  expect("the strip is the one TransitionRules gives", draw.contains("TransitionRules.stripStart(") && draw.contains("TransitionRules.stripEnd("), true)
  // What keeps the state right when something cuts the transition short, or a gesture ends it.
  expect("only a transition with a screen below taking part draws strips (after a gesture the strip would cover what it showed)", system.contains("s.extendsEdge = m.extend && under != null"), true)
  expect("a pop goes on from where a gesture left the screen", system.contains("distance >= 0f -> max(distance, from)") && system.contains("else -> min(distance, from)"), true)
  expect("the screen below goes back in place when the transition ends or is cut short", system.contains("under.translationX = 0f") && system.contains("putBack()"), true)
  expect("a transition that lands puts the scale back", system.substringAfter("s.landing = {").contains("s.scaleX = 1f"), true)
  expect("the screen below fades as its motion says, unless the stack hid it meanwhile",
    system.contains("if (underFade != null && !under.hidden) {") && system.contains("val shown = underFade.at(ms, p)") &&
      system.contains("if (veiled) fade(under, shown, under.silhouette) else under.alpha = shown"), true)
  // #111: a fade-through draws the two screens whole under a veil, with no layer; a scaled screen (a back gesture) or one with no opaque surface keeps them.
  expect("a fade-through holds no layer, unless a screen is scaled or not opaque",
    system.contains("val veiled = m.fadeThrough && under != null && s.scaleX == 1f && opaque(s) && opaque(under)") && system.contains("if (!veiled) s.holdLayer()") &&
      system.contains("if (!veiled) under.holdLayer()") && system.contains("var underHeld = under != null && !veiled") && system.contains("if (!veiled) s.releaseLayer()"), true)
  expect("the screen on top fades under the veil in a fade-through", system.contains("if (veiled) fade(s, shown, under?.silhouette) else s.alpha = shown"), true)
  expect("the veil goes when the transition ends, lands or puts the screen below back, and a cut keeps how far the screen had faded",
    system.contains("if (cancelled && s.veil > 0f) s.alpha *= 1f - s.veil") && system.split("s.veil = 0f").size - 1 == 2 && system.contains("under.veil = 0f"), true)
  expect("a screen the stack hides or shows has no veil", screen.substringAfter("fun setHidden(").substringBefore("\n  }").contains("veil = 0f"), true)
  expect("the stack draws the coming screen's surface under both when the one below fades (the push's, for a pop that goes on from it)", system.contains("under.silhouette = if (underFade == null) null else if (entering || resumed) s else under"), true)
  expect("a pop takes over a push's fade only on the way back", system.contains("m.under?.let { if (entering) it else TransitionRules.resumedFade(it, from, distance) }"), true)
  // The screen below's alpha is written twice (a frame's and putBack's), both leaving a screen the stack hid alone; its visibility is the stack's refresh() to set.
  expect("the transition writes the screen below's alpha only where it checks hidden, and never its visibility", Regex("under\\.alpha\\s*=").findAll(system).count() == 2 && !system.contains("under.visibility"), true)
  expect("the screen below is whole again after (hidden if a push hid it)", system.contains("under.silhouette = null") && system.contains("under.alpha = if (under.hidden) 0f else 1f"), true)
  // `releaseUnder()` is defined once and called twice (the animator's end, the landing); it lets go only once.
  expect("its layer is held for the transition and let go at its end", system.contains("under.holdLayer()") && system.split("releaseUnder()").size - 1 == 3 && system.contains("if (!underHeld) return"), true)
  val drawChild = stack.substringAfter("override fun drawChild(").substringBefore("\n  /** The strip in")
  expect("the surface is drawn before the screen below, across the stack", drawChild.indexOf("drawSurface(canvas, it, 0f, width.toFloat(), 1f, REACH_ACROSS)") in 0 until drawChild.indexOf("super.drawChild("), true)
  expect("the veil is laid over the screen after it is drawn, where it is", drawChild.indexOf("s.veilOf?.let {") > drawChild.indexOf("super.drawChild(") &&
    drawChild.contains("drawSurface(canvas, it, s.left + s.translationX, s.right + s.translationX, s.veil, REACH_ACROSS, s.top + s.translationY)"), true)
  expect("a veiled screen's strip is drawn as faded as the screen", draw.contains("s.alpha * (1f - s.veil)"), true)
  val surface = stack.substringAfter("private fun drawSurface(").substringBefore("\n  private fun fillEdge(")
  expect("the surface is drawn as composited bands, once each", surface.contains("for (band in TransitionRules.bands(fills)) fillEdge(canvas, band.color, alpha, x0, band.top, x1, band.bottom)") &&
    Regex("fillEdge\\(").findAll(surface).count() == 1, true)
  expect("a screen with rounded corners is not taken as opaque", stack.contains("if (d is GradientDrawable && (d.cornerRadius > 0f || d.cornerRadii != null)) return false"), true)
  expect("a screen moved as the one below another's transition is freed first", system.contains("freeUnder(s)") && system.contains("freeUnder(under)"), true)
  val dismiss = stack.substringAfter("internal fun dismissTop(").substringBefore("\n  /** JavaScript did not remove")
  expect("a gesture's exit goes right: across the width but for a default or activity screen, unless the edge swipe took it past 96 dp",
    dismiss.contains("if (byGesture && TransitionRules.paired(kind) && (!small || (dragged && TransitionRules.exitsAcross("), true)
  expect("a gesture's dismissal leaves the screen below where the gesture showed it", dismiss.contains("moveUnder = !byGesture"), true)
  expect("the edge swipe's dismissal says it was dragged", stack.contains("dismissTop(dragged = true)"), true)
  expect("the edge swipe does not start on a screen a transition is moving", stack.substringAfter("private fun swipesBack(").substringBefore("\n").contains("&& canDrag()"), true)
  val started = stack.substringAfter("override fun handleOnBackStarted(").substringBefore("override fun handleOnBackProgressed")
  expect("predictive back takes the screen whole and opaque from a transition it cut short", started.contains("freeUnder(top)") && started.contains("top.alpha = 1f"), true)
  val insert2 = stack.substringAfter("fun insertScreen(").substringBefore("val others = live()")
  expect("a re-inserted screen starts unscaled", insert2.contains("child.scaleX = 1f"), true)
}

/**
 * The surface a fade-through's veil lays over a screen is its fills composited band by band and drawn once ([TransitionRules.bands], #111): laid at an
 * opacity, that is the opacity of what the fills make together. Each fill drawn at the opacity would let a white background through a dark header.
 */
private fun surfaces() {
  val r = TransitionRules
  val white = 0xFFFFFFFF.toInt(); val dark = 0xFF202020.toInt()
  val plain = r.bands(listOf(TransitionRules.Fill(0f, 2340f, white, 1f), TransitionRules.Fill(200f, 2340f, white, 1f), TransitionRules.Fill(0f, 200f, dark, 1f)))
  expect("a white screen with a dark header is two bands, the header's dark and the rest white",
    plain.map { "${it.top.toInt()}-${it.bottom.toInt()} ${Integer.toHexString(it.color)}" }, listOf("0-200 ff202020", "200-2340 ffffffff"))
  val translucent = r.bands(listOf(TransitionRules.Fill(0f, 2340f, white, 1f), TransitionRules.Fill(0f, 200f, 0x80000000.toInt(), 1f)))
  expect("a half-black header over white is one grey band", Integer.toHexString(translucent.first().color), "ff7f7f7f")
  expect("a fill made transparent by its view's alpha leaves the band under it", r.bands(listOf(TransitionRules.Fill(0f, 100f, white, 1f), TransitionRules.Fill(0f, 100f, dark, 0f))).single().color, white)
  // Against a per-pixel reference: random fills over an opaque background, every band's colour is what the fills make at a row inside it.
  val random = java.util.Random(111)
  var worst = 0
  repeat(200) {
    val fills = mutableListOf(TransitionRules.Fill(0f, 1000f, 0xFF000000.toInt() or random.nextInt(0x1000000), 1f))
    repeat(1 + random.nextInt(5)) {
      val y0 = random.nextInt(1000).toFloat(); val y1 = y0 + 1 + random.nextInt(400)
      fills.add(TransitionRules.Fill(y0, minOf(y1, 1000f), random.nextInt(), random.nextFloat()))
    }
    for (band in r.bands(fills)) {
      val y = (band.top + band.bottom) / 2
      var a = 0.0; var c = DoubleArray(3)
      for (f in fills) if (f.top <= y && f.bottom >= y) {
        val sa = (f.color ushr 24) / 255.0 * f.alpha
        val ch = intArrayOf((f.color shr 16) and 0xff, (f.color shr 8) and 0xff, f.color and 0xff)
        c = DoubleArray(3) { ch[it] / 255.0 * sa + c[it] * (1 - sa) }
        a = sa + a * (1 - sa)
      }
      expect("a band over an opaque background is opaque", band.color ushr 24, 255)
      val got = intArrayOf((band.color shr 16) and 0xff, (band.color shr 8) and 0xff, band.color and 0xff)
      for (k in 0..2) worst = maxOf(worst, abs(got[k] - (c[k] / a * 255).toInt()))
    }
  }
  expect("bands match the per-pixel composite within one step", worst <= 1, true)
}

fun main(args: Array<String>) {
  timing()
  surfaces()
  curve()
  motions()
  screens()
  resume()
  sources(File(args[0]).readText(), File(args[1]).readText())
  codes(File(args[0]).readText(), File(args[2]).readText())
  val res = args.getOrNull(3)?.let { File(it) }
  if (res != null && File(res, "anim/activity_open_enter.xml").isFile) framework(res)
  else println("transition rules: no Android SDK resources${if (res != null) " at $res" else ""}, the framework files were not compared")
  println("transition rules: $checks checks, $failures failed")
  if (failures > 0) exitProcess(1)
}
