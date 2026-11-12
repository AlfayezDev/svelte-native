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
 * No work when nothing could show ([BlurRules.idleReason]): the view without a size, not shown, its window not visible, nothing of it on screen, intensity 0. While the
 * view or one of its ancestors has a layer (`setLayerType`: a screen held during a transition, the screen the stack keeps in a layer while it stands still,
 * `renderToHardwareTextureAndroid`) nothing is drawn either and the last picture stays: a software draw builds a layer's drawing cache on a canvas of its own, which
 * the drawing could neither stop at the view nor afford (a cache of the layer's size). A layer on a view that is not an ancestor is drawn into the picture as it is
 * (its cache is built once and stays until the view detaches).
 *
 * The pre-draw that finds a layer asks for a frame of its own, once ([BlurRules.asksForFrame]): a pre-draw only runs for a frame, a layer that a transition holds
 * goes when the transition ends (and the frame that makes comes with it), but the layer a screen keeps while it stands still goes only when something under the screen
 * is invalidated, and a screen at rest has no frames. Without the request a blur on a screen that has settled showed its stronger tint, with no blur, until something
 * else on the screen changed (in the lab it was the next prop the checks set, which is why a place with nothing else on it blurred, and a list row, which has a video
 * and an animation beside it, was judged before them). The view's own `invalidate` is that something, and the picture of the frame it makes is drawn and recorded even
 * when it equals the one on show ([BlurRules.shouldRecord]): the node was recorded before the layer.
 *
 * The request for a frame is made once in the first pre-draw under a layer, and that pre-draw is a frame of the transition that holds the layer, so it does not reach the layer the stack keeps on the
 * screen after the transition (the hold is handed over to it, and no frame follows on a screen at rest): the view looks again [BlurRules.QUIET_MS] after a pre-draw that found a layer ([quietCheck]), and
 * when no pre-draw went by in that time asks once more ([BlurRules.afterQuietWait]); while the window moves it waits again. A pushed screen with a blur and nothing else on it showed it: the blur stayed a tint.
 *
 * The node's display list is the renderer's to drop: a `RenderNode` that no display list refers to for a frame loses what it holds (its parent count goes to zero and the render thread
 * frees its content, `RenderNode.hasDisplayList()` answers false), and the view's own list refers to the node only while the view draws it ([draw]). A frame in which the view draws nothing
 * (intensity 0, which the lab sets between two readings) is such a frame; when the intensity comes back the picture behind the view is the same one as before, so it was not recorded again and
 * the node, empty, drew nothing: the tint of a blur over stripes that stayed sharp. [update] asks the node ([BlurRules.nodeLost]) and records the picture again when it is empty, whatever the
 * picture equals. A view that is attached again ([release]) records a first picture anyway, which is why only the list row of the lab showed it: the view of its inline and sheet places is taken out
 * of React Native's parent and attached again by the engine after its first frames, so its first picture at intensity 100 was a new one.
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
  private var effect: RenderEffect? = null

  /** The pre-draw has asked for a frame for the layer it is waiting on (see [BlurRules.asksForFrame]), and the node may hold a picture from before the layer. */
  private var asked = false
  private var stale = false

  /** Pre-draws that ran, counted so that the wait for a quiet window can tell whether any went by (it only compares, so it may wrap). */
  private var frames = 0

  /** The last pre-draw found a layer on the way up (and nothing before it that made it idle): the wait for a quiet window only goes on while it did. */
  private var underLayer = false

  /** [quietCheck] is posted, and the number of [frames] it was posted at. */
  private var waiting = false
  private var framesAtWait = 0

  /** The wait for a quiet window asked for its frame, for the layer that stands now (forgotten with [asked] when the reason is not a layer any more). */
  private var askedQuiet = false
  private val quiet = Runnable { quietCheck() }

  /** The node was found empty and the view asked for a frame to refer to it again, and it has not been found with its display list since (see [BlurRules.asksForFrameAfterLoss]). */
  private var askedAfterLoss = false

  /** What the last pre-draw that was noted did (`Idle.ordinal`, -1 for drawing) and how many were: a state change is one line of the log, a few per view, so that a device run says why a view drew what it drew. */
  private var noted = -2
  private var notes = 0

  /** Whether the node holds a picture of the backdrop. */
  var ready = false
    private set

  /** The view's pre-draw: draws the backdrop again when the frame is about to show something else than the last one. */
  fun update() {
    frames++
    val width = view.width
    val height = view.height
    val reason = BlurRules.idleReason(
      width, height, view.intensity, view.isShown, view.windowVisibility == View.VISIBLE,
      { view.getGlobalVisibleRect(visible) }, { view.rootView === view }, { layered() },
    )
    if (reason != null) {
      note(reason.ordinal)
      if (BlurRules.asksForFrame(reason, asked)) {
        asked = true
        stale = true
        view.invalidate()
      }
      underLayer = reason == BlurRules.Idle.LAYER
      if (underLayer) waitForQuiet() else {
        asked = false
        askedQuiet = false
      }
      return
    }
    asked = false
    askedQuiet = false
    underLayer = false
    val root = view.rootView
    var shape = picture
    if (shape == null || shape.width != width || shape.height != height) {
      shape = BlurRules.picture(width, height) ?: return
      picture = shape
      fit(shape)
    }
    applyEffect(shape)
    val lost = BlurRules.nodeLost(ready, node.hasDisplayList())
    if (!lost) askedAfterLoss = false

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
    note(if (view.reached) DRAWING else NOT_REACHED)
    if (!view.reached) return
    val last = bitmaps.getOrNull(current)
    if (!BlurRules.shouldRecord(last != null && last.sameAs(bitmap), stale, lost)) return
    stale = false
    current = next
    record(shape, bitmap)
    if (!ready) {
      ready = true
      logReady(shape, bitmap)
      // The view's display list was recorded without the node (or with the stronger tint of no blur): record it again, in this frame.
      view.invalidate()
    } else if (lost) {
      logLost()
      // The view's display list has to refer to the node again; the frame of the intensity that came back from 0 does that already, this is for the ones that did not.
      if (BlurRules.asksForFrameAfterLoss(lost, askedAfterLoss)) {
        askedAfterLoss = true
        view.invalidate()
      }
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
    view.removeCallbacks(quiet)
    waiting = false
    askedQuiet = false
    underLayer = false
    ready = false
    current = -1
    picture = null
    appliedRadius = -1f
    effect = null
    asked = false
    stale = false
    askedAfterLoss = false
    noted = -2
    failed = false
    capacityWidth = 0
    capacityHeight = 0
    bitmaps.fill(null)
    node.discardDisplayList()
  }

  /** Posts the look for a quiet window, once at a time: a view that found a layer looks again when [BlurRules.QUIET_MS] have passed (see [BlurRules.afterQuietWait]). */
  private fun waitForQuiet() {
    if (waiting || askedQuiet) return
    waiting = true
    framesAtWait = frames
    view.postDelayed(quiet, BlurRules.QUIET_MS)
  }

  private fun quietCheck() {
    waiting = false
    if (!view.isAttachedToWindow) return
    when (BlurRules.afterQuietWait(underLayer && layered(), frames != framesAtWait, askedQuiet)) {
      BlurRules.Quiet.WAIT -> waitForQuiet()
      BlurRules.Quiet.ASK -> {
        askedQuiet = true
        stale = true
        logQuiet()
        view.invalidate()
      }
      BlurRules.Quiet.STOP -> Unit
    }
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
    // The effect is the node's property and a recording is its content; they are put together again whenever the content is, so that what the node shows never depends on which of the two was made first.
    node.setRenderEffect(effect)
  }

  private fun applyEffect(shape: BlurRules.Picture) {
    // The nominal divisor, not the exact ratio, so that an animated size does not make an effect per frame.
    val radius = BlurRules.radius(view.intensity, view.resources.displayMetrics.density, 1f / shape.divisor)
    if (radius == appliedRadius) return
    appliedRadius = radius
    effect = if (BlurRules.hasEffect(radius)) RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP) else null
    node.setRenderEffect(effect)
  }

  /** One line of the log when what the pre-draws do changes (at most [MAX_NOTES] for a view): what a view was doing is in a device's log, not a guess from its pixels. */
  private fun note(state: Int) {
    if (state == noted) return
    noted = state
    if (notes++ >= MAX_NOTES) return
    val what = when (state) {
      DRAWING -> "draws its backdrop"
      NOT_REACHED -> "drew the window without reaching the view: the picture is left as it is"
      else -> "idle (${BlurRules.Idle.values()[state]})${if (state == BlurRules.Idle.LAYER.ordinal) ", under ${layerOwner()}" else ""}"
    }
    Log.i(TAG, "backdrop ${view.width}x${view.height} intensity ${view.intensity}: $what")
  }

  /** No frame came for a while under a layer and the view asked for one: one line of the log, within the view's [MAX_NOTES]. */
  private fun logQuiet() {
    if (notes++ >= MAX_NOTES) return
    Log.i(TAG, "backdrop ${view.width}x${view.height} intensity ${view.intensity}: under ${layerOwner()} with no frame for ${BlurRules.QUIET_MS} ms: asks for one")
  }

  /** The node lost its display list and the picture was recorded again: one line of the log, within the view's [MAX_NOTES]. */
  private fun logLost() {
    if (notes++ >= MAX_NOTES) return
    Log.i(TAG, "backdrop ${view.width}x${view.height} intensity ${view.intensity}: the node had lost its display list (no frame drew it for a while): recorded again")
  }

  /** The first view with a layer on the way up from the view, for the log. */
  private fun layerOwner(): String {
    var found: View? = view
    while (found != null) {
      if (found.layerType != View.LAYER_TYPE_NONE) return "${found.javaClass.simpleName} (layer type ${found.layerType})"
      found = found.parent as? View
    }
    return "no layer"
  }

  /** The first picture of a view: what it is (its size and radius, the opaque points of a 3 by 3 grid of it: nothing opaque is a window that drew nothing behind the view), once per attach. */
  private fun logReady(shape: BlurRules.Picture, bitmap: Bitmap) {
    if (notes >= MAX_NOTES) return
    notes++
    var opaque = 0
    for (row in 0 until 3) for (column in 0 until 3) {
      val x = ((column + 0.5f) * shape.pictureWidth / 3f).toInt().coerceIn(0, shape.pictureWidth - 1)
      val y = ((row + 0.5f) * shape.pictureHeight / 3f).toInt().coerceIn(0, shape.pictureHeight - 1)
      if (Color.alpha(bitmap.getPixel(x, y)) >= 250) opaque++
    }
    Log.i(TAG, "backdrop ready: view ${shape.width}x${shape.height}, picture ${shape.pictureWidth}x${shape.pictureHeight} (divisor ${shape.divisor}), blur radius $appliedRadius px, $opaque of 9 points opaque")
  }

  private companion object {
    const val TAG = "SvelteBlur"
    const val SLOTS = 3
    const val MAX_NOTES = 12
    const val DRAWING = -1
    const val NOT_REACHED = 100
  }
}
