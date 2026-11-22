package expo.modules.svelteengine

import kotlin.system.exitProcess

/**
 * Plain-JVM check of what the status and navigation bars do by default (`SystemBarsRules`): `auto` follows the system appearance (dark icons by day, light
 * icons at night), an explicit style wins, and the window is written the first time even when no option was ever set.
 * Usage: SystemBarsRulesCheck   (src/test/run.sh)
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

fun main() {
  expect("auto by day has dark icons", SystemBarsRules.darkIcons(SystemBarsRules.AUTO, night = false), true)
  expect("auto at night has light icons", SystemBarsRules.darkIcons(SystemBarsRules.AUTO, night = true), false)
  expect("light style has light icons by day", SystemBarsRules.darkIcons(SystemBarsRules.LIGHT, night = false), false)
  expect("light style has light icons at night", SystemBarsRules.darkIcons(SystemBarsRules.LIGHT, night = true), false)
  expect("dark style has dark icons by day", SystemBarsRules.darkIcons(SystemBarsRules.DARK, night = false), true)
  expect("dark style has dark icons at night", SystemBarsRules.darkIcons(SystemBarsRules.DARK, night = true), true)
  expect("an unknown style is auto", SystemBarsRules.darkIcons(9, night = false), true)
  // The window is written the first time even though "no spec" equals the initial "nothing applied": an app that sets no option still gets the default.
  expect("the first write happens even for the same (empty) spec", SystemBarsRules.needsWrite(written = false, sameAsApplied = true), true)
  expect("an unchanged spec is not written again", SystemBarsRules.needsWrite(written = true, sameAsApplied = true), false)
  expect("a changed spec is written", SystemBarsRules.needsWrite(written = true, sameAsApplied = false), true)
  // The system switched between light and night while the app ran: the same spec is written again, so `auto` draws its icons for the new appearance.
  expect("an unchanged spec is written again after a switch to or from night", SystemBarsRules.needsWrite(written = true, sameAsApplied = true, sameNight = false), true)
  expect("an unchanged spec in the same appearance is not", SystemBarsRules.needsWrite(written = true, sameAsApplied = true, sameNight = true), false)
  System.err.println("SystemBarsRulesCheck: $checks checks, $failures failures")
  if (failures > 0) exitProcess(1)
}
