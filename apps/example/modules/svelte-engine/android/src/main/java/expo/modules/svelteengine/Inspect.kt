package expo.modules.svelteengine

import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.TextView

/**
 * What the lab reads back from the platform's own view of a tag (SPEC.md, "Foreign views", "Device verification of the
 * libraries"): the class Android built, its size, where it is on the screen, whether it is attached and shown, the text it
 * holds, and the classes of the views inside it. A check that asks JavaScript whether a view exists answers what JavaScript
 * believes; this answers what the platform made.
 *
 * Works for a foreign view and everything inside one (React Native's view, found through the mounting manager) and for an
 * engine view (its own registry). Main thread only.
 */
object Inspect {
  private const val MAX_DESCENDANTS = 40
  private const val MAX_DEPTH = 6

  fun of(mm: MountingManager, tag: Int): Map<String, Any?>? {
    val react = mm.foreign.viewFor(tag)
    val view = react ?: mm.viewFor(tag) ?: return null
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    val inside = ArrayList<String>()
    val texts = ArrayList<String>()
    val surfaces = ArrayList<String>()
    collect(view, 0, inside, texts, surfaces, location)
    return mapOf(
      "owner" to if (react != null) "react" else "engine",
      "class" to view.javaClass.name,
      "width" to view.width,
      "height" to view.height,
      "x" to location[0],
      "y" to location[1],
      "attached" to view.isAttachedToWindow,
      "shown" to view.isShown,
      "visibility" to view.visibility,
      "alpha" to view.alpha.toDouble(),
      "density" to view.resources.displayMetrics.density.toDouble(),
      // Whether the parent lets the view draw outside its bounds (a view's own render node follows its parent's `clipChildren`): a shadow or a glow needs it.
      "parent" to ((view.parent as? ViewGroup)?.let { "${it.javaClass.simpleName} clipChildren=${it.clipChildren}" } ?: "none"),
      "text" to texts.joinToString("\n"),
      "views" to inside,
      "surfaces" to surfaces,
    )
  }

  /** The class and box of each view below [view] (depth first, in draw order of the children), its text, and its surfaces. */
  private fun collect(view: View, depth: Int, views: MutableList<String>, texts: MutableList<String>, surfaces: MutableList<String>, origin: IntArray) {
    ownText(view)?.let { if (it.isNotEmpty() && !texts.contains(it)) texts.add(it) }
    if (view is SurfaceView || view is TextureView) {
      val at = IntArray(2)
      view.getLocationOnScreen(at)
      surfaces.add("${view.javaClass.simpleName} ${view.width}x${view.height}@${at[0]},${at[1]} ${if (view.isShown) "shown" else "hidden"}")
    }
    if (view !is ViewGroup || depth >= MAX_DEPTH) return
    for (i in 0 until view.childCount) {
      val child = view.getChildAt(i)
      if (views.size < MAX_DESCENDANTS) views.add("${"  ".repeat(depth)}${child.javaClass.simpleName} ${child.width}x${child.height}${if (child is ViewGroup) " clip=${child.clipChildren}" else ""}")
      collect(child, depth + 1, views, texts, surfaces, origin)
    }
  }

  /** A text view's string, or what the view tells accessibility (a prepared-layout text view keeps its layout, not a `TextView`'s text). */
  private fun ownText(view: View): String? {
    if (view is TextView) return view.text?.toString()
    if (!view.javaClass.name.contains("Text")) return null
    val info = AccessibilityNodeInfo.obtain()
    try {
      view.onInitializeAccessibilityNodeInfo(info)
      return info.text?.toString()
    } finally {
      @Suppress("DEPRECATION")
      info.recycle()
    }
  }
}
