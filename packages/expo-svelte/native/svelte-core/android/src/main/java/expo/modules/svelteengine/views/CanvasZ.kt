package expo.modules.svelteengine.views

import android.annotation.SuppressLint
import android.graphics.Canvas
import android.os.Build
import java.lang.reflect.Method

/**
 * `com.facebook.react.views.view.CanvasUtil.enableZ` (internal there): turns the canvas's Z ordering on for the draw of one child and off after it. A `ViewGroup` draws its
 * children in one chunk sorted by Z, so a sibling with an elevation is drawn over the siblings that come after it; React Native draws an elevated child in a chunk of its
 * own (`ReactViewGroup.drawChild`), which keeps the shadow and the order the siblings are in. API 29 has the calls; before it they are hidden barriers.
 */
internal object CanvasZ {
  private var reorder: Method? = null
  private var inorder: Method? = null
  private var fetched = false

  @SuppressLint("SoonBlockedPrivateApi", "PrivateApi", "DiscouragedPrivateApi")
  fun enable(canvas: Canvas, enable: Boolean) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      if (enable) canvas.enableZ() else canvas.disableZ()
      return
    }
    if (!fetched) {
      fetched = true
      try {
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.P) {
          // Double reflection, to keep the grey-listed lookup out of the way on P.
          val lookup = Class::class.java.getDeclaredMethod("getDeclaredMethod", String::class.java, arrayOfNulls<Class<*>>(0).javaClass)
          reorder = lookup.invoke(Canvas::class.java, "insertReorderBarrier", arrayOfNulls<Class<*>>(0)) as Method
          inorder = lookup.invoke(Canvas::class.java, "insertInorderBarrier", arrayOfNulls<Class<*>>(0)) as Method
        } else {
          reorder = Canvas::class.java.getDeclaredMethod("insertReorderBarrier")
          inorder = Canvas::class.java.getDeclaredMethod("insertInorderBarrier")
        }
        reorder?.isAccessible = true
        inorder?.isAccessible = true
      } catch (_: Throwable) {
        reorder = null
        inorder = null
      }
    }
    try {
      (if (enable) reorder else inorder)?.invoke(canvas)
    } catch (_: Throwable) {
    }
  }
}
