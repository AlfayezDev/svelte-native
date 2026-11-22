package expo.modules.svelteengine

import java.io.File
import kotlin.system.exitProcess

/**
 * Plain-JVM check of the accessibility props on the Kotlin side, without a device:
 * 1. the production decoder (`A11yRecords`) on the streams A11yWireTest.cpp verified, so both halves of the wire meet on the same bytes;
 * 2. the decisions of `A11yRules` (content description, range, action ids, which role a prop stands for);
 * 3. the tables of `A11yRules` against React Native 0.88's own sources (`ReactAccessibilityDelegate.kt`, `BaseViewManager.java`,
 *    `AccessibilityPrimitives.h`), read from `node_modules`, so an upgrade that changes a role, an action id or the `Role` enum fails here.
 * Usage: A11yRulesCheck <fixture> <ReactAccessibilityDelegate.kt> <BaseViewManager.java> <AccessibilityPrimitives.h>   (src/test/run.sh)
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

private fun unhex(hex: String): String {
  if (hex == "00") return ""
  val bytes = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
  return String(bytes, Charsets.UTF_8)
}

private fun render(r: A11yRecords): String {
  val parts = ArrayList<String>()
  if (r.hasState) parts.add("state=${r.state}")
  if (r.valueMask != 0) {
    val value = ArrayList<String>()
    value.add("mask:${r.valueMask}")
    if (r.valueMask and A11yRules.VALUE_MIN != 0) value.add("min:${r.min}")
    if (r.valueMask and A11yRules.VALUE_MAX != 0) value.add("max:${r.max}")
    if (r.valueMask and A11yRules.VALUE_NOW != 0) value.add("now:${r.now}")
    if (r.valueMask and A11yRules.VALUE_TEXT != 0) value.add("text:${r.valueText}")
    parts.add("value=" + value.joinToString(","))
  }
  r.hint?.let { parts.add("hint=$it") }
  if (r.actionNames.isNotEmpty()) parts.add("actions=" + r.actionNames.indices.joinToString(",") { "${r.actionNames[it]}|${r.actionLabels[it] ?: ""}" })
  if (r.mode != 0) parts.add("mode=${r.mode}")
  if (r.role >= 0) parts.add("role=${r.role}")
  return parts.joinToString(" ")
}

private fun decode(opsText: String, stringsText: String): A11yRecords {
  val ops = opsText.split(',').map { it.toInt() }.toIntArray()
  val strings = if (stringsText == "-") emptyArray() else stringsText.split(',').map { unhex(it) }.toTypedArray()
  val records = A11yRecords()
  var i = 1
  for (n in 0 until ops[0]) {
    val id = ops[i++]
    i = records.decode(id, ops, i, strings)
  }
  check(i == ops.size) { "records end at $i, stream has ${ops.size} ints" }
  return records
}

private fun fixture(path: String) {
  val lines = File(path).readLines().filter { it.isNotBlank() }
  for (line in lines) {
    val cells = line.split('\t')
    val records = decode(cells[1], cells[2])
    expect("wire ${cells[0]}", render(records), cells.getOrElse(3) { "" })
    expect("wire ${cells[0]} isEmpty", records.isEmpty, cells[0] == "nothing")
  }
  // A record id this build does not know stops the decode instead of misreading what follows.
  var thrown = false
  try { A11yRecords().decode(99, intArrayOf(0), 0, emptyArray()) } catch (e: IllegalStateException) { thrown = true }
  expect("an unknown record id throws", thrown, true)
  // copyFrom and sameAs: what the node keeps is a copy, and a record equal to it is no change.
  val slider = decode(lines.first { it.startsWith("slider\t") }.split('\t')[1], lines.first { it.startsWith("slider\t") }.split('\t')[2])
  val kept = A11yRecords().also { it.copyFrom(slider) }
  expect("copy renders as the original", render(kept), render(slider))
  expect("a copy is the same", kept.sameAs(slider), true)
  slider.reset()
  expect("a reset record is empty and unlike the copy", slider.isEmpty && !kept.sameAs(slider), true)
}

private fun rules() {
  val busy = "busy"
  val mixed = "mixed"
  expect("label alone", A11yRules.contentDescription("Save", false, 0, null, busy, mixed), "Save")
  expect("a state with nothing to say keeps the label", A11yRules.contentDescription("Save", true, A11yRules.DISABLED or A11yRules.SELECTED, null, busy, mixed), "Save")
  expect("busy follows the label", A11yRules.contentDescription("Save", true, A11yRules.BUSY, null, busy, mixed), "Save, busy")
  expect("mixed follows the label", A11yRules.contentDescription("Terms", true, 3 shl 3, null, busy, mixed), "Terms, mixed")
  expect("checked and unchecked add nothing", A11yRules.contentDescription("Terms", true, 2 shl 3, null, busy, mixed), "Terms")
  expect("busy, mixed and the value's text, in that order", A11yRules.contentDescription("Volume", true, A11yRules.BUSY or (3 shl 3), "40 percent", busy, mixed), "Volume, busy, mixed, 40 percent")
  expect("the value's text without a label", A11yRules.contentDescription(null, false, 0, "40 percent", busy, mixed), "40 percent")
  expect("nothing to say", A11yRules.contentDescription(null, true, A11yRules.SELECTED, null, busy, mixed), null)

  fun range(min: Int, max: Int, now: Int, mask: Int = 7) = A11yRecords().also { it.valueMask = mask; it.min = min; it.max = max; it.now = now }
  expect("a range", A11yRules.hasRange(range(0, 10, 3)), true)
  expect("a range at its ends", A11yRules.hasRange(range(0, 10, 0)) && A11yRules.hasRange(range(0, 10, 10)), true)
  expect("an empty range is none", A11yRules.hasRange(range(5, 5, 5)), false)
  expect("now below min is none", A11yRules.hasRange(range(2, 10, 1)), false)
  expect("now above max is none", A11yRules.hasRange(range(0, 10, 11)), false)
  expect("min, max and now are all needed", A11yRules.hasRange(range(0, 10, 3, mask = 3)) || A11yRules.hasRange(range(0, 10, 3, mask = 6)) || A11yRules.hasRange(range(0, 10, 3, mask = 8)), false)

  expect("state bits", listOf(A11yRules.checked(1 shl 3), A11yRules.checked(2 shl 3), A11yRules.checked(3 shl 3), A11yRules.checked(0)), listOf(1, 2, 3, 0))
  expect("expanded bits", listOf(A11yRules.expanded(1 shl 5), A11yRules.expanded(2 shl 5), A11yRules.expanded(0)), listOf(1, 2, 0))
  expect("mode bits", listOf(A11yRules.liveRegion(13), A11yRules.important(13), A11yRules.liveRegion(4), A11yRules.important(4)), listOf(1, 3, 0, 1))

  // The standard names are the standard actions; any other name is a custom id from 0x3f000000, one per name, the same on every ask.
  expect("standard action ids", listOf("activate", "longpress", "increment", "decrement", "expand", "collapse").map { A11yRules.actionId(it) }, listOf(0x10, 0x20, 0x1000, 0x2000, 0x40000, 0x80000))
  val archive = A11yRules.actionId("archive")
  val delete = A11yRules.actionId("delete")
  expect("custom action ids start at 0x3f000000 and follow each other", listOf(archive, delete, A11yRules.actionId("archive")), listOf(0x3f000000, 0x3f000001, 0x3f000000))
  expect("an action id names its action", A11yRules.actionName(arrayOf("activate", "archive", "delete"), delete), "delete")
  expect("an action the node did not declare is none", A11yRules.actionName(arrayOf("activate"), delete), null)
  expect("a standard id names the standard action", A11yRules.actionName(arrayOf("increment"), A11yRules.ACTION_SCROLL_FORWARD), "increment")

  // `role` wins whenever it is set, even when it stands for no accessibility role; without it `accessibilityRole` counts, in any case.
  val slider = A11yRules.ARIA_ROLES.indexOf("slider")
  val article = A11yRules.ARIA_ROLES.indexOf("article")
  expect("an ARIA role over accessibilityRole", A11yRules.resolveRole(slider, "button"), A11yRules.AccessibilityRole.ADJUSTABLE)
  expect("an ARIA role with no counterpart leaves the view without a role", A11yRules.resolveRole(article, "button"), null)
  expect("accessibilityRole without role", A11yRules.resolveRole(-1, "Button"), A11yRules.AccessibilityRole.BUTTON)
  expect("a value React Native would reject is no role", A11yRules.resolveRole(-1, "heading"), null)
  expect("role=slider is not adjustable for the actions", A11yRules.isAdjustable("adjustable") && !A11yRules.isAdjustable(null), true)
}

/** The body of `{ ... }` that starts at the first `{` at or after [from] (braces balanced), without the outer braces. */
private fun block(source: String, from: Int): String {
  val start = source.indexOf('{', from)
  var depth = 0
  for (i in start until source.length) {
    when (source[i]) {
      '{' -> depth++
      '}' -> if (--depth == 0) return source.substring(start + 1, i)
    }
  }
  error("unbalanced braces after $from")
}

private fun entries(body: String): List<String> =
  body.substringBefore(';').split(',').map { it.trim() }.filter { it.isNotEmpty() && it.all { c -> c.isUpperCase() || c.isDigit() } }

private fun reactNative(delegatePath: String, viewManagerPath: String, primitivesPath: String) {
  val delegate = File(delegatePath).readText()
  val manager = File(viewManagerPath).readText()
  val primitives = File(primitivesPath).readText()

  val roleBody = block(delegate, delegate.indexOf("enum class AccessibilityRole"))
  val roles = entries(roleBody)
  expect("AccessibilityRole entries and their order", A11yRules.AccessibilityRole.entries.map { it.name }, roles)

  // getValue: the class name of each role.
  val getValue = delegate.substring(delegate.indexOf("fun getValue(role: AccessibilityRole)"))
  val whenBody = block(getValue, getValue.indexOf("return when"))
  val classes = HashMap<String, String>()
  for (m in Regex("((?:[A-Z]+\\s*,\\s*)*[A-Z]+)\\s*->\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").findAll(whenBody)) {
    val className = m.groupValues[2].replace("\\$", "$")
    for (name in m.groupValues[1].split(',').map { it.trim() }) classes[name] = className
  }
  expect("a class name for every role", roles.filter { it !in classes }, emptyList<String>())
  for (role in A11yRules.AccessibilityRole.entries) expect("class name of ${role.name}", role.className, classes[role.name])

  // setRole: what each role adds to the node.
  val setRole = delegate.substring(delegate.indexOf("fun setRole("))
  val setRoleBody = block(setRole, setRole.indexOf("when (resolvedRole)"))
  val added = HashMap<String, String>()
  for (m in Regex("AccessibilityRole\\.([A-Z]+)\\s*->\\s*\\{([^}]*)\\}").findAll(setRoleBody)) added[m.groupValues[1]] = m.groupValues[2]
  for (role in A11yRules.AccessibilityRole.entries) {
    val body = added[role.name] ?: ""
    expect("${role.name} clickable", role.clickable, body.contains("isClickable = true"))
    expect("${role.name} checkable", role.checkable, body.contains("isCheckable = true"))
    expect("${role.name} heading", role.heading, body.contains("isHeading = true"))
    val text = Regex("R\\.string\\.(\\w+)").find(body)?.groupValues?.get(1)
    val mine = role.text?.let { if (it == A11yRules.RoleText.TAB) "rn_tab_description" else it.name.lowercase() + "_description" }
    expect("${role.name} role description", mine, text)
  }

  // The ARIA roles: React Native's enum (Kotlin and C++) and which accessibility role each stands for.
  val ariaKotlin = entries(block(delegate, delegate.indexOf("enum class Role")))
  expect("Role entries (Kotlin) are the ARIA roles in the order of the wire", A11yRules.ARIA_ROLES.map { it.uppercase() }, ariaKotlin)
  val header = primitives.substring(primitives.indexOf("enum class Role : uint8_t"))
  val ariaCpp = block(header, 0).split(',').map { it.trim() }.filter { it.isNotEmpty() }
  expect("Role entries (C++) are the ARIA roles in the order of the wire", A11yRules.ARIA_ROLES.map { it.uppercase() }, ariaCpp.map { it.uppercase() })
  val fromRole = delegate.substring(delegate.indexOf("fun fromRole(role: Role)"))
  val fromRoleBody = block(fromRole, fromRole.indexOf("return when"))
  val mapped = HashMap<String, String>()
  for (m in Regex("Role\\.([A-Z]+)\\s*->\\s*([A-Z]+)").findAll(fromRoleBody)) mapped[m.groupValues[1]] = m.groupValues[2]
  for (name in A11yRules.ARIA_ROLES) {
    expect("accessibility role of role=$name", A11yRules.fromAriaRole(name)?.name, mapped[name.uppercase()])
  }

  // Actions: the names and the ids they stand for, and where the custom ids start.
  val ids = mapOf("ACTION_CLICK" to A11yRules.ACTION_CLICK, "ACTION_LONG_CLICK" to A11yRules.ACTION_LONG_CLICK, "ACTION_SCROLL_FORWARD" to A11yRules.ACTION_SCROLL_FORWARD,
    "ACTION_SCROLL_BACKWARD" to A11yRules.ACTION_SCROLL_BACKWARD, "ACTION_EXPAND" to A11yRules.ACTION_EXPAND, "ACTION_COLLAPSE" to A11yRules.ACTION_COLLAPSE)
  val standard = Regex("\"(\\w+)\"\\s+to\\s+AccessibilityActionCompat\\.(\\w+)\\.id").findAll(delegate).associate { it.groupValues[1] to it.groupValues[2] }
  expect("React Native maps six action names", standard.size, 6)
  for ((name, constant) in standard) expect("action id of $name", A11yRules.actionId(name), ids[constant])
  expect("custom actions start at 0x3f000000", Regex("customActionCounter = (0x[0-9a-fA-F]+)").find(delegate)?.groupValues?.get(1), "0x3f000000")

  // What React Native publishes on the node, and what it does not: the hint is the tooltip text, a state is no state description.
  expect("the hint is the node's tooltip text", delegate.contains("info.tooltipText = accessibilityHint"), true)
  expect("no state description and no hint text are written", Regex("\\.(stateDescription|hintText)\\s*=").containsMatchIn(delegate + manager), false)
  expect("the range test", delegate.contains("max > min && now >= min && max >= now"), true)
  expect("the content description is joined with a comma", manager.contains("TextUtils.join(\", \", contentDescription)"), true)
  expect("mixed and busy come from the state", manager.contains("R.string.state_mixed_description") && manager.contains("R.string.state_busy_description"), true)
  expect("the live region is the view's", manager.contains("ViewCompat.setAccessibilityLiveRegion"), true)
  expect("unselected is announced when focus is on the node", manager.contains("R.string.state_unselected_description") && manager.contains("announceForAccessibility"), true)
}

fun main(args: Array<String>) {
  fixture(args[0])
  rules()
  reactNative(args[1], args[2], args[3])
  if (failures > 0) {
    System.err.println("$failures of $checks check(s) failed")
    exitProcess(1)
  }
  System.err.println("A11yRulesCheck: $checks checks passed")
}
