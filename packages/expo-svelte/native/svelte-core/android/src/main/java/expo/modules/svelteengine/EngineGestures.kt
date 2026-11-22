package expo.modules.svelteengine

import android.util.Log
import android.view.MotionEvent
import com.facebook.react.uimanager.ThemedReactContext
import com.swmansion.gesturehandler.react.RNGestureHandlerRootHelper
import expo.modules.svelteengine.views.EngineRoot
import expo.modules.svelteengine.views.GestureRoot

/**
 * The one place the engine names react-native-gesture-handler's root helper (SPEC.md, "Gestures", Android contract item 4;
 * the other, [expo.modules.svelteengine.views.EngineScroll], implements the library's `NativeViewGestureHandlerHook`). The
 * library is a `compileOnly` dependency of this module and is in every app that uses the engine's gestures; this object is
 * first used by `MountingManager.enableGestures`, so an app that never enables them loads none of it.
 */
internal object EngineGestures {
  /**
   * The root helper of [root]: it registers the root handler (tag `-root.id`) with the library's module, finds [root] as the
   * `RootView` above itself and hands the orchestrator the tree under it. [context] has to be a `ThemedReactContext`, which
   * the helper's teardown casts it to. Throws when the library's module is not registered with React Native (the package is
   * missing from the autolinked list).
   */
  fun install(context: ThemedReactContext, root: EngineRoot): GestureRoot {
    val helper = RNGestureHandlerRootHelper(context, root)
    Log.i("SvelteEngine", "gestures enabled")
    return HelperRoot(helper)
  }

  private class HelperRoot(private val helper: RNGestureHandlerRootHelper) : GestureRoot {
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean = helper.dispatchTouchEvent(ev)

    override fun requestDisallowInterceptTouchEvent() = helper.requestDisallowInterceptTouchEvent()

    override fun tearDown() = helper.tearDown()
  }
}
