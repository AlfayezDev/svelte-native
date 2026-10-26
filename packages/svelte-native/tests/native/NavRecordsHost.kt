import expo.modules.svelteengine.NavProps
import expo.modules.svelteengine.PropsNav

// Host-side check of the engine's Kotlin record decoder (PropsNav.kt): reads what nav-records-host.cpp wrote (per node
// `kind`, `count`, `ops`, `strings` lines), decodes it into NavProps the way MountingManager does, and prints the
// result as one JSON object per node. tests/navigation-native.test.ts compares it with `decodeRecords`.

private fun json(value: Any?): String = when (value) {
  null -> "null"
  is Boolean, is Int -> value.toString()
  is Float -> if (value.isNaN()) "null" else value.toString()
  is String -> buildString {
    append('"')
    for (c in value) when {
      c == '"' -> append("\\\"")
      c == '\\' -> append("\\\\")
      c < ' ' || c.code > 126 -> append(String.format("\\u%04x", c.code))
      else -> append(c)
    }
    append('"')
  }
  is FloatArray -> value.joinToString(",", "[", "]") { json(it) }
  is Map<*, *> -> value.entries.joinToString(",", "{", "}") { "${json(it.key as String)}:${json(it.value)}" }
  else -> throw IllegalArgumentException(value.toString())
}

private fun fields(n: NavProps): Map<String, Any?> = linkedMapOf(
  "seen" to n.seen, "activityState" to n.activityState, "presentation" to n.presentation, "gestureEnabled" to n.gestureEnabled,
  "animation" to n.animation, "backDismissal" to n.backDismissal,
  "sheetSeen" to n.sheetSeen, "detents" to n.detents, "initialDetent" to n.initialDetent, "grabber" to n.grabber,
  "dismissible" to n.dismissible, "backdropNone" to n.backdropNone,
  "barsSeen" to n.barsSeen, "statusStyle" to n.statusStyle, "statusHidden" to n.statusHidden, "hasNavColor" to n.hasNavColor,
  "navColor" to n.navColor, "navStyle" to n.navStyle,
  "headerSeen" to n.headerSeen, "headerFlags" to n.headerFlags, "title" to n.title, "subtitle" to n.subtitle,
  "backTitle" to n.backTitle, "hasTint" to n.hasTint, "tint" to n.tint, "hasBackground" to n.hasBackground,
  "background" to n.background, "slotMask" to n.slotMask,
  "slotSeen" to n.slotSeen, "slot" to n.slot, "searchSeen" to n.searchSeen, "placeholder" to n.placeholder,
  "searchValue" to n.searchValue, "searchCount" to n.searchCount,
  "tabsSeen" to n.tabsSeen, "selectedIndex" to n.selectedIndex, "selectCount" to n.selectCount, "hasTabTint" to n.hasTabTint,
  "tabTint" to n.tabTint, "hasInactiveTint" to n.hasInactiveTint, "inactiveTint" to n.inactiveTint,
  "hasTabBackground" to n.hasTabBackground, "tabBackground" to n.tabBackground, "labelsHidden" to n.labelsHidden,
  "tabSeen" to n.tabSeen, "tabKey" to n.tabKey, "tabTitle" to n.tabTitle, "iconUri" to n.iconUri,
  "selectedIconUri" to n.selectedIconUri, "iconIsView" to n.iconIsView, "badgeKind" to n.badgeKind,
  "badgeText" to n.badgeText, "tabDisabled" to n.tabDisabled,
)

private fun unhex(text: String): String {
  if (text == "-") return ""
  val bytes = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
  return String(bytes, Charsets.UTF_8)
}

fun main() {
  val lines = generateSequence(::readLine).toList()
  var at = 0
  while (at + 3 < lines.size) {
    val count = lines[at + 1].removePrefix("count ").trim().toInt()
    val ops = lines[at + 2].removePrefix("ops").trim().split(" ").filter { it.isNotEmpty() }.map { it.toInt() }.toIntArray()
    val strings = lines[at + 3].removePrefix("strings").trim().split(" ").filter { it.isNotEmpty() }.map(::unhex).toTypedArray()
    at += 4
    val props = NavProps()
    var i = 0
    repeat(count) {
      val id = ops[i++]
      i = PropsNav.decode(id, ops, i, strings, props)
    }
    check(i == ops.size) { "decoded $i of ${ops.size} ints" }
    println(json(fields(props)))
  }
}
