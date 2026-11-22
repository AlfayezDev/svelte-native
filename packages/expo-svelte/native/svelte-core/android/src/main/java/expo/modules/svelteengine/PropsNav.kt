package expo.modules.svelteengine

import com.facebook.proguard.annotations.DoNotStrip

/**
 * Decoded navigation records of one node (SPEC.md "Navigation" and "Screen API contract"), reset together with the
 * owning [PropSet]. A record's `*Seen` flag says whether the batch carried it, so a view applies only its own.
 */
class NavProps {
  // Record 110, screen.
  var seen = false
  /** 0 detached/inactive, 1 transitioning, 2 active. */
  var activityState = 2
  /** 0 push, 1 modal, 2 transparentModal, 3 sheet, 4 formSheet. */
  var presentation = 0
  var gestureEnabled = true
  /** 0 default, 1 none, 2 fade, 3 slide_from_right, 4 slide_from_bottom, 5 slide_from_left, 6 fade_from_bottom, 7 android_activity, 8 flip, 9 simple_push. */
  var animation = 0
  var backDismissal = true

  // Record 122, sheet and formSheet: detents are fractions of the available height, -1 for "auto".
  var sheetSeen = false
  var detents = EMPTY_DETENTS
  var initialDetent = 0
  var grabber = true
  var dismissible = true
  var backdropNone = false

  // Record 125, system bars: styles are 0 auto, 1 light icons, 2 dark icons.
  var barsSeen = false
  var statusStyle = 0
  var statusHidden = false
  var hasNavColor = false
  var navColor = 0
  var navStyle = 0

  // Records 120 and 121, header: flags 1 large, 2 translucent, 4 back button, 8 no divider; slot mask 1 left, 2 center, 4 right, 8 search.
  var headerSeen = false
  var headerFlags = 0
  var title: String? = null
  var subtitle: String? = null
  var backTitle: String? = null
  var hasTint = false
  var tint = 0
  var hasBackground = false
  var background = 0
  var slotMask = 0

  // Records 126 and 127, header slots: 0 left, 1 center, 2 right, 3 search, 4 the toolbar's center.
  var slotSeen = false
  var slot = 0
  var searchSeen = false
  var placeholder: String? = null
  var searchValue: String? = null
  var searchCount = 0

  // Record 123, tabs.
  var tabsSeen = false
  var selectedIndex = 0
  var selectCount = 0
  var hasTabTint = false
  var tabTint = 0
  var hasInactiveTint = false
  var inactiveTint = 0
  var hasTabBackground = false
  var tabBackground = 0
  var labelsHidden = false

  // Record 124, tab: badge kind 0 none, 1 dot, 2 text.
  var tabSeen = false
  var tabKey: String? = null
  var tabTitle: String? = null
  var iconUri: String? = null
  var selectedIconUri: String? = null
  var iconIsView = false
  var badgeKind = 0
  var badgeText: String? = null
  var tabDisabled = false

  // Record 128, toolbar: flags 1 hidden, 2 translucent; slot mask 1 center.
  var toolbarSeen = false
  var toolbarFlags = 0
  var hasToolbarTint = false
  var toolbarTint = 0
  var hasToolbarBackground = false
  var toolbarBackground = 0
  var toolbarSlots = 0

  // Record 129, toolbar item: badge kind 0 none, 1 dot, 2 text; a spacer is flexible space and draws nothing.
  var itemSeen = false
  var itemKey: String? = null
  var itemTitle: String? = null
  var itemIconUri: String? = null
  var itemIconIsView = false
  var itemBadgeKind = 0
  var itemBadgeText: String? = null
  var itemDisabled = false
  var itemSpacer = false

  /** A record of this group was decoded since the last reset (PropSet.reset clears the group only then). */
  var touched = false

  fun reset() {
    touched = false
    seen = false; activityState = 2; presentation = 0; gestureEnabled = true; animation = 0; backDismissal = true
    sheetSeen = false; detents = EMPTY_DETENTS; initialDetent = 0; grabber = true; dismissible = true; backdropNone = false
    barsSeen = false; statusStyle = 0; statusHidden = false; hasNavColor = false; navColor = 0; navStyle = 0
    headerSeen = false; headerFlags = 0; title = null; subtitle = null; backTitle = null
    hasTint = false; tint = 0; hasBackground = false; background = 0; slotMask = 0
    slotSeen = false; slot = 0; searchSeen = false; placeholder = null; searchValue = null; searchCount = 0
    tabsSeen = false; selectedIndex = 0; selectCount = 0; hasTabTint = false; tabTint = 0
    hasInactiveTint = false; inactiveTint = 0; hasTabBackground = false; tabBackground = 0; labelsHidden = false
    tabSeen = false; tabKey = null; tabTitle = null; iconUri = null; selectedIconUri = null; iconIsView = false
    badgeKind = 0; badgeText = null; tabDisabled = false
    toolbarSeen = false; toolbarFlags = 0; hasToolbarTint = false; toolbarTint = 0; hasToolbarBackground = false
    toolbarBackground = 0; toolbarSlots = 0
    itemSeen = false; itemKey = null; itemTitle = null; itemIconUri = null; itemIconIsView = false; itemBadgeKind = 0
    itemBadgeText = null; itemDisabled = false; itemSpacer = false
  }

  private companion object {
    val EMPTY_DETENTS = FloatArray(0)
  }
}

object PropsNav {
  private fun f(ops: IntArray, i: Int) = Float.fromBits(ops[i])
  private fun s(ops: IntArray, i: Int, strings: Array<String>): String? = if (ops[i] >= 0) strings[ops[i]] else null

  /** Decodes the record [id] (110..139) whose values start at [at]; returns the index after it. */
  fun decode(id: Int, ops: IntArray, at: Int, strings: Array<String>, n: NavProps): Int {
    var i = at
    n.touched = true
    when (id) {
      110 -> {
        n.seen = true
        n.activityState = ops[i]; n.presentation = ops[i + 1]; n.gestureEnabled = ops[i + 2] == 1
        n.animation = ops[i + 3]; n.backDismissal = ops[i + 4] == 1
        i += 5
      }
      120 -> {
        n.headerSeen = true
        n.headerFlags = ops[i]; n.title = s(ops, i + 1, strings); n.subtitle = s(ops, i + 2, strings); n.backTitle = s(ops, i + 3, strings)
        n.hasTint = ops[i + 4] == 1; n.tint = ops[i + 5]; n.hasBackground = ops[i + 6] == 1; n.background = ops[i + 7]
        i += 8
      }
      121 -> { n.slotMask = ops[i]; i += 1 }
      122 -> {
        n.sheetSeen = true
        val count = ops[i++]
        n.detents = FloatArray(count) { f(ops, i + it) }
        i += count
        n.initialDetent = ops[i]; n.grabber = ops[i + 1] == 1; n.dismissible = ops[i + 2] == 1; n.backdropNone = ops[i + 3] == 1
        i += 4
      }
      123 -> {
        n.tabsSeen = true
        n.selectedIndex = ops[i]; n.selectCount = ops[i + 1]
        n.hasTabTint = ops[i + 2] == 1; n.tabTint = ops[i + 3]
        n.hasInactiveTint = ops[i + 4] == 1; n.inactiveTint = ops[i + 5]
        n.hasTabBackground = ops[i + 6] == 1; n.tabBackground = ops[i + 7]
        n.labelsHidden = ops[i + 8] == 1
        i += 9
      }
      124 -> {
        n.tabSeen = true
        n.tabKey = s(ops, i, strings); n.tabTitle = s(ops, i + 1, strings)
        n.iconUri = s(ops, i + 2, strings); n.selectedIconUri = s(ops, i + 3, strings)
        n.iconIsView = ops[i + 4] == 1; n.badgeKind = ops[i + 5]; n.badgeText = s(ops, i + 6, strings); n.tabDisabled = ops[i + 7] == 1
        i += 8
      }
      125 -> {
        n.barsSeen = true
        n.statusStyle = ops[i]; n.statusHidden = ops[i + 1] == 1
        n.hasNavColor = ops[i + 2] == 1; n.navColor = ops[i + 3]; n.navStyle = ops[i + 4]
        i += 5
      }
      126 -> { n.slotSeen = true; n.slot = ops[i]; i += 1 }
      127 -> {
        n.searchSeen = true
        n.placeholder = s(ops, i, strings); n.searchValue = s(ops, i + 1, strings); n.searchCount = ops[i + 2]
        i += 3
      }
      128 -> {
        n.toolbarSeen = true
        n.toolbarFlags = ops[i]
        n.hasToolbarTint = ops[i + 1] == 1; n.toolbarTint = ops[i + 2]
        n.hasToolbarBackground = ops[i + 3] == 1; n.toolbarBackground = ops[i + 4]
        n.toolbarSlots = ops[i + 5]
        i += 6
      }
      129 -> {
        n.itemSeen = true
        n.itemKey = s(ops, i, strings); n.itemTitle = s(ops, i + 1, strings); n.itemIconUri = s(ops, i + 2, strings)
        n.itemIconIsView = ops[i + 3] == 1; n.itemBadgeKind = ops[i + 4]; n.itemBadgeText = s(ops, i + 5, strings)
        n.itemDisabled = ops[i + 6] == 1; n.itemSpacer = ops[i + 7] == 1
        i += 8
      }
      else -> throw IllegalStateException("SvelteEngine: unknown nav prop id $id at ${at - 1}")
    }
    return i
  }
}

/** Events of the navigation views, forwarded to the Fabric event emitters in C++ (PropsEncoderNav.cpp). */
@DoNotStrip
object NavEvents {
  /** The user dismissed the screen [tag] (back button, predictive back, edge swipe, sheet drag or scrim) and its transition finished: `topDismissed`. */
  @JvmStatic external fun dismissed(tag: Int)

  /** JavaScript set the screen [tag]'s activityState to 0 and the stack finished taking it away (SPEC, "Screen exit"): `topExited`. */
  @JvmStatic external fun exited(tag: Int)

  /** The screen became visible and its transition finished: `topAppear`. */
  @JvmStatic external fun appear(tag: Int)

  /** The screen stopped being visible (covered by an opaque screen, its tab deselected, removed): `topDisappear`. */
  @JvmStatic external fun disappear(tag: Int)

  /** A user drag settled the sheet [tag] on another detent: `topDetentChange { index, fraction }`. */
  @JvmStatic external fun detentChange(tag: Int, index: Int, fraction: Float)

  /** Header, tab bar or toolbar size in dp (inset included in [height]): `topMetrics { height, inset }`. */
  @JvmStatic external fun metrics(tag: Int, height: Float, inset: Float)

  /** The header search of the slot [tag] was dismissed: `topCancel`. */
  @JvmStatic external fun cancel(tag: Int)

  /** A tab bar press on the tabs node [tag]: `topSelect { key, index }`. */
  @JvmStatic external fun select(tag: Int, key: String, index: Int)

  /** A press on item [index] (counting spacers) of the toolbar [tag]: `topPress { key, index }`. */
  @JvmStatic external fun press(tag: Int, key: String, index: Int)

  init {
    System.loadLibrary("svelteengine")
  }
}
