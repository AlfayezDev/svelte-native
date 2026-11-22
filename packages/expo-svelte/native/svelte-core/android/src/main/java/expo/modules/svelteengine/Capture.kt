package expo.modules.svelteengine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import expo.modules.kotlin.Promise
import expo.modules.svelteengine.views.EngineForeign
import java.io.ByteArrayOutputStream
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * `react-native-view-shot` for the engine's views. The library's module draws the view a React tag names, which it finds through
 * React Native's mounting manager, and that has never seen an engine view (the C++ delegate returns no mutations for them), so
 * `captureRef` fails with "No view found" for every engine tag. The JavaScript side (`fabric/foreign-capture.ts`) asks this first:
 * the view of the engine's registry is drawn here, with the options the library takes, and a tag that is not an engine view of its
 * own (a foreign view's frame, what is inside a foreign view, an unknown tag) answers null, so the library's module draws it, with
 * every option. The view is looked up first and the options are judged only for an engine view ([CaptureRules.plan]).
 *
 * Supported: the formats `png`, `jpg`, `webp` and `webm` (view-shot 6's deprecated name for `webp`); the results `tmpfile`, `base64` and `data-uri`; `width` and `height` (both),
 * `quality`, `fileName`, `handleGLSurfaceViewOnAndroid`. Rejected, for an engine view: the `raw` format, the `zip-base64` result
 * and `snapshotContentContainer`.
 *
 * How a view is drawn (the recording stays on the main thread, the rest does not):
 * - API 29+, and no `SurfaceView` in the tree: the view is recorded into a `RenderNode` and rendered by a `HardwareRenderer` into an
 *   `ImageReader` ([GpuFrame]), so the outline clip of a rounded view, elevation shadows and `TextureView` children are in the image.
 * - Otherwise, or when that fails: `View.draw` into a software canvas, then each visible `TextureView` below the view is copied in
 *   with `getBitmap` at its place, as the library does. A software canvas knows neither outlines nor shadows.
 * - With `handleGLSurfaceViewOnAndroid`, each visible `SurfaceView` below the view is copied with `PixelCopy` over the finished
 *   bitmap at its place (position, rotation, scale and alpha of its ancestors; clipping by an ancestor is not applied), as the
 *   library does. Without the option a `SurfaceView` is a hole, as on the library's path.
 *
 * Every bitmap is recycled on every path, success or failure.
 *
 * The temporary files are named as the library names its own, so its `releaseCapture` deletes these too. The library's clean-up on
 * exit runs only if its module was ever instantiated (its `invalidate()`), which an app that captures only engine views may not
 * have done, so the engine deletes the files it made when its own module is destroyed ([deleteTemporaryFiles], [CaptureFiles]).
 */
@Suppress("DEPRECATION")
private val WEBP = Bitmap.CompressFormat.WEBP

/** A view of one kind in the captured tree, and where and how opaque it draws in the captured view's own coordinates. */
private class Placed(val view: View, val matrix: Matrix, val alpha: Float)

object Capture {
  private const val TAG = "SvelteEngine"
  private const val ERROR = "E_UNABLE_TO_SNAPSHOT"
  private const val TEMP_FILE_PREFIX = "ReactNative-snapshot-image"
  private const val GPU_FRAME_MS = 3000L
  private const val SURFACE_COPY_SECONDS = 5L
  private const val MAIN_SECONDS = 5L
  private val encoder = Executors.newCachedThreadPool()
  private val main = Handler(Looper.getMainLooper())
  private val files = CaptureFiles()

  /** Where the `ImageReader` and `PixelCopy` call back: never the thread that waits for them, never the main thread. */
  private val callbacks: Handler by lazy { Handler(HandlerThread("svelte-capture").also { it.start() }.looper) }

  /**
   * Deletes the `tmpfile` results a process of the app that was killed left ([CaptureFiles.sweep]): everything of the library's name that is older than this process, in
   * both cache directories (a result goes to the one with more free space, the external one when the card has it). Off the main thread, once, when the module is
   * created, so no capture of this process can be in the way.
   */
  fun deleteLeftovers(directories: List<java.io.File?>) {
    val existing = directories.filterNotNull().distinct()
    if (existing.isEmpty()) return
    Thread {
      try {
        val started = System.currentTimeMillis() - (SystemClock.elapsedRealtime() - android.os.Process.getStartElapsedRealtime())
        val deleted = existing.sumOf { files.sweep(it, TEMP_FILE_PREFIX, started) }
        if (deleted > 0) Log.i(TAG, "capture: deleted $deleted leftover file(s) of an earlier process")
      } catch (error: Throwable) {
        Log.w(TAG, "capture: could not clear the leftovers: ${error.message}")
      }
    }.also { it.name = "svelte-capture-sweep"; it.start() }
  }

  /** Deletes the `tmpfile` results this process made; the module calls it when it is destroyed. */
  fun deleteTemporaryFiles() {
    files.deleteAll()
  }

  fun capture(manager: MountingManager, tag: Int, options: Map<String, Any?>, promise: Promise) {
    val draw = Runnable {
      try {
        record(manager, tag, options, promise)
      } catch (error: Throwable) {
        // On the main thread: nothing here may escape and take the app down.
        Log.e(TAG, "Failed to capture view snapshot", error)
        promise.reject(ERROR, "Failed to capture view snapshot: ${error.message ?: error}", error)
      }
    }
    if (Looper.myLooper() == Looper.getMainLooper()) draw.run() else main.post(draw)
  }

  /** The main-thread half: finds the view, reads its tree and records it; the encoder thread then waits for the frame and writes the result. */
  private fun record(manager: MountingManager, tag: Int, options: Map<String, Any?>, promise: Promise) {
    val format = (options["format"] as? String) ?: "png"
    val result = (options["result"] as? String) ?: "tmpfile"
    val width = (options["width"] as? Number)?.toInt()
    val height = (options["height"] as? Number)?.toInt()
    val quality = (options["quality"] as? Number)?.toDouble() ?: 1.0
    val fileName = options["fileName"] as? String
    val withSurfaces = options["handleGLSurfaceViewOnAndroid"] == true
    // The mounting manager is main thread only, so the lookup and the recording (which read the view tree) run there.
    val found = manager.viewFor(tag)
    val view = if (found is EngineForeign) null else found
    when (val plan = CaptureRules.plan(view != null, options)) {
      CaptureRules.Plan.NotEngine -> { promise.resolve(null); return }
      is CaptureRules.Plan.Reject -> { promise.reject(ERROR, plan.message, null); return }
      CaptureRules.Plan.Draw -> Unit
    }
    if (view == null) return
    val viewWidth = view.width
    val viewHeight = view.height
    if (viewWidth <= 0 || viewHeight <= 0) {
      promise.reject(ERROR, "Impossible to snapshot the view: view is invalid", null)
      return
    }
    val cacheDir = view.context.let { context ->
      val external = context.externalCacheDir
      val internal = context.cacheDir
      if (external != null && external.freeSpace > internal.freeSpace) external else internal
    }
    val surfaceViews = place(view, SurfaceView::class.java)
    val gpu = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && surfaceViews.isEmpty()) GpuFrame.start(view, viewWidth, viewHeight, callbacks) else null
    encoder.execute {
      var bitmap: Bitmap? = null
      var scaled: Bitmap? = null
      try {
        val drawn = gpu?.bitmap(GPU_FRAME_MS) ?: onMain { softwareDraw(view, viewWidth, viewHeight) }
        bitmap = drawn
        if (withSurfaces) overlay(drawn, surfaceViews)
        val sized = if (width != null && height != null && (width != viewWidth || height != viewHeight)) Bitmap.createScaledBitmap(drawn, width, height, true) else drawn
        scaled = sized
        val compress = when (format) {
          "jpg" -> Bitmap.CompressFormat.JPEG
          "webp", "webm" -> WEBP
          else -> Bitmap.CompressFormat.PNG
        }
        val percent = (100.0 * quality).toInt()
        when (result) {
          "tmpfile" -> {
            val file = files.create(fileName ?: TEMP_FILE_PREFIX, ".$format", cacheDir)
            FileOutputStream(file).use { sized.compress(compress, percent, it) }
            promise.resolve(Uri.fromFile(file).toString())
          }
          else -> {
            val bytes = ByteArrayOutputStream().also { sized.compress(compress, percent, it) }.toByteArray()
            val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
            promise.resolve(if (result == "data-uri") "data:image/${mime(format)};base64,$encoded" else encoded)
          }
        }
      } catch (error: Throwable) {
        Log.e(TAG, "Failed to capture view snapshot", error)
        promise.reject(ERROR, "Failed to capture view snapshot: ${error.message ?: error}", error)
      } finally {
        scaled?.let { if (it !== bitmap) it.recycle() }
        bitmap?.recycle()
        gpu?.release()
      }
    }
  }

  /** The subtype of a `data:image/...` URI, as view-shot 6 writes it: `jpg` is `jpeg` and its deprecated `webm` is `webp`. */
  private fun mime(format: String): String = when (format) {
    "jpg" -> "jpeg"
    "webm" -> "webp"
    else -> format
  }

  /** `View.draw` into a software canvas, then the library's walk over the `TextureView`s below the view. Main thread; the bitmap is the caller's, and recycled here when the draw fails. */
  private fun softwareDraw(view: View, width: Int, height: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    try {
      val canvas = Canvas(bitmap)
      view.draw(canvas)
      val paint = Paint(Paint.FILTER_BITMAP_FLAG)
      for (texture in place(view, TextureView::class.java)) {
        val tv = texture.view as TextureView
        if (tv.width <= 0 || tv.height <= 0) continue
        val copy = Bitmap.createBitmap(tv.width, tv.height, Bitmap.Config.ARGB_8888)
        try {
          // The bitmap has the view's own size: a texture is scaled to the bitmap it is copied into.
          tv.getBitmap(copy)
          paint.alpha = (255 * texture.alpha).toInt()
          canvas.drawBitmap(copy, texture.matrix, paint)
        } finally {
          copy.recycle()
        }
      }
      return bitmap
    } catch (error: Throwable) {
      bitmap.recycle()
      throw error
    }
  }

  /** Copies each `SurfaceView` over [bitmap] with `PixelCopy`; one that cannot be copied (no surface yet, a refused copy, no answer in time) stays a hole, with a warning. Off the main thread. */
  private fun overlay(bitmap: Bitmap, surfaces: List<Placed>) {
    if (surfaces.isEmpty()) return
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG)
    for (surface in surfaces) {
      val sv = surface.view as SurfaceView
      if (sv.width <= 0 || sv.height <= 0 || !sv.holder.surface.isValid) continue
      val copy = Bitmap.createBitmap(sv.width, sv.height, Bitmap.Config.ARGB_8888)
      try {
        val done = CountDownLatch(1)
        var code = PixelCopy.ERROR_UNKNOWN
        PixelCopy.request(sv, copy, PixelCopy.OnPixelCopyFinishedListener { answer -> code = answer; done.countDown() }, callbacks)
        if (!done.await(SURFACE_COPY_SECONDS, TimeUnit.SECONDS) || code != PixelCopy.SUCCESS) {
          Log.w(TAG, "capture: PixelCopy of $sv did not succeed (result $code)")
          continue
        }
        paint.alpha = (255 * surface.alpha).toInt()
        canvas.drawBitmap(copy, surface.matrix, paint)
      } catch (error: Throwable) {
        Log.w(TAG, "capture: cannot copy $sv", error)
      } finally {
        copy.recycle()
      }
    }
  }

  /**
   * The visible views of [kind] below [root] with the matrix that takes each one's own coordinates to [root]'s: the position in the
   * parent less the parent's scroll, then translation, rotation and scale about the view's pivot, from the outermost down (the
   * library's `applyTransformations` without its padding and with the pivot of the scale). The alpha is the product of the views'
   * own along the way. Main thread.
   */
  private fun <T : View> place(root: View, kind: Class<T>): List<Placed> {
    val found = ArrayList<Placed>()
    fun visit(group: ViewGroup, matrix: Matrix, alpha: Float) {
      for (index in 0 until group.childCount) {
        val child = group.getChildAt(index)
        if (child.visibility != View.VISIBLE) continue
        val at = Matrix(matrix)
        at.preTranslate(child.left - group.scrollX + child.translationX, child.top - group.scrollY + child.translationY)
        at.preRotate(child.rotation, child.pivotX, child.pivotY)
        at.preScale(child.scaleX, child.scaleY, child.pivotX, child.pivotY)
        val opacity = alpha * child.alpha
        if (kind.isInstance(child)) found.add(Placed(child, at, opacity))
        if (child is ViewGroup) visit(child, at, opacity)
      }
    }
    if (root is ViewGroup) visit(root, Matrix(), 1f)
    return found
  }

  /** Runs [block] on the main thread and waits for it; for the encoder threads that need a view read. */
  private fun <T> onMain(block: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) return block()
    val done = CountDownLatch(1)
    val outcome = AtomicReference<Result<T>>()
    main.post {
      outcome.set(runCatching(block))
      done.countDown()
    }
    check(done.await(MAIN_SECONDS, TimeUnit.SECONDS)) { "the main thread did not answer in $MAIN_SECONDS s" }
    return outcome.get().getOrThrow()
  }
}
