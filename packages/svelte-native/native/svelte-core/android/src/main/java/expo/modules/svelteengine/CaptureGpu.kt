package expo.modules.svelteengine

import android.annotation.TargetApi
import android.graphics.Bitmap
import android.graphics.ColorSpace
import android.graphics.HardwareRenderer
import android.graphics.Outline
import android.graphics.PixelFormat
import android.graphics.RenderNode
import android.hardware.HardwareBuffer
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.util.Log
import android.view.View
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * One view drawn the way the screen draws it (API 29+): recorded into a [RenderNode] on the main thread, then rendered by a
 * [HardwareRenderer] into an [ImageReader] surface. A software `View.draw(Canvas)` loses what only the GPU path does: the
 * outline clip of a rounded view (`clipToOutline`: the engine's `overflow: hidden` with a radius, a rounded image), the shadow of
 * an elevated view, and a `TextureView` (Rive, a video in texture mode, Lottie in some modes), which draws nothing on a software
 * canvas.
 *
 * [start] runs on the main thread and does only the recording and the sync of the display lists with the render thread (the one
 * part that must not overlap a UI change); [bitmap] and [release] run anywhere else.
 *
 * Not for a tree with a `SurfaceView` in it ([Capture] draws those in software): a `SurfaceView` follows its position through a
 * `RenderNode.PositionUpdateListener` on its own node, so rendering that node into another surface would report the offscreen
 * frame's position to the live surface (and `positionLost` when this renderer goes away), moving or hiding it on screen.
 */
@TargetApi(Build.VERSION_CODES.Q)
internal class GpuFrame private constructor(
  private val node: RenderNode,
  private val renderer: HardwareRenderer,
  private val reader: ImageReader,
  private val available: CountDownLatch,
) {
  /** The finished frame as a bitmap of its own (ARGB_8888), or null when the render thread did not deliver it. */
  fun bitmap(timeoutMs: Long): Bitmap? {
    if (!available.await(timeoutMs, TimeUnit.MILLISECONDS)) {
      Log.w(TAG, "capture: the GPU frame did not arrive in $timeoutMs ms")
      return null
    }
    val image = reader.acquireNextImage() ?: return null
    try {
      // From API 33 the image carries the fence of the render thread's work; older releases wait for it when the image is acquired.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        image.fence.use { fence -> if (fence.isValid && !fence.await(Duration.ofMillis(FENCE_MS))) return null }
      }
      val buffer = image.hardwareBuffer ?: return null
      val hardware = Bitmap.wrapHardwareBuffer(buffer, ColorSpace.get(ColorSpace.Named.SRGB)) ?: return null
      try {
        return hardware.copy(Bitmap.Config.ARGB_8888, false)
      } finally {
        hardware.recycle()
      }
    } finally {
      image.close()
    }
  }

  /** Frees the renderer, the reader and the recorded display list; the bitmap from [bitmap] is the caller's. */
  fun release() {
    runCatching { renderer.destroy() }
    runCatching { reader.close() }
    runCatching { node.discardDisplayList() }
  }

  companion object {
    private const val TAG = "SvelteEngine"
    private const val FENCE_MS = 2000L

    // The window's light is the theme's (`ambientShadowAlpha` 0.039, `spotShadowAlpha` 0.19, the light 800 dp above and 200 dp
    // over the top edge): the theme's attributes are not public, so a shadow here is that look, not a copy of the window's.
    private const val AMBIENT_SHADOW_ALPHA = 0.039f
    private const val SPOT_SHADOW_ALPHA = 0.19f
    private const val LIGHT_Y_DP = -200f
    private const val LIGHT_Z_DP = 800f
    private const val LIGHT_RADIUS_DP = 800f

    /** Records [view] and asks the render thread for its frame, or answers null (nothing is left behind) when the platform cannot. Main thread. */
    fun start(view: View, width: Int, height: Int, callbacks: Handler): GpuFrame? {
      val node = RenderNode("svelte-capture")
      var renderer: HardwareRenderer? = null
      var reader: ImageReader? = null
      try {
        node.setPosition(0, 0, width, height)
        // The view's own outline clip belongs to the node that draws it in its parent, which `View.draw(Canvas)` leaves out.
        if (view.clipToOutline) {
          val outline = Outline()
          view.outlineProvider?.getOutline(view, outline)
          node.setOutline(if (outline.isEmpty) null else outline)
          node.setClipToOutline(true)
        }
        val canvas = node.beginRecording(width, height)
        try {
          view.draw(canvas)
        } finally {
          node.endRecording()
        }
        val usage = HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE or HardwareBuffer.USAGE_GPU_COLOR_OUTPUT
        val images = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 1, usage)
        reader = images
        val available = CountDownLatch(1)
        images.setOnImageAvailableListener({ available.countDown() }, callbacks)
        val density = view.resources.displayMetrics.density
        val rendering = HardwareRenderer()
        renderer = rendering
        rendering.setName("svelte-capture")
        rendering.setOpaque(false)
        rendering.setLightSourceAlpha(AMBIENT_SHADOW_ALPHA, SPOT_SHADOW_ALPHA)
        rendering.setLightSourceGeometry(width / 2f, LIGHT_Y_DP * density, LIGHT_Z_DP * density, LIGHT_RADIUS_DP * density)
        rendering.setContentRoot(node)
        rendering.setSurface(images.surface)
        val request = rendering.createRenderRequest()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) request.setWaitForPresent(true)
        val synced = request.syncAndDraw()
        if (synced != HardwareRenderer.SYNC_OK && synced != HardwareRenderer.SYNC_REDRAW_REQUESTED) {
          throw IllegalStateException("the render thread refused the frame (syncAndDraw answered $synced)")
        }
        return GpuFrame(node, rendering, images, available)
      } catch (error: Throwable) {
        Log.w(TAG, "capture: the GPU path failed, drawing in software", error)
        runCatching { renderer?.destroy() }
        runCatching { reader?.close() }
        runCatching { node.discardDisplayList() }
        return null
      }
    }
  }
}
