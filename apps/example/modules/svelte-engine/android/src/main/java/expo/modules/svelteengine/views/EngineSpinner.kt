package expo.modules.svelteengine.views

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.PorterDuff
import android.widget.ProgressBar
import expo.modules.svelteengine.ViewProps

/**
 * ActivityIndicator on a framework [ProgressBar] (component "AndroidProgressBar"). The style (Small,
 * Normal, Large, ...) picks the platform drawable and is fixed at creation like React Native's
 * ProgressBarContainerView; the frame comes from Yoga, which measured that same style.
 */
@Suppress("DEPRECATION")
class EngineSpinner(context: Context, styleCode: Int) : ProgressBar(context, null, styleAttr(styleCode)), EngineNode {
  override val node = NodeState()
  private var animating = true
  private var determinate = false

  init {
    isIndeterminate = true
  }

  fun apply(v: ViewProps) {
    if (v.hasSpinnerColor) {
      val tint = ColorStateList.valueOf(v.spinnerColor)
      indeterminateTintList = tint
      indeterminateTintMode = PorterDuff.Mode.SRC_IN
      progressTintList = tint
    } else {
      indeterminateTintList = null
      progressTintList = null
    }
    animating = v.animating
    determinate = !v.indeterminate && v.spinnerStyle == 3
    if (determinate) {
      isIndeterminate = false
      progress = (v.progress * max).toInt()
    } else if (!isIndeterminate) {
      isIndeterminate = true
    }
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    // `animating = false` hides the indicator (React Native: ProgressBarContainerView).
    if (animating) super.onDraw(canvas)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(node.w, node.h)
  }

  companion object {
    fun styleAttr(code: Int): Int = when (code) {
      1 -> android.R.attr.progressBarStyleSmall
      2 -> android.R.attr.progressBarStyleLarge
      3 -> android.R.attr.progressBarStyleHorizontal
      4 -> android.R.attr.progressBarStyleInverse
      5 -> android.R.attr.progressBarStyleSmallInverse
      6 -> android.R.attr.progressBarStyleLargeInverse
      else -> android.R.attr.progressBarStyle
    }
  }
}
