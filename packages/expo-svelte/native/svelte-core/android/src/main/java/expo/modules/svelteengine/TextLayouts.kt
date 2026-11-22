package expo.modules.svelteengine

import android.content.res.AssetManager
import android.content.res.Resources
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import android.os.Trace
import android.text.Layout
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.TextUtils
import android.text.style.LineHeightSpan
import android.text.style.MetricAffectingSpan
import com.facebook.react.views.text.ReactFontManager
import java.lang.reflect.Method
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

/** A layout ready to draw and the vertical offset (px) `textAlignVertical` adds below the top padding. */
class BuiltText(val layout: Layout, val verticalOffset: Float)

/**
 * Builds `android.text.Layout` objects the way React Native's `TextLayoutManager` does (SPEC.md, "Text parity"): the same
 * attributes in the same order, `includeFontPadding`, break strategy, hyphenation, justification and alignment rules,
 * so the draw matches what Yoga measured through that class.
 */
object TextLayouts {
  private val typefaceCache = HashMap<String, Typeface>()
  private var assets: AssetManager? = null

  fun init(assetManager: AssetManager) {
    assets = assetManager
  }

  internal fun typeface(family: String?, weight: Int, italic: Boolean): Typeface {
    val key = "$family|$weight|$italic"
    typefaceCache[key]?.let { return it }
    val w = if (weight <= 0) 400 else weight
    val tf: Typeface = if (family != null && assets != null) {
      @Suppress("DEPRECATION")
      ReactFontManager.getInstance().getTypeface(family, w, italic, assets!!)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      Typeface.create(Typeface.DEFAULT, w, italic)
    } else {
      Typeface.create(Typeface.DEFAULT, if (w >= 600) (if (italic) Typeface.BOLD_ITALIC else Typeface.BOLD) else (if (italic) Typeface.ITALIC else Typeface.NORMAL))
    }
    typefaceCache[key] = tf
    return tf
  }

  /** React Native's pixel font size: `ceil` of the already scaled size (`TextAttributeProps.setFontSize`). */
  private fun pixelSize(size: Float) = ceil(size.toDouble()).toFloat()

  private val featureCache = HashMap<Int, String?>()

  /** `FontVariant` bits to `Paint.fontFeatureSettings` (`TextAttributeProps.setFontVariant`). */
  private fun features(bits: Int): String? {
    if (bits == 0) return null
    return featureCache.getOrPut(bits) {
      val out = ArrayList<String>(2)
      if (bits and (1 shl 1) != 0) out.add("'smcp'")
      if (bits and (1 shl 2) != 0) out.add("'onum'")
      if (bits and (1 shl 3) != 0) out.add("'lnum'")
      if (bits and (1 shl 4) != 0) out.add("'tnum'")
      if (bits and (1 shl 5) != 0) out.add("'pnum'")
      for (n in 1..20) if (bits and (1 shl (5 + n)) != 0) out.add(String.format(Locale.US, "'ss%02d'", n))
      if (out.isEmpty()) null else out.joinToString(", ")
    }
  }

  /**
   * One span per fragment carrying what React Native spreads over `ReactForegroundColorSpan`, `ReactBackgroundColorSpan`,
   * `ReactOpacitySpan`, `CustomLetterSpacingSpan`, `ReactAbsoluteSizeSpan`, `CustomStyleSpan`, underline, strike-through
   * and `ShadowStyleSpan`; they only write paint fields, so one span applying them in the same order is equivalent.
   */
  private class FragmentSpan(val frag: Fragment) : MetricAffectingSpan() {
    var size = pixelSize(frag.size)
    private val features = features(frag.variant)

    override fun updateDrawState(ds: TextPaint) {
      ds.color = frag.color
      if (frag.flags and 4 != 0) ds.bgColor = frag.background
      if (!frag.opacity.isNaN()) {
        ds.alpha = (Color.alpha(ds.color) * frag.opacity).roundToInt()
        if (ds.bgColor != 0) {
          ds.bgColor = Color.argb((Color.alpha(ds.bgColor) * frag.opacity).roundToInt(), Color.red(ds.bgColor), Color.green(ds.bgColor), Color.blue(ds.bgColor))
        }
      }
      apply(ds)
      if (frag.flags and 1 != 0) ds.isUnderlineText = true
      if (frag.flags and 2 != 0) ds.isStrikeThruText = true
      if ((frag.shadowDx != 0f || frag.shadowDy != 0f || frag.shadowRadius != 0f) && Color.alpha(frag.shadowColor) != 0) {
        ds.setShadowLayer(frag.shadowRadius, frag.shadowDx, frag.shadowDy, frag.shadowColor)
      }
    }

    override fun updateMeasureState(ds: TextPaint) = apply(ds)

    private fun apply(ds: TextPaint) {
      ds.letterSpacing = if (size > 0f) frag.letterSpacing / size else 0f
      ds.textSize = size
      ds.typeface = typeface(frag.family, frag.weight, frag.italic)
      ds.fontFeatureSettings = features
      // As `CustomStyleSpan`, which React Native only sets for a fragment with a weight, style or family: the paint must
      // measure the way React Native measured the node, or a text that fits Yoga's width to the pixel wraps here.
      ds.isSubpixelText = frag.styled
      ds.isLinearText = frag.styled
    }
  }

  /** `CustomLineHeightSpan`. */
  private class LineHeight(height: Float) : LineHeightSpan {
    val lineHeight: Int = ceil(height.toDouble()).toInt()

    override fun chooseHeight(text: CharSequence, start: Int, end: Int, spanstartv: Int, v: Int, fm: Paint.FontMetricsInt) {
      val leading = lineHeight - ((-fm.ascent) + fm.descent)
      fm.ascent -= ceil(leading / 2.0f).toInt()
      fm.descent += floor(leading / 2.0f).toInt()
      if (start == 0) fm.top = fm.ascent
      if (end == text.length) fm.bottom = fm.descent
    }
  }

  /** `TextTransform.apply`. */
  internal fun transformed(text: String, mode: Int): String = TextTransform.apply(text, mode)

  /**
   * Reads React Native's internal `com.facebook.react.views.text.PreparedLayout` (public JVM class, `internal` in Kotlin; the
   * constructor `val`s are public so the getters are `getLayout()` and `getVerticalOffset()`, `@DoNotStrip`). Method and
   * field objects are resolved once from the first instance's class; any failure disables the prepared path (null).
   */
  private object Prepared {
    private var resolved = false
    private var getLayout: Method? = null
    private var getVerticalOffset: Method? = null
    private var layoutField: java.lang.reflect.Field? = null
    private var offsetField: java.lang.reflect.Field? = null

    private fun resolve(cls: Class<*>) {
      if (resolved) return
      resolved = true
      try {
        getLayout = cls.getMethod("getLayout")
        getVerticalOffset = cls.getMethod("getVerticalOffset")
      } catch (_: Throwable) {
        try {
          layoutField = cls.getDeclaredField("layout").also { it.isAccessible = true }
          offsetField = cls.getDeclaredField("verticalOffset").also { it.isAccessible = true }
        } catch (_: Throwable) {
          layoutField = null
          offsetField = null
        }
      }
    }

    fun layout(o: Any): Layout? {
      if (o is Layout) return o
      resolve(o.javaClass)
      return try {
        (getLayout?.invoke(o) ?: layoutField?.get(o)) as? Layout
      } catch (_: Throwable) {
        null
      }
    }

    fun verticalOffset(o: Any): Float {
      if (o is Layout) return 0f
      resolve(o.javaClass)
      return try {
        ((getVerticalOffset?.invoke(o) ?: offsetField?.get(o)) as? Number)?.toFloat() ?: 0f
      } catch (_: Throwable) {
        0f
      }
    }
  }

  /** The prepared layout of the spec when React Native built one; drawn as is with its own vertical offset. */
  private fun prepared(spec: TextSpec): BuiltText? {
    val o = spec.prepared ?: return null
    val l = Prepared.layout(o) ?: return null
    return BuiltText(l, Prepared.verticalOffset(o))
  }

  /** `getTextAlignment` (paragraph versus script direction swap) and `getTextJustificationMode`. */
  private fun alignment(spec: TextSpec, text: CharSequence): Layout.Alignment {
    val scriptRtl = TextDirectionHeuristics.FIRSTSTRONG_LTR.isRtl(text, 0, text.length)
    val swap = spec.rtl != scriptRtl
    var alignment = if (swap) Layout.Alignment.ALIGN_OPPOSITE else Layout.Alignment.ALIGN_NORMAL
    when (spec.align) {
      1 -> alignment = Layout.Alignment.ALIGN_CENTER
      2 -> alignment = if (swap) Layout.Alignment.ALIGN_NORMAL else Layout.Alignment.ALIGN_OPPOSITE
    }
    return alignment
  }

  private fun staticLayout(
    text: CharSequence,
    paint: TextPaint,
    width: Int,
    spec: TextSpec,
    limitLines: Boolean,
  ): Layout {
    val builder = StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
      .setAlignment(alignment(spec, text))
      .setLineSpacing(0f, 1f)
      .setIncludePad(spec.includeFontPadding)
      .setBreakStrategy(spec.breakStrategy)
      .setHyphenationFrequency(spec.hyphenation)
    if (limitLines && spec.maxLines > 0) {
      val where = when (spec.ellipsize) {
        0 -> TextUtils.TruncateAt.END
        1 -> TextUtils.TruncateAt.START
        2 -> TextUtils.TruncateAt.MIDDLE
        else -> null
      }
      builder.setEllipsize(where).setMaxLines(spec.maxLines)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      builder.setJustificationMode(if (spec.align == 3) Layout.JUSTIFICATION_MODE_INTER_WORD else Layout.JUSTIFICATION_MODE_NONE)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) builder.setUseLineSpacingFromFallbacks(true)
    return builder.build()
  }

  private fun basePaint(first: Fragment): TextPaint {
    val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG)
    val size = pixelSize(first.size)
    paint.textSize = size
    paint.color = first.color
    paint.typeface = typeface(first.family, first.weight, first.italic)
    paint.isSubpixelText = first.styled
    paint.isLinearText = first.styled
    if (size > 0f) paint.letterSpacing = first.letterSpacing / size
    return paint
  }

  /**
   * `adjustSpannableFontToFit`: binary search over the font size between the minimum (4 dp, or `minimumFontSize` read as
   * pixels like React Native) and the largest fragment, scaling every fragment by the ratio between steps; leaves the final
   * sizes in [spans] and in [paint].
   */
  private fun adjustToFit(
    text: Spannable,
    spans: List<FragmentSpan>,
    paint: TextPaint,
    width: Int,
    height: Int,
    spec: TextSpec,
  ) {
    val density = Resources.getSystem().displayMetrics.density
    val minimum = (if (spec.minFontSize.isNaN()) 4f * density else spec.minFontSize).toInt()
    var largest = minimum
    for (s in spans) largest = max(largest, s.size.toInt())
    var intervalStart = minimum
    var intervalEnd = largest
    var previous = largest
    while (true) {
      val current = (intervalStart + intervalEnd + 1) / 2
      val ratio = current.toFloat() / previous.toFloat()
      paint.textSize = max((paint.textSize * ratio).toInt(), minimum).toFloat()
      for (s in spans) s.size = max((s.size * ratio).toInt(), minimum).toFloat()
      val layout = staticLayout(text, paint, width, spec, false)
      if (intervalStart == intervalEnd) break
      val singleLineExceedsWidth = text.length == 1 && layout.getLineWidth(0) > width
      val exceedsHeight = height > 0 && layout.height > height
      val exceedsLines = spec.maxLines > 0 && layout.lineCount > spec.maxLines
      if (current > minimum && (exceedsLines || exceedsHeight || singleLineExceedsWidth)) {
        intervalEnd = if (intervalEnd - intervalStart == 1) intervalStart else current
      } else {
        intervalStart = current
      }
      previous = current
    }
  }

  /** `getVerticalOffset`. */
  private fun verticalOffset(layout: Layout, spec: TextSpec, boxHeight: Int): Float {
    if (spec.vAlign == 0 || boxHeight <= 0) return 0f
    val textHeight = layout.height
    if (textHeight > boxHeight) return 0f
    return if (spec.vAlign == 1) (boxHeight - textHeight) / 2f else (boxHeight - textHeight).toFloat()
  }

  /**
   * Layout for [spec] at [width] px (text box, padding excluded); [height] is the box height used by `textAlignVertical` and
   * `adjustsFontSizeToFit`. A prepared layout wins; null when there is nothing to draw. Layouts built here are kept in a
   * bounded cache keyed by everything that decides them (fragments, paragraph options, width, and the height when it
   * matters), so a row that mounts again with the same text, style and width draws the layout it had before. A layout
   * is immutable once built and drawn from the main thread only, so views share cached ones.
   */
  fun build(spec: TextSpec, width: Int, height: Int): BuiltText? {
    prepared(spec)?.let { return it }
    val frags = spec.fragments ?: return null
    if (frags.isEmpty() || width <= 0) return null
    val probe = LayoutKey.probe.also { it.fill(spec, frags, width, height) }
    cache[probe]?.let { return it }
    Trace.beginSection("SvelteEngine.text.build")
    val built = try {
      buildUncached(spec, frags, width, height)
    } finally {
      Trace.endSection()
    }
    store(probe.snapshot(), built)
    return built
  }

  /** Drops every cached layout (memory pressure). */
  fun clearCache() {
    cache.clear()
    cachedChars = 0
  }

  private val cache = LinkedHashMap<LayoutKey, BuiltText>(256, 0.75f, true)
  private var cachedChars = 0

  private fun store(key: LayoutKey, built: BuiltText) {
    cache[key] = built
    cachedChars += key.chars
    if (cache.size <= MAX_ENTRIES && cachedChars <= MAX_CHARS) return
    val it = cache.entries.iterator()
    while (it.hasNext() && (cache.size > MAX_ENTRIES || cachedChars > MAX_CHARS)) {
      val eldest = it.next()
      cachedChars -= eldest.key.chars
      it.remove()
    }
  }

  private const val MAX_ENTRIES = 768
  private const val MAX_CHARS = 200_000

  /**
   * What decides a layout, compared by value. [probe] is one reusable instance filled for every lookup (so a hit
   * allocates nothing); a miss stores [snapshot], a copy that owns its fragment list because animated props edit the
   * spec's list in place.
   */
  private class LayoutKey {
    var frags: List<Fragment> = emptyList()
    var align = 0
    var maxLines = 0
    var ellipsize = 0
    var breakStrategy = 0
    var includeFontPadding = true
    var hyphenation = 0
    var fit = false
    var minFontSize = 0
    var vAlign = 0
    var rtl = false
    var width = 0
    var height = 0
    var hash = 0
    var chars = 0

    fun fill(spec: TextSpec, fragments: List<Fragment>, width: Int, height: Int) {
      frags = fragments
      align = spec.align
      maxLines = spec.maxLines
      ellipsize = spec.ellipsize
      breakStrategy = spec.breakStrategy
      includeFontPadding = spec.includeFontPadding
      hyphenation = spec.hyphenation
      fit = spec.fit
      minFontSize = spec.minFontSize.toRawBits()
      vAlign = spec.vAlign
      rtl = spec.rtl
      this.width = width
      // The box height only shapes the layout for vertical alignment and shrink-to-fit.
      this.height = if (spec.vAlign != 0 || spec.fit) height else 0
      var h = width
      h = h * 31 + this.height
      h = h * 31 + align
      h = h * 31 + maxLines
      h = h * 31 + ellipsize
      h = h * 31 + breakStrategy
      h = h * 31 + hyphenation
      h = h * 31 + vAlign
      h = h * 31 + minFontSize
      h = h * 31 + ((if (includeFontPadding) 1 else 0) or (if (fit) 2 else 0) or (if (rtl) 4 else 0))
      var n = 0
      for (i in fragments.indices) {
        val f = fragments[i]
        h = h * 31 + f.text.hashCode()
        h = h * 31 + f.size.toRawBits()
        h = h * 31 + f.color
        h = h * 31 + f.weight
        h = h * 31 + (if (f.italic) 1 else 0)
        h = h * 31 + (f.family?.hashCode() ?: 0)
        h = h * 31 + f.letterSpacing.toRawBits()
        h = h * 31 + f.lineHeight.toRawBits()
        h = h * 31 + f.flags
        h = h * 31 + f.transform
        h = h * 31 + f.background
        h = h * 31 + f.opacity.toRawBits()
        h = h * 31 + f.shadowDx.toRawBits()
        h = h * 31 + f.shadowDy.toRawBits()
        h = h * 31 + f.shadowRadius.toRawBits()
        h = h * 31 + f.shadowColor
        h = h * 31 + f.variant
        n += f.text.length
      }
      hash = h
      chars = n
    }

    fun snapshot(): LayoutKey {
      val k = LayoutKey()
      k.frags = ArrayList(frags)
      k.align = align; k.maxLines = maxLines; k.ellipsize = ellipsize; k.breakStrategy = breakStrategy
      k.includeFontPadding = includeFontPadding; k.hyphenation = hyphenation; k.fit = fit; k.minFontSize = minFontSize
      k.vAlign = vAlign; k.rtl = rtl; k.width = width; k.height = height; k.hash = hash; k.chars = chars
      return k
    }

    override fun hashCode() = hash

    override fun equals(other: Any?): Boolean {
      if (other !is LayoutKey) return false
      if (hash != other.hash || width != other.width || height != other.height || frags.size != other.frags.size) return false
      if (align != other.align || maxLines != other.maxLines || ellipsize != other.ellipsize || breakStrategy != other.breakStrategy ||
        includeFontPadding != other.includeFontPadding || hyphenation != other.hyphenation || fit != other.fit ||
        minFontSize != other.minFontSize || vAlign != other.vAlign || rtl != other.rtl
      ) return false
      for (i in frags.indices) if (!same(frags[i], other.frags[i])) return false
      return true
    }

    private fun same(a: Fragment, b: Fragment) =
      a.text == b.text && a.size.toRawBits() == b.size.toRawBits() && a.color == b.color && a.weight == b.weight &&
        a.italic == b.italic && a.family == b.family && a.letterSpacing.toRawBits() == b.letterSpacing.toRawBits() &&
        a.lineHeight.toRawBits() == b.lineHeight.toRawBits() && a.flags == b.flags && a.transform == b.transform &&
        a.background == b.background && a.opacity.toRawBits() == b.opacity.toRawBits() &&
        a.shadowDx.toRawBits() == b.shadowDx.toRawBits() && a.shadowDy.toRawBits() == b.shadowDy.toRawBits() &&
        a.shadowRadius.toRawBits() == b.shadowRadius.toRawBits() && a.shadowColor == b.shadowColor && a.variant == b.variant

    companion object {
      val probe = LayoutKey()
    }
  }

  private fun buildUncached(spec: TextSpec, frags: List<Fragment>, width: Int, height: Int): BuiltText {

    val paint = basePaint(frags[0])
    val text: CharSequence
    var spans: ArrayList<FragmentSpan>? = null
    if (frags.size == 1 && frags[0].plain && !spec.fit) {
      val only = frags[0]
      val s = transformed(only.text, only.transform)
      text = if (only.lineHeight > 0f) android.text.SpannableString(s).also {
        it.setSpan(LineHeight(only.lineHeight), 0, it.length, Spannable.SPAN_INCLUSIVE_INCLUSIVE)
      } else s
    } else {
      val sb = SpannableStringBuilder()
      spans = ArrayList(frags.size)
      for (fr in frags) {
        val start = sb.length
        sb.append(transformed(fr.text, fr.transform))
        val end = sb.length
        if (end <= start) continue
        val flags = if (start == 0) Spannable.SPAN_INCLUSIVE_INCLUSIVE else Spannable.SPAN_EXCLUSIVE_INCLUSIVE
        val span = FragmentSpan(fr)
        spans.add(span)
        sb.setSpan(span, start, end, flags)
        if (fr.lineHeight > 0f) sb.setSpan(LineHeight(fr.lineHeight), start, end, flags)
      }
      text = sb
    }

    if (spec.fit && spans != null && text is Spannable) adjustToFit(text, spans, paint, width, height, spec)
    val layout = staticLayout(text, paint, width, spec, true)
    return BuiltText(layout, verticalOffset(layout, spec, height))
  }
}
