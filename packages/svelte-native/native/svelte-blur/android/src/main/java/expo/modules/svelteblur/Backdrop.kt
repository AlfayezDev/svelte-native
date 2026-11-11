package expo.modules.svelteblur

import android.annotation.TargetApi
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.util.Log
import android.view.View

/**
 * The canvas the backdrop is drawn on. It is a software canvas on a small bitmap (not a hardware one), so that a view draws itself through its own `draw`
 * instead of handing its display list to the parent: the view that is blurred (`SvelteBlurView.dispatchDraw`) sees the canvas and [stop]s it. From then on
 * everything the window draws later (the views above the blur, its own children, the foreground of its parents) is clipped away, so the picture is exactly what
 * is drawn behind the view, whatever the tree looks like. [restore] and [restoreToCount] put the empty clip back, as the parents that restore their own saves
 * would give the clip of before; every draw that follows is skipped outright.
 *
 * What a software canvas does not take, this one takes anyway, so that the picture is not lost to one view:
 *  - A hardware bitmap (what Glide, Fresco and `ImageDecoder` decode into) is drawn from its software copy ([SoftCopies]), made once and smaller than the bitmap.
 *  - A draw of a shape with a hardware bitmap in its shader, and a render node (React Native's box shadows), is left out ([skipped] counts them).
 */
internal class BackdropCanvas : Canvas() {
  private var stopped = false
  private var copyScale = 1f
  private val scaledSource = Rect()

  /** How many draws of the picture in progress were left out because a software canvas cannot take them. */
  var skipped = 0
    private set

  fun begin(bitmap: Bitmap, copyScale: Float) {
    setBitmap(bitmap)
    stopped = false
    skipped = 0
    this.copyScale = copyScale
  }

  fun stop() {
    stopped = true
    clipRect(0, 0, 0, 0)
  }

  override fun restore() {
    super.restore()
    if (stopped) clipRect(0, 0, 0, 0)
  }

  override fun restoreToCount(saveCount: Int) {
    super.restoreToCount(saveCount)
    if (stopped) clipRect(0, 0, 0, 0)
  }

  private inline fun guarded(block: () -> Unit) {
    if (stopped) return
    try {
      block()
    } catch (_: RuntimeException) {
      skipped++
    }
  }

  private fun isHardware(bitmap: Bitmap) = !bitmap.isRecycled && bitmap.config == Bitmap.Config.HARDWARE

  private fun copyOf(bitmap: Bitmap): SoftCopies.Copy? = SoftCopies.copy(bitmap, copyScale).takeIf { it.bitmap != null }

  override fun drawBitmap(bitmap: Bitmap, left: Float, top: Float, paint: Paint?) {
    if (!isHardware(bitmap)) return guarded { super.drawBitmap(bitmap, left, top, paint) }
    if (stopped) return
    val copy = copyOf(bitmap) ?: return
    guarded {
      val saved = save()
      try {
        translate(left, top)
        scale(1f / copy.scaleX, 1f / copy.scaleY)
        super.drawBitmap(copy.bitmap!!, 0f, 0f, paint)
      } finally {
        restoreToCount(saved)
      }
    }
  }

  override fun drawBitmap(bitmap: Bitmap, src: Rect?, dst: Rect, paint: Paint?) {
    if (!isHardware(bitmap)) return guarded { super.drawBitmap(bitmap, src, dst, paint) }
    if (stopped) return
    val copy = copyOf(bitmap) ?: return
    guarded { super.drawBitmap(copy.bitmap!!, scaled(src, copy), dst, paint) }
  }

  override fun drawBitmap(bitmap: Bitmap, src: Rect?, dst: RectF, paint: Paint?) {
    if (!isHardware(bitmap)) return guarded { super.drawBitmap(bitmap, src, dst, paint) }
    if (stopped) return
    val copy = copyOf(bitmap) ?: return
    guarded { super.drawBitmap(copy.bitmap!!, scaled(src, copy), dst, paint) }
  }

  override fun drawBitmap(bitmap: Bitmap, matrix: Matrix, paint: Paint?) {
    if (!isHardware(bitmap)) return guarded { super.drawBitmap(bitmap, matrix, paint) }
    if (stopped) return
    val copy = copyOf(bitmap) ?: return
    guarded {
      val saved = save()
      try {
        concat(matrix)
        scale(1f / copy.scaleX, 1f / copy.scaleY)
        super.drawBitmap(copy.bitmap!!, 0f, 0f, paint)
      } finally {
        restoreToCount(saved)
      }
    }
  }

  override fun drawBitmapMesh(bitmap: Bitmap, meshWidth: Int, meshHeight: Int, verts: FloatArray, vertOffset: Int, colors: IntArray?, colorOffset: Int, paint: Paint?) {
    if (stopped) return
    // The mesh maps the whole bitmap, so the smaller copy takes its place as it is.
    val drawn = if (isHardware(bitmap)) copyOf(bitmap)?.bitmap ?: return else bitmap
    guarded { super.drawBitmapMesh(drawn, meshWidth, meshHeight, verts, vertOffset, colors, colorOffset, paint) }
  }

  /** The part of the bitmap [src] names, in the pixels of the smaller copy (the reused rect); null (all of it) stays null. */
  private fun scaled(src: Rect?, copy: SoftCopies.Copy): Rect? {
    if (src == null) return null
    scaledSource.set(
      (src.left * copy.scaleX).toInt(),
      (src.top * copy.scaleY).toInt(),
      Math.ceil((src.right * copy.scaleX).toDouble()).toInt(),
      Math.ceil((src.bottom * copy.scaleY).toDouble()).toInt(),
    )
    return scaledSource
  }

  // The shapes: a shader that holds a hardware bitmap (a rounded image) makes a software canvas throw, and the shader cannot be read to swap the bitmap.
  override fun drawRect(rect: RectF, paint: Paint) = guarded { super.drawRect(rect, paint) }
  override fun drawRect(r: Rect, paint: Paint) = guarded { super.drawRect(r, paint) }
  override fun drawRect(left: Float, top: Float, right: Float, bottom: Float, paint: Paint) = guarded { super.drawRect(left, top, right, bottom, paint) }
  override fun drawRoundRect(rect: RectF, rx: Float, ry: Float, paint: Paint) = guarded { super.drawRoundRect(rect, rx, ry, paint) }
  override fun drawRoundRect(left: Float, top: Float, right: Float, bottom: Float, rx: Float, ry: Float, paint: Paint) =
    guarded { super.drawRoundRect(left, top, right, bottom, rx, ry, paint) }
  override fun drawCircle(cx: Float, cy: Float, radius: Float, paint: Paint) = guarded { super.drawCircle(cx, cy, radius, paint) }
  override fun drawOval(oval: RectF, paint: Paint) = guarded { super.drawOval(oval, paint) }
  override fun drawOval(left: Float, top: Float, right: Float, bottom: Float, paint: Paint) = guarded { super.drawOval(left, top, right, bottom, paint) }
  override fun drawPath(path: Path, paint: Paint) = guarded { super.drawPath(path, paint) }
  override fun drawArc(oval: RectF, startAngle: Float, sweepAngle: Float, useCenter: Boolean, paint: Paint) =
    guarded { super.drawArc(oval, startAngle, sweepAngle, useCenter, paint) }
  override fun drawArc(left: Float, top: Float, right: Float, bottom: Float, startAngle: Float, sweepAngle: Float, useCenter: Boolean, paint: Paint) =
    guarded { super.drawArc(left, top, right, bottom, startAngle, sweepAngle, useCenter, paint) }
  override fun drawPaint(paint: Paint) = guarded { super.drawPaint(paint) }

  /** A render node is a hardware canvas's (React Native's box shadow): this canvas has nowhere to draw it, and would throw. */
  override fun drawRenderNode(renderNode: RenderNode) {
    if (!stopped) skipped++
  }
}

/**
 * What a `SvelteBlurView` shows of what is behind it (API 31 and up, where `RenderEffect` blurs on the GPU).
 *
 * Before each frame (`update`, from the view's pre-draw listener) the window's root view is drawn into a small bitmap, [BlurRules.DIVISOR] times smaller than
 * the view and translated so that the view's top-left is the bitmap's origin; the view's own `dispatchDraw` stops the drawing there (see [BackdropCanvas]). The
 * bitmap goes into a `RenderNode` whose render effect is the blur, and the view draws that node scaled back up to its bounds, under its tint and children.
 *
 * Why a bitmap and not the root's own `RenderNode`: a `RenderNode` that holds the window's display lists holds the blur view's display list too, which holds
 * this node, and a cycle of display lists is a stack overflow in the render thread; and a hardware canvas draws a child from the child's cached display list, so
 * the view could not leave itself out. A software canvas runs every view's own `draw`, which can. The price: the views of the window draw once more per frame,
 * into a bitmap of a sixteenth of the pixels (the trade of the BlurView library's software path). What a software canvas cannot take is handled by
 * [BackdropCanvas]; a throw from anything else keeps the last picture.
 *
 * No work when nothing could show: the view without a size, not shown, its window not visible, nothing of it on screen, intensity 0. While the view or one of
 * its ancestors has a layer (`setLayerType`: a screen held during a transition, `renderToHardwareTextureAndroid`) nothing is drawn either and the last picture
 * stays: a software draw builds a layer's drawing cache on a canvas of its own, which the drawing could neither stop at the view nor afford (a cache of the
 * layer's size). A layer on a view that is not an ancestor is drawn into the picture as it is (its cache is built once and stays until the view detaches).
 *
 * No allocation per frame: three bitmaps and their canvases (one is on screen, one may still be read by the render thread, one is written), one node, one
 * effect per radius. The bitmaps only grow, in steps ([BlurRules.capacity]): a picture that changes size a pixel at a time (an animated height) is drawn into
 * the corner of the same bitmaps, which are made again only when the picture no longer fits or is under half of them (a size change makes one small [BlurRules.Picture]).
 * A frame whose picture equals the last is not recorded again, so a still screen does not keep itself drawing.
 */
@TargetApi(Build.VERSION_CODES.S)
internal class Backdrop(private val view: SvelteBlurView) {
  private val node = RenderNode("SvelteBlur backdrop").also { it.clipToBounds = true }
  private val bitmaps = arrayOfNulls<Bitmap>(SLOTS)
  private val canvases = Array(SLOTS) { BackdropCanvas() }

  /** The picture size each bitmap last held: a bitmap that held another is cleared whole, one that held this size only where the picture goes. */
  private val heldWidth = IntArray(SLOTS)
  private val heldHeight = IntArray(SLOTS)
  private var capacityWidth = 0
  private var capacityHeight = 0
  private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val area = Rect()
  private val location = IntArray(2)
  private val rootLocation = IntArray(2)
  private val visible = Rect()
  private var picture: BlurRules.Picture? = null
  private var current = -1
  private var appliedRadius = -1f
  private var failed = false
  private var warnedSkips = false

  /** Whether the node holds a picture of the backdrop. */
  var ready = false
    private set

  /** The view's pre-draw: draws the backdrop again when the frame is about to show something else than the last one. */
  fun update() {
    val width = view.width
    val height = view.height
    if (width <= 0 || height <= 0 || view.intensity <= 0.0 || !view.isShown || view.windowVisibility != View.VISIBLE) return
    if (!view.getGlobalVisibleRect(visible)) return
    val root = view.rootView
    if (root === view || layered()) return
    var shape = picture
    if (shape == null || shape.width != width || shape.height != height) {
      shape = BlurRules.picture(width, height) ?: return
      picture = shape
      fit(shape)
    }
    applyEffect(shape)

    view.getLocationInWindow(location)
    root.getLocationInWindow(rootLocation)
    val next = (current + 1) % SLOTS
    val bitmap = bitmaps[next] ?: return
    val canvas = canvases[next]
    if (heldWidth[next] != shape.pictureWidth || heldHeight[next] != shape.pictureHeight) {
      bitmap.eraseColor(Color.TRANSPARENT)
      heldWidth[next] = shape.pictureWidth
      heldHeight[next] = shape.pictureHeight
    }
    canvas.begin(bitmap, BlurRules.copyScale(shape.divisor))
    canvas.clipRect(0, 0, shape.pictureWidth, shape.pictureHeight)
    canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
    canvas.scale(1f / shape.scaleX, 1f / shape.scaleY)
    canvas.translate(-(location[0] - rootLocation[0]).toFloat(), -(location[1] - rootLocation[1]).toFloat())
    view.snapshotting = true
    view.reached = false
    try {
      root.draw(canvas)
    } catch (error: Throwable) {
      // A view that cannot draw into a software canvas in a way the canvas does not cover: the picture is incomplete, so the last good one stays.
      if (!failed) {
        failed = true
        Log.w(TAG, "The window could not be drawn into the backdrop; the blur keeps its last picture", error)
      }
      return
    } finally {
      view.snapshotting = false
    }
    if (canvas.skipped > 0 && !warnedSkips) {
      warnedSkips = true
      Log.w(TAG, "${canvas.skipped} draws (a hardware bitmap in a shader, a render node) are left out of the backdrop")
    }
    if (!view.reached) return
    val last = bitmaps.getOrNull(current)
    if (last != null && last.sameAs(bitmap)) return
    current = next
    record(shape, bitmap)
    if (!ready) {
      ready = true
      // The view's display list was recorded without the node (or with the stronger tint of no blur): record it again, in this frame.
      view.invalidate()
    }
  }

  /** Draws the blurred backdrop onto the view's hardware canvas; false when there is none to draw (the caller draws the stronger tint). */
  fun draw(canvas: Canvas): Boolean {
    val shape = picture
    if (!ready || shape == null || view.intensity <= 0.0 || !canvas.isHardwareAccelerated) return false
    canvas.save()
    canvas.scale(shape.scaleX, shape.scaleY)
    canvas.drawRenderNode(node)
    canvas.restore()
    return true
  }

  /** The view left its window: nothing is drawn until it is back, and the pictures go (the render thread may still read one: they are not recycled). */
  fun release() {
    ready = false
    current = -1
    picture = null
    appliedRadius = -1f
    failed = false
    capacityWidth = 0
    capacityHeight = 0
    bitmaps.fill(null)
    node.discardDisplayList()
  }

  /** Whether the view or an ancestor draws through a layer: see the class comment. One walk up the parents, no allocation. */
  private fun layered(): Boolean {
    if (view.layerType != View.LAYER_TYPE_NONE) return true
    var parent = view.parent
    while (parent is View) {
      if (parent.layerType != View.LAYER_TYPE_NONE) return true
      parent = parent.parent
    }
    return false
  }

  /** Makes the bitmaps again only when the picture no longer fits them or is under half of them ([BlurRules.capacity]). */
  private fun fit(shape: BlurRules.Picture) {
    val width = BlurRules.capacity(shape.pictureWidth, capacityWidth)
    val height = BlurRules.capacity(shape.pictureHeight, capacityHeight)
    if (width == capacityWidth && height == capacityHeight && bitmaps[0] != null) return
    capacityWidth = width
    capacityHeight = height
    for (slot in 0 until SLOTS) bitmaps[slot] = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    heldWidth.fill(0)
    heldHeight.fill(0)
    current = -1
  }

  private fun record(shape: BlurRules.Picture, bitmap: Bitmap) {
    node.setPosition(0, 0, shape.pictureWidth, shape.pictureHeight)
    val recording = node.beginRecording(shape.pictureWidth, shape.pictureHeight)
    try {
      area.set(0, 0, shape.pictureWidth, shape.pictureHeight)
      recording.drawBitmap(bitmap, area, area, bitmapPaint)
    } finally {
      node.endRecording()
    }
  }

  private fun applyEffect(shape: BlurRules.Picture) {
    // The nominal divisor, not the exact ratio, so that an animated size does not make an effect per frame.
    val radius = BlurRules.radius(view.intensity, view.resources.displayMetrics.density, 1f / shape.divisor)
    if (radius == appliedRadius) return
    appliedRadius = radius
    node.setRenderEffect(if (BlurRules.hasEffect(radius)) RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP) else null)
  }

  private companion object {
    const val TAG = "SvelteBlur"
    const val SLOTS = 3
  }
}
