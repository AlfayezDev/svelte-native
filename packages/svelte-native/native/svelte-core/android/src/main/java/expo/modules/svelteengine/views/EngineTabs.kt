package expo.modules.svelteengine.views

import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.RippleDrawable
import android.text.Layout
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import expo.modules.svelteengine.Fragment
import expo.modules.svelteengine.NavEvents
import expo.modules.svelteengine.NavProps
import expo.modules.svelteengine.TextLayouts
import expo.modules.svelteengine.TextSpec
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import expo.modules.svelteappearance.isNight

/**
 * The live icon of a tab (`native-tab-icon`): the app's snippet, laid out inside its pane but never shown there. The bar
 * draws it as a template in the tab's item, so it is fully transparent in the pane and takes no touches.
 */
class EngineTabIcon(context: Context) : EngineView(context) {
  fun apply() {
    // The common props set these on every update.
    node.pointer = 1
    if (alpha != 0f) alpha = 0f
    if (importantForAccessibility != IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS) importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
  }
}

/**
 * One tab: the pane that holds the tab's own stack (a child of [EngineTabs] at its Yoga frame, above the bar) and the
 * data of the tab's bar item. Only the selected pane is visible and touchable; the others stay laid out and mounted.
 */
class EngineTab(context: Context) : EngineView(context) {
  var key: String = ""
  var title: String = ""
  var iconUri: String? = null
  var selectedIconUri: String? = null
  var iconIsView = false
  /** 0 none, 1 dot, 2 text. */
  var badgeKind = 0
  var badgeText: String? = null
  var disabled = false
  /** `accessibilityLabel` and `testID` of the node label the bar item, not the pane. */
  var itemLabel: String? = null
  var itemTestId: String? = null
  /** Yoga's `display: none`; the tab container decides the rest of the visibility. */
  var displayNone = false

  internal var item: TabItemView? = null

  val tabs: EngineTabs? get() = parent as? EngineTabs

  fun isSelectedPane(): Boolean = tabs?.isSelected(this) == true

  fun iconNode(): EngineTabIcon? {
    for (i in 0 until childCount) (getChildAt(i) as? EngineTabIcon)?.let { return it }
    return null
  }

  fun apply(p: NavProps) {
    if (!p.tabSeen) return
    key = p.tabKey ?: ""
    title = p.tabTitle ?: ""
    iconUri = p.iconUri
    selectedIconUri = p.selectedIconUri
    iconIsView = p.iconIsView
    badgeKind = p.badgeKind
    badgeText = p.badgeText
    disabled = p.tabDisabled
    // The common props put the label and test id on this view; they belong to the bar item.
    itemLabel = contentDescription?.toString()
    itemTestId = tag as? String
    contentDescription = null
    tag = null
    node.testID = null
    tabs?.tabChanged(this)
    // The common props also reset the accessibility flag on every update.
    setPaneHidden(!isSelectedPane())
  }

  /** A hidden pane takes no touches (it is invisible) and nothing of it reaches accessibility services. */
  fun setPaneHidden(hidden: Boolean) {
    if (hidden) {
      if (importantForAccessibility != IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS) importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    } else if (importantForAccessibility == IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS) {
      importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_AUTO
    }
  }
}

/**
 * The tab container (SPEC.md "Native screens, Android"): the panes are its children at their Yoga frames, the bar is
 * drawn by the engine below them. The bar is 64 dp plus the bottom inset and holds one item per tab: a 24 dp icon (an
 * asset or the live icon snippet, drawn as a template in the tint), the label, the badge. A press switches at once
 * and sends `topSelect`; `sel` from JavaScript applies when it or the select count changed, so an owner that ignores
 * the press puts the bar back with its next commit.
 */
class EngineTabs(context: Context) : EngineView(context) {
  private val density = resources.displayMetrics.density
  private val barPx = (BAR_DP * density).roundToInt()

  var selectedIndex = 0
    private set
  private var appliedIndex = -1
  private var appliedCount = -1
  private var shownIndex = -1
  private var hasTint = false
  private var tint = 0
  private var hasInactiveTint = false
  private var inactiveTint = 0
  private var hasBackground = false
  private var background = 0
  var labelsHidden = false
    private set
  private var reportedHeight = -1f
  private var reportedInset = -1f
  private val bar = TabBar(context)

  init {
    addView(bar)
  }

  private val dark: Boolean
    get() = isNight(resources)

  internal fun activeColor() = if (hasTint) tint else if (dark) 0xFFE6E1E5.toInt() else 0xFF1C1B1F.toInt()
  internal fun inactiveColor() = if (hasInactiveTint) inactiveTint else if (dark) 0xFFCAC4D0.toInt() else 0xFF49454F.toInt()
  internal fun barColor() = if (hasBackground) background else if (dark) 0xFF211F26.toInt() else 0xFFF3EDF7.toInt()
  internal fun lineColor() = if (dark) 0xFF49454F.toInt() else 0xFFCAC4D0.toInt()

  fun apply(p: NavProps) {
    if (!p.tabsSeen) return
    hasTint = p.hasTabTint; tint = p.tabTint
    hasInactiveTint = p.hasInactiveTint; inactiveTint = p.inactiveTint
    hasBackground = p.hasTabBackground; background = p.tabBackground
    labelsHidden = p.labelsHidden
    // The selection from JavaScript applies when it or the press count changed since the last commit.
    if (p.selectedIndex != appliedIndex || p.selectCount != appliedCount) selectedIndex = p.selectedIndex
    appliedIndex = p.selectedIndex
    appliedCount = p.selectCount
    bar.refreshItems()
    refresh()
  }

  fun tabs(): List<EngineTab> {
    val out = ArrayList<EngineTab>(childCount)
    for (i in 0 until childCount) (getChildAt(i) as? EngineTab)?.let { out.add(it) }
    return out
  }

  fun isSelected(tab: EngineTab): Boolean = tabs().indexOf(tab) == selectedIndex

  fun selectedPane(): EngineTab? = tabs().getOrNull(selectedIndex)

  fun tabChanged(tab: EngineTab) {
    tab.item?.bind()
    bar.invalidate()
  }

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    if (child is EngineTab) { bar.sync(tabs()); refresh() }
  }

  override fun onViewRemoved(child: View) {
    super.onViewRemoved(child)
    if (child is EngineTab) { bar.sync(tabs()); refresh() }
  }

  /** Shows the selected pane and hides the others; the bar follows. */
  fun refresh() {
    val panes = tabs()
    for (i in panes.indices) {
      val pane = panes[i]
      val visibility = if (pane.displayNone) GONE else if (i == selectedIndex) VISIBLE else INVISIBLE
      if (pane.visibility != visibility) pane.visibility = visibility
      pane.setPaneHidden(i != selectedIndex)
    }
    bar.refreshItems()
    if (shownIndex != selectedIndex) {
      shownIndex = selectedIndex
      // The stacks in the panes answer the back key, appear and disappear, and set the bars by what is selected.
      EngineStack.refreshBackCallbacks()
      EngineStack.syncWithin(this, false)
      SystemBars.invalidate(this)
    }
  }

  /** A press on item [index]: switch at once, tell JavaScript. */
  internal fun pressed(index: Int) {
    val panes = tabs()
    val pane = panes.getOrNull(index) ?: return
    if (pane.disabled) return
    selectedIndex = index
    refresh()
    NavEvents.select(node.tag, pane.key, index)
  }

  // Layout -------------------------------------------------------------------------------------------------------------

  /** The bottom inset in px as the window last reported it, read once per layout pass; -1 until it has. */
  private var cachedInset = -1

  private fun bottomInset() = max(0, cachedInset)

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
    Frames.measureChildren(this)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    Frames.layoutChildren(this)
    cachedInset = SafeArea.bottom(this) ?: -1
    val inset = bottomInset()
    val total = barPx + inset
    val w = r - l
    bar.measure(MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(total, MeasureSpec.EXACTLY))
    bar.layout(0, (b - t) - total, w, b - t)
    if (isAttachedToWindow) reportMetrics()
  }

  private fun reportMetrics() {
    val inset = cachedInset
    if (inset < 0) return
    val height = ((barPx + inset) / density * 100f).roundToInt() / 100f
    val dp = (inset / density * 100f).roundToInt() / 100f
    if (height == reportedHeight && dp == reportedInset) return
    reportedHeight = height
    reportedInset = dp
    NavEvents.metrics(node.tag, height, dp)
  }

  // Insets are read from the root when the bar lays out; a dispatch only matters when the bottom inset moved.
  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    if ((SafeArea.bottom(this) ?: -1) != cachedInset) requestLayout()
    return super.onApplyWindowInsets(insets)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    shownIndex = -1
    refresh()
  }

  // The bar ------------------------------------------------------------------------------------------------------------

  /** The bar below the panes: background, a hairline on top, and the items in a row (mirrored for right-to-left). */
  internal inner class TabBar(context: Context) : ViewGroup(context) {
    private val fill = Paint()
    private val items = ArrayList<TabItemView>(5)

    init {
      setWillNotDraw(false)
      ViewCompat.setAccessibilityDelegate(this, object : AccessibilityDelegateCompat() {
        override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
          super.onInitializeAccessibilityNodeInfo(host, info)
          info.className = "android.widget.TabWidget"
          info.setCollectionInfo(AccessibilityNodeInfoCompat.CollectionInfoCompat.obtain(1, items.size, false, AccessibilityNodeInfoCompat.CollectionInfoCompat.SELECTION_MODE_SINGLE))
        }
      })
    }

    /** One item per pane, in pane order. */
    fun sync(panes: List<EngineTab>) {
      val wanted = ArrayList<TabItemView>(panes.size)
      for ((index, pane) in panes.withIndex()) {
        val item = pane.item ?: TabItemView(context, this@EngineTabs, pane).also { pane.item = it }
        item.index = index
        wanted.add(item)
      }
      if (wanted == items) return
      removeAllViews()
      items.clear()
      for (item in wanted) {
        items.add(item)
        addView(item)
      }
      refreshItems()
      requestLayout()
    }

    fun refreshItems() {
      for ((index, item) in items.withIndex()) {
        item.index = index
        item.bind()
      }
      invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
      val w = MeasureSpec.getSize(widthMeasureSpec)
      setMeasuredDimension(w, MeasureSpec.getSize(heightMeasureSpec))
      val each = if (items.isEmpty()) 0 else w / items.size
      for (item in items) item.measure(MeasureSpec.makeMeasureSpec(each, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(barPx, MeasureSpec.EXACTLY))
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
      if (items.isEmpty()) return
      val w = r - l
      val each = w / items.size
      val rtl = isRtlLayout()
      for ((i, item) in items.withIndex()) {
        val x = if (rtl) w - (i + 1) * each else i * each
        item.layout(x, 0, x + each, barPx)
      }
    }

    override fun onDraw(canvas: Canvas) {
      fill.color = barColor()
      canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), fill)
      fill.color = lineColor()
      canvas.drawRect(0f, 0f, width.toFloat(), max(1f, density * 0.5f), fill)
    }
  }
}

/** The bar item of one tab, drawn in one piece: indicator, icon, label, badge. */
internal class TabItemView(context: Context, private val tabs: EngineTabs, private val tab: EngineTab) : View(context) {
  // The label bakes in its direction and the font scale when it is built: a configuration change (locale, font scale)
  // rebuilds it, and the bar lays the items out again for the mirrored order.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    label = null
    requestLayout()
    invalidate()
  }

  var index = 0
  private val density = resources.displayMetrics.density
  private val fontScale: Float get() = min(resources.configuration.fontScale, MAX_FONT_SCALE)
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rect = RectF()
  private val source = Rect()
  private var filterColor = 0
  private var filter: PorterDuffColorFilter? = null
  private var bitmap: Bitmap? = null
  private var loadedUri: String? = null
  private var label: Layout? = null
  private var labelWidth = -1
  private var labelColor = 0
  private var labelText = ""
  private var labelSelected = false
  private var labelRtl = false
  private var labelScale = 0f
  private var rippleColor = 0

  private val selected: Boolean get() = tabs.selectedIndex == index

  init {
    isClickable = true
    isFocusable = true
    setOnClickListener { tabs.pressed(index) }
    ViewCompat.setAccessibilityDelegate(this, object : AccessibilityDelegateCompat() {
      override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
        super.onInitializeAccessibilityNodeInfo(host, info)
        info.className = "android.widget.Button"
        info.roleDescription = "tab"
        info.isSelected = selected
        info.isEnabled = !tab.disabled
        tab.itemTestId?.let { info.viewIdResourceName = it }
        info.setCollectionItemInfo(AccessibilityNodeInfoCompat.CollectionItemInfoCompat.obtain(0, 1, index, 1, false, selected))
      }
    })
  }

  /** Reads the tab's data: the label for accessibility services, the icon to load, the enabled state. */
  fun bind() {
    val badge = when (tab.badgeKind) {
      1 -> ", new items"
      2 -> tab.badgeText?.let { ", $it" } ?: ""
      else -> ""
    }
    contentDescription = tab.itemLabel ?: (tab.title + badge)
    isEnabled = !tab.disabled
    alpha = if (tab.disabled) 0.38f else 1f
    val ripple = (tabs.activeColor() and 0x00FFFFFF) or (0x24 shl 24)
    if (background == null || rippleColor != ripple) {
      rippleColor = ripple
      background = RippleDrawable(ColorStateList.valueOf(ripple), null, ColorDrawable(Color.WHITE))
    }
    loadIcon()
    invalidate()
  }

  private fun wantedUri(): String? = if (selected) tab.selectedIconUri ?: tab.iconUri else tab.iconUri

  private fun loadIcon() {
    val uri = wantedUri()
    if (uri == loadedUri) return
    loadedUri = uri
    bitmap = null
    if (uri == null) return
    val px = (ICON_DP * density).roundToInt()
    ImageLoader.cached(ImageLoader.key(uri, px, px))?.let {
      bitmap = it.bitmap
      return
    }
    ImageLoader.load(context, uri, null, px, px) { image, _ ->
      if (loadedUri == uri) {
        bitmap = image?.bitmap
        invalidate()
      }
    }
  }

  private fun tintFilter(color: Int): PorterDuffColorFilter {
    val current = filter
    if (current != null && filterColor == color) return current
    filterColor = color
    return PorterDuffColorFilter(color, PorterDuff.Mode.SRC_IN).also { filter = it }
  }

  private fun labelLayout(color: Int, width: Int): Layout? {
    val text = tab.title
    if (labelsHiddenOrEmpty(text) || width <= 0) return null
    val rtl = isRtlLayout()
    val scale = fontScale
    if (label != null && labelWidth == width && labelColor == color && labelText == text && labelSelected == selected && labelRtl == rtl && labelScale == scale) return label
    val spec = TextSpec()
    spec.maxLines = 1
    spec.ellipsize = 0
    spec.align = 1
    spec.breakStrategy = 0
    spec.includeFontPadding = false
    spec.rtl = rtl
    spec.fragments = arrayListOf(Fragment(text, LABEL_SP * density * scale, color, if (selected) 600 else 500, false, null, 0f, 0f))
    label = TextLayouts.build(spec, width, 0)?.layout
    labelWidth = width
    labelColor = color
    labelText = text
    labelSelected = selected
    labelRtl = rtl
    labelScale = scale
    return label
  }

  private fun labelsHiddenOrEmpty(text: String) = tabs.labelsHidden || text.isEmpty()

  override fun onDraw(canvas: Canvas) {
    val w = width.toFloat()
    val color = if (selected) tabs.activeColor() else tabs.inactiveColor()
    val cx = w / 2f
    val icon = ICON_DP * density
    val showLabel = !labelsHiddenOrEmpty(tab.title)
    val layout = if (showLabel) labelLayout(color, (w - 8f * density).toInt()) else null
    val content = icon + if (layout != null) (GAP_DP * density + layout.height) else 0f
    // Whole pixels for the icon, pill and badge: a half-pixel origin anti-aliases their edges differently from one
    // layout to the next (the parity suite saw the tab icons 1 px apart between launches).
    val iconTop = ((height - content) / 2f).roundToInt().toFloat()

    if (selected) {
      paint.color = (color and 0x00FFFFFF) or (0x29 shl 24)
      rect.set(cx - PILL_W_DP * density / 2f, iconTop - PILL_PAD_DP * density, cx + PILL_W_DP * density / 2f, iconTop + icon + PILL_PAD_DP * density)
      canvas.drawRoundRect(rect, rect.height() / 2f, rect.height() / 2f, paint)
    }

    val left = (cx - icon / 2f).roundToInt().toFloat()
    val bmp = bitmap
    val live = if (tab.iconIsView) tab.iconNode() else null
    if (live != null) {
      // The snippet's own pixels, used as an alpha mask: drawn into a layer that the tint color replaces.
      iconPaint.colorFilter = tintFilter(color)
      val saved = canvas.saveLayer(left, iconTop, left + icon, iconTop + icon, iconPaint)
      canvas.translate(left, iconTop)
      live.draw(canvas)
      canvas.restoreToCount(saved)
    } else if (bmp != null) {
      iconPaint.colorFilter = tintFilter(color)
      source.set(0, 0, bmp.width, bmp.height)
      rect.set(left, iconTop, left + icon, iconTop + icon)
      canvas.drawBitmap(bmp, source, rect, iconPaint)
    }

    layout?.let {
      canvas.save()
      canvas.translate(4f * density, iconTop + icon + GAP_DP * density)
      it.draw(canvas)
      canvas.restore()
    }
    drawBadge(canvas, cx, iconTop, icon)
  }

  private val badge = BadgeDrawer(density)

  private fun drawBadge(canvas: Canvas, cx: Float, iconTop: Float, icon: Float) {
    badge.draw(canvas, tab.badgeKind, tab.badgeText, isRtlLayout(), cx, iconTop, icon)
  }

  private companion object {
    const val ICON_DP = 24f
    const val GAP_DP = 4f
    const val LABEL_SP = 12f
    const val PILL_W_DP = 56f
    const val PILL_PAD_DP = 4f
    const val MAX_FONT_SCALE = 1.3f
  }
}

/**
 * The badge of a bar item, shared by the tab bar and the toolbar: a dot (8 dp) or a text pill at the top end of the
 * 24 dp icon whose horizontal center is [draw]'s `cx` and top `iconTop`. Origins and sizes are whole pixels. One per
 * item view: it owns the paint and the rectangle, so drawing allocates nothing.
 */
internal class BadgeDrawer(private val density: Float) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val rect = RectF()

  /** [kind] is 0 none, 1 dot, 2 [text]. */
  fun draw(canvas: Canvas, kind: Int, text: String?, rtl: Boolean, cx: Float, iconTop: Float, icon: Float) {
    if (kind == 0) return
    val side = if (rtl) -1f else 1f
    paint.color = BADGE_COLOR
    if (kind == 1) {
      val r = 4f * density
      canvas.drawCircle((cx + side * (icon / 2f)).roundToInt().toFloat(), (iconTop + r / 2f).roundToInt().toFloat(), r, paint)
      return
    }
    val label = text ?: return
    paint.textSize = BADGE_SP * density
    paint.typeface = android.graphics.Typeface.DEFAULT_BOLD
    val textWidth = paint.measureText(label)
    val h = 16f * density
    val w = max(h, textWidth + 8f * density)
    val centerX = (cx + side * (icon / 2f + 2f * density)).roundToInt().toFloat()
    val top = (iconTop - 4f * density).roundToInt().toFloat()
    rect.set((centerX - w / 2f).roundToInt().toFloat(), top, (centerX + w / 2f).roundToInt().toFloat(), top + h)
    canvas.drawRoundRect(rect, h / 2f, h / 2f, paint)
    paint.color = Color.WHITE
    paint.textAlign = Paint.Align.CENTER
    val baseline = rect.centerY() - (paint.descent() + paint.ascent()) / 2f
    canvas.drawText(label, rect.centerX(), baseline, paint)
    paint.textAlign = Paint.Align.LEFT
  }

  private companion object {
    const val BADGE_SP = 10f
    const val BADGE_COLOR = 0xFFB3261E.toInt()
  }
}

private const val BAR_DP = 64f
