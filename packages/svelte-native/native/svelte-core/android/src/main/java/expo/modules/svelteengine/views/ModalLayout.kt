package expo.modules.svelteengine.views

import kotlin.math.max

/**
 * The rules of the modal overlay layer that need no Android type, so the host test (`tests/native-host/modal.test.ts`) runs
 * them as they are: where the content sits, how the layer looks at a point of its animation, and what a show or a hide
 * asks the view to do.
 */
object ModalLayout {
  const val ANIMATION_NONE = 0
  const val ANIMATION_SLIDE = 1
  const val ANIMATION_FADE = 2

  /**
   * Left, top, right and bottom insets of the content frame inside the layer, px, into [out]. The inputs are what the
   * system covers of the layer (bars and cutout) and how far the keyboard reaches into it. React Native's rules: a
   * translucent status bar takes the top inset away, a translucent navigation bar takes all of them away (its window
   * then draws edge to edge), and the keyboard raises the bottom edge whatever the bars say.
   */
  fun contentInsets(
    barsLeft: Int, barsTop: Int, barsRight: Int, barsBottom: Int, keyboard: Int,
    statusBarTranslucent: Boolean, navigationBarTranslucent: Boolean, out: IntArray,
  ) {
    val edge = navigationBarTranslucent
    out[0] = if (edge) 0 else barsLeft
    out[1] = if (edge || statusBarTranslucent) 0 else barsTop
    out[2] = if (edge) 0 else barsRight
    out[3] = max(if (edge) 0 else barsBottom, keyboard)
  }

  /** Where the sheet of the modal is now: the layer's alpha, how far the content is pushed down (px) and the scrim's alpha. */
  class Pose {
    var layerAlpha = 1f
      private set
    var contentOffset = 0f
      private set
    var scrimAlpha = 0f
      private set

    /**
     * The look at [progress] (0 hidden, 1 shown): fade moves the whole layer's alpha (dim and content together), slide
     * moves the content from below the layer's bottom edge ([height]) while the dim fades in, none is always the shown
     * pose. [dim] is the scrim's alpha when shown; a transparent modal has no scrim, the caller hides the view.
     */
    fun at(progress: Float, animationType: Int, height: Float, dim: Float) {
      val p = progress.coerceIn(0f, 1f)
      when (animationType) {
        ANIMATION_FADE -> { layerAlpha = p; contentOffset = 0f; scrimAlpha = dim }
        ANIMATION_SLIDE -> { layerAlpha = 1f; contentOffset = (1f - p) * height; scrimAlpha = dim * p }
        else -> { layerAlpha = 1f; contentOffset = 0f; scrimAlpha = dim }
      }
    }
  }

  /** What the view does after a state change of [Phase]. */
  enum class Step {
    NOTHING,
    /** Add the layer to the root; start the enter animation (or show it at once). */
    ATTACH,
    /** The layer is still attached, leaving: bring it to the front and animate it back in. */
    RETURN,
    /** Animate out; remove the layer when the animation ends. */
    LEAVE,
    /** Remove the layer now and send `onDismiss`. */
    DETACH,
  }

  /**
   * Life of one modal layer. `visible` drives [show] and [hide]; the view reports the end of its animation with
   * [finished] (a cancelled animation reports nothing) and the deletion of the host with [drop].
   */
  class Phase {
    enum class State { HIDDEN, ENTERING, SHOWN, LEAVING }

    var state = State.HIDDEN
      private set

    /** The layer takes touches, the back key and accessibility focus: shown or on its way in. */
    val active: Boolean get() = state == State.ENTERING || state == State.SHOWN

    /** `visible` became true. [animated] is false for animation type none. */
    fun show(animated: Boolean): Step = when (state) {
      State.HIDDEN -> { state = if (animated) State.ENTERING else State.SHOWN; Step.ATTACH }
      State.LEAVING -> { state = if (animated) State.ENTERING else State.SHOWN; Step.RETURN }
      else -> Step.NOTHING
    }

    /** `visible` became false. */
    fun hide(animated: Boolean): Step = when (state) {
      State.ENTERING, State.SHOWN -> if (animated) { state = State.LEAVING; Step.LEAVE } else { state = State.HIDDEN; Step.DETACH }
      else -> Step.NOTHING
    }

    /** The running animation reached its end. */
    fun finished(): Step = when (state) {
      State.ENTERING -> { state = State.SHOWN; Step.NOTHING }
      State.LEAVING -> { state = State.HIDDEN; Step.DETACH }
      else -> Step.NOTHING
    }

    /** The host is gone: true when a layer has to come off at once (and nobody hears about it). */
    fun drop(): Boolean {
      val attached = state != State.HIDDEN
      state = State.HIDDEN
      return attached
    }
  }
}
