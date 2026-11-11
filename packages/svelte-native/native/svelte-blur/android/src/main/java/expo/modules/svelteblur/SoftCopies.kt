package expo.modules.svelteblur

import android.graphics.Bitmap
import java.util.WeakHashMap

/**
 * Software copies of hardware bitmaps, for [BackdropCanvas]: a software canvas cannot draw a `Bitmap.Config.HARDWARE` bitmap (Glide, Fresco and `ImageDecoder`
 * decode into one), which is what an image behind the blur is. The copy is made once per bitmap (a read back from the GPU, so not per frame) and is smaller than
 * the bitmap ([BlurRules.copyScale]); it lives as long as the hardware bitmap does (the map holds the bitmap weakly and a copy never refers to its source) and at most
 * [BlurRules.COPY_BUDGET_BYTES] of them are kept. A hardware bitmap is immutable, so the bitmap itself is the key; its generation id is checked anyway.
 * Main thread only, as the drawing of a window is.
 */
internal object SoftCopies {
  /** [bitmap] is null when the copy could not be made (the bitmap is then left out of the backdrop, and not tried again). */
  class Copy(val bitmap: Bitmap?, val sourceWidth: Int, val sourceHeight: Int, val scale: Float, val generation: Int) {
    /** How many pixels of the copy one pixel of the source is: the copy's side over the source's, across and down. */
    val scaleX: Float get() = if (bitmap == null) 1f else bitmap.width.toFloat() / sourceWidth
    val scaleY: Float get() = if (bitmap == null) 1f else bitmap.height.toFloat() / sourceHeight
  }

  private val copies = WeakHashMap<Bitmap, Copy>()

  /** The copy of [source] at [scale]; made the first time it is asked for. */
  fun copy(source: Bitmap, scale: Float): Copy {
    val known = copies[source]
    if (known != null && known.scale == scale && known.generation == source.generationId && known.sourceWidth == source.width && known.sourceHeight == source.height) return known
    val made = make(source, scale)
    var kept = 0L
    for (other in copies.values) kept += other.bitmap?.allocationByteCount ?: 0
    if (kept + (made.bitmap?.allocationByteCount ?: 0) > BlurRules.COPY_BUDGET_BYTES) copies.clear()
    copies[source] = made
    return made
  }

  private fun make(source: Bitmap, scale: Float): Copy {
    val width = BlurRules.copySide(source.width, scale)
    val height = BlurRules.copySide(source.height, scale)
    var bitmap: Bitmap? = try {
      source.copy(Bitmap.Config.ARGB_8888, false)
    } catch (_: Throwable) {
      null
    }
    if (bitmap != null && (width != bitmap.width || height != bitmap.height)) {
      val full = bitmap
      bitmap = try {
        Bitmap.createScaledBitmap(full, width, height, true)
      } catch (_: Throwable) {
        null
      }
      if (bitmap !== full) full.recycle()
    }
    return Copy(bitmap, source.width, source.height, scale, source.generationId)
  }
}
