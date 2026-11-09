package expo.modules.svelteqa

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * Pixels of an image the app made of itself (a `captureRef` result), for the lab's checks of the native-view libraries (SPEC.md,
 * "Foreign views", "Device verification of the libraries"): a check compares a region of a capture with the colour it must have,
 * which is what the platform drew, not what JavaScript was told. Like `SvelteQaTouch` it is in the QA variant only.
 *
 * `sample(source, points, radius)` takes a `file://` URI, a path, a `data:` URI or a bare base64 string, decodes it and answers
 * `{ width, height, format, colors }`: for each `[fx, fy]` (fractions of the image, 0 to 1) the ARGB integer of the mean of the
 * `(2 * radius + 1)` square around that pixel (a single pixel of a gradient or of text edge says little). `format` is the MIME type
 * the decoder found, so a `jpg` result can be told from a `png` one. Everything is decoded as `ARGB_8888` without scaling.
 */
class SvelteQaPixelsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SvelteQaPixels")

    Function("sample") { source: String, points: List<List<Double>>, radius: Int? ->
      val context = appContext.reactContext
      if (context == null || context.packageName != QA_PACKAGE) throw CodedException("ERR_QA_ONLY", "SvelteQaPixels reads pixels in the QA app ($QA_PACKAGE) only", null)
      val bytes = readBytes(source)
      val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 }
      val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: throw CodedException("ERR_QA_PIXELS", "the image of ${source.take(64)} could not be decoded (${bytes.size} bytes)", null)
      try {
        val reach = (radius ?: 1).coerceIn(0, 8)
        val colors = points.map { point ->
          val x = (point[0] * (bitmap.width - 1)).toInt().coerceIn(0, bitmap.width - 1)
          val y = (point[1] * (bitmap.height - 1)).toInt().coerceIn(0, bitmap.height - 1)
          mean(bitmap, x, y, reach)
        }
        mapOf("width" to bitmap.width, "height" to bitmap.height, "format" to (options.outMimeType ?: ""), "colors" to colors)
      } finally {
        bitmap.recycle()
      }
    }
  }

  private fun readBytes(source: String): ByteArray = when {
    source.startsWith("data:") -> Base64.decode(source.substringAfter("base64,"), Base64.DEFAULT)
    source.startsWith("file://") -> File(java.net.URI(source)).readBytes()
    source.startsWith("/") -> File(source).readBytes()
    else -> Base64.decode(source, Base64.DEFAULT)
  }

  /** The mean ARGB of the square of side `2 * reach + 1` around ([x], [y]), clipped to the image. */
  private fun mean(bitmap: Bitmap, x: Int, y: Int, reach: Int): Int {
    var a = 0L; var r = 0L; var g = 0L; var b = 0L; var n = 0
    for (yy in (y - reach).coerceAtLeast(0)..(y + reach).coerceAtMost(bitmap.height - 1)) {
      for (xx in (x - reach).coerceAtLeast(0)..(x + reach).coerceAtMost(bitmap.width - 1)) {
        val p = bitmap.getPixel(xx, yy)
        a += (p ushr 24) and 0xff; r += (p ushr 16) and 0xff; g += (p ushr 8) and 0xff; b += p and 0xff; n++
      }
    }
    return ((a / n).toInt() shl 24) or ((r / n).toInt() shl 16) or ((g / n).toInt() shl 8) or (b / n).toInt()
  }
}
