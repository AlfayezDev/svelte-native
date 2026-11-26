package expo.modules.svelteengine.views

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.text.Layout
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowInsets
import androidx.activity.OnBackPressedCallback
import androidx.activity.findViewTreeOnBackPressedDispatcherOwner
import androidx.core.view.ViewCompat
import expo.modules.svelteappearance.isNight
import expo.modules.svelteengine.ChromeRules
import expo.modules.svelteengine.Fragment
import expo.modules.svelteengine.GestureRules
import expo.modules.svelteengine.NavEvents
import expo.modules.svelteengine.NavProps
import expo.modules.svelteengine.TextLayouts
import expo.modules.svelteengine.TextSpec
import expo.modules.svelteengine.ViewProps
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val TOOLBAR_CENTER = 4

/**
 * A slot of a screen's header: `native-header-left|center|right` hold the app's content for the bar, `native-header-search`
 * the results shown while the search is active (and the search field's placeholder, value and edit count). Yoga sizes a
 * slot; [EngineHeader] places it in the bar.
 */
class EngineHeaderSlot(context: Context) : EngineView(context) {
  /** 0 left, 1 center, 2 right, 3 search, 4 the center of a toolbar. */
  var slot = 0
  var placeholder: String? = null
  var value: String? = null
  var eventCount = 0
  /** Yoga's `display: none`; the header decides the rest of the visibility. */
  var displayNone = false

  val header: EngineHeader? get() = parent as? EngineHeader

  /** The toolbar this slot is the center of (slot 4), or null. */
  val toolbar: EngineToolbar? get() = parent as? EngineToolbar

  fun apply(p: NavProps) {
    if (p.slotSeen) slot = p.slot
    // The toolbar's center may reach over the items (EngineToolbar.placeCenter): only its content takes touches.
    if (slot == TOOLBAR_CENTER && node.pointer == 0) node.pointer = 2
    if (p.searchSeen) {
      placeholder = p.placeholder
      value = p.searchValue
      eventCount = p.searchCount
    }
    header?.slotChanged(this)
    toolbar?.slotChanged(this)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    // The mounting layer places a slot at its Yoga frame; the header or the toolbar moves it to its place in the bar.
    header?.slotPlaced(this)
    toolbar?.slotPlaced(this)
  }
}

/**
 * The header band of a screen (SPEC.md "Native screens, Android"): a child of [EngineScreen] that draws the bar in its
 * Yoga frame, which is the status bar inset plus the 56 dp bar, plus a second 56 dp row for a large title. It draws the
 * background, the divider, the title and subtitle (through [TextLayouts]), the back arrow and the search icon; the slots
 * the app gave it sit in the bar row. Because it is a child of the screen it moves with it in push, pop, predictive
 * back and edge swipe.
 *
 * Large title: the first scroll view of the screen gets the header's height as top padding (so its offset 0 is the rest
 * position) and the large row collapses over the first 56 dp of its scroll offset: the bar stays, the large title moves up
 * and fades while the inline title fades in. A translucent header insets that scroll view the same way without collapsing.
 * Search: the icon expands to a field in the title area; the results slot is shown while it is active.
 */
class EngineHeader(context: Context) : EngineView(context) {
  private val density = resources.displayMetrics.density
  private val barPx = dp(BAR_DP)
  private val largePx = dp(LARGE_DP)
  private val iconPx = dp(ICON_BOX_DP)
  private val fontScale = min(resources.configuration.fontScale, MAX_FONT_SCALE)

  private var large = false
  private var translucent = false
  private var back = false
  private var noDivider = false
  private var title: String? = null
  private var subtitle: String? = null
  private var backTitle: String? = null
  private var hasTint = false
  private var tint = 0
  private var hasBackground = false
  private var background = 0
  private var slotMask = 0

  private val titleView = TitleView(context, false)
  private val largeView = TitleView(context, true)
  private var backButton: IconButton? = null
  private var searchButton: IconButton? = null
  private var searchInput: EngineInput? = null
  private var searchActive = false
  /** Which title the traversal chain was last built for ([updateHeading]). */
  private var headingIsLarge = false

  private var scroll: EngineScroll? = null
  private var scrolled = false
  private var collapse = 0f
  private var adoptQueued = false
  // What the title layouts were last built for.
  private var textDirty = true
  private var builtAreaW = -1
  private var builtLargeW = -1
  private var builtRtl = false
  private var builtDark = false
  private var builtInk = 0
  private var reportedHeight = -1f
  private var reportedInset = -1f

  private val bgPaint = Paint()
  private val dividerPaint = Paint()
  private val slotRect = IntArray(4)

  // Runs before the next draw, so a scroll view that has just arrived is inset in the frame it first shows in.
  private val adoptDraw = object : ViewTreeObserver.OnPreDrawListener {
    override fun onPreDraw(): Boolean {
      viewTreeObserver.removeOnPreDrawListener(this)
      adoptQueued = false
      // A changed padding needs another layout pass before anything is drawn.
      return !adopt()
    }
  }
  private val scrollListener = View.OnScrollChangeListener { _, _, y, _, _ -> onScrolled(y) }
  private val scrollDetached = object : View.OnAttachStateChangeListener {
    override fun onViewAttachedToWindow(v: View) {}
    override fun onViewDetachedFromWindow(v: View) { if (v === scroll) releaseScroll() }
  }
  private val searchBack = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() { closeSearch(true) }
  }
  private var searchBackRegistered = false

  init {
    setWillNotDraw(false)
    addView(titleView)
    addView(largeView)
    ViewCompat.setAccessibilityHeading(titleView, true)
    ViewCompat.setAccessibilityHeading(largeView, true)
    updateHeading()
    largeView.visibility = GONE
    titleView.visibility = GONE
  }

  private fun dp(value: Float) = (value * density).roundToInt()

  private fun isRtl() = isRtlLayout()

  private val dark: Boolean
    get() = isNight(resources)

  private fun onSurface() = if (dark) 0xFFE6E1E5.toInt() else 0xFF1C1B1F.toInt()
  private fun surface() = if (dark) 0xFF1C1B1F.toInt() else 0xFFFFFBFE.toInt()
  private fun outline() = if (dark) 0xFF49454F.toInt() else 0xFFCAC4D0.toInt()
  private fun ink() = if (hasTint) tint else onSurface()

  // Props ------------------------------------------------------------------------------------------------------------

  fun apply(p: NavProps) {
    if (!p.headerSeen) return
    val flags = p.headerFlags
    if (title != p.title || subtitle != p.subtitle || large != (flags and 1 != 0)) textDirty = true
    large = flags and 1 != 0
    translucent = flags and 2 != 0
    back = flags and 4 != 0
    noDivider = flags and 8 != 0
    title = p.title
    subtitle = p.subtitle
    backTitle = p.backTitle
    hasTint = p.hasTint
    tint = p.tint
    hasBackground = p.hasBackground
    background = p.background
    slotMask = p.slotMask
    updateChrome()
    queueAdopt()
    requestLayout()
    invalidate()
  }

  private fun updateChrome() {
    if (back && backButton == null) {
      backButton = IconButton(context, Glyph.ARROW).also { button ->
        button.setOnClickListener { goBack() }
        addView(button)
      }
    } else if (!back) {
      backButton?.let { removeView(it) }
      backButton = null
    }
    backButton?.let {
      it.contentDescription = backTitle ?: "Navigate up"
      it.ink = ink()
    }
    val wantsSearch = slotMask and SEARCH_BIT != 0
    if (wantsSearch && searchButton == null) {
      searchButton = IconButton(context, Glyph.SEARCH).also { button ->
        button.setOnClickListener { if (searchActive) closeSearch(true) else openSearch() }
        addView(button)
      }
    } else if (!wantsSearch) {
      if (searchActive) closeSearch(false)
      searchButton?.let { removeView(it) }
      searchButton = null
    }
    searchButton?.let {
      it.contentDescription = if (searchActive) "Close search" else "Search"
      it.ink = ink()
    }
    updateTitleVisibility()
    updateTraversal()
  }

  private fun nativeTitle() = (title != null || subtitle != null) && slotMask and CENTER_BIT == 0

  private fun updateTitleVisibility() {
    val show = nativeTitle() && !searchActive
    titleView.visibility = if (show) VISIBLE else GONE
    largeView.visibility = if (show && large && title != null) VISIBLE else GONE
    applyCollapse()
  }

  /** The large title moves up with the scroll and fades into the inline title; without a large title only the inline one shows. */
  private fun applyCollapse() {
    val fraction = if (large) collapse / largePx else 1f
    titleView.alpha = fraction
    largeView.alpha = if (large) 1f - fraction else 0f
    largeView.translationY = -collapse
    updateHeading()
  }

  /** Whether the large title is the one showing: the inline title takes over once the collapse has passed its half (where the cross-fade meets). */
  private fun largeShows() = large && title != null && collapse * 2f < largePx

  /**
   * The heading is the title that shows. A view at alpha 0 is not visible to the user: uiautomator leaves it out of the dump and
   * TalkBack never focuses it, so under a large title at rest the inline title (alpha 0, its bounds kept) was no stop and the
   * screen had no heading at all. Exactly one of the two is important for accessibility at a time, so a service never reads the
   * title twice while they cross-fade.
   */
  private fun updateHeading() {
    val onLarge = largeShows()
    val wanted = if (onLarge) IMPORTANT_FOR_ACCESSIBILITY_YES else IMPORTANT_FOR_ACCESSIBILITY_NO
    val other = if (onLarge) IMPORTANT_FOR_ACCESSIBILITY_NO else IMPORTANT_FOR_ACCESSIBILITY_YES
    if (largeView.importantForAccessibility != wanted) largeView.importantForAccessibility = wanted
    if (titleView.importantForAccessibility != other) titleView.importantForAccessibility = other
    if (onLarge != headingIsLarge) {
      headingIsLarge = onLarge
      updateTraversal()
    }
  }

  private fun heading(): View = if (largeShows()) largeView else titleView

  /**
   * Reading order, start to end (the start is the right edge in right-to-left, so this is logical order and the layout mirrors
   * it): the back button, the left slot, the title (or the center slot), the search field while it is open, the right slot,
   * the search icon, the search results. It is the order of the native bars (UIKit's: back, title, trailing items; Material's
   * toolbar: navigation icon, title, actions) and what the accessibility suite's order rule runs on both platforms. The large
   * title is the bar's second row and is the one step that goes up: it is read after the back button, before the end controls.
   */
  private fun readingOrder(): List<View> {
    val order = ArrayList<View>(8)
    backButton?.let { order.add(it) }
    slotOf(0)?.let { order.add(it) }
    order.add(heading())
    slotOf(1)?.let { order.add(it) }
    searchInput?.let { order.add(it) }
    slotOf(2)?.let { order.add(it) }
    searchButton?.let { order.add(it) }
    slotOf(3)?.let { order.add(it) }
    return order
  }

  /** The chain `accessibilityTraversalBefore` makes for the services that read it: the reading order of what is on show. */
  private fun updateTraversal() {
    val all = readingOrder()
    val shown = all.filter { it.visibility == VISIBLE }
    for (v in shown) if (v.id == NO_ID) v.id = GestureRules.nextInternalId()
    // What is not in the order (the title that does not show, a closed field) is in no chain.
    titleView.accessibilityTraversalBefore = NO_ID
    largeView.accessibilityTraversalBefore = NO_ID
    for (v in all) v.accessibilityTraversalBefore = NO_ID
    for (i in shown.indices) shown[i].accessibilityTraversalBefore = if (i + 1 < shown.size) shown[i + 1].id else NO_ID
  }

  private fun slotOf(kind: Int): EngineHeaderSlot? {
    for (i in 0 until childCount) {
      val s = getChildAt(i) as? EngineHeaderSlot ?: continue
      if (s.slot == kind) return s
    }
    return null
  }

  /** A slot got its props or a layout update: its visibility and, for the search, the field's text belong to the header. */
  fun slotChanged(s: EngineHeaderSlot) {
    if (s.slot == 3) {
      s.visibility = if (s.displayNone) GONE else if (searchActive) VISIBLE else INVISIBLE
      searchInput?.let { input ->
        input.node.tag = s.node.tag
        applyInputProps(input, s)
        s.value?.let { input.maybeSetText(it, s.eventCount) }
      }
    } else if (s.visibility != if (s.displayNone) GONE else VISIBLE) {
      s.visibility = if (s.displayNone) GONE else VISIBLE
    }
    updateTraversal()
    requestLayout()
  }

  /**
   * The order accessibility services read the header in, whatever order the views were added in (slots first, as Fabric
   * inserts them, then the chrome) and wherever they sit: [readingOrder].
   */
  override fun addChildrenForAccessibility(outChildren: ArrayList<View>) {
    for (view in readingOrder()) {
      if (view.visibility != VISIBLE) continue
      if (view.isImportantForAccessibility) outChildren.add(view) else if (view is ViewGroup) view.addChildrenForAccessibility(outChildren)
    }
  }

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    if (child is EngineHeaderSlot) slotChanged(child)
  }

  override fun onViewRemoved(child: View) {
    super.onViewRemoved(child)
    if (child is EngineHeaderSlot) {
      updateTraversal()
      requestLayout()
    }
  }

  // Layout -----------------------------------------------------------------------------------------------------------

  /** The status bar inset in px as the window last reported it, read once per layout pass; -1 until it has. */
  private var cachedInset = -1

  private fun refreshInset() { cachedInset = windowInset() ?: -1 }

  /** What the window says the status bar covers of this header; null while it has reported none, and always inside a sheet ([ChromeRules.headerInset]). */
  private fun windowInset(): Int? = ChromeRules.headerInset(inSheet(), SafeArea.top(this))

  private fun inSheet(): Boolean {
    var p = parent
    while (p != null) {
      if (p is EngineSheet) return true
      p = p.parent
    }
    return false
  }

  /** The inset the bar is drawn with: the window's, or Yoga's padding until the window reports. */
  private fun inset() = if (cachedInset >= 0) cachedInset else node.padT.toInt()

  private fun expandedHeight() = inset() + barPx + if (large) largePx else 0

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
    Frames.measureChildren(this)
  }

  /** Where [s] belongs in the bar, in this view's coordinates; false for the search results, which stay at their Yoga frame. */
  private fun wantedRect(s: EngineHeaderSlot, out: IntArray): Boolean {
    if (s.slot == 3 || !s.node.hasFrame) return false
    val rtl = isRtl()
    val w = width
    val sw = s.node.w
    val sh = s.node.h
    val reserved = if (back) iconPx else 0
    val searchW = if (searchButton != null) iconPx else 0
    val leftW = slotOf(0)?.node?.w ?: 0
    val x = when (s.slot) {
      0 -> if (rtl) w - sw else 0
      2 -> if (rtl) searchW else w - sw - searchW
      else -> if (rtl) w - reserved - leftW - sw else reserved + leftW
    }
    // The bar row is what a slot centers in: Yoga's own centering would use the whole large header.
    val y = inset() + max(0, (barPx - sh) / 2)
    out[0] = x; out[1] = y; out[2] = x + sw; out[3] = y + sh
    return true
  }

  fun slotPlaced(s: EngineHeaderSlot) {
    if (!wantedRect(s, slotRect)) return
    if (s.left != slotRect[0] || s.top != slotRect[1] || s.right != slotRect[2] || s.bottom != slotRect[3]) requestLayout()
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    refreshInset()
    val w = r - l
    val rtl = isRtl()
    val barTop = inset()

    backButton?.let { place(it, if (rtl) w - iconPx else 0, barTop, iconPx, barPx) }
    searchButton?.let { place(it, if (rtl) 0 else w - iconPx, barTop, iconPx, barPx) }
    for (i in 0 until childCount) {
      val s = getChildAt(i) as? EngineHeaderSlot ?: continue
      if (!s.node.hasFrame) continue
      if (wantedRect(s, slotRect)) {
        s.measure(MeasureSpec.makeMeasureSpec(s.node.w, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(s.node.h, MeasureSpec.EXACTLY))
        s.layout(slotRect[0], slotRect[1], slotRect[2], slotRect[3])
      }
    }

    // The title area is the bar row between what sits at its start and at its end.
    val gap = dp(8f)
    val startReserve = if (back) iconPx + gap else dp(16f)
    val leftW = slotOf(0)?.node?.w ?: 0
    val rightW = slotOf(2)?.node?.w ?: 0
    val start = max(startReserve, if (leftW > 0) leftW + gap else 0)
    val end = max(dp(16f), (if (searchButton != null) iconPx else 0) + (if (rightW > 0) rightW + gap else 0))
    val x0 = if (rtl) end else start
    val x1 = if (rtl) w - start else w - end
    val areaW = max(0, x1 - x0)
    val ink = ink()
    val pad = dp(16f)
    val largeW = max(0, w - 2 * pad)
    // The text layouts only change with the text, its color and the width: a later layout pass of the same header (the
    // window's insets arriving, a slot changing) reuses them. The large title is only built for a large header.
    val night = dark
    if (textDirty || areaW != builtAreaW || largeW != builtLargeW || rtl != builtRtl || night != builtDark || ink != builtInk) {
      textDirty = false
      builtAreaW = areaW; builtLargeW = largeW; builtRtl = rtl; builtDark = night; builtInk = ink
      // A subtitle alone is drawn as the title.
      val main = title ?: subtitle
      titleView.set(
        build(main, TITLE_SP, 500, ink, areaW, title != null && subtitle != null),
        if (title != null) build(subtitle, SUBTITLE_SP, 400, (ink and 0x00FFFFFF) or (0xB3 shl 24), areaW, false) else null,
      )
      largeView.set(if (large) build(title, LARGE_SP, 400, ink, largeW, false) else null, null)
    }
    place(titleView, x0, barTop, areaW, barPx)
    place(largeView, pad, barTop + barPx, largeW, largePx)

    searchInput?.let { input ->
      if (searchActive) {
        val h = dp(40f)
        input.node.l = x0; input.node.t = barTop + (barPx - h) / 2; input.node.r = x0 + areaW; input.node.b = input.node.t + h
        input.node.hasFrame = true
        Frames.place(input)
      }
    }
    if (isAttachedToWindow) reportMetrics()
  }

  private fun place(view: View, x: Int, y: Int, width: Int, height: Int) {
    view.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
    view.layout(x, y, x + width, y + height)
  }

  /** One line of [text] at [sp], tail-ellipsized to [width]; null when there is nothing to draw. */
  private fun build(text: String?, sp: Float, weight: Int, color: Int, width: Int, compact: Boolean): Layout? {
    if (text.isNullOrEmpty() || width <= 0) return null
    val spec = TextSpec()
    spec.maxLines = 1
    spec.ellipsize = 0
    spec.breakStrategy = 0
    spec.includeFontPadding = false
    spec.rtl = isRtl()
    val size = sp * density * fontScale * (if (compact) COMPACT_RATIO else 1f)
    spec.fragments = arrayListOf(Fragment(text, size, color, weight, false, null, 0f, 0f))
    return TextLayouts.build(spec, width, 0)?.layout
  }

  /** Tells JavaScript the real header size, once per change; never before the window has reported its insets. */
  private fun reportMetrics() {
    val inset = cachedInset
    if (inset < 0) return
    val total = inset + barPx + if (large) largePx else 0
    val height = round2(total / density)
    val topInset = round2(inset / density)
    if (height == reportedHeight && topInset == reportedInset) return
    reportedHeight = height
    reportedInset = topInset
    NavEvents.metrics(node.tag, height, topInset)
  }

  private fun round2(v: Float) = (v * 100f).roundToInt() / 100f

  // The window dispatches insets again when they change, to every view (so an IME animation calls this each frame): the
  // header only lays out again when its own inset moved. It does not ask for a dispatch itself when it attaches, which
  // would walk the whole view tree on every push; `refreshInset` reads the root insets directly.
  override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
    val before = cachedInset
    refreshInset()
    if (ChromeRules.insetStale(before, cachedInset)) requestLayout()
    return super.onApplyWindowInsets(insets)
  }

  // Drawing ---------------------------------------------------------------------------------------------------------

  private fun visualBottom(): Float = height - (if (searchActive) 0f else collapse)

  private fun backgroundColor(): Int = if (hasBackground) background else if (translucent) Color.TRANSPARENT else surface()

  /** What the bar paints, for the stack to draw on across a screen's uncovered edge in Android's own transition ([EngineStack.drawChild]): its colour, down to [edgeBottom]. */
  internal fun edgeColor(): Int = backgroundColor()

  internal fun edgeBottom(): Float = visualBottom()

  override fun onDraw(canvas: Canvas) {
    val color = backgroundColor()
    if (Color.alpha(color) == 0) return
    bgPaint.color = color
    canvas.drawRect(0f, 0f, width.toFloat(), visualBottom(), bgPaint)
  }

  override fun dispatchDraw(canvas: Canvas) {
    super.dispatchDraw(canvas)
    // The divider appears once content has moved under the bar, and always while there is no scroll view to move.
    if (noDivider || !(scrolled || scroll == null)) return
    val bottom = visualBottom()
    dividerPaint.color = outline()
    canvas.drawRect(0f, bottom - max(1f, density * 0.5f), width.toFloat(), bottom, dividerPaint)
  }

  // Large title and the first scroll view -----------------------------------------------------------------------------

  /** Looks for the screen's first scroll view before the next draw (never inside a layout pass). */
  fun queueAdopt() {
    if (adoptQueued || !isAttachedToWindow || (!large && !translucent && scroll == null)) return
    adoptQueued = true
    viewTreeObserver.addOnPreDrawListener(adoptDraw)
  }

  /** Insets the first scroll view by the header when it is large or translucent; true when that changed a layout. */
  private fun adopt(): Boolean {
    var changed = false
    val wants = (large || translucent) && isAttachedToWindow
    val found = if (wants) firstScroll() else null
    if (found !== scroll) {
      changed = scroll != null
      releaseScroll()
      if (found != null) {
        scroll = found
        found.setOnScrollChangeListener(scrollListener)
        found.addOnAttachStateChangeListener(scrollDetached)
      }
    }
    val target = scroll ?: return changed
    // Offset 0 is the rest position under the header: the content starts below it, and scrolls under it.
    val top = node.h
    if (target.paddingTop != top || target.clipToPadding) {
      target.clipToPadding = false
      target.setPadding(target.paddingLeft, top, target.paddingRight, target.paddingBottom)
      changed = true
    }
    onScrolled(target.scrollY)
    return changed
  }

  private fun firstScroll(): EngineScroll? {
    val screen = parent as? ViewGroup ?: return null
    for (i in 0 until screen.childCount) {
      val child = screen.getChildAt(i)
      if (child !== this && child !is EngineToolbar) findScroll(child)?.let { return it }
    }
    return null
  }

  private fun findScroll(view: View): EngineScroll? {
    if (view is EngineScroll) return view
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) findScroll(view.getChildAt(i))?.let { return it }
    }
    return null
  }

  private fun releaseScroll() {
    val s = scroll ?: return
    scroll = null
    s.setOnScrollChangeListener(null)
    s.removeOnAttachStateChangeListener(scrollDetached)
    s.clipToPadding = true
    s.setPadding(s.paddingLeft, 0, s.paddingRight, s.paddingBottom)
    collapse = 0f
    scrolled = false
    applyCollapse()
    invalidate()
  }

  private fun onScrolled(y: Int) {
    val offset = max(0, y)
    val next = if (large) min(offset.toFloat(), largePx.toFloat()) else 0f
    val moved = offset > 0
    if (next == collapse && moved == scrolled) return
    collapse = next
    scrolled = moved
    applyCollapse()
    invalidate()
  }

  // Back and search -------------------------------------------------------------------------------------------------

  /** The back key's own path: the stack's callback pops with its exit transition, or JavaScript's `BackHandler` answers. */
  private fun goBack() {
    findViewTreeOnBackPressedDispatcherOwner()?.onBackPressedDispatcher?.onBackPressed()
  }

  private fun applyInputProps(input: EngineInput, slot: EngineHeaderSlot) {
    val v = ViewProps()
    v.includeFontPadding = false
    v.fontSize = SEARCH_SP * density * fontScale
    v.hasColor = true
    v.color = ink()
    v.placeholder = slot.placeholder
    v.hasPlaceholderColor = true
    v.placeholderColor = (ink() and 0x00FFFFFF) or (0x99 shl 24)
    v.returnKey = 5
    v.submitBehavior = 2
    v.autoCorrect = 0
    input.apply(v, false)
    input.contentDescription = slot.placeholder
  }

  private fun ensureInput(): EngineInput {
    searchInput?.let { return it }
    val input = EngineInput(context)
    input.visibility = GONE
    val slot = slotOf(3)
    if (slot != null) {
      input.node.tag = slot.node.tag
      val v = ViewProps()
      v.includeFontPadding = false
      v.fontSize = SEARCH_SP * density * fontScale
      input.apply(v, true)
      applyInputProps(input, slot)
    }
    searchInput = input
    addView(input)
    return input
  }

  private fun openSearch() {
    if (searchActive || searchButton == null) return
    searchActive = true
    val input = ensureInput()
    slotOf(3)?.let { slotChanged(it) }
    input.visibility = VISIBLE
    searchButton?.let { it.glyph = Glyph.CLOSE; it.contentDescription = "Close search" }
    ensureSearchBack()
    searchBack.isEnabled = true
    updateTitleVisibility()
    updateTraversal()
    requestLayout()
    invalidate()
    input.focus()
  }

  private fun closeSearch(notify: Boolean) {
    if (!searchActive) return
    searchActive = false
    searchBack.isEnabled = false
    searchInput?.let { input ->
      input.blur()
      input.visibility = GONE
      input.maybeSetText("", Int.MAX_VALUE)
    }
    searchButton?.let { it.glyph = Glyph.SEARCH; it.contentDescription = "Search" }
    slotOf(3)?.let { slotChanged(it) }
    updateTitleVisibility()
    updateTraversal()
    requestLayout()
    invalidate()
    if (notify) slotOf(3)?.let { NavEvents.cancel(it.node.tag) }
    // The scroll offset decides the collapse again.
    scroll?.let { onScrolled(it.scrollY) }
  }

  private fun ensureSearchBack() {
    if (searchBackRegistered || !isAttachedToWindow) return
    val owner = findViewTreeOnBackPressedDispatcherOwner() ?: return
    owner.onBackPressedDispatcher.addCallback(owner, searchBack)
    searchBackRegistered = true
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    // The screen's first layout ran detached (`MountingManager.flushScreens` places its whole subtree before the stack attaches it), where the window
    // reports no insets: lay out again with the real one, whether the screen is the first of its stack or pushed onto it. `adopt` only re-pads the
    // screen's scroll view and lays no header out again, so every header, large, translucent or inline, relies on this relayout for its bar offset.
    if (ChromeRules.insetStale(cachedInset, windowInset())) requestLayout()
    queueAdopt()
    if (searchActive) ensureSearchBack()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    if (adoptQueued) viewTreeObserver.removeOnPreDrawListener(adoptDraw)
    adoptQueued = false
    releaseScroll()
    searchBack.remove()
    searchBackRegistered = false
    // The screen is gone, and so is its search: an open one must not come back with the next attach.
    if (searchActive) closeSearch(false)
  }

  // Chrome views ------------------------------------------------------------------------------------------------------

  private enum class Glyph { ARROW, SEARCH, CLOSE }

  /** The inline title (and subtitle) of the bar, or the large title of the second row. */
  private class TitleView(context: Context, private val bottomAligned: Boolean) : View(context) {
    private var title: Layout? = null
    private var subtitle: Layout? = null

    fun set(title: Layout?, subtitle: Layout?) {
      if (this.title === title && this.subtitle === subtitle) return
      this.title = title
      this.subtitle = subtitle
      contentDescription = listOfNotNull(title?.text?.toString(), subtitle?.text?.toString()).joinToString(", ").ifEmpty { null }
      invalidate()
    }

    override fun onDraw(canvas: Canvas) {
      val t = title ?: return
      val total = t.height + (subtitle?.height ?: 0)
      val y = if (bottomAligned) height - total - 12f * resources.displayMetrics.density else (height - total) / 2f
      canvas.save()
      canvas.translate(0f, y)
      t.draw(canvas)
      subtitle?.let {
        canvas.translate(0f, t.height.toFloat())
        it.draw(canvas)
      }
      canvas.restore()
    }
  }

  /** The back arrow, search icon and close icon: 24 dp glyphs drawn in a 48 dp wide, bar high touch target. */
  private class IconButton(context: Context, var glyph: Glyph) : View(context) {
    var ink = Color.BLACK
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()
    private val density = resources.displayMetrics.density

    init {
      isClickable = true
      isFocusable = true
    }

    override fun getAccessibilityClassName(): CharSequence = "android.widget.Button"

    override fun drawableStateChanged() {
      super.drawableStateChanged()
      invalidate()
    }

    override fun onDraw(canvas: Canvas) {
      val cx = width / 2f
      val cy = height / 2f
      if (isPressed) {
        fill.color = (ink and 0x00FFFFFF) or (0x1F shl 24)
        canvas.drawCircle(cx, cy, 20f * density, fill)
      }
      canvas.save()
      // The 24 dp icon grid, centered; the arrow points the other way for right-to-left.
      canvas.translate(cx - 12f * density, cy - 12f * density)
      canvas.scale(density, density)
      if (glyph == Glyph.ARROW && isRtlLayout()) canvas.scale(-1f, 1f, 12f, 12f)
      paint.color = ink
      paint.strokeWidth = 2f
      path.reset()
      when (glyph) {
        Glyph.ARROW -> {
          paint.style = Paint.Style.FILL
          path.moveTo(20f, 11f); path.lineTo(7.83f, 11f); path.lineTo(13.42f, 5.41f); path.lineTo(12f, 4f)
          path.lineTo(4f, 12f); path.lineTo(12f, 20f); path.lineTo(13.41f, 18.59f); path.lineTo(7.83f, 13f)
          path.lineTo(20f, 13f); path.close()
        }
        Glyph.SEARCH -> {
          paint.style = Paint.Style.STROKE
          path.addCircle(10.5f, 10.5f, 5.5f, Path.Direction.CW)
          path.moveTo(14.6f, 14.6f); path.lineTo(20f, 20f)
        }
        Glyph.CLOSE -> {
          paint.style = Paint.Style.STROKE
          path.moveTo(6f, 6f); path.lineTo(18f, 18f); path.moveTo(18f, 6f); path.lineTo(6f, 18f)
        }
      }
      canvas.drawPath(path, paint)
      canvas.restore()
    }
  }

  private companion object {
    const val BAR_DP = 56f
    const val LARGE_DP = 56f
    const val ICON_BOX_DP = 48f
    const val TITLE_SP = 22f
    const val SUBTITLE_SP = 12f
    const val LARGE_SP = 28f
    const val SEARCH_SP = 16f
    /** With a subtitle the title shrinks so both lines fit the 56 dp bar. */
    const val COMPACT_RATIO = 0.77f
    const val MAX_FONT_SCALE = 1.3f
    const val CENTER_BIT = 2
    const val SEARCH_BIT = 8
  }
}
