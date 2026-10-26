import expo.modules.svelteengine.views.ModalLayout

// Host-side check of the modal overlay's rules (ModalLayout.kt, no Android types). Reads one command per line from
// stdin and prints one result line per command; tests/modal-native.test.ts holds the expectations.
//
//   insets L T R B KEYBOARD STATUS_TRANSLUCENT NAVIGATION_TRANSLUCENT   ->  left top right bottom
//   pose TYPE PROGRESS HEIGHT DIM                                       ->  layerAlpha contentOffset scrimAlpha
//   phase STEP...                                                       ->  STEP:RESULT/STATE for each step, space separated
//       steps: show, show0 (animation type none), hide, hide0, end (the running animation ended), drop
//       result of show/hide/end: the Step; drop: DROP or NONE; state is the phase after the step, `*` marks an active layer

private fun phase(steps: List<String>): String {
  val phase = ModalLayout.Phase()
  val out = ArrayList<String>()
  for (step in steps) {
    val result = when (step) {
      "show" -> phase.show(true).name
      "show0" -> phase.show(false).name
      "hide" -> phase.hide(true).name
      "hide0" -> phase.hide(false).name
      "end" -> phase.finished().name
      "drop" -> if (phase.drop()) "DROP" else "NONE"
      else -> throw IllegalArgumentException(step)
    }
    out.add("$step:$result/${phase.state.name}${if (phase.active) "*" else ""}")
  }
  return out.joinToString(" ")
}

fun main() {
  val pose = ModalLayout.Pose()
  val insets = IntArray(4)
  for (line in generateSequence(::readLine)) {
    val words = line.trim().split(" ").filter { it.isNotEmpty() }
    if (words.isEmpty()) continue
    when (words[0]) {
      "insets" -> {
        val n = words.drop(1).map { it.toInt() }
        ModalLayout.contentInsets(n[0], n[1], n[2], n[3], n[4], n[5] == 1, n[6] == 1, insets)
        println(insets.joinToString(" "))
      }
      "pose" -> {
        pose.at(words[2].toFloat(), words[1].toInt(), words[3].toFloat(), words[4].toFloat())
        println("${pose.layerAlpha} ${pose.contentOffset} ${pose.scrimAlpha}")
      }
      "phase" -> println(phase(words.drop(1)))
      else -> throw IllegalArgumentException(line)
    }
  }
}
