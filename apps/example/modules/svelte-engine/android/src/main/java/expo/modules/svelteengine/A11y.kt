package expo.modules.svelteengine

import android.view.View
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import expo.modules.svelteengine.views.EngineNode
import expo.modules.svelteengine.views.EngineText
import expo.modules.svelteengine.views.NodeState

/**
 * Accessibility exposure of the common props (SPEC-input.md):
 * accessibilityLabel -> contentDescription, accessible -> focusable + important, accessibilityRole -> node class /
 * heading / role description, testID -> view.tag plus AccessibilityNodeInfo.viewIdResourceName (uiautomator
 * `resource-id`, same as React Native's ReactAccessibilityDelegate).
 */
object A11y {
  /** Where an accessibility click goes (the node's tag): set by MountingManager.attach, null before the engine is installed. */
  @Volatile var clicks: ((Int) -> Unit)? = null

  private val onClick = View.OnClickListener { view ->
    val tag = (view as? EngineNode)?.node?.tag ?: return@OnClickListener
    clicks?.invoke(tag)
  }

  /**
   * A node that listens for `click` (every Pressable) is clickable, so that accessibility services get ACTION_CLICK and
   * their activation (`performClick`) reaches JavaScript as the `click` event. Engine views never receive touch events
   * themselves (EngineRoot claims and forwards every gesture), so the click listener changes nothing for touches.
   */
  fun setClickable(view: View, clickable: Boolean) {
    if (view.isClickable == clickable && (clickable == view.hasOnClickListeners())) return
    view.setOnClickListener(if (clickable) onClick else null)
    view.isClickable = clickable
  }
  /**
   * testID is not copied into contentDescription: TalkBack would read it aloud and it would shadow the text of
   * EngineText. Flip this to also fall back to `testID` as content-desc when there is no label (uiautomator
   * `content-desc` selectors).
   */
  const val TEST_ID_AS_CONTENT_DESCRIPTION = false

  fun apply(view: View, st: NodeState, p: PropSet) {
    if (view.tag != p.testID) view.tag = p.testID
    val desc = p.label ?: if (TEST_ID_AS_CONTENT_DESCRIPTION) p.testID else null
    if (view.contentDescription != desc) view.contentDescription = desc

    val accessible = p.accessible == 1
    // `accessible` only adds focusability; inputs, switches and buttons keep their own (never force it off).
    if (accessible && !view.isFocusable) view.isFocusable = true
    if (view !is EngineText) {
      val want = if (accessible) View.IMPORTANT_FOR_ACCESSIBILITY_YES else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
      if (view.importantForAccessibility != want) view.importantForAccessibility = want
    }

    if (st.testID != p.testID || st.role != p.role) {
      st.testID = p.testID
      st.role = p.role
      val need = p.testID != null || p.role != null
      if (need && !st.a11yDelegate) {
        st.a11yDelegate = true
        ViewCompat.setAccessibilityDelegate(view, EngineDelegate(st))
      } else if (!need && st.a11yDelegate) {
        st.a11yDelegate = false
        ViewCompat.setAccessibilityDelegate(view, null)
      }
    }
  }

  private class EngineDelegate(private val st: NodeState) : AccessibilityDelegateCompat() {
    override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
      super.onInitializeAccessibilityNodeInfo(host, info)
      st.testID?.let { info.viewIdResourceName = it }
      when (st.role) {
        "button" -> info.className = "android.widget.Button"
        "imagebutton" -> info.className = "android.widget.ImageButton"
        "image" -> info.className = "android.widget.ImageView"
        "checkbox" -> info.className = "android.widget.CheckBox"
        "radio" -> info.className = "android.widget.RadioButton"
        "switch" -> info.className = "android.widget.Switch"
        "header" -> info.isHeading = true
        "link" -> info.roleDescription = "link"
        "search" -> info.roleDescription = "search"
        "tab" -> info.roleDescription = "tab"
        "alert" -> info.roleDescription = "alert"
      }
    }
  }
}
