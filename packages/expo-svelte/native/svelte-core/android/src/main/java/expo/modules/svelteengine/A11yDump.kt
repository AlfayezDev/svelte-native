package expo.modules.svelteengine

import android.view.View
import android.view.ViewGroup
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * What a screen reader is handed, read from the views of the engine's tree: the `AccessibilityNodeInfo` of each view that has a `testID`,
 * made the way a service's request makes it (through the view and its delegate), as JSON. The QA accessibility suite (`qa/lib/a11y.ts`)
 * reads it for what `uiautomator dump` leaves out: the tooltip text (the hint), the range, the actions with their ids and labels, the
 * live region and the role description. Called through `SvelteEngine.accessibilityNodes()`, from the accessibility lab (`/__dev/a11y`).
 */
object A11yDump {
  fun nodes(root: View): String {
    val out = JSONArray()
    walk(root, out)
    return out.toString()
  }

  private fun walk(view: View, out: JSONArray) {
    (view.tag as? String)?.let { out.put(describe(view, it)) }
    if (view is ViewGroup) for (i in 0 until view.childCount) walk(view.getChildAt(i), out)
  }

  private fun describe(view: View, id: String): JSONObject {
    val info = AccessibilityNodeInfoCompat.wrap(view.createAccessibilityNodeInfo())
    val node = JSONObject()
    node.put("id", id)
    node.put("class", info.className?.toString() ?: "")
    node.put("text", info.text?.toString() ?: "")
    node.put("desc", info.contentDescription?.toString() ?: "")
    node.put("tooltip", info.tooltipText?.toString() ?: "")
    node.put("stateDescription", info.stateDescription?.toString() ?: "")
    node.put("hintText", info.hintText?.toString() ?: "")
    node.put("roleDescription", info.roleDescription?.toString() ?: "")
    node.put("heading", info.isHeading)
    node.put("checkable", info.isCheckable)
    node.put("checked", info.isChecked)
    node.put("selected", info.isSelected)
    node.put("enabled", info.isEnabled)
    node.put("clickable", info.isClickable)
    node.put("longClickable", info.isLongClickable)
    node.put("focusable", info.isFocusable)
    node.put("liveRegion", info.liveRegion)
    node.put("important", view.importantForAccessibility)
    info.rangeInfo?.let { node.put("range", JSONObject().put("min", it.min.toDouble()).put("max", it.max.toDouble()).put("current", it.current.toDouble())) }
    val actions = JSONArray()
    for (action in info.actionList) actions.put(JSONObject().put("id", action.id).put("label", action.label?.toString() ?: ""))
    node.put("actions", actions)
    return node
  }

  /** Performs the action [name] on the view with `testID`, the way a service does (`performAction` on its node); false when there is no such view or it declines. */
  fun perform(root: View, testID: String, name: String): Boolean {
    val view = find(root, testID) ?: return false
    return view.performAccessibilityAction(A11yRules.actionId(name), null)
  }

  private fun find(view: View, testID: String): View? {
    if (view.tag == testID) return view
    if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i), testID)?.let { return it }
    return null
  }
}
