package expo.modules.svelteengine.views

import android.content.Context
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.drawable.Drawable
import android.graphics.drawable.RippleDrawable
import android.content.res.ColorStateList
import android.view.View
import android.widget.CompoundButton
import android.widget.Switch
import expo.modules.svelteengine.ViewEvents
import expo.modules.svelteengine.ViewProps

/**
 * Switch on the framework [Switch], following ReactSwitch: after a user toggle further user toggles are
 * ignored until JS answers with [setOn] (the `value` prop), and programmatic sets never fire `onChange`.
 */
@Suppress("DEPRECATION")
class EngineSwitch(context: Context) : Switch(context), EngineNode {
  override val node = NodeState()

  private var allowChange = true
  private var trackColorForFalse: Int? = null
  private var trackColorForTrue: Int? = null
  private var trackTint: Int? = null

  private val listener = CompoundButton.OnCheckedChangeListener { _, checked ->
    ViewEvents.switchChange(node.tag, checked)
  }

  init {
    showText = false
    setOnCheckedChangeListener(listener)
  }

  override fun setChecked(checked: Boolean) {
    if (allowChange && isChecked != checked) {
      allowChange = false
      super.setChecked(checked)
      applyTrackFor(checked)
    } else {
      // Still call super: it moves the thumb back to the correct edge after a rejected drag.
      super.setChecked(isChecked)
    }
  }

  /** Programmatic set from the `value` prop: no event, and the switch accepts user input again. */
  fun setOn(on: Boolean) {
    setOnCheckedChangeListener(null)
    if (isChecked != on) {
      super.setChecked(on)
      applyTrackFor(on)
    }
    allowChange = true
    setOnCheckedChangeListener(listener)
  }

  fun apply(v: ViewProps) {
    isEnabled = v.enabled
    trackColorForFalse = if (v.hasTrackFalse) v.trackFalse else null
    trackColorForTrue = if (v.hasTrackTrue) v.trackTrue else null
    trackTint = if (v.hasTrackTint) v.trackTint else null
    setOn(v.switchValue)
    setThumbColor(if (v.hasThumb) v.thumb else null)
    if (trackColorForFalse == null && trackColorForTrue == null) {
      setTrackColor(trackTint)
    } else {
      setTrackColor(if (isChecked) trackColorForTrue else trackColorForFalse)
    }
  }

  private fun applyTrackFor(checked: Boolean) {
    if (trackColorForTrue != null || trackColorForFalse != null) {
      setTrackColor(if (checked) trackColorForTrue else trackColorForFalse)
    }
  }

  private fun setColor(d: Drawable?, color: Int?) {
    if (d == null) return
    if (color == null) d.clearColorFilter() else d.colorFilter = PorterDuffColorFilter(color, PorterDuff.Mode.MULTIPLY)
  }

  private fun setTrackColor(color: Int?) = setColor(trackDrawable, color)

  private fun setThumbColor(color: Int?) {
    setColor(thumbDrawable, color)
    val bg = background
    if (color != null && bg is RippleDrawable) {
      bg.setColor(ColorStateList(arrayOf(intArrayOf(android.R.attr.state_pressed)), intArrayOf(color)))
    }
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    // Switch sizes its track from its own measure pass: run it, at the frame Yoga chose.
    super.onMeasure(
      View.MeasureSpec.makeMeasureSpec(node.w, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(node.h, View.MeasureSpec.EXACTLY),
    )
  }
}
