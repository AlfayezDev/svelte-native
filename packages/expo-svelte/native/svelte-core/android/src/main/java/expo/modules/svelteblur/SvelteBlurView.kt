package expo.modules.svelteblur

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Build
import android.view.ViewTreeObserver
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.svelteappearance.isNight

/**
 * The view of `BlurView` (`expo-svelte/foreign`): it blurs what is drawn behind it, and what a view draws inside it (a child of an Expo view is a child
 * of this one) comes above the blur. Props: `intensity` (0 to 100, see [BlurRules]) and `tint` (`default`, `light`, `dark`, `extraLight`, `regular`, `prominent`,
 * the `system...Material` names; the same strings as `expo-blur`, all of them mapped by [BlurRules.group]).
 *
 * On API 31 and up with a hardware accelerated canvas it shows the window's content behind it, blurred on the GPU ([Backdrop]: the content is drawn once per
 * frame into a small bitmap, the drawing of which stops at this view), under a translucent tint. Anywhere else (an older Android, a view drawn into a software
 * canvas such as a capture, or before the first picture) it is the tint alone, stronger because nothing is blurred.
 *
 * Draw order: the background and border the style gives (as an Expo view draws them), then the blur, then the tint, then the children. The padding box clip of an
 * Expo view (`overflow`, border radius) applies to the blur and the tint too. The component of the library puts this view behind a container of its own that
 * holds the children, so the container's rounded `overflow: hidden` clip rounds the blur and the children are the engine's views (they take touches).
 */
@SuppressLint("ViewConstructor")
class SvelteBlurView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  internal var intensity = BlurRules.DEFAULT_INTENSITY
    private set
  private var tint = BlurRules.DEFAULT_TINT

  /** True while [Backdrop] draws the window: this view is what the picture stops at, and draws nothing. */
  internal var snapshotting = false

  /** Whether the drawing of the window got as far as this view (the picture is only complete when it did). */
  internal var reached = false

  private val backdrop: Backdrop? = if (Build.VERSION.SDK_INT >= BlurRules.MIN_BLUR_SDK) Backdrop(this) else null
  private val paint = Paint()
  private var observer: ViewTreeObserver? = null
  private val preDraw = ViewTreeObserver.OnPreDrawListener {
    backdrop?.update()
    true
  }

  private val night: Boolean
    get() = isNight(resources)

  fun setIntensity(value: Double?) {
    val next = BlurRules.intensity(value)
    if (next == intensity) return
    intensity = next
    invalidate()
  }

  fun setTint(value: String?) {
    val next = value ?: BlurRules.DEFAULT_TINT
    if (next == tint) return
    tint = next
    invalidate()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (backdrop != null && observer == null) {
      observer = viewTreeObserver.also { it.addOnPreDrawListener(preDraw) }
    }
    invalidate()
  }

  override fun onDetachedFromWindow() {
    observer?.let { if (it.isAlive) it.removeOnPreDrawListener(preDraw) }
    observer = null
    backdrop?.release()
    super.onDetachedFromWindow()
  }

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    // The adaptive tints follow the night mode.
    invalidate()
  }

  override fun dispatchDraw(canvas: Canvas) {
    if (snapshotting) {
      // The window is being drawn into the backdrop and has come to this view: everything after it is above the blur and does not belong in the picture.
      reached = true
      (canvas as? BackdropCanvas)?.stop()
      return
    }
    clipToPaddingBox(canvas)
    val blurred = backdrop?.draw(canvas) == true
    val color = BlurRules.overlayColor(tint, intensity, night, blurred)
    if (color != 0) {
      paint.color = color
      canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
    }
    super.dispatchDraw(canvas)
  }
}
