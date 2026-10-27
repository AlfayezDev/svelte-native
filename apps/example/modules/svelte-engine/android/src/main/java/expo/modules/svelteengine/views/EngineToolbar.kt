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
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.Layout
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import expo.modules.svelteengine.Fragment
import expo.modules.svelteengine.NavEvents
import expo.modules.svelteengine.NavProps
import expo.modules.svelteengine.TextLayouts
import expo.modules.svelteengine.TextSpec
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** The row's geometry, `TOOLBAR_METRICS.android` of `fabric/navigation.ts`: Yoga lays the band out with the same numbers (SPEC.md, "Toolbar"). */
private const val ITEM_DP = 48f
private const val EDGE_DP = 4f

/**
 * One action of a toolbar (`native-toolbar-item`, SPEC.md "Toolbar"): a 48 dp high target that draws its own icon, label
 * and badge, so it is also its control: it takes the press, the ripple, the accessibility role and the disabled state.
 * The icon is an asset drawn as a template in the toolbar's tint, or the app's snippet (a child of this view, laid out by
 * Yoga and drawn as it is, centered where the 24 dp icon would be). A spacer is flexible space and draws nothing. The
 * toolbar decides the item's place; its width is [ITEM_DP], the number JavaScript gives the item node's Yoga style
 * (`TOOLBAR_METRICS.android.item`), and Yoga's frame of the item itself is not used.
 */
class EngineToolbarItem(context: Context) : EngineView(context) {
  var key = ""
  var title = ""
  var iconUri: String? = null
  var iconIsView = false
  /** 0 none, 1 dot, 2 text. */
  var badgeKind = 0
  var badgeText: String? = null
  var disabled = false
  var spacer = false
  /** The `accessibilityLabel` of the node, which belongs to this control; the title (and badge) read when it is absent. */
  private var itemLabel: String? = null

  internal var wantL = 0
  internal var wantT = 0
  internal var wantR = 0
  internal var wantB = 0
  /** The toolbar has chosen a rectangle for this item; [wantL]..[wantB] are valid. */
  internal var placed = false

  val toolbar: EngineToolbar? get() = parent as? EngineToolbar

  private val density = resources.displayMetrics.density
  private val fontScale: Float get() = min(resources.configuration.fontScale, MAX_FONT_SCALE)
  private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val dest = RectF()
  private val source = Rect()
  private val badge = BadgeDrawer(density)
  private var filterColor = 0
  private var filter: PorterDuffColorFilter? = null
  private var bitmap: Bitmap? = null
  private var loadedUri: String? = null
  private var label: Layout? = null
  private var labelColor = 0
  private var labelText = ""
  private var labelRtl = false
  private var labelScale = 0f
  private var rippleColor = 0

  private val press = OnClickListener { toolbar?.pressed(this) }

  // The label bakes in its direction and the font scale when it is built: a configuration change rebuilds it.
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    label = null
    requestLayout()
    invalidate()
  }

  private fun dp(value: Float) = (value * density).roundToInt()

  fun apply(p: NavProps) {
    if (!p.itemSeen) return
    key = p.itemKey ?: ""
    title = p.itemTitle ?: ""
    iconUri = p.itemIconUri
    iconIsView = p.itemIconIsView
    badgeKind = p.itemBadgeKind
    badgeText = p.itemBadgeText
    disabled = p.itemDisabled
    spacer = p.itemSpacer
    // The common props have just put the node's accessibilityLabel on this view (or null): it is the control's label.
    itemLabel = contentDescription?.toString()
    bind()
    toolbar?.itemChanged(this)
  }

  /** Reads the item's data and the toolbar's tint into the view's state: label, enabled, clickable, ripple, icon. */
  internal fun bind() {
    if (spacer) {
      foreground = null
      setOnClickListener(null)
      isClickable = false
      isFocusable = false
      contentDescription = null
      if (importantForAccessibility != IMPORTANT_FOR_ACCESSIBILITY_NO) importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
      invalidate()
      return
    }
    val suffix = when (badgeKind) {
      1 -> ", new items"
      2 -> badgeText?.let { ", $it" } ?: ""
      else -> ""
    }
    val described = itemLabel ?: (title + suffix).ifEmpty { key }
    if (contentDescription?.toString() != described) contentDescription = described
    // A disabled item is announced as disabled and does nothing: still focusable for accessibility services.
    setOnClickListener(press)
    isClickable = !disabled
    isFocusable = true
    isEnabled = !disabled
    if (disabled) {
      foreground = null
      rippleColor = 0
      if (isPressed) isPressed = false
    } else {
      val ripple = (itemColor() and 0x00FFFFFF) or (RIPPLE_ALPHA shl 24)
      if (foreground == null || rippleColor != ripple) {
        rippleColor = ripple
        val mask = GradientDrawable().apply {
          setColor(Color.WHITE)
          cornerRadius = dp(ITEM_DP / 2f).toFloat()
        }
        foreground = RippleDrawable(ColorStateList.valueOf(ripple), null, mask)
      }
    }
    loadIcon()
    invalidate()
  }

  private fun itemColor(): Int = toolbar?.itemColor() ?: if (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES) 0xFFCAC4D0.toInt() else 0xFF49454F.toInt()

  override fun getAccessibilityClassName(): CharSequence = "android.widget.Button"

  // Icon ---------------------------------------------------------------------------------------------------------------

  private fun loadIcon() {
    val uri = if (iconIsView) null else iconUri
    if (uri == loadedUri) return
    loadedUri = uri
    bitmap = null
    if (uri == null) return
    val px = dp(ICON_DP)
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

  // Label --------------------------------------------------------------------------------------------------------------

  /** The label as one centered line, ellipsized within the item (less 4 dp each side, as the tab bar's labels); null without a title. */
  private fun labelLayout(color: Int): Layout? {
    val text = title
    if (text.isEmpty()) return null
    val rtl = isRtlLayout()
    val scale = fontScale
    if (label != null && labelColor == color && labelText == text && labelRtl == rtl && labelScale == scale) return label
    val spec = TextSpec()
    spec.maxLines = 1
    spec.ellipsize = 0
    spec.align = 1
    spec.breakStrategy = 0
    spec.includeFontPadding = false
    spec.rtl = rtl
    spec.fragments = arrayListOf(Fragment(text, LABEL_SP * density * scale, color, 500, false, null, 0f, 0f))
    label = TextLayouts.build(spec, dp(ITEM_DP) - dp(LABEL_PAD_DP), 0)?.layout
    labelColor = color
    labelText = text
    labelRtl = rtl
    labelScale = scale
    return label
  }

  /** The icon (24 dp) and the label under it are centered as one block; the block's top, whole pixels. */
  private fun iconTop(layout: Layout?): Int {
    val content = dp(ICON_DP) + if (layout != null) dp(GAP_DP) + layout.height else 0
    return ((height - content) / 2f).roundToInt()
  }

  // Layout and drawing -------------------------------------------------------------------------------------------------

  // The toolbar gives the item its size: the view is measured at what it was asked for, not at Yoga's frame.
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.getSize(heightMeasureSpec))
    Frames.measureChildren(this)
  }

  internal fun setWant(l: Int, t: Int, r: Int, b: Int) {
    wantL = l; wantT = t; wantR = r; wantB = b
    placed = true
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    placeSnippet()
    // The mounting layer put the item at Yoga's frame: the toolbar puts it back in its row.
    toolbar?.itemPlaced(this)
  }

  /** The snippet icon is Yoga-sized and sits where the 24 dp icon would, centered in the item. */
  internal fun placeSnippet() {
    if (childCount == 0 || width == 0) return
    val icon = dp(ICON_DP)
    val top = iconTop(if (title.isEmpty()) null else labelLayout(itemColor()))
    for (i in 0 until childCount) {
      val c = getChildAt(i)
      val st = (c as? EngineNode)?.node ?: continue
      if (!st.hasFrame) continue
      val x = ((width - st.w) / 2f).roundToInt()
      val y = (top + (icon - st.h) / 2f).roundToInt()
      if (c.left == x && c.top == y && c.width == st.w && c.height == st.h && !c.isLayoutRequested) continue
      c.measure(MeasureSpec.makeMeasureSpec(st.w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(st.h, MeasureSpec.EXACTLY))
      c.layout(x, y, x + st.w, y + st.h)
    }
  }

  override fun dispatchDraw(canvas: Canvas) {
    if (spacer) {
      super.dispatchDraw(canvas)
      return
    }
    // Disabled: everything of the item at 38 %, in one layer (the view's own alpha belongs to the common props).
    val saved = if (disabled) canvas.saveLayerAlpha(0f, 0f, width.toFloat(), height.toFloat(), DISABLED_ALPHA) else -1
    val color = itemColor()
    val layout = if (title.isEmpty()) null else labelLayout(color)
    val icon = dp(ICON_DP)
    // Whole pixels for the icon, the label and the badge: a half-pixel origin anti-aliases differently from one layout to the next.
    val top = iconTop(layout)
    val left = ((width - icon) / 2f).roundToInt().toFloat()
    val bmp = bitmap
    if (!iconIsView && bmp != null) {
      iconPaint.colorFilter = tintFilter(color)
      source.set(0, 0, bmp.width, bmp.height)
      dest.set(left, top.toFloat(), left + icon, (top + icon).toFloat())
      canvas.drawBitmap(bmp, source, dest, iconPaint)
    }
    layout?.let {
      canvas.save()
      canvas.translate(((width - it.width) / 2f).roundToInt().toFloat(), (top + icon + dp(GAP_DP)).toFloat())
      it.draw(canvas)
      canvas.restore()
    }
    super.dispatchDraw(canvas)
    badge.draw(canvas, badgeKind, badgeText, isRtlLayout(), width / 2f, top.toFloat(), icon.toFloat())
    if (saved >= 0) canvas.restoreToCount(saved)
  }

  // Touch --------------------------------------------------------------------------------------------------------------

  private val pressable: Boolean get() = !spacer && !disabled

  // JavaScript's own touch dispatch ends at the item node (`pointerEvents: box-only` from `toolbarProps`), so a Pressable inside
  // a snippet never fires: the item is the only press. It takes the platform's gesture so a press on any part of it is a press of the item.
  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean = pressable && ev.actionMasked == MotionEvent.ACTION_DOWN

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!pressable) return super.onTouchEvent(event)
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        drawableHotspotChanged(event.x, event.y)
        isPressed = true
      }
      MotionEvent.ACTION_MOVE -> {
        val inside = event.x >= 0f && event.y >= 0f && event.x < width && event.y < height
        if (inside) drawableHotspotChanged(event.x, event.y)
        if (isPressed != inside) isPressed = inside
      }
      MotionEvent.ACTION_UP -> {
        val fire = isPressed
        isPressed = false
        if (fire) performClick()
      }
      MotionEvent.ACTION_CANCEL -> isPressed = false
    }
    return true
  }

  private companion object {
    const val ICON_DP = 24f
    const val LABEL_PAD_DP = 8f
    const val GAP_DP = 2f
    const val LABEL_SP = 12f
    const val MAX_FONT_SCALE = 1.3f
    const val RIPPLE_ALPHA = 0x24
    const val DISABLED_ALPHA = 97
  }
}

/**
 * The toolbar band of a screen (SPEC.md "Toolbar", "Native screens, Android"): a child of [EngineScreen], the last one,
 * that draws the bar in its Yoga frame, which is the 56 dp bar plus the bottom inset (Yoga's `paddingBottom`). The bar
 * row sits at the bottom of the band above the inset; the items and the center slot are laid out in it here, with the
 * numbers Yoga used (4 dp edges, items exactly 48 dp wide, [ITEM_DP] and [EDGE_DP]): items are packed from the start
 * edge, a spacer takes an equal share of the free width, and a center slot (`native-toolbar-center`, an
 * [EngineHeaderSlot] of slot 4) takes the place of the first spacer (after the last item without one) and all the free
 * width, which is the width Yoga gave it. Because the band is a child of the screen it moves
 * with it in push, pop, predictive back and edge swipe.
 *
 * Translucent: the background is transparent unless one is given (JavaScript puts the band out of flow, over the
 * content). Hidden: the band is `GONE` and reports nothing. The metrics carry the real inset, which inside a tab pane is
 * zero (the pane ends at the tab bar), so JavaScript's estimate is corrected after the first layout there.
 */
class EngineToolbar(context: Context) : EngineView(context) {
  private val density = resources.displayMetrics.density
  private val barPx = (BAR_DP * density).roundToInt()

  private var hidden = false
  private var translucent = false
  private var hasTint = false
  private var tint = 0
  private var hasBackground = false
  private var background = 0
  /** Yoga's `display: none`; hiding by the `hd` flag adds to it. */
  var displayNone = false

  private var cachedInset = -1
  private var reportedHeight = -1f
  private var reportedInset = -1f
  private var widths = IntArray(8)
  private val centerRect = IntArray(4)
  private var centerPlaced = false
  private val fill = Paint()

  init {
    setWillNotDraw(false)
  }

  private val dark: Boolean
    get() = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES

  /** Icons and labels: the tint, or the theme's on-surface-variant like an inactive tab. */
  internal fun itemColor() = if (hasTint) tint else if (dark) 0xFFCAC4D0.toInt() else 0xFF49454F.toInt()
  private fun barColor() = if (dark) 0xFF211F26.toInt() else 0xFFF3EDF7.toInt()
  private fun lineColor() = if (dark) 0xFF49454F.toInt() else 0xFFCAC4D0.toInt()
  private fun backgroundColor() = if (hasBackground) background else if (translucent) Color.TRANSPARENT else barColor()

  private fun dp(value: Float) = (value * density).roundToInt()

  // Props ------------------------------------------------------------------------------------------------------------

  fun apply(p: NavProps) {
    if (!p.toolbarSeen) return
    hidden = p.toolbarFlags and 1 != 0
    translucent = p.toolbarFlags and 2 != 0
    hasTint = p.hasToolbarTint
    tint = p.toolbarTint
    hasBackground = p.hasToolbarBackground
    background = p.toolbarBackground
    updateVisibility()
    for (i in 0 until childCount) (getChildAt(i) as? EngineToolbarItem)?.bind()
    requestLayout()
    invalidate()
  }

  /** Yoga's `display: none` or the `hd` flag hides the band: not drawn, no touches, nothing for accessibility services. */
  fun updateVisibility() {
    val wanted = if (displayNone || hidden) GONE else VISIBLE
    if (visibility != wanted) visibility = wanted
  }

  /** An item got its props: its width or place may have changed. */
  internal fun itemChanged(@Suppress("UNUSED_PARAMETER") item: EngineToolbarItem) {
    requestLayout()
  }

  /** The center slot got its props or a layout update. */
  fun slotChanged(s: EngineHeaderSlot) {
    if (s.slot != CENTER_SLOT) return
    val wanted = if (s.displayNone) GONE else VISIBLE
    if (s.visibility != wanted) s.visibility = wanted
    requestLayout()
  }

  /** A press on [item]: JavaScript hears the key and the item's index among the item nodes (spacers count). */
  internal fun pressed(item: EngineToolbarItem) {
    if (item.disabled || item.spacer) return
    var index = 0
    for (i in 0 until childCount) {
      val c = getChildAt(i)
      if (c === item) break
      if (c is EngineToolbarItem) index++
    }
    NavEvents.press(node.tag, item.key, index)
  }

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    if (child is EngineToolbarItem) child.bind()
    if (child is EngineHeaderSlot) slotChanged(child)
    requestLayout()
  }

  override fun onViewRemoved(child: View) {
    super.onViewRemoved(child)
    if (child is EngineToolbarItem) child.placed = false
    requestLayout()
  }

  // Accessibility ----------------------------------------------------------------------------------------------------

  /** The child index before which the center slot sits: the first spacer, else the end. Callers know a center exists. */
  private fun centerAt(): Int {
    for (i in 0 until childCount) if ((getChildAt(i) as? EngineToolbarItem)?.spacer == true) return i
    return childCount
  }

  private fun center(): EngineHeaderSlot? {
    for (i in 0 until childCount) {
      val s = getChildAt(i) as? EngineHeaderSlot ?: continue
      if (s.slot == CENTER_SLOT) return s
    }
    return null
  }

  /** Reading order is the row's logical order: the items, with the center slot where it sits (mirrored visually in RTL). */
  override fun addChildrenForAccessibility(outChildren: ArrayList<View>) {
    val center = center()
    val at = if (center == null) -1 else centerAt()
    for (i in 0..childCount) {
      if (i == at && center != null) addForAccessibility(center, outChildren)
      if (i < childCount) {
        val c = getChildAt(i)
        if (c !== center) addForAccessibility(c, outChildren)
      }
    }
  }

  private fun addForAccessibility(view: View, out: ArrayList<View>) {
    if (view.visibility != VISIBLE) return
    if (view.isImportantForAccessibility) out.add(view) else if (view is ViewGroup) view.addChildrenForAccessibility(out)
  }

  // Layout -------------------------------------------------------------------------------------------------------------

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
    Frames.measureChildren(this)
  }

  /** The inset the band is laid out with: the window's, or Yoga's padding until the window reports. */
  private fun inset() = if (cachedInset >= 0) cachedInset else node.padB.toInt()

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    cachedInset = SafeArea.bottom(this) ?: -1
    val rowTop = max(0, (b - t) - inset() - barPx)
    layoutRow(r - l, rowTop)
    if (isAttachedToWindow) reportMetrics()
  }

  private fun layoutRow(w: Int, rowTop: Int) {
    val n = childCount
    if (widths.size < n) widths = IntArray(n + 4)
    val pad = dp(EDGE_DP)
    val itemW = dp(ITEM_DP)
    val available = max(0, w - 2 * pad)
    var fixed = 0
    var spacers = 0
    for (i in 0 until n) {
      val item = getChildAt(i) as? EngineToolbarItem
      widths[i] = 0
      if (item == null || item.visibility == GONE) continue
      if (item.spacer) spacers++ else {
        widths[i] = itemW
        fixed += itemW
      }
    }
    // A row with more items than the bar holds (more than seven on a 360 dp phone): every item gives up the same share rather
    // than leaving the bar. Yoga's numbers no longer hold there (its center is zero), and the items are narrower than 48 dp.
    if (fixed > available && fixed > 0) {
      val total = fixed
      fixed = 0
      for (i in 0 until n) {
        widths[i] = (widths[i].toLong() * available / total).toInt()
        fixed += widths[i]
      }
    }
    val free = available - fixed
    val slot = center()?.takeIf { it.visibility != GONE && it.node.hasFrame }
    val at = if (slot == null) -1 else centerAt()
    val share = if (slot == null && spacers > 0) free / spacers else 0
    var remainder = if (slot == null && spacers > 0) free - share * spacers else 0
    var lastSpacer = -1
    if (remainder > 0) for (i in n - 1 downTo 0) if ((getChildAt(i) as? EngineToolbarItem)?.spacer == true && getChildAt(i).visibility != GONE) { lastSpacer = i; break }
    val rtl = isRtlLayout()
    val itemH = min(barPx, itemW)
    var x = pad
    for (i in 0..n) {
      if (i == at && slot != null) {
        placeCenter(slot, x, free, w, rowTop, rtl)
        x += free
      }
      if (i == n) break
      val item = getChildAt(i) as? EngineToolbarItem ?: continue
      if (item.visibility == GONE) continue
      var width = widths[i]
      if (item.spacer) {
        width = share
        if (i == lastSpacer) {
          width += remainder
          remainder = 0
        }
      }
      val left = if (rtl) w - x - width else x
      val top = rowTop + (barPx - itemH) / 2
      item.setWant(left, top, left + width, top + itemH)
      item.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(itemH, MeasureSpec.EXACTLY))
      item.layout(left, top, left + width, top + itemH)
      x += width
    }
  }

  /**
   * The center slot fills the free span: Yoga gave it `flex: 1` in a row whose edges are [EDGE_DP] and whose items are
   * [ITEM_DP] wide (JavaScript's `TOOLBAR_METRICS.android`, the numbers [layoutRow] uses), with spacers that do not grow beside
   * a center, so Yoga's width of the slot is `band width - 2 * EDGE_DP - ITEM_DP * items`, which is [free]. The slot keeps that
   * width and sits at the span's start; its content was centered inside it by Yoga (mirrored there for right-to-left), so
   * nothing is measured or clamped here. The slot lets touches through where it has no content ([EngineHeaderSlot.apply]).
   */
  private fun placeCenter(s: EngineHeaderSlot, start: Int, free: Int, w: Int, rowTop: Int, rtl: Boolean) {
    val height = if (s.node.h in 1..barPx) s.node.h else barPx
    val width = s.node.w
    // Physical coordinates; equal widths put the slot exactly on the span, a different one anchors it at the span's start edge.
    val spanLeft = if (rtl) w - start - free else start
    val left = if (rtl) spanLeft + free - width else spanLeft
    val top = rowTop + (barPx - height) / 2
    centerRect[0] = left; centerRect[1] = top; centerRect[2] = left + width; centerRect[3] = top + height
    centerPlaced = true
    s.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
    s.layout(left, top, left + width, top + height)
  }

  /** An item was laid out at a frame other than the one chosen for it (Yoga's, from the mounting layer): lay the row out again. */
  internal fun itemPlaced(item: EngineToolbarItem) {
    if (!item.placed || item.visibility == GONE) return
    if (item.left != item.wantL || item.top != item.wantT || item.right != item.wantR || item.bottom != item.wantB) requestLayout()
  }

  /** Same for the center slot ([EngineHeaderSlot.onLayout]). */
  fun slotPlaced(s: EngineHeaderSlot) {
    if (s.slot != CENTER_SLOT || !centerPlaced || s.visibility == GONE) return
    if (s.left != centerRect[0] || s.top != centerRect[1] || s.right != centerRect[2] || s.bottom != centerRect[3]) requestLayout()
  }

  /** Tells JavaScript the real band size, once per change; never before the window has reported its insets, never while hidden. */
  private fun reportMetrics() {
    val inset = cachedInset
    if (inset < 0 || visibility == GONE) return
    val height = round2((barPx + inset) / density)
    val dp = round2(inset / density)
    if (height == reportedHeight && dp == reportedInset) return
    reportedHeight = height
    reportedInset = dp
    NavEvents.metrics(node.tag, height, dp)
  }

  private fun round2(v: Float) = (v * 100f).roundToInt() / 100f

  // The window dispatches insets again when they change: the band only lays out again when its own bottom inset moved.
  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    if ((SafeArea.bottom(this) ?: -1) != cachedInset) requestLayout()
    return super.onApplyWindowInsets(insets)
  }

  // The first layout of a screen runs detached, where the window reports no insets: lay out again once attached, so the
  // real inset is used and reported.
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    requestLayout()
  }

  // Drawing ------------------------------------------------------------------------------------------------------------

  override fun onDraw(canvas: Canvas) {
    val color = backgroundColor()
    if (Color.alpha(color) == 0) return
    fill.color = color
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), fill)
    fill.color = lineColor()
    canvas.drawRect(0f, 0f, width.toFloat(), max(1f, density * 0.5f), fill)
  }

  private companion object {
    const val BAR_DP = 56f
    const val CENTER_SLOT = 4
  }
}
