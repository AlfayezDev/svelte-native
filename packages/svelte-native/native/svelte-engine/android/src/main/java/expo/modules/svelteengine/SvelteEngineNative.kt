package expo.modules.svelteengine

import com.facebook.jni.HybridData
import com.facebook.proguard.annotations.DoNotStrip
import com.facebook.react.fabric.FabricUIManager

/** fbjni hybrid holder for the C++ side (shadow-tree delegate, emitter registry). */
@DoNotStrip
class SvelteEngineNative(fabricUIManager: FabricUIManager, mountingManager: MountingManager) {
  @DoNotStrip
  @Suppress("unused")
  private val mHybridData: HybridData = initHybrid(fabricUIManager, mountingManager)

  private external fun initHybrid(fabricUIManager: FabricUIManager, mountingManager: MountingManager): HybridData

  external fun install(fabricUIManager: FabricUIManager, reanimatedReady: Boolean)

  /**
   * All active pointers of one gesture; per-pointer arrays are read up to [count]. type: 0 start, 1 move, 2 end,
   * 3 cancel. [changedIndex] is the pressed/lifted pointer for start/end (-1 otherwise). [targets] are the tags fixed
   * at DOWN. Coordinates in points; page = root, local = target view.
   */
  external fun dispatchTouch(
    surfaceId: Int,
    type: Int,
    changedIndex: Int,
    count: Int,
    targets: IntArray,
    identifiers: IntArray,
    pageX: FloatArray,
    pageY: FloatArray,
    localX: FloatArray,
    localY: FloatArray,
    timestampMs: Double,
  )

  /** kind: 0 scroll, 1 beginDrag, 2 endDrag, 3 momentumBegin, 4 momentumEnd. Values in points; velocity in points/ms (end drag only). */
  external fun dispatchScroll(
    tag: Int,
    kind: Int,
    offsetX: Float,
    offsetY: Float,
    contentW: Float,
    contentH: Float,
    containerW: Float,
    containerH: Float,
    velocityX: Float,
    velocityY: Float,
  )

  /** Pushes a ScrollView's content offset (points) into its Fabric ScrollViewState. */
  external fun updateScrollState(tag: Int, offsetX: Float, offsetY: Float)
  /** An accessibility service's click on a clickable node (see A11y): the node emits `click`. */
  external fun dispatchClick(tag: Int)

  /** Reports a mounted transaction to Fabric so mount hooks (Reanimated's cleanup of removed nodes) run. */
  external fun reportMount(surfaceId: Int)
  // The Fabric host imported Reanimated after install; moves the engine's delegate behind Reanimated's proxy.
  external fun reanimatedLoaded()

  /** Foreign views (SPEC.md, "Foreign views"): a component name whose nodes React Native's Java mounting owns. */
  external fun registerForeign(name: String)

  /** Whether React Native's mounting owns [tag]: a foreign view, or something inside one. */
  external fun isForeign(tag: Int): Boolean

  /** How many nodes (foreign views and everything inside them) React Native's mounting owns now. */
  external fun foreignCount(): Int

  /** How many nodes the C++ delegate holds an event emitter for, and a ScrollView state for (a node that was deleted must be gone from both). */
  external fun emitterCount(): Int

  /** Whether the C++ delegate holds an event emitter for [tag]: a touch dispatched to a node without one is dropped. */
  external fun hasEmitter(tag: Int): Boolean
  external fun scrollStateCount(): Int

  companion object {
    init {
      System.loadLibrary("svelteengine")
    }
  }
}
