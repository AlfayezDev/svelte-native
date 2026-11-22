package expo.modules.svelteappearance

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the app's night mode on Android: which mode each `userInterfaceStyle` gives, that a missing or unknown value leaves the mode alone, and that the meta-data's name is
 * the one the config plugin writes (`src/user-interface-style.ts`). Usage: AppearanceCheck <src/user-interface-style.ts>   (src/test/appearance.sh)
 */
private var checks = 0
private var failures = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    failures++
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
  }
}

fun main(args: Array<String>) {
  expect("light keeps the app light", AppearanceRules.night("light"), AppearanceRules.Night.NO)
  expect("dark keeps it dark", AppearanceRules.night("dark"), AppearanceRules.Night.YES)
  expect("automatic follows the system", AppearanceRules.night("automatic"), AppearanceRules.Night.FOLLOW_SYSTEM)
  expect("the case does not matter", AppearanceRules.night(" Dark "), AppearanceRules.Night.YES)
  expect("no meta-data leaves the mode alone", AppearanceRules.night(null), null)
  expect("an unknown value leaves it alone", AppearanceRules.night("sepia"), null)
  val plugin = File(args[0]).readText()
  expect("the plugin writes the meta-data this reads", Regex("""userInterfaceStyleMetaData = "([^"]+)"""").find(plugin)?.groupValues?.get(1), AppearanceRules.META_STYLE)
  println("appearance: $checks checks, $failures failed")
  if (failures > 0) exitProcess(1)
}
