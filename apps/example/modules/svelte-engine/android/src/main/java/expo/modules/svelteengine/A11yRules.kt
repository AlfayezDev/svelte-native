package expo.modules.svelteengine

/**
 * What React Native's Android accessibility layer decides from the accessibility props, with no Android types so the host check
 * (`src/test/run.sh`, `A11yRulesCheck`) can run it and read React Native's own source for the tables. The Android calls that
 * apply the decisions are in [A11y]. The reference is React Native 0.86.3: `ReactAccessibilityDelegate.kt` (roles, actions, state,
 * range) and `BaseViewManager.java` (content description, live region, important for accessibility).
 */
object A11yRules {
  /** Record 17 mask bits. */
  const val VALUE_MIN = 1
  const val VALUE_MAX = 2
  const val VALUE_NOW = 4
  const val VALUE_TEXT = 8

  /** Record 16 bits. */
  const val DISABLED = 1
  const val SELECTED = 2
  const val BUSY = 4

  /** 0 not set, 1 unchecked, 2 checked, 3 mixed. */
  fun checked(state: Int): Int = (state shr 3) and 3

  /** 0 not set, 1 collapsed, 2 expanded. */
  fun expanded(state: Int): Int = (state shr 5) and 3

  /** Record 25: 0 none, 1 polite, 2 assertive. */
  fun liveRegion(mode: Int): Int = mode and 3

  /** Record 25: 0 auto, 1 yes, 2 no, 3 no-hide-descendants. */
  fun important(mode: Int): Int = (mode shr 2) and 3

  /**
   * The content description React Native builds (`BaseViewManager.updateViewContentDescription`): the label, then "busy" for a busy
   * view, then "mixed" for a checkbox that is neither checked nor unchecked, then the value's text, joined by ", ". The states that
   * have an `AccessibilityNodeInfo` field (selected, disabled, checked, expanded) are not in it. Null when there is nothing to say.
   */
  fun contentDescription(label: String?, hasState: Boolean, state: Int, valueText: String?, busy: String, mixed: String): String? {
    val parts = ArrayList<String>(4)
    if (label != null) parts.add(label)
    if (hasState && state and BUSY != 0) parts.add(busy)
    if (hasState && checked(state) == 3) parts.add(mixed)
    if (valueText != null) parts.add(valueText)
    return if (parts.isEmpty()) null else parts.joinToString(", ")
  }

  /** `ReactAccessibilityDelegate`: a range is exposed when min, now and max are all numbers and `max > min && now >= min && max >= now`. */
  fun hasRange(r: A11yRecords): Boolean {
    val all = VALUE_MIN or VALUE_MAX or VALUE_NOW
    return r.valueMask and all == all && r.max > r.min && r.now >= r.min && r.max >= r.now
  }

  /** The ids of the standard actions (`AccessibilityNodeInfo.ACTION_*`) React Native's `actionIdMap` maps the JavaScript names to. */
  const val ACTION_CLICK = 0x10
  const val ACTION_LONG_CLICK = 0x20
  const val ACTION_SCROLL_FORWARD = 0x1000
  const val ACTION_SCROLL_BACKWARD = 0x2000
  const val ACTION_EXPAND = 0x40000
  const val ACTION_COLLAPSE = 0x80000

  private val standardActions = mapOf(
    "activate" to ACTION_CLICK,
    "longpress" to ACTION_LONG_CLICK,
    "increment" to ACTION_SCROLL_FORWARD,
    "decrement" to ACTION_SCROLL_BACKWARD,
    "expand" to ACTION_EXPAND,
    "collapse" to ACTION_COLLAPSE,
  )
  private var customActionCounter = 0x3f000000
  private val customActions = HashMap<String, Int>()

  /** The id of an action name: the standard action's, else one counted up from 0x3f000000 per name for the life of the process (React Native does the same). Main thread. */
  fun actionId(name: String): Int = standardActions[name] ?: customActions.getOrPut(name) { customActionCounter++ }

  /** Which of [names] an accessibility action [id] is, or null (an action the node does not declare). */
  fun actionName(names: Array<String>, id: Int): String? {
    for (name in names) if (actionId(name) == id) return name
    return null
  }

  /** The ids of every action [names] declares, in order. */
  fun actionIds(names: Array<String>): IntArray = IntArray(names.size) { actionId(names[it]) }

  /** Strings React Native resolves from its resources for a role description (`R.string.*_description`). */
  enum class RoleText { LINK, IMAGE, IMAGEBUTTON, SUMMARY, ALERT, COMBOBOX, MENU, MENUBAR, MENUITEM, PROGRESSBAR, RADIOGROUP, SCROLLBAR, SPINBUTTON, TAB, TABLIST, TIMER, TOOLBAR }

  /**
   * `ReactAccessibilityDelegate.AccessibilityRole`: the class name `setRole` gives the node, whether the node is clickable or checkable
   * because of it, whether it is a heading, and the role description. `name` is the JavaScript value in capitals.
   */
  enum class AccessibilityRole(
    val className: String,
    val clickable: Boolean = false,
    val checkable: Boolean = false,
    val heading: Boolean = false,
    val text: RoleText? = null,
  ) {
    NONE("android.view.View"),
    BUTTON("android.widget.Button", clickable = true),
    DROPDOWNLIST("android.widget.Spinner"),
    TOGGLEBUTTON("android.widget.ToggleButton", clickable = true, checkable = true),
    LINK("android.view.View", text = RoleText.LINK),
    SEARCH("android.widget.EditText"),
    IMAGE("android.widget.ImageView", text = RoleText.IMAGE),
    IMAGEBUTTON("android.widget.ImageButton", clickable = true, text = RoleText.IMAGEBUTTON),
    KEYBOARDKEY("android.inputmethodservice.Keyboard\$Key"),
    TEXT("android.widget.TextView"),
    ADJUSTABLE("android.widget.SeekBar"),
    SUMMARY("android.view.View", text = RoleText.SUMMARY),
    HEADER("android.view.View", heading = true),
    ALERT("android.view.View", text = RoleText.ALERT),
    CHECKBOX("android.widget.CheckBox"),
    COMBOBOX("android.view.View", text = RoleText.COMBOBOX),
    MENU("android.view.View", text = RoleText.MENU),
    MENUBAR("android.view.View", text = RoleText.MENUBAR),
    MENUITEM("android.view.View", text = RoleText.MENUITEM),
    PROGRESSBAR("android.view.View", text = RoleText.PROGRESSBAR),
    RADIO("android.widget.RadioButton"),
    RADIOGROUP("android.view.View", text = RoleText.RADIOGROUP),
    SCROLLBAR("android.view.View", text = RoleText.SCROLLBAR),
    SPINBUTTON("android.widget.SpinButton", text = RoleText.SPINBUTTON),
    SWITCH("android.widget.Switch"),
    TAB("android.view.View", text = RoleText.TAB),
    TABLIST("android.view.View", text = RoleText.TABLIST),
    TIMER("android.view.View", text = RoleText.TIMER),
    LIST("android.widget.AbsListView"),
    GRID("android.widget.GridView"),
    PAGER("androidx.viewpager.widget.ViewPager"),
    SCROLLVIEW("android.widget.ScrollView"),
    HORIZONTALSCROLLVIEW("android.widget.HorizontalScrollView"),
    VIEWGROUP("android.view.ViewGroup"),
    WEBVIEW("android.webkit.WebView"),
    DRAWERLAYOUT("androidx.drawerlayout.widget.DrawerLayout"),
    SLIDINGDRAWER("android.widget.SlidingDrawer"),
    ICONMENU("com.android.internal.view.menu.IconMenuView"),
    TOOLBAR("android.view.View", text = RoleText.TOOLBAR);

    companion object {
      /** `accessibilityRole` as React Native reads it (case-insensitive); null for a value it would reject (React Native throws). */
      fun fromValue(value: String?): AccessibilityRole? {
        if (value == null) return null
        for (role in entries) if (role.name.equals(value, ignoreCase = true)) return role
        return null
      }
    }
  }

  /** `facebook::react::Role` in declaration order (`AccessibilityPrimitives.h`); the ordinal is what record 26 carries. */
  val ARIA_ROLES: Array<String> = arrayOf(
    "alert", "alertdialog", "application", "article", "banner", "button", "cell", "checkbox", "columnheader", "combobox", "complementary",
    "contentinfo", "definition", "dialog", "directory", "document", "feed", "figure", "form", "grid", "group", "heading", "img", "link",
    "list", "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem", "meter", "navigation", "none", "note", "option",
    "presentation", "progressbar", "radio", "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar", "searchbox", "separator",
    "slider", "spinbutton", "status", "summary", "switch", "tab", "table", "tablist", "tabpanel", "term", "timer", "toolbar", "tooltip",
    "tree", "treegrid", "treeitem",
  )

  /** `AccessibilityRole.fromRole`: the accessibility role an ARIA role stands for, null for the ones with no counterpart. */
  fun fromAriaRole(ariaRole: String): AccessibilityRole? = when (ariaRole) {
    "alert" -> AccessibilityRole.ALERT
    "button" -> AccessibilityRole.BUTTON
    "checkbox" -> AccessibilityRole.CHECKBOX
    "combobox" -> AccessibilityRole.COMBOBOX
    "grid" -> AccessibilityRole.GRID
    "heading" -> AccessibilityRole.HEADER
    "img" -> AccessibilityRole.IMAGE
    "link" -> AccessibilityRole.LINK
    "list" -> AccessibilityRole.LIST
    "menu" -> AccessibilityRole.MENU
    "menubar" -> AccessibilityRole.MENUBAR
    "menuitem" -> AccessibilityRole.MENUITEM
    "none" -> AccessibilityRole.NONE
    "progressbar" -> AccessibilityRole.PROGRESSBAR
    "radio" -> AccessibilityRole.RADIO
    "radiogroup" -> AccessibilityRole.RADIOGROUP
    "scrollbar" -> AccessibilityRole.SCROLLBAR
    "searchbox" -> AccessibilityRole.SEARCH
    "slider" -> AccessibilityRole.ADJUSTABLE
    "spinbutton" -> AccessibilityRole.SPINBUTTON
    "summary" -> AccessibilityRole.SUMMARY
    "switch" -> AccessibilityRole.SWITCH
    "tab" -> AccessibilityRole.TAB
    "tablist" -> AccessibilityRole.TABLIST
    "timer" -> AccessibilityRole.TIMER
    "toolbar" -> AccessibilityRole.TOOLBAR
    else -> null
  }

  /**
   * `AccessibilityRole.fromViewTag`: `role` (an ARIA role) takes precedence over `accessibilityRole` whenever it is set, even when it
   * stands for no accessibility role (then the view has none). [ariaOrdinal] is -1 for a view with no `role`.
   */
  fun resolveRole(ariaOrdinal: Int, accessibilityRole: String?): AccessibilityRole? =
    if (ariaOrdinal >= 0) fromAriaRole(ARIA_ROLES[ariaOrdinal]) else AccessibilityRole.fromValue(accessibilityRole)

  /** The adjustable role in the sense of `performAccessibilityAction`, which reads the `accessibilityRole` prop only (not `role="slider"`). */
  fun isAdjustable(accessibilityRole: String?): Boolean = AccessibilityRole.fromValue(accessibilityRole) == AccessibilityRole.ADJUSTABLE
}
