package expo.modules.svelteengine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.svelteengine.views.EngineForeign
import java.io.ByteArrayOutputStream
import java.io.FileOutputStream
import java.util.concurrent.Executors

/**
 * `react-native-view-shot` for the engine's views. The library's module draws the view a React tag names, which it finds through
 * React Native's mounting manager, and that has never seen an engine view (the C++ delegate returns no mutations for them), so
 * `captureRef` fails with "No view found" for every engine tag. The JavaScript side (`fabric/foreign-capture.ts`) asks this first:
 * the view of the engine's registry is drawn here, with the options the library takes, and a tag that is not an engine view of its
 * own (a foreign view's frame, what is inside a foreign view, an unknown tag) answers null, so the library's module draws it, with
 * every option. The view is looked up first and the options are judged only for an engine view ([CaptureRules.plan]).
 *
 * Supported: the formats `png`, `jpg` and `webm`; the results `tmpfile`, `base64` and `data-uri`; `width` and `height` (both),
 * `quality`, `fileName`. Rejected, for an engine view: the `raw` format, the `zip-base64` result, `snapshotContentContainer` and
 * `handleGLSurfaceViewOnAndroid`.
 * The temporary files are named as the library names its own, so its `releaseCapture` deletes these too. The library's clean-up on
 * exit runs only if its module was ever instantiated (its `invalidate()`), which an app that captures only engine views may not
 * have done, so the engine deletes the files it made when its own module is destroyed ([deleteTemporaryFiles], [CaptureFiles]).
 */
@Suppress("DEPRECATION")
private val WEBP = Bitmap.CompressFormat.WEBP

object Capture {
  private const val TAG = "SvelteEngine"
  private const val ERROR = "E_UNABLE_TO_SNAPSHOT"
  private const val TEMP_FILE_PREFIX = "ReactNative-snapshot-image"
  private val encoder = Executors.newCachedThreadPool()
  private val main = Handler(Looper.getMainLooper())
  private val files = CaptureFiles()

  /** Deletes the `tmpfile` results this process made; the module calls it when it is destroyed. */
  fun deleteTemporaryFiles() {
    files.deleteAll()
  }

  fun capture(manager: MountingManager, tag: Int, options: Map<String, Any?>, promise: Promise) {
    val format = (options["format"] as? String) ?: "png"
    val result = (options["result"] as? String) ?: "tmpfile"
    val width = (options["width"] as? Number)?.toInt()
    val height = (options["height"] as? Number)?.toInt()
    val quality = (options["quality"] as? Number)?.toDouble() ?: 1.0
    val fileName = options["fileName"] as? String
    val draw = Runnable {
      // The mounting manager is main thread only, so the lookup and the draw (which reads the view tree) run there.
      val found = manager.viewFor(tag)
      val view = if (found is EngineForeign) null else found
      when (val plan = CaptureRules.plan(view != null, options)) {
        CaptureRules.Plan.NotEngine -> { promise.resolve(null); return@Runnable }
        is CaptureRules.Plan.Reject -> { promise.reject(ERROR, plan.message, null); return@Runnable }
        CaptureRules.Plan.Draw -> Unit
      }
      if (view == null) return@Runnable
      val viewWidth = view.width
      val viewHeight = view.height
      if (viewWidth <= 0 || viewHeight <= 0) {
        promise.reject(ERROR, "Impossible to snapshot the view: view is invalid", null)
        return@Runnable
      }
      val bitmap = try {
        Bitmap.createBitmap(viewWidth, viewHeight, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
      } catch (error: Throwable) {
        android.util.Log.e(TAG, "Failed to capture view snapshot", error)
        promise.reject(ERROR, "Failed to capture view snapshot: ${error.message ?: error}", error)
        return@Runnable
      }
      val cacheDir = view.context.let { context ->
        val external = context.externalCacheDir
        val internal = context.cacheDir
        if (external != null && external.freeSpace > internal.freeSpace) external else internal
      }
      encoder.execute {
        try {
          val scaled = if (width != null && height != null && (width != viewWidth || height != viewHeight)) Bitmap.createScaledBitmap(bitmap, width, height, true) else bitmap
          val compress = when (format) {
            "jpg" -> Bitmap.CompressFormat.JPEG
            "webm" -> WEBP
            else -> Bitmap.CompressFormat.PNG
          }
          val percent = (100.0 * quality).toInt()
          when (result) {
            "tmpfile" -> {
              val file = files.create(fileName ?: TEMP_FILE_PREFIX, ".$format", cacheDir)
              FileOutputStream(file).use { scaled.compress(compress, percent, it) }
              promise.resolve(Uri.fromFile(file).toString())
            }
            else -> {
              val bytes = ByteArrayOutputStream().also { scaled.compress(compress, percent, it) }.toByteArray()
              val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
              promise.resolve(if (result == "data-uri") "data:image/${if (format == "jpg") "jpeg" else format};base64,$encoded" else encoded)
            }
          }
          if (scaled !== bitmap) scaled.recycle()
          bitmap.recycle()
        } catch (error: Throwable) {
          promise.reject(ERROR, "Failed to capture view snapshot: ${error.message ?: error}", error)
        }
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) draw.run() else main.post(draw)
  }
}
