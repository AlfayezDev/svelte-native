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

/**
 * A predictive back that takes a screen over from a push it cut short goes on from where the screen is drawn, and never against the finger (#121). The numbers are the report's: a 400 px wide
 * screen sliding in from the left, half in (x = -200), and an 800 px high one sliding in from the bottom, half in (y = 400); the preview moves a screen to 20 % of the width to the right, scales it
 * down to 92 %, and moves a sheet down by a quarter of its height.
 */
private fun takeover() {
  val r = TransitionRules
  val width = 400f
  fun x(p: Float, taken: Float) = r.takenOver(p * width * 0.2f, taken, p)
  fun y(p: Float) = r.takenAway(400f, p)
  near("the preview starts where the screen is drawn (from the left)", x(0f, -200f), -200f)
  near("and where it is drawn from the bottom", y(0f), 400f)
  near("the first step (progress 0.01) moves the screen from the left by what the gesture moved and what is left of its offset, 2.8 px; it jumped 200.8", x(0.01f, -200f) - x(0f, -200f), 2.8f)
  near("the first step of the one from the bottom leaves its other axis too, 4 px", y(0.01f) - y(0f), -4f)
  near("the offset behind the finger is gone when the gesture is all the way (from the left)", x(1f, -200f), width * 0.2f)
  near("and the vertical one is", y(1f), 0f)
  near("a progress past 1 is the preview alone", r.takenOver(80f, -200f, 1.2f), 80f)
  near("a screen at its place goes where the gesture goes, as it did", x(0.5f, 0f), 40f)
  // An offset ahead of the finger (a slide_from_right screen half in: x = +200 of 400, or less in) stays, and the screen goes on to the right from there: it moved left for the whole gesture
  // when the offset left (x(p) = 80 p + 200 (1 - p)).
  near("a slide_from_right screen half in starts where it is drawn", x(0f, 200f), 200f)
  near("and its first step is the gesture's own, 0.8 px, to the right", x(0.01f, 200f) - x(0f, 200f), 0.8f)
  near("it ends the preview's 80 px past where it was", x(1f, 200f), 280f)
  // No step of the preview of any screen goes against the finger, whatever the offset the push left, and none is more than the finger's own step and the share of an offset behind it that leaves.
  var worst = 0f
  var backwards = 0
  var from = -2 * width
  while (from <= 2 * width) {
    for (i in 1..100) {
      val step = x(i / 100f, from) - x((i - 1) / 100f, from)
      if (step < -1e-3f) backwards++
      worst = maxOf(worst, abs(step - 0.2f * width / 100f + (if (from < 0f) from / 100f else 0f)))
    }
    from += 25f
  }
  expect("the preview of a screen from the left or the right never moves left", backwards, 0)
  expect("and its step is the gesture's plus the share of the offset behind the finger that leaves", worst < 1e-2f, true)
  var higher = 0
  var offset = 0f
  while (offset <= 3000f) {
    for (i in 1..100) {
      val step = r.takenOver(1252f + (i / 100f) * 2273f * 0.25f, offset, i / 100f) - r.takenOver(1252f + ((i - 1) / 100f) * 2273f * 0.25f, offset, (i - 1) / 100f)
      if (step < -1e-3f) higher++
    }
    offset += 100f
  }
  expect("a sheet that was entering moves down for the whole preview, whatever its offset (it moved up when the offset was more than a quarter of its height)", higher, 0)
  // A sheet that was entering from the bottom (a 2273 px box resting at 1252 px, drawn at 1500) is moved down by up to a quarter of its height from where it is.
  near("a sheet mid-enter starts where it is drawn", r.takenOver(1252f, 1500f - 1252f, 0f), 1500f)
  near("keeps its offset below its place and goes down from there", r.takenOver(1252f + 2273f * 0.25f, 1500f - 1252f, 1f), 1252f + 2273f * 0.25f + 248f)
  near("a sheet that was above its rest (a settle past it) comes down by the preview and the offset leaving", r.takenOver(1252f + 100f, -60f, 0.5f), 1252f + 100f - 30f)
  // The scale a cancelled gesture was springing back from carries over, and goes on down to the preview's 92 %.
  fun scale(p: Float, taken: Float) = r.takenOver(1f - 0.08f * p, taken - 1f, p)
  near("a gesture that starts in the spring back of one at 0.95 starts at 0.95", scale(0f, 0.95f), 0.95f)
  near("goes on to 0.92 at the end", scale(1f, 0.95f), 0.92f)
  near("and at 1 it is the preview's own scale, as before", scale(0.5f, 1f), 0.96f)
  var grows = 0
  for (i in 1..100) if (scale(i / 100f, 0.95f) > scale((i - 1) / 100f, 0.95f) + 1e-6f) grows++
  expect("the scale never grows during the preview", grows, 0)
  // The screen below, which the push moved with the one on top, comes in place with the gesture.
  near("the screen below starts where the push had it", r.takenAway(200f, 0f), 200f)
  near("is in place at the end", r.takenAway(200f, 1f), 0f)
  near("and half way is half way", r.takenAway(-200f, 0.5f), -100f)

  // A commit comes at the progress the finger let go at, often before 1: the screen below, which the preview was bringing into place, goes the rest of the way over the exit from where it is drawn
  // (it was put in place at the commit, which jumped what was left: a push cut at half the width, released at 0.5, with the screen below 100 px aside jumped 50 px).
  fun belowOver(atCut: Float, release: Float, t: Float) = r.takenAway(r.takenAway(atCut, release), t)
  near("a push cut with the screen below 100 px aside, the gesture let go at 0.5: it is 50 px aside when the exit starts", belowOver(100f, 0.5f, 0f), 50f)
  near("it is where the last step of the preview drew it, with no jump", belowOver(100f, 0.5f, 0f) - r.takenAway(100f, 0.5f), 0f)
  near("half way through the exit it is 25 px aside", belowOver(100f, 0.5f, 0.5f), 25f)
  near("and in place at its end", belowOver(100f, 0.5f, 1f), 0f)
  var jumps = 0
  var growing = 0
  for (side in listOf(-1f, 1f)) for (cut in listOf(40f, 100f, 200f, 400f)) for (release in 0..99 step 11) for (i in 1..100) {
    val at = side * cut
    val rp = release / 100f
    if (abs(belowOver(at, rp, 0f) - r.takenAway(at, rp)) > 1e-4f) jumps++
    if (abs(belowOver(at, rp, i / 100f)) > abs(belowOver(at, rp, (i - 1) / 100f)) + 1e-4f) growing++
  }
  expect("whatever the offset, the side and the progress it was let go at, the screen below starts the exit where the preview left it", jumps, 0)
  expect("and over the exit it only comes closer to its place", growing, 0)

  // The scale of a cancelled gesture that springs back is anything from the preview's 92 % to 1: none of them grows during the preview, and each starts where the screen is drawn.
  var scaleGrows = 0
  var scaleStarts = 0
  var taken = 0.92f
  while (taken <= 1.0001f) {
    if (abs(scale(0f, taken) - taken) > 1e-5f) scaleStarts++
    for (i in 1..100) if (scale(i / 100f, taken) > scale((i - 1) / 100f, taken) + 1e-6f) scaleGrows++
    taken += 0.01f
  }
  expect("a scale from 0.92 to 1 never grows during the preview", scaleGrows, 0)
  expect("and starts where the screen is drawn", scaleStarts, 0)

  // A sheet above its rest (negative offsets: a settle past it) goes down for the whole preview too, and starts where it is drawn.
  var up = 0
  var misplaced = 0
  var negative = -3000f
  while (negative <= 0f) {
    if (abs(r.takenOver(1252f, negative, 0f) - (1252f + negative)) > 1e-2f) misplaced++
    for (i in 1..100) if (r.takenOver(1252f + (i / 100f) * 2273f * 0.25f, negative, i / 100f) < r.takenOver(1252f + ((i - 1) / 100f) * 2273f * 0.25f, negative, (i - 1) / 100f) - 1e-3f) up++
    negative += 100f
  }
  expect("a sheet above its rest never goes up during the preview, whatever its offset", up, 0)
  expect("and starts where it is drawn", misplaced, 0)

  // The screen below, the one the last gesture left displaced, is the new one's only while it still is a screen of the stack that is not the new top: the rules of what a gesture takes and keeps.
  val a = Any(); val b = Any(); val c = Any()
  expect("the screen that moves with the top one is the one below", r.belowFor(a, b, c) { true }, a)
  expect("else the one the last gesture left displaced", r.belowFor(null, b, c) { true }, b)
  expect("not the new top itself (a spring cancelled by a push left it)", r.belowFor(null, c, c) { true }, null)
  expect("not one that left or was removed", r.belowFor(null, b, c) { false }, null)
  expect("none at all is none", r.belowFor<Any>(null, null, c) { true }, null)
  expect("a gesture previews the screen it began on while that is the top", r.stillPreviewing(a, a), true)
  expect("not when JavaScript popped it and another is the top", r.stillPreviewing(a, b), false)
  expect("not when nothing is the top", r.stillPreviewing(a, null), false)
  expect("and not a gesture that never began", r.stillPreviewing(null, a), false)
}

/**
 * The interleavings of #124, replayed: a gesture begins on settled B and, while it is held, a route C opens on the same stack (a push, or a sheet that cannot be dismissed), then the gesture goes on, is
 * committed or cancelled (the system's predictive back), or the finger is let go (the in-app edge swipe). The fake stack takes every decision from [TransitionRules.GestureTarget] and the rules, in the order
 * `EngineStack` does (the pins of `sources` hold that it does), and records what each screen was made to do. A gesture that began on B never moves, dismisses or restores C, B goes back to its own rest,
 * the end of an abandoned gesture is not a back key, and the screen below a cut push stays where the gesture left it through a cancel's spring.
 */
private class Screen(val name: String, val rest: Float = 0f, val dismissible: Boolean = true) {
  var x = 0f
  var y = rest
  var scale = 1f
  var leaving = false
  var mover: Screen? = null
  var movedByMover = false
}

private class Stack(val width: Float = 400f) {
  val screens = ArrayList<Screen>()
  val moved = ArrayList<String>()
  val dismissed = ArrayList<String>()
  val restored = ArrayList<String>()
  val sprung = ArrayList<String>()
  var held: Screen? = null
  val system = TransitionRules.GestureTarget<Screen>()
  val drag = TransitionRules.GestureTarget<Screen>()
  var belowTaken: Screen? = null
  var belowTakenX = 0f
  var springBack: Screen? = null
  var running: Screen? = null
  /** The system's gesture has started and its end has not come: a back with no start is a key. */
  var systemGesture = false
  var callbackEnabled = true
  val top: Screen? get() = screens.lastOrNull { !it.leaving }

  fun push(s: Screen) { screens += s; changed() }
  /** A stack change the stack has not noticed yet (the check of `refresh` has not run): the end of the gesture must still not touch what is in front. */
  fun pushQuiet(s: Screen) { screens += s }
  fun pop() { screens.removeLastOrNull(); changed() }
  private fun changed() {
    if (system.onStackChange(top)) abandonSystem()
    if (drag.onStackChange(top)) abandon(drag)
  }
  private fun abandonSystem() { belowTaken?.let { it.x = 0f }; belowTaken = null; abandon(system) }
  private fun abandon(target: TransitionRules.GestureTarget<Screen>) {
    val screen = target.screen
    target.abandon()
    if (screen != null) restoreAbandoned(screen)
    held = null
  }
  /** `EngineStack.restoreAbandoned`: whole at its rest, unless a transition that moves it has it; a leaving screen is not touched. */
  fun restoreAbandoned(s: Screen) {
    if (s.leaving) return
    s.scale = 1f
    if (s.mover != null) {
      if (!s.movedByMover) { s.x = 0f; s.y = s.rest }
      return
    }
    s.x = 0f; s.y = s.rest
    restored += s.name
  }

  // The system's predictive back.
  fun started() {
    systemGesture = true
    val t = top ?: return
    val below = TransitionRules.belowFor(screens.firstOrNull { it.mover === t }, belowTaken, t) { it in screens && !it.leaving }
    if (belowTaken != null && belowTaken !== below) { belowTaken?.x = 0f; belowTaken = null }
    val belowX = below?.x ?: 0f
    cancelRunning(t)
    belowTaken = below
    belowTakenX = belowX
    below?.x = belowX
    system.begin(t); held = t
  }
  fun progressed(p: Float) {
    val shown = system.screen ?: return
    if (system.onStep(top) != TransitionRules.Step.MOVE) { abandonSystem(); return }
    belowTaken?.x = TransitionRules.takenAway(belowTakenX, p)
    shown.x = p * width * 0.2f
    shown.scale = 1f - 0.08f * p
    moved += shown.name
  }
  fun pressed(expired: Boolean = false) {
    if (!systemGesture) system.end()
    systemGesture = false
    val previewed = system.screen
    val finish = system.onFinish(top, committed = true, expired = expired)
    system.end()
    if (finish == TransitionRules.Finish.RESTORE) { belowTaken?.x = 0f; belowTaken = null; if (previewed != null) restoreAbandoned(previewed); held = null; return }
    if (finish == TransitionRules.Finish.ABANDONED) return
    if (top?.dismissible == false) { belowTaken?.x = 0f; belowTaken = null; if (previewed != null) restoreAbandoned(previewed); held = null; return }
    top?.let { dismissed += it.name }
    held = null
  }
  fun cancelRunning(s: Screen) {
    if (s === springBack) { springBack = null; belowTaken?.x = 0f; belowTaken = null }
    if (running === s) running = null
  }
  /** The spring's end: the screen below is in place for good. */
  fun springEnds() { if (running != null) { running = null; springBack = null; belowTaken?.x = 0f; belowTaken = null } }
  /** [assignedBefore] is the order that was wrong: `animate` cancels what runs on the screen, which clears `springBack` and puts the screen below in place at once. */
  fun cancelled(assignedBefore: Boolean = false, sync: Boolean = false, guarded: Boolean = true) {
    systemGesture = false
    val previewed = system.screen
    val finish = system.onFinish(top, committed = false)
    system.end()
    if (finish == TransitionRules.Finish.ABANDONED) return
    if (finish == TransitionRules.Finish.SPRING && previewed != null) {
      previewed.x = 0f; previewed.y = previewed.rest; previewed.scale = 1f; sprung += previewed.name
      if (assignedBefore) springBack = previewed
      cancelRunning(previewed)
      // [sync]: the animators are off and the spring ended inside `animate` (its `done` ran: the screen below is in place for good).
      if (sync) { springBack = null; belowTaken?.x = 0f; belowTaken = null } else running = previewed
      if (!assignedBefore && (!guarded || running != null)) springBack = previewed
    } else {
      belowTaken?.x = 0f; belowTaken = null
      if (previewed != null) restoreAbandoned(previewed)
    }
    held = null
  }
  /** A finger on the app: no system gesture is in progress, so an abandoned one whose end never came is over. */
  fun touchDown() { if (system.screen == null) system.end() }
  /** `EngineStack.updateBackCallback`: the callback comes back with no gesture on the screen, so an abandoned gesture's end that went elsewhere is over. */
  fun callback(enabled: Boolean) {
    if (enabled && !callbackEnabled && system.screen == null) system.end()
    callbackEnabled = enabled
  }

  // The in-app edge swipe.
  fun dragStarted() { drag.begin(top); held = top }
  fun dragMoved(dx: Float) {
    if (drag.onStep(top) == TransitionRules.Step.ABANDON) abandon(drag)
    drag.screen?.let { it.x = dx.coerceIn(0f, width); moved += it.name }
  }
  fun dragEnded(dx: Float, up: Boolean) {
    val dragged = drag.screen
    val commits = up && dx > width / 3f
    val finish = drag.onFinish(top, commits)
    drag.end()
    when (finish) {
      TransitionRules.Finish.RESTORE -> if (dragged != null) restoreAbandoned(dragged)
      TransitionRules.Finish.DISMISS -> top?.let { dismissed += it.name }
      TransitionRules.Finish.SPRING -> dragged?.let { it.x = 0f; it.y = it.rest; sprung += it.name }
      TransitionRules.Finish.NONE, TransitionRules.Finish.ABANDONED -> {}
    }
    held = null
  }
}

private fun replays() {
  var cases = 0
  fun case(name: String, ok: Boolean) { cases++; expect(name, ok, true) }
  for (withC in listOf("none", "push", "sheet")) for (end in listOf("commit", "cancel")) {
    val stack = Stack()
    val a = Screen("A"); val b = Screen("B"); stack.push(a); stack.push(b)
    val c = if (withC == "sheet") Screen("C", rest = 400f, dismissible = false) else Screen("C")
    stack.started()
    stack.progressed(0.3f)
    case("system $withC/$end: progress 0.3 moves B 24 px", abs(b.x - 24f) < 1e-3f && c.x == 0f)
    if (withC != "none") stack.push(c)
    stack.progressed(0.5f)
    if (withC == "none") case("system $withC/$end: with no C, progress 0.5 moves B to 40 px", abs(b.x - 40f) < 1e-3f)
    else {
      case("system $withC/$end: C is not moved by the rest of B's gesture (it was moved to 40 px)", c.x == 0f && c.y == c.rest && c.scale == 1f)
      case("system $withC/$end: B went back to its rest at once, whole", b.x == 0f && b.y == b.rest && b.scale == 1f && stack.restored == listOf("B"))
    }
    if (end == "commit") stack.pressed() else stack.cancelled()
    when {
      withC == "none" && end == "commit" -> case("system none/commit: B is dismissed, as without the fix", stack.dismissed == listOf("B"))
      withC == "none" -> case("system none/cancel: B springs back to X = 0", stack.sprung == listOf("B") && b.x == 0f)
      else -> {
        case("system $withC/$end: nothing is dismissed (C is not, and B is not a second time)", stack.dismissed.isEmpty())
        case("system $withC/$end: C is not restored or sprung, and keeps its own rest (Y = ${c.rest})", stack.sprung.isEmpty() && "C" !in stack.restored && c.x == 0f && c.y == c.rest)
        case("system $withC/$end: B is back at X = 0 and its rest", b.x == 0f && b.y == b.rest)
      }
    }
    case("system $withC/$end: the layer the gesture held is released", stack.held == null)
  }
  // The end of the gesture reaches a stack that has not noticed the change yet (`refresh` has not run): the commit restores the gesture's screen and dismisses nothing, the cancel springs nothing in front.
  for (commit in listOf(true, false)) {
    val stack = Stack()
    val b = Screen("B"); val c = Screen("C"); stack.push(Screen("A")); stack.push(b)
    stack.started(); stack.progressed(0.4f)
    stack.pushQuiet(c)
    if (commit) stack.pressed() else stack.cancelled()
    case("the end of a gesture on a stack that was not told of C yet (${if (commit) "commit" else "cancel"}) restores B to its rest and touches nothing else", b.x == 0f && stack.dismissed.isEmpty() && stack.sprung.isEmpty() && c.x == 0f && stack.restored == listOf("B"))
  }
  // A plain back key (no gesture) dismisses the top; the end of an abandoned gesture is not one, but one that comes long after, or after a finger touched the app, is.
  run {
    val stack = Stack()
    stack.push(Screen("A")); stack.push(Screen("B"))
    stack.pressed()
    case("a back key with no gesture dismisses the top", stack.dismissed == listOf("B"))
    case("and so does the next one after a gesture that was committed or cancelled", run {
      val again = Stack(); again.push(Screen("A")); again.push(Screen("B")); again.started(); again.progressed(0.3f); again.cancelled(); again.pressed(); again.dismissed == listOf("B")
    })
    case("the end of an abandoned gesture dismisses nothing", run {
      val abandoned = Stack(); abandoned.push(Screen("A")); abandoned.push(Screen("B")); abandoned.started(); abandoned.progressed(0.3f); abandoned.push(Screen("C")); abandoned.pressed(); abandoned.dismissed.isEmpty()
    })
    case("a back key that comes long after the stack changed under a gesture whose end never came is a key", run {
      val lost = Stack(); lost.push(Screen("A")); lost.push(Screen("B")); lost.started(); lost.progressed(0.3f); lost.push(Screen("C")); lost.pressed(expired = true); lost.dismissed == listOf("C")
    })
    case("and so is the first one after a finger touched the app, which a system gesture never lets happen", run {
      val lost = Stack(); lost.push(Screen("A")); lost.push(Screen("B")); lost.started(); lost.progressed(0.3f); lost.push(Screen("C")); lost.touchDown(); lost.pressed(); lost.dismissed == listOf("C")
    })
  }
  // A gesture on B, a sheet that cannot be dismissed over it (the callback is off, the gesture's end goes to the sheet or nowhere) and gone again within the 30 s: the next key is a key.
  run {
    val sheet = Screen("C", dismissible = false)
    val stack = Stack(); stack.push(Screen("A")); stack.push(Screen("B"))
    stack.started(); stack.progressed(0.3f); stack.push(sheet); stack.callback(false); stack.pop(); stack.callback(true)
    stack.pressed()
    case("a key after a sheet that cannot be dismissed came and went over a gesture dismisses the top: the callback coming back ends the abandoned gesture", stack.dismissed == listOf("B"))
    val stays = Stack(); stays.push(Screen("A")); stays.push(Screen("B"))
    stays.started(); stays.progressed(0.3f); stays.push(Screen("D", dismissible = false)); stays.pop()
    stays.pressed()
    case("without the callback coming back (it was on all along) that back is the end of the gesture, and dismisses nothing", stays.dismissed.isEmpty())
    val key = Stack(); key.push(Screen("A")); val b = Screen("B"); key.push(b)
    key.system.begin(b); key.system.abandon()
    key.pressed()
    case("a back that comes with no start is a key, also when an abandoned gesture is still open", key.dismissed == listOf("B"))
    val during = Stack(); during.push(Screen("A")); during.push(Screen("B"))
    during.started(); during.progressed(0.2f); during.callback(false); during.callback(true)
    case("the callback coming back while a gesture is on the screen does not end it", during.system.screen?.name == "B")
  }
  // With the animators off the spring ends inside `animate`: the screen below is in place for good, and nothing is left to cancel.
  run {
    for ((guarded, expected) in listOf(true to true, false to false)) {
      val stack = Stack()
      val a = Screen("A"); val b = Screen("B"); stack.push(a); stack.push(b)
      a.x = 100f; a.mover = b; a.movedByMover = true
      stack.started(); stack.progressed(0.5f); stack.cancelled(sync = true, guarded = guarded)
      case("a spring that ended inside animate leaves no springBack (${if (guarded) "guarded" else "the assignment without the check: stale"})", (stack.springBack == null && a.x == 0f && stack.belowTaken == null) == expected)
    }
  }
  // The screen below a cut push stays where the gesture left it through a cancel's spring, and a gesture that starts then carries it; whatever cancels the spring puts it in place.
  for (assignedBefore in listOf(false, true)) {
    val stack = Stack()
    val a = Screen("A"); val b = Screen("B"); stack.push(a); stack.push(b)
    a.x = 100f; b.x = -100f; a.mover = b; a.movedByMover = true
    stack.started(); stack.progressed(0.5f)
    case("a push cut with the screen below 100 px aside: half way through the gesture it is 50 px aside", a.x == 50f)
    stack.cancelled(assignedBefore)
    if (!assignedBefore) {
      case("cancel: the screen below is still 50 px aside during the spring (the spring's own end puts it in place)", a.x == 50f && stack.belowTaken === a && stack.springBack === b)
      a.mover = null
      stack.started()
      case("a gesture that starts during the spring carries the screen below, still where it was", stack.belowTaken === a && stack.belowTakenX == 50f)
      stack.cancelled()
      stack.springEnds()
      case("and the spring's end puts it in place for good", a.x == 0f && stack.belowTaken == null)
    } else {
      case("the order that assigned springBack before animate (the bug) snapped the screen below to 0 at the cancel, which is what the check above rules out", a.x == 0f && stack.belowTaken == null)
    }
  }
  run {
    val stack = Stack()
    val a = Screen("A"); val b = Screen("B"); stack.push(a); stack.push(b)
    a.x = 100f; a.mover = b; a.movedByMover = true
    stack.started(); stack.progressed(0.5f); stack.cancelled()
    stack.cancelRunning(b)
    case("a spring cancelled by a push, a pop, an edge swipe or a dismissal puts the screen below in place", a.x == 0f && stack.belowTaken == null && stack.springBack == null)
  }
  // What a screen an abandoned gesture had moved does when a transition has it, and when it leaves.
  run {
    val stack = Stack()
    val b = Screen("B"); val c = Screen("C")
    b.x = 24f; b.scale = 0.95f; b.mover = c; b.movedByMover = true
    stack.restoreAbandoned(b)
    case("a screen a push moves aside is left to the push (its X), whole", b.x == 24f && b.scale == 1f)
    val faded = Screen("F"); faded.x = 24f; faded.y = 3f; faded.mover = c; faded.movedByMover = false
    stack.restoreAbandoned(faded)
    case("a screen that is only faded (the default's fade-through, a crossfade) goes back to X = 0 and its rest at once, not after the transition", faded.x == 0f && faded.y == faded.rest)
    val leaving = Screen("L"); leaving.x = 24f; leaving.leaving = true
    stack.restoreAbandoned(leaving)
    case("a screen that is leaving is not touched", leaving.x == 24f)
  }
  // A sheet that was previewed goes back to its own rest, not to 0, when something opens over it.
  run {
    val stack = Stack()
    val sheet = Screen("S", rest = 400f); stack.push(Screen("A")); stack.push(sheet)
    stack.started(); stack.progressed(0.4f)
    stack.push(Screen("C"))
    case("a previewed sheet goes back to its rest offset (400), not 0, when a route opens over it", sheet.y == 400f && sheet.x == 0f)
  }
  // A pop of JavaScript's during the gesture (B is gone): the steps and the commit apply to nothing.
  run {
    val stack = Stack()
    stack.push(Screen("A")); val b = Screen("B"); stack.push(b)
    stack.started(); stack.progressed(0.2f)
    stack.pop()
    stack.progressed(0.6f); stack.pressed()
    case("a gesture whose screen was popped moves nothing, and its commit dismisses nothing (A is not popped by it)", stack.dismissed.isEmpty() && stack.top?.name == "A" && stack.top?.x == 0f)
  }
  // The in-app edge swipe: DOWN at X = 2, drag to 62 (B +60), C opens, on to 162, then the finger goes up (past width/3 = 133), is cancelled, or goes up short at 82.
  for (withC in listOf("none", "push", "sheet")) for (end in listOf("up past a third", "cancel", "short up")) {
    val stack = Stack()
    val a = Screen("A"); val b = Screen("B"); stack.push(a); stack.push(b)
    val c = if (withC == "sheet") Screen("C", rest = 400f, dismissible = false) else Screen("C")
    stack.dragStarted(); stack.dragMoved(60f)
    case("drag $withC/$end: B follows the finger to +60", b.x == 60f)
    if (withC != "none") stack.push(c)
    stack.dragMoved(if (end == "short up") 82f else 162f)
    val dx = if (end == "short up") 82f else 162f
    when (end) {
      "up past a third" -> stack.dragEnded(dx, up = true)
      "cancel" -> stack.dragEnded(dx, up = false)
      else -> stack.dragEnded(dx, up = true)
    }
    if (withC == "none") {
      if (end == "up past a third") case("drag none/$end: B is dismissed, as without C", stack.dismissed == listOf("B"))
      else case("drag none/$end: B is brought back to X = 0", stack.dismissed.isEmpty() && b.x == 0f && stack.sprung == listOf("B"))
    } else {
      case("drag $withC/$end: C is not moved to +160, dismissed or restored (it keeps X = 0 and its rest ${c.rest})", c.x == 0f && c.y == c.rest && stack.dismissed.isEmpty() && "C" !in stack.restored && "C" !in stack.sprung)
      case("drag $withC/$end: B is back at X = 0 and its rest", b.x == 0f && b.y == b.rest)
    }
    case("drag $withC/$end: the layer the drag held is released", stack.held == null)
  }
  expect("the interleavings that were replayed", cases >= 80, true)
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

private fun flatStackDetach(stack: String) = stack.substringAfter("override fun onDetachedFromWindow()").substringBefore("land(s)").replace(Regex("\\s+"), " ").contains("abandonPreview() abandonDrag() previewTarget.end() dragTarget.end()")

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
  // The preview goes on from where the cut transition left the screen (#121), on both axes: the offset is read after the transition was cut, and leaves with the progress.
  expect("predictive back reads where the screen is drawn once the transition is cut", started.indexOf("cancelRunning(top)") in 0 until started.indexOf("takenX = top.translationX"), true)
  expect("on both axes, a sheet's from its own rest, and the scale", started.contains("takenX = top.translationX") && started.contains("takenY = top.translationY - top.restY") && started.contains("takenScale = top.scaleX"), true)
  val progressed = stack.substringAfter("override fun handleOnBackProgressed(").substringBefore("override fun handleOnBackPressed")
  expect("a screen's preview goes on to the right from its offset, and takes the vertical one and the scale away or over",
    progressed.contains("shown.translationX = TransitionRules.takenOver(p * width * 0.2f, takenX, p)") && progressed.contains("shown.translationY = shown.restY + TransitionRules.takenAway(takenY, p)") &&
      progressed.contains("shown.scaleX = TransitionRules.takenOver(1f - 0.08f * p, takenScale - 1f, p)") && progressed.contains("shown.scaleY = shown.scaleX"), true)
  expect("so does a sheet's", progressed.contains("shown.translationY = TransitionRules.takenOver(shown.restY + p * shown.height * 0.25f, takenY, p)"), true)
  // The screen a gesture began on is the one it moves and commits, captured at its start. The direction of the preview and of the exit is main's (a gesture from the right edge, or in a right-to-left layout, is a known gap: SPEC.md).
  val pressed = stack.substringAfter("override fun handleOnBackPressed()").substringBefore("override fun handleOnBackCancelled")
  expect("the screen below is not put in place at the commit: the exit brings it, from where it is drawn, over its duration, and it is in place for good when the exit ends",
    !pressed.contains("releaseBelow()\n      dismissTop") && dismiss.contains("belowTaken?.let { it.animate().translationX(0f).setDuration(duration).setInterpolator(interpolator).start() }") && dismiss.contains("exitTo(s, kind, duration, moveUnder = !byGesture) {\n      releaseBelow()"), true)
  val cancelled = stack.substringAfter("override fun handleOnBackCancelled()").substringBefore("private var backRegistered")
  expect("a cancel springs the previewed screen back and puts the one below in place with the spring's end", cancelled.contains("springBack = previewed") && cancelled.contains("{ springBack = null; releaseBelow(); refresh() }"), true)
  expect("whatever cancels the spring puts the screen below in place (a push, a pop, an edge swipe, a dismissal)", stack.substringAfter("private fun cancelRunning(").substringBefore("(s as? EngineSheet)").contains("if (s === springBack) { springBack = null; releaseBelow() }"), true)
  expect("the stack leaving the window ends the gesture and the spring: nothing of them is held for the next one", stack.substringAfter("override fun onDetachedFromWindow()").substringBefore("land(s)").replace(Regex("\\s+"), " ").contains("springBack = null abandonPreview()"), true)
  expect("a gesture takes the screen below from the one moving with the top, or the stale one only if it is still valid", started.replace(Regex("\\s+"), " ").contains("TransitionRules.belowFor(movedWith(top), belowTaken, top) { it.parent === this@EngineStack && !it.leaving }") && started.contains("if (belowTaken != null && belowTaken !== below) releaseBelow()"), true)
  // The screen below a push that is cut was moved with it, and the cut puts it in place at once: it is found before the cut, drawn where it was, brought in place by the gesture, and put in place at its end.
  expect("the screen the push moved with the top one is found before the cut", started.indexOf("movedWith(top)") in 0 until started.indexOf("cancelRunning(top)"), true)
  expect("and drawn where it was after it", started.indexOf("cancelRunning(top)") in 0 until started.indexOf("below?.translationX = belowX"), true)
  expect("the gesture brings it in place", progressed.contains("belowTaken?.translationX = TransitionRules.takenAway(belowTakenX, p)"), true)
  expect("a screen that goes off across the width after a gesture takes its vertical offset to its place on the way", exit.contains("2 -> animate(s, width.toFloat(), s.restY, s.alpha, 1f, duration, done)"), true)
  expect("the steps move the screen the gesture began on, and end the gesture when it is not the top any more", progressed.contains("val shown = previewTarget.screen") && progressed.contains("if (previewTarget.onStep(top()) != TransitionRules.Step.MOVE) { abandonPreview(); return }"), true)
  expect("the start captures it, and the edge", started.contains("previewTarget.begin(top)") && !started.contains("swipeEdge"), true)
  val pressedFlat = pressed.replace(Regex("\\s+"), " ")
  expect("a commit is decided by the target: a screen that is not in front any more is restored to its rest, and nothing of what is in front is dismissed", pressedFlat.contains("val finish = previewTarget.onFinish(top(), committed = true, expired = abandonedFor() > ABANDONED_MS)") && pressedFlat.contains("if (finish == TransitionRules.Finish.RESTORE) { releaseBelow() if (previewed != null) restoreAbandoned(previewed) releaseGesture() return }"), true)
  val cancelledFlat = cancelled.replace(Regex("\\s+"), " ")
  expect("a cancel springs the screen back only while it is in front; otherwise it goes back to its rest and what is in front is not restored", cancelledFlat.contains("val finish = previewTarget.onFinish(top(), committed = false, expired = abandonedFor() > ABANDONED_MS)") && cancelledFlat.contains("if (finish == TransitionRules.Finish.SPRING && previewed != null) {") && cancelledFlat.contains("} else { // Its screen is not in front any more: it goes back to its rest, and what is in front is not restored in its place. releaseBelow() if (previewed != null) restoreAbandoned(previewed) }"), true)
  expect("the end the system still sends of a gesture that was abandoned applies to nothing: a commit is not a back key that dismisses what opened, and a cancel restores nothing", pressedFlat.contains("if (finish == TransitionRules.Finish.ABANDONED) return") && cancelledFlat.contains("if (finish == TransitionRules.Finish.ABANDONED) return"), true)
  expect("abandoning lets go of the screen and keeps the gesture open until its end; the stack leaving the window closes it", stack.substringAfter("private fun abandonPreview()").substringBefore("\n  }\n").contains("previewTarget.abandon()") && flatStackDetach(stack), true)
  // The stack changing in front ends a gesture at once, and the screen it moved goes back to its rest, whole, with Y at its own rest (a sheet's offset), and is left to the transition that moves it.
  val flatStack = stack.replace(Regex("\\s+"), " ")
  expect("a key is not the end of a gesture: the start marks the gesture before anything can return, and a back with no start ends what an abandoned gesture left", started.indexOf("systemGesture = true") in 0 until started.indexOf("val top = top() ?: return") && pressedFlat.contains("if (!systemGesture) previewTarget.end() systemGesture = false") && pressedFlat.indexOf("if (!systemGesture) previewTarget.end()") in 0 until pressedFlat.indexOf("val finish = previewTarget.onFinish") && cancelledFlat.contains("systemGesture = false"), true)
  expect("the callback coming back with no gesture on the screen ends an abandoned gesture", flatStack.contains("if (enabled && !backCallback.isEnabled && !predictive && previewTarget.screen == null) previewTarget.end() backCallback.isEnabled = enabled"), true)
  expect("the spring is the gesture's only while it runs: with the animators off its end ran inside animate", cancelled.contains("if (previewed.running != null) springBack = previewed"), true)
  expect("the cancel's spring is started before springBack is assigned: starting it cancels what ran on the screen, which would clear it and put the screen below in place at once", cancelled.indexOf("animate(previewed, 0f, previewed.restY, 1f, 1f, 150L)") in 0 until cancelled.indexOf("springBack = previewed"), true)
  expect("a screen a transition only fades goes back to its rest at once: the transition records whether it moves the screen below", stack.contains("under.movedByMover = m.moveUnder") && stack.contains("if (!s.movedByMover) { s.translationX = 0f; s.translationY = s.restY }"), true)
  expect("the end of an abandoned gesture is its own only for a while, and a finger on the app or a window that lost focus ends it: a lost end does not swallow a key", pressedFlat.contains("expired = abandonedFor() > ABANDONED_MS") && cancelledFlat.contains("expired = abandonedFor() > ABANDONED_MS") && flatStack.contains("if (!predictive) previewTarget.end()") && flatStack.contains("if (!hasWindowFocus && previewTarget.open) { abandonPreview(); previewTarget.end() }"), true)
  expect("the stack leaving the window resets the drag and its touch state", flatStack.substringAfter("override fun onDetachedFromWindow()").substringBefore("land(s)").contains("dragging = false edgeCandidate = false tracker?.recycle() tracker = null downPointer.clear()"), true)
  expect("a change of the top ends the system gesture and the in-app drag at once", flatStack.contains("if (previewTarget.onStackChange(top)) abandonPreview() if (dragging && dragTarget.onStackChange(top)) abandonDrag()"), true)
  val restore = stack.substringAfter("private fun restoreAbandoned(").substringBefore("\n  }\n")
  expect("an abandoned screen goes back whole, to X = 0 and to its own rest in Y, unless a transition moves it or it leaves", restore.contains("s.scaleX = 1f") && restore.contains("if (s.mover != null) {") && restore.contains("animate(s, 0f, s.restY, 1f, 1f, 150L) { refresh() }") && restore.contains("if (s.parent !== this || s.leaving) return"), true)
  expect("the abandoned gestures let go of the layer they held", stack.substringAfter("private fun abandonPreview()").substringBefore("\n  }\n").contains("releaseGesture()") && stack.substringAfter("private fun abandonDrag()").substringBefore("\n  }\n").contains("releaseGesture()"), true)
  // The in-app edge swipe takes its screen when it claims the touch, and moves, dismisses and restores that one.
  val touch = stack.substringAfter("override fun onTouchEvent(event: MotionEvent): Boolean {").substringBefore("companion object")
  val touchFlat = touch.replace(Regex("\\s+"), " ")
  expect("the drag captures its screen when it claims the touch", stack.substringAfter("private fun startDrag(").substringBefore("\n  }\n").contains("dragTarget.begin(top())"), true)
  expect("a move of the drag ends it when its screen is not in front any more, and moves only its own screen", touchFlat.contains("if (dragTarget.onStep(top()) == TransitionRules.Step.ABANDON) abandonDrag()") && touchFlat.contains("val moved = dragTarget.screen") && touchFlat.contains("moved.translationX = dragX"), true)
  expect("the end of the drag is decided by the target: dismiss its screen, spring it back to its own rest, or restore it when it is not in front any more", touchFlat.contains("val finish = dragTarget.onFinish(top(), commits)") && touchFlat.contains("TransitionRules.Finish.RESTORE -> { if (dragged != null) restoreAbandoned(dragged); refresh() }") && touchFlat.contains("TransitionRules.Finish.DISMISS -> dismissTop(dragged = true)") && touchFlat.contains("animate(back, 0f, back.restY, 1f, 1f, 150L)"), true)
  expect("the drag no longer moves or restores whatever is in front (top()?.translationX, animate(top, 0f, 0f ...))", !touchFlat.contains("top?.translationX") && !touchFlat.contains("animate(top, 0f, 0f"), true)
  expect("no preview replaces the translation with the gesture's own position", progressed.contains("translationX = p * width * 0.2f"), false)
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
  takeover()
  replays()
  sources(File(args[0]).readText(), File(args[1]).readText())
  codes(File(args[0]).readText(), File(args[2]).readText())
  val res = args.getOrNull(3)?.let { File(it) }
  if (res != null && File(res, "anim/activity_open_enter.xml").isFile) framework(res)
  else println("transition rules: no Android SDK resources${if (res != null) " at $res" else ""}, the framework files were not compared")
  println("transition rules: $checks checks, $failures failed")
  if (failures > 0) exitProcess(1)
}
