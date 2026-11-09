package expo.modules.svelteengine.views

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Outline
import android.graphics.Shader
import android.graphics.drawable.BitmapDrawable
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.LruCache
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.ImageView
import expo.modules.svelteengine.ViewEvents
import expo.modules.svelteengine.ViewProps
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/** A decoded image plus the size of the source it came from (what `onLoad` reports). */
class LoadedImage(val bitmap: Bitmap, val sourceWidth: Int, val sourceHeight: Int)

/** Tiny image loader: background executor, `HttpURLConnection` + `BitmapFactory`, LRU cache by uri and size. */
object ImageLoader {
  private val executor = Executors.newFixedThreadPool(3) { r -> Thread(r, "SvelteEngineImage").also { it.isDaemon = true } }
  private val main = Handler(Looper.getMainLooper())
  private val cache = object : LruCache<String, LoadedImage>(
    max(4 * 1024 * 1024, min(32 * 1024 * 1024, (Runtime.getRuntime().maxMemory() / 8).toInt()))
  ) {
    override fun sizeOf(key: String, value: LoadedImage) = value.bitmap.byteCount
  }

  fun key(uri: String, w: Int, h: Int) = "$uri|${w}x$h"

  fun cached(key: String): LoadedImage? = synchronized(cache) { cache.get(key) }

  /** Loads [uri] decoded to roughly [w] x [h]; [done] runs on the main thread with the image or an error message. */
  fun load(context: Context, uri: String, headers: Array<String>?, w: Int, h: Int, done: (LoadedImage?, String?) -> Unit) {
    val key = key(uri, w, h)
    executor.execute {
      var result: LoadedImage? = null
      var error: String? = null
      try {
        result = decode(context, uri, headers, w, h)
        if (result == null) error = "Could not decode image"
        else synchronized(cache) { cache.put(key, result) }
      } catch (t: Throwable) {
        error = t.message ?: t.javaClass.simpleName
      }
      main.post { done(result, error) }
    }
  }

  private fun decode(context: Context, uri: String, headers: Array<String>?, w: Int, h: Int): LoadedImage? {
    val resId = if (uri.startsWith("res:/") || !uri.contains(':') && !uri.startsWith("/")) resourceId(context, uri) else 0
    val bytes: ByteArray? = if (resId == 0) readBytes(context, uri, headers) else null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    if (resId != 0) BitmapFactory.decodeResource(context.resources, resId, bounds)
    else BitmapFactory.decodeByteArray(bytes!!, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val opts = BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, w, h) }
    val bmp = if (resId != 0) BitmapFactory.decodeResource(context.resources, resId, opts)
    else BitmapFactory.decodeByteArray(bytes!!, 0, bytes.size, opts)
    return bmp?.let { LoadedImage(it, bounds.outWidth, bounds.outHeight) }
  }

  private fun sampleSize(srcW: Int, srcH: Int, w: Int, h: Int): Int {
    if (w <= 0 || h <= 0) return 1
    var s = 1
    while (srcW / (s * 2) >= w && srcH / (s * 2) >= h) s *= 2
    return s
  }

  /** `res:/<id>` or a bare drawable name, as React Native's ResourceDrawableIdHelper resolves them. */
  private fun resourceId(context: Context, uri: String): Int {
    val name = uri.removePrefix("res:/")
    name.toIntOrNull()?.let { return it }
    return context.resources.getIdentifier(name.lowercase().replace('-', '_'), "drawable", context.packageName)
  }

  private fun readBytes(context: Context, uri: String, headers: Array<String>?): ByteArray {
    return when {
      uri.startsWith("http://") || uri.startsWith("https://") -> {
        val c = URL(uri).openConnection() as HttpURLConnection
        try {
          c.connectTimeout = 15000
          c.readTimeout = 30000
          c.instanceFollowRedirects = true
          if (headers != null) {
            var i = 0
            while (i + 1 < headers.size) { c.setRequestProperty(headers[i], headers[i + 1]); i += 2 }
          }
          val code = c.responseCode
          if (code !in 200..299) throw java.io.IOException("HTTP $code")
          c.inputStream.use { it.readAllBytes2() }
        } finally {
          c.disconnect()
        }
      }
      uri.startsWith("data:") -> {
        val comma = uri.indexOf(',')
        val meta = uri.substring(0, comma)
        val body = uri.substring(comma + 1)
        if (meta.endsWith(";base64")) Base64.decode(body, Base64.DEFAULT) else java.net.URLDecoder.decode(body, "UTF-8").toByteArray(Charsets.ISO_8859_1)
      }
      uri.startsWith("asset:/") -> context.assets.open(uri.removePrefix("asset:/").trimStart('/')).use { it.readAllBytes2() }
      uri.startsWith("file://") -> FileInputStream(File(java.net.URI(uri))).use { it.readAllBytes2() }
      uri.startsWith("/") -> FileInputStream(File(uri)).use { it.readAllBytes2() }
      uri.startsWith("content://") || uri.startsWith("android.resource://") ->
        context.contentResolver.openInputStream(android.net.Uri.parse(uri))!!.use { it.readAllBytes2() }
      else -> throw java.io.IOException("Unsupported image uri scheme")
    }
  }

  private fun InputStream.readAllBytes2(): ByteArray {
    val out = ByteArrayOutputStream(32 * 1024)
    val buf = ByteArray(16 * 1024)
    while (true) {
      val n = read(buf)
      if (n < 0) break
      out.write(buf, 0, n)
    }
    return out.toByteArray()
  }
}

/**
 * Image on a framework [ImageView]. The source loads once the frame is known (the decode is sized to it);
 * the events follow React Native's ImageLoadEvent order: loadStart, load | error, loadEnd.
 */
class EngineImage(context: Context) : ImageView(context), EngineNode {
  override val node = NodeState()

  private var uri: String? = null
  private var headers: Array<String>? = null
  private var loadedKey: String? = null
  private var loadedUri: String? = null
  private var requested: String? = null
  private var generation = 0
  private var current: LoadedImage? = null
  private var repeat = false
  private var radius = 0f

  init {
    scaleType = ScaleType.FIT_XY
  }

  fun apply(v: ViewProps) {
    val newRepeat = v.resizeMode == 4
    val type = when (v.resizeMode) {
      0 -> ScaleType.CENTER_CROP
      1 -> ScaleType.FIT_CENTER
      2 -> ScaleType.FIT_XY
      3 -> ScaleType.CENTER_INSIDE
      4 -> ScaleType.FIT_XY
      else -> ScaleType.MATRIX
    }
    if (scaleType != type) scaleType = type
    imageTintList = if (v.hasTint) ColorStateList.valueOf(v.tint) else null

    // Rounded corners clip the image itself, like the drawee's rounding in ReactImageView.
    val r = maxOf(maxOf(node.radii[0], node.radii[1]), maxOf(node.radii[2], node.radii[3]))
    if (r != radius) {
      radius = r
      if (!node.outlineClip) {
        if (r > 0f) {
          outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
              outline.setRoundRect(0, 0, view.width, view.height, radius)
            }
          }
          clipToOutline = true
        } else {
          clipToOutline = false
          outlineProvider = ViewOutlineProvider.BACKGROUND
        }
      }
    }

    val repeatChanged = newRepeat != repeat
    repeat = newRepeat
    if (v.imageUri != uri) {
      uri = v.imageUri
      headers = v.headers
      loadedKey = null
      loadedUri = null
      requested = null
      generation++
      if (uri == null) {
        current = null
        setImageDrawable(null)
      }
      maybeLoad()
    } else if (repeatChanged) {
      showCurrent()
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    maybeLoad()
  }

  private fun maybeLoad() {
    val u = uri ?: return
    val w = node.w
    val h = node.h
    if (w <= 0 || h <= 0) return
    val cur = current
    if (cur != null && loadedUri == u && (cur.bitmap.width >= w && cur.bitmap.height >= h || cur.bitmap.width == cur.sourceWidth)) {
      return // the decoded bitmap already covers the new frame
    }
    val key = ImageLoader.key(u, w, h)
    if (key == loadedKey || key == requested) return
    requested = key
    val gen = ++generation
    ViewEvents.image(node.tag, ViewEvents.IMAGE_LOAD_START, 0f, 0f, u, null)
    ImageLoader.cached(key)?.let { finish(gen, key, u, it, null); return }
    ImageLoader.load(context, u, headers, w, h) { img, err -> finish(gen, key, u, img, err) }
  }

  private fun finish(gen: Int, key: String, u: String, img: LoadedImage?, error: String?) {
    if (gen != generation) return // superseded by a newer source or size
    requested = null
    if (img != null) {
      loadedKey = key
      loadedUri = u
      current = img
      showCurrent()
      ViewEvents.image(node.tag, ViewEvents.IMAGE_LOAD, img.sourceWidth.toFloat(), img.sourceHeight.toFloat(), u, null)
    } else {
      ViewEvents.image(node.tag, ViewEvents.IMAGE_ERROR, 0f, 0f, u, error)
    }
    ViewEvents.image(node.tag, ViewEvents.IMAGE_LOAD_END, 0f, 0f, u, null)
  }

  private fun showCurrent() {
    val img = current ?: return
    if (repeat) {
      setImageDrawable(BitmapDrawable(resources, img.bitmap).also { it.setTileModeXY(Shader.TileMode.REPEAT, Shader.TileMode.REPEAT) })
    } else {
      setImageBitmap(img.bitmap)
    }
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
  }
}
