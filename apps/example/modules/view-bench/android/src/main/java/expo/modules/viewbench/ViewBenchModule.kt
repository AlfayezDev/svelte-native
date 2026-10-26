package expo.modules.viewbench

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.widget.AppCompatTextView
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Lab-only: the platform floor for building a list row (a padded rounded View holding a TextView)
 * with plain Android widgets, so React Native's per-view cost can be compared against it.
 */
class ViewBenchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ViewBench")
    AsyncFunction("run") { count: Int, appCompat: Boolean, widthPx: Int ->
      val context = appContext.reactContext ?: throw IllegalStateException("no context")
      val density = context.resources.displayMetrics.density
      val container = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
      val rows = ArrayList<View>(count)
      val t0 = System.nanoTime()
      for (i in 0 until count) {
        val row = FrameLayout(context)
        row.setPadding((10 * density).toInt(), (10 * density).toInt(), (10 * density).toInt(), (10 * density).toInt())
        row.background = GradientDrawable().apply { cornerRadius = 8 * density; setColor(Color.WHITE) }
        val text = if (appCompat) AppCompatTextView(context) else TextView(context)
        text.text = "Row ${i + 1}"
        text.textSize = 14f
        text.setTextColor(Color.parseColor("#191b1e"))
        row.addView(text, ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        rows.add(row)
      }
      val t1 = System.nanoTime()
      for (row in rows) container.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = (6 * density).toInt() })
      val t2 = System.nanoTime()
      container.measure(View.MeasureSpec.makeMeasureSpec(widthPx, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
      val t3 = System.nanoTime()
      container.layout(0, 0, container.measuredWidth, container.measuredHeight)
      val t4 = System.nanoTime()
      mapOf(
        "count" to count,
        "appCompat" to appCompat,
        "constructMs" to (t1 - t0) / 1e6,
        "addMs" to (t2 - t1) / 1e6,
        "measureMs" to (t3 - t2) / 1e6,
        "layoutMs" to (t4 - t3) / 1e6,
        "totalMs" to (t4 - t0) / 1e6,
        "heightPx" to container.measuredHeight
      )
    }.runOnQueue(Queues.MAIN)
  }
}
