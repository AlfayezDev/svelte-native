package expo.modules.svelteengine

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.SystemClock
import android.view.View
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityEventCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat.AccessibilityActionCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat.RangeInfoCompat
import expo.modules.svelteengine.A11yRules.RoleText
import expo.modules.svelteengine.views.EngineNode
import expo.modules.svelteengine.views.EngineText
import expo.modules.svelteengine.views.NodeState
import com.facebook.react.R as ReactR

/**
 * Accessibility exposure of the common props (SPEC.md, "Accessibility props"), the way React Native 0.86's Android views publish
 * them (`BaseViewManager` for what is set on the view, `ReactAccessibilityDelegate` for what a service reads from the node):
 * - `accessibilityLabel` -> contentDescription, joined with "busy", "mixed" and the value's text as `updateViewContentDescription` does;
 * - `accessible` -> focusable + important, `importantForAccessibility` as given, `accessibilityLiveRegion` as given;
 * - `accessibilityRole` / `role` -> the node's class, clickable / checkable / heading and role description (see [A11yRules.AccessibilityRole]);
 * - `accessibilityState` -> `View.setSelected` / `setEnabled`, and on the node selected, enabled, checkable and checked, and the expand
 *   or collapse action; `accessibilityValue` -> the node's range and the item count of its events; `accessibilityHint` -> the node's
 *   tooltip text (React Native uses no hint text); `accessibilityActions` -> the node's actions, whose activation is the
 *   `onAccessibilityAction` event;
 * - `testID` -> view.tag plus AccessibilityNodeInfo.viewIdResourceName (uiautomator `resource-id`, same as React Native's delegate).
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

  /**
   * The resource id of a control of the bottom toolbar band: `svelte-toolbar:<key>` on an item, `svelte-toolbar:center` on the
   * center slot and what it holds. The uiautomator tree shows no view class of the band (items are `android.widget.Button`, the
   * container is not important for accessibility), so this is how the QA accessibility suite (`qa/lib/a11y.ts`) knows what is
   * read after the content. A `testID` of the node is appended (`svelte-toolbar:<key>:<testID>`), never replaces it.
   */
  const val TOOLBAR_ID = "svelte-toolbar"

  /** Nothing set; what a view without any of the records is compared with. */
  private val NONE = A11yRecords()

  fun apply(view: View, st: NodeState, p: PropSet) {
    if (view.tag != p.testID) view.tag = p.testID
    val a = if (p.a11y.touched) p.a11y else NONE
    val before = st.a11y ?: NONE
    // The description is built again only when its inputs changed (the label, the busy and mixed state, the value's text); the view is still compared with it, since
    // the tab bar takes the description off the view it reads it from.
    val rebuild = A11yRules.descriptionChanged(st.label, p.label, before, a) || (TEST_ID_AS_CONTENT_DESCRIPTION && p.testID != st.testID)
    st.label = p.label
    if (rebuild) st.description = describe(view.context, p.label, a) ?: if (TEST_ID_AS_CONTENT_DESCRIPTION) p.testID else null
    val desc = st.description
    if (view.contentDescription != desc) view.contentDescription = desc

    val accessible = p.accessible == 1
    // `accessible` only adds focusability; inputs, switches and buttons keep their own (never force it off).
    if (accessible && !view.isFocusable) view.isFocusable = true
    val important = A11yRules.important(a.mode)
    if (important != 0) {
      val want = when (important) {
        1 -> View.IMPORTANT_FOR_ACCESSIBILITY_YES
        2 -> View.IMPORTANT_FOR_ACCESSIBILITY_NO
        else -> View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
      }
      if (view.importantForAccessibility != want) view.importantForAccessibility = want
    } else if (view !is EngineText) {
      val want = if (accessible) View.IMPORTANT_FOR_ACCESSIBILITY_YES else View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
      if (view.importantForAccessibility != want) view.importantForAccessibility = want
    } else if (A11yRules.important(before.mode) != 0) {
      view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES // a text is always read: the default `EngineText` sets
    }
    val live = A11yRules.liveRegion(a.mode)
    if (live != A11yRules.liveRegion(before.mode)) {
      ViewCompat.setAccessibilityLiveRegion(
        view,
        when (live) {
          1 -> ViewCompat.ACCESSIBILITY_LIVE_REGION_POLITE
          2 -> ViewCompat.ACCESSIBILITY_LIVE_REGION_ASSERTIVE
          else -> ViewCompat.ACCESSIBILITY_LIVE_REGION_NONE
        },
      )
    }

    applyState(view, st, a, before)

    // The node publishes what it holds at the time a service asks (the delegate reads `st.a11y`); a change is only visible to a service
    // that already has the node when it is told.
    if (a.isEmpty) {
      st.a11y = null
    } else {
      val held = st.a11y ?: A11yRecords().also { st.a11y = it }
      if (!held.sameAs(a)) {
        held.copyFrom(a)
        st.expandedLocal = 0
      }
    }

    st.testID = p.testID
    st.role = p.role
    val need = p.testID != null || p.role != null || !a.isEmpty
    if (need && !st.a11yDelegate) {
      st.a11yDelegate = true
      ViewCompat.setAccessibilityDelegate(view, EngineDelegate(st))
    } else if (!need && st.a11yDelegate) {
      st.a11yDelegate = false
      ViewCompat.setAccessibilityDelegate(view, null)
    }
  }

  /** `BaseViewManager.updateViewContentDescription`: the label, "busy", "mixed" and the value's text. */
  private fun describe(context: Context, label: String?, a: A11yRecords): String? {
    if (!a.hasState && a.valueText == null) return label
    val busy = if (a.hasState && a.state and A11yRules.BUSY != 0) context.getString(ReactR.string.state_busy_description) else ""
    val mixed = if (a.hasState && A11yRules.checked(a.state) == 3) context.getString(ReactR.string.state_mixed_description) else ""
    return A11yRules.contentDescription(label, a.hasState, a.state, a.valueText, busy, mixed)
  }

  /**
   * `BaseViewManager.setViewState`: selected and disabled go to the view (a disabled view is a disabled node), a service that has focus
   * on the node is told (TalkBack only hears of a change of checked or selected as a click; a node that stops being selected is announced).
   * The view is touched only when the state changes it, so the kinds that decide `enabled` themselves (input, switch) keep it.
   */
  private fun applyState(view: View, st: NodeState, a: A11yRecords, before: A11yRecords) {
    val selected = a.hasState && a.state and A11yRules.SELECTED != 0
    val disabled = a.hasState && a.state and A11yRules.DISABLED != 0
    val wasSelected = before.hasState && before.state and A11yRules.SELECTED != 0
    val wasDisabled = before.hasState && before.state and A11yRules.DISABLED != 0
    if (selected != wasSelected) view.isSelected = selected
    if (disabled != wasDisabled) view.isEnabled = !disabled
    if (!a.hasState || !before.hasState || a.state == before.state) return
    if (!view.isAccessibilityFocused) return
    if (wasSelected && !selected) view.announceForAccessibility(view.context.getString(ReactR.string.state_unselected_description))
    val checkedChanged = A11yRules.checked(a.state) != A11yRules.checked(before.state) && A11yRules.checked(a.state) in 1..2
    if (checkedChanged || selected != wasSelected) view.sendAccessibilityEvent(AccessibilityEvent.TYPE_VIEW_CLICKED)
  }

  private fun roleText(context: Context, text: RoleText): String = context.getString(
    when (text) {
      RoleText.LINK -> ReactR.string.link_description
      RoleText.IMAGE -> ReactR.string.image_description
      RoleText.IMAGEBUTTON -> ReactR.string.imagebutton_description
      RoleText.SUMMARY -> ReactR.string.summary_description
      RoleText.ALERT -> ReactR.string.alert_description
      RoleText.COMBOBOX -> ReactR.string.combobox_description
      RoleText.MENU -> ReactR.string.menu_description
      RoleText.MENUBAR -> ReactR.string.menubar_description
      RoleText.MENUITEM -> ReactR.string.menuitem_description
      RoleText.PROGRESSBAR -> ReactR.string.progressbar_description
      RoleText.RADIOGROUP -> ReactR.string.radiogroup_description
      RoleText.SCROLLBAR -> ReactR.string.scrollbar_description
      RoleText.SPINBUTTON -> ReactR.string.spinbutton_description
      RoleText.TAB -> ReactR.string.rn_tab_description
      RoleText.TABLIST -> ReactR.string.tablist_description
      RoleText.TIMER -> ReactR.string.timer_description
      RoleText.TOOLBAR -> ReactR.string.toolbar_description
    },
  )

  /** `ReactAccessibilityDelegate.setRole`. */
  private fun setRole(info: AccessibilityNodeInfoCompat, role: A11yRules.AccessibilityRole, context: Context) {
    info.className = role.className
    role.text?.let { info.roleDescription = roleText(context, it) }
    if (role.clickable) info.isClickable = true
    if (role.checkable) info.isCheckable = true
    if (role.heading) info.isHeading = true
  }

  private fun accessibilityManager(context: Context): AccessibilityManager? =
    context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager

  private const val FRAME_MS = 16L
  private val listeningInFrame = FrameFlag()

  /**
   * Whether a service is listening, so a text that changes is worth asking the live regions above it about. Asked of the platform once per frame: the frame
   * is a 16 ms window of the uptime clock (`Choreographer`'s frame time is not public API), long enough for every rebuild of one layout pass to share the answer.
   */
  fun listening(context: Context): Boolean {
    val frame = SystemClock.uptimeMillis() / FRAME_MS
    return listeningInFrame.cached(frame) ?: listeningInFrame.store(frame, accessibilityManager(context)?.isEnabled == true)
  }

  /**
   * The text of [view] changed. A `TextView` tells the platform, which sends the change up to the nearest live region; an `EngineText` is
   * a plain view, so this does it: the live region at or above it sends a content change (its subtree, or its own text) as its source.
   */
  fun textChanged(view: View) {
    if (!view.isAttachedToWindow) return
    var current: View? = view
    while (current != null) {
      if (ViewCompat.getAccessibilityLiveRegion(current) != ViewCompat.ACCESSIBILITY_LIVE_REGION_NONE) {
        val event = AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)
        AccessibilityEventCompat.setContentChangeTypes(
          event,
          if (current === view) AccessibilityEvent.CONTENT_CHANGE_TYPE_TEXT else AccessibilityEvent.CONTENT_CHANGE_TYPE_SUBTREE,
        )
        current.sendAccessibilityEventUnchecked(event)
        return
      }
      current = current.parent as? View
    }
  }

  private const val SEND_EVENT = 1
  private const val TIMEOUT_SEND_ACCESSIBILITY_EVENT = 200L

  /** Delayed `TYPE_VIEW_SELECTED` for a slider (see [EngineDelegate.performAccessibilityAction]); at most one per time frame per view. */
  private val events = object : Handler(Looper.getMainLooper()) {
    override fun handleMessage(msg: Message) {
      (msg.obj as? View)?.sendAccessibilityEvent(AccessibilityEvent.TYPE_VIEW_SELECTED)
    }
  }

  private fun scheduleSelectedEvent(host: View) {
    if (events.hasMessages(SEND_EVENT, host)) events.removeMessages(SEND_EVENT, host)
    events.sendMessageDelayed(events.obtainMessage(SEND_EVENT, host), TIMEOUT_SEND_ACCESSIBILITY_EVENT)
  }

  /** `ReactAccessibilityDelegate`, reading what [apply] stored on the [NodeState]. */
  private class EngineDelegate(private val st: NodeState) : AccessibilityDelegateCompat() {
    override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
      super.onInitializeAccessibilityNodeInfo(host, info)
      st.testID?.let { id ->
        val band = info.viewIdResourceName
        info.viewIdResourceName = if (band != null && band.startsWith(TOOLBAR_ID)) "$band:$id" else id
      }
      val a = st.a11y
      if (a != null && a.hasState) {
        val expanded = if (st.expandedLocal != 0) st.expandedLocal else A11yRules.expanded(a.state)
        if (expanded != 0) info.addAction(if (expanded == 2) AccessibilityNodeInfoCompat.ACTION_COLLAPSE else AccessibilityNodeInfoCompat.ACTION_EXPAND)
      }
      A11yRules.resolveRole(a?.role ?: -1, st.role)?.let { setRole(info, it, host.context) }
      if (a == null) return
      a.hint?.let { info.tooltipText = it }
      if (a.hasState) {
        val state = a.state
        info.isSelected = state and A11yRules.SELECTED != 0
        // The view's own enabled flag is already in the node; a state that does not disable it must not enable what input and switch disabled.
        if (state and A11yRules.DISABLED != 0) info.isEnabled = false
        val checked = A11yRules.checked(state)
        if (checked == 1 || checked == 2) {
          info.isCheckable = true
          info.isChecked = checked == 2
        }
      }
      for (k in a.actionNames.indices) {
        info.addAction(AccessibilityActionCompat(A11yRules.actionId(a.actionNames[k]), a.actionLabels[k] ?: ""))
      }
      if (A11yRules.hasRange(a)) {
        info.rangeInfo = RangeInfoCompat.obtain(RangeInfoCompat.RANGE_TYPE_INT, a.min.toFloat(), a.max.toFloat(), a.now.toFloat())
      }
    }

    /** Item count and current item of a range, so that TalkBack announces the value of a slider. */
    override fun onInitializeAccessibilityEvent(host: View, event: AccessibilityEvent) {
      super.onInitializeAccessibilityEvent(host, event)
      val a = st.a11y ?: return
      if (A11yRules.hasRange(a)) {
        event.itemCount = a.max - a.min
        event.currentItemIndex = a.now
      }
    }

    override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean {
      if (action == AccessibilityNodeInfoCompat.ACTION_COLLAPSE) st.expandedLocal = 1
      if (action == AccessibilityNodeInfoCompat.ACTION_EXPAND) st.expandedLocal = 2
      val a = st.a11y
      val name = if (a == null) null else A11yRules.actionName(a.actionNames, action)
      if (a == null || name == null) return super.performAccessibilityAction(host, action, args)
      ViewEvents.accessibilityAction(st.tag, name)
      // TalkBack announces a slider's new value from a selected event after the scroll action; one of the engine's own to send.
      if (A11yRules.isAdjustable(st.role) &&
        (action == AccessibilityActionCompat.ACTION_SCROLL_FORWARD.id || action == AccessibilityActionCompat.ACTION_SCROLL_BACKWARD.id)
      ) {
        if (a.valueMask != 0 && a.valueMask and A11yRules.VALUE_TEXT == 0) scheduleSelectedEvent(host)
        return super.performAccessibilityAction(host, action, args)
      }
      return true
    }
  }
}
