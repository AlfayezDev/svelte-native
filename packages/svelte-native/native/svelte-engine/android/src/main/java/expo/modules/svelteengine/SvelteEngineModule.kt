package expo.modules.svelteengine

import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import android.os.Trace
import android.view.ViewGroup
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.fabric.FabricUIManager
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.svelteengine.views.EngineInput
import expo.modules.svelteengine.views.EngineRoot

class SvelteEngineModule : Module() {
  private var native: SvelteEngineNative? = null
  private var mountingManager: MountingManager? = null
  private var insets: Insets? = null

  override fun definition() = ModuleDefinition {
    Name("SvelteEngine")

    Events("insets")

    OnCreate { appContext.reactContext?.let { Capture.deleteLeftovers(listOf(it.cacheDir, it.externalCacheDir)) } }

    OnDestroy { setAnimatedUpdater(null); AnimatedBridge.uninstall(); EngineInput.discardSpare(); Capture.deleteTemporaryFiles(); onMain { insets?.uninstall(); mountingManager?.foreign?.uninstall(); mountingManager?.disableGestures() } }

    Function("install") { reanimatedReady: Boolean? ->
      if (native != null) return@Function true
      val reactContext = appContext.reactContext as? ReactApplicationContext
        ?: throw IllegalStateException("SvelteEngine: no ReactApplicationContext")
      // Lab switches (`LabSwitches`): the QA app and debuggable builds read the launch intent, a release build never does.
      // `am start ... --ez svelteEngine false` runs the same build on React Native's own mounting layer; `--ez svelteGestures true`
      // (or a link with `?gestures=1`) installs the gesture handler root at start, as the first gesture would, so the lab and
      // the parity suites can measure the engine with it in place.
      val launch = (appContext.currentActivity ?: reactContext.currentActivity)?.intent
      val lab = LabSwitches.read(
        reactContext.packageName,
        (reactContext.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0,
        engineExtra = { launch?.takeIf { it.hasExtra("svelteEngine") }?.getBooleanExtra("svelteEngine", true) },
        gesturesExtra = { launch?.getBooleanExtra("svelteGestures", false) },
        query = { name -> launch?.data?.takeIf { it.isHierarchical }?.getQueryParameter(name) },
      )
      if (!lab.engineEnabled) {
        android.util.Log.i("SvelteEngine", "disabled by intent extra; React Native mounting stays active")
        return@Function false
      }
      val fabric = UIManagerHelper.getUIManager(reactContext, UIManagerType.FABRIC) as? FabricUIManager
        ?: throw IllegalStateException("SvelteEngine: no FabricUIManager")
      val manager = MountingManager(reactContext, lab)
      val engine = SvelteEngineNative(fabric, manager)
      manager.attach(engine)
      ExpoViews.current = ExpoViews(appContext)
      manager.foreign.install(fabric) // the listener list is thread safe; installed before any foreign component can register
      manager.events.install(fabric)
      engine.install(fabric, reanimatedReady == true)
      mountingManager = manager
      native = engine
      installAnimatedHook(manager)
      attachRoot(reactContext, manager.root)
      // A recreated Activity (a font-scale change, a locale change) gets a new content view: the overlay moves to it. React
      // Native's listener, not an Expo lifecycle hook: the module is registered lazily, after the hooks are collected.
      reactContext.addLifecycleEventListener(object : LifecycleEventListener {
        override fun onHostResume() { attachRoot(reactContext, manager.root) }
        override fun onHostPause() {}
        override fun onHostDestroy() {}
      })
      onMain {
        val tracker = Insets(manager.root) { sendEvent("insets", it) }
        insets = tracker
        tracker.install()
        if (lab.gesturesAtStart) manager.enableGestures()
      }
      true
    }

    // Installs react-native-gesture-handler's root helper on the overlay (SPEC.md, "Gestures", Android contract item 4):
    // called by the gesture host before its first `attachGestureHandler`, so an app that never uses a gesture loads none of
    // the library. True once installed (also when it already was); false when the library is not in the app or the engine is
    // not installed. Throws when the library's module is not registered with React Native, or when the main thread did not
    // answer within 5 s (the install still runs when it gets to it, and a second call finds it done).
    Function("enableGestures") {
      val manager = mountingManager ?: return@Function false
      onMainBlocking(5000) { manager.enableGestures() }
        ?: throw IllegalStateException("SvelteEngine.enableGestures: the main thread did not answer within 5 s")
    }

    // Called once by the Fabric host when it loads Reanimated lazily (SPEC.md, "Animation": delegate order). Its library
    // is loaded now, so the typed animated path (SPEC.md, "Animated write path") can register with it.
    Function("reanimatedLoaded") { native?.reanimatedLoaded(); AnimatedBridge.attach() }

    // A commit attached many animated nodes at once: the engine puts the main thread and the RenderThread on the big cores for the
    // message Worklets takes to register them and the frames that draw them (`MountingManager.animatedBatch`). No effect on when or
    // how any animation starts.
    Function("animatedBatch") { mountingManager?.animatedBatch() }

    // The commits JavaScript makes next belong together (a layout read needs one, the first frames of an animation are the next): the engine applies them in one message, so no
    // frame shows the first alone (`MountingManager.holdMounts`, SPEC.md "Transaction order"). Released by `releaseMounts`, or by itself after 100 ms.
    Function("holdMounts") { mountingManager?.holdMounts() }
    Function("releaseMounts") { mountingManager?.releaseMounts() }

    // The root router's navigation state as JSON, after every change (SPEC.md, "Navigation state across recreation and process
    // death"); MainActivity keeps it in the Activity's saved instance state. `finishing` is read when a surface stops: true when the
    // Activity is going away for good, so the next start does not adopt the state.
    Function("saveNavigation") { json: String? -> NavigationState.save(json) }
    Function("finishing") { NavigationState.finishing }

    // Safe-area and keyboard insets of the overlay (SPEC.md, "Insets and keyboard"); null before the overlay has a window.
    Function("getInsets") { onMainBlocking { insets?.read() } }

    // Commands for engine tags. Fire-and-forget on the main thread, queued behind mounting batches already posted.
    Function("dispatchCommand") { tag: Int, name: String, args: List<Any?> ->
      val manager = mountingManager ?: return@Function false
      onMain { Commands.dispatch(manager, tag, name, args) }
      true
    }

    Function("setNativeProps") { tag: Int, props: Map<String, Any?> ->
      val manager = mountingManager ?: return@Function false
      onMain { Commands.setNativeProps(manager, tag, props) }
      true
    }

    // Microbenchmark for the Reanimated fast path: applies {opacity, transform: [{translateX}]} `iterations` times on
    // the main thread (values alternate so every call changes something) and returns microseconds per call, -1 when
    // the tag is unknown.
    Function("benchAnimated") { tag: Int, iterations: Int ->
      val manager = mountingManager ?: return@Function -1.0
      val n = iterations.coerceAtLeast(1)
      val a = JavaOnlyMap.of("opacity", 0.5, "transform", JavaOnlyArray.of(JavaOnlyMap.of("translateX", 10.0)))
      val b = JavaOnlyMap.of("opacity", 1.0, "transform", JavaOnlyArray.of(JavaOnlyMap.of("translateX", 20.0)))
      var result = -1.0
      val run = Runnable {
        if (manager.viewFor(tag) != null) {
          for (i in 0 until 200) manager.applyAnimated(tag, if (i and 1 == 0) a else b)
          val t0 = System.nanoTime()
          for (i in 0 until n) manager.applyAnimated(tag, if (i and 1 == 0) a else b)
          result = (System.nanoTime() - t0) / 1000.0 / n
        }
      }
      if (Looper.myLooper() == Looper.getMainLooper()) {
        run.run()
      } else {
        val latch = java.util.concurrent.CountDownLatch(1)
        mainHandler.post { try { run.run() } finally { latch.countDown() } }
        latch.await(30, java.util.concurrent.TimeUnit.SECONDS)
      }
      result
    }

    // Foreign views (SPEC.md, "Foreign views"). The Fabric host names a component whose nodes React Native's own mounting
    // creates before it commits the first node of it; false while the engine is not installed (React Native then mounts
    // everything).
    Function("registerForeign") { name: String ->
      val engine = native ?: return@Function false
      // An Expo module's view (`ViewManagerAdapter_<module>_<view>`) belongs to a module the host built lazily: it is built,
      // and its Fabric components registered, before the first node of it is created.
      if (name.startsWith("ViewManagerAdapter_")) ExpoViews.current?.prepare(name)
      engine.registerForeign(name)
      true
    }

    // Counts for the lab: frames, frames still waiting for their view, the views React Native created that are still
    // reachable (after a full collection when asked), how views were adopted; null while the main thread is busy for over
    // 500 ms or before install.
    Function("foreignStats") { collect: Boolean? -> onMainBlocking { mountingManager?.foreign?.stats(collect == true)?.plus("nodes" to (native?.foreignCount() ?: 0)) } }

    // What the platform made of a tag (class, size, screen position, attached, shown, text, inner views and surfaces), for the lab's checks
    // of the native-view libraries (`Inspect`); null for an unknown tag or while the main thread is busy.
    Function("inspect") { tag: Int ->
      requireLab("inspect")
      onMainBlocking { mountingManager?.let { Inspect.of(it, tag) } }
    }

    // A tap at (x, y) dp of the overlay through EngineRoot.dispatchTouchEvent, for the lab (it cannot press the screen).
    Function("tap") { x: Double, y: Double ->
      requireLab("tap")
      val manager = mountingManager ?: return@Function false
      onMain { ForeignViews.tap(manager.root, x.toFloat(), y.toFloat()) }
      true
    }

    // A drag through EngineRoot.dispatchTouchEvent, for the lab: from (x0, y0) to (x1, y1) dp over durationMs.
    Function("drag") { x0: Double, y0: Double, x1: Double, y1: Double, durationMs: Int ->
      requireLab("drag")
      val manager = mountingManager ?: return@Function false
      onMain { ForeignViews.drag(manager.root, x0.toFloat(), y0.toFloat(), x1.toFloat(), y1.toFloat(), durationMs.toLong(), 12) }
      true
    }

    // A full Java collection with its finalizers, for the soak runner's idle windows: a dead view, text layout or render node
    // keeps the native memory behind it (display lists, glyph runs) until its Java object is collected, so a window taken
    // between two collections counts garbage as growth.
    Function("collectJava") {
      System.gc()
      @Suppress("DEPRECATION")
      Runtime.getRuntime().runFinalization()
      System.gc()
      true
    }

    // Hermes' sampling profiler on the running JavaScript runtime, for the lab: `true` starts it, `false` stops it and writes the
    // trace (Chrome's .cpuprofile) to the app's external files directory, which `adb pull` can read on a release build. Returns the
    // path, or null when the profiler is not in this build.
    Function("profileJs") { start: Boolean ->
      requireLab("profileJs")
      try {
        if (start) {
          com.facebook.hermes.instrumentation.HermesSamplingProfiler.enable()
          null
        } else {
          com.facebook.hermes.instrumentation.HermesSamplingProfiler.disable()
          val directory = appContext.reactContext?.getExternalFilesDir(null) ?: return@Function null
          val path = java.io.File(directory, "hermes.cpuprofile").path
          com.facebook.hermes.instrumentation.HermesSamplingProfiler.dumpSampledTraceToFile(path)
          path
        }
      } catch (error: Throwable) {
        android.util.Log.w("SvelteEngine", "Hermes sampling profiler: ${error.javaClass.simpleName} ${error.message}")
        null
      }
    }

    // Live counts for the soak runner (MountingManager.stats); null while the main thread is busy for over 500 ms or before install.
    Function("stats") { onMainBlocking { mountingManager?.stats() } }
    // Accessibility lab (`/__dev/a11y`, A11yDump.kt): the node info the views with a testID publish, and an action performed the way a service does.
    Function("accessibilityNodes") {
      requireLab("accessibilityNodes")
      onMainBlocking { mountingManager?.root?.let { A11yDump.nodes(it) } }
    }
    Function("performAccessibilityAction") { testID: String, name: String ->
      requireLab("performAccessibilityAction")
      onMainBlocking { mountingManager?.root?.let { A11yDump.perform(it, testID, name) } }
    }

    // `react-native-view-shot` for engine views (Capture.kt): the library's own module resolves a tag through React Native's mounting
    // manager, which has no engine view. Resolves with the image's URI or data, or null for a tag that is not an engine view of its
    // own (the JavaScript side then asks the library's module).
    AsyncFunction("captureView") { tag: Int, options: Map<String, Any?>, promise: Promise ->
      val manager = mountingManager
      if (manager == null) promise.resolve(null) else Capture.capture(manager, tag, options, promise)
    }

    // Synchronous: waits (up to 500 ms) for the main thread. null when the tag is unknown or the engine is not installed.
    Function("measure") { tag: Int ->
      val manager = mountingManager ?: return@Function null
      onMainBlocking { Commands.measure(manager, tag) }
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())

  /**
   * The hooks of the lab that read what a view holds (`inspect`: the text of any view, a password field's included; `accessibilityNodes`: what a service would read of the
   * tree), press the screen or perform an action (`tap`, `drag`, `performAccessibilityAction`) or write a profile to the app's files (`profileJs`) answer the QA app and
   * debuggable builds only (`LabSwitches.allowed`, the rule that lets the lab read the launch intent): a product build has the module and not these.
   * `qa/test/product-modules.test.ts` scans this file for every function and sees each is the product's or starts with this check.
   */
  private fun requireLab(hook: String) {
    val context = appContext.reactContext
    val debuggable = context != null && (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    if (context == null || !LabSwitches.allowed(context.packageName, debuggable))
      throw CodedException("ERR_LAB_ONLY", "SvelteEngine.$hook is a hook of the lab: the QA app (${LabSwitches.QA_PACKAGE}) and debuggable builds only", null)
  }

  // Reanimated is a soft dependency: its patched NativeProxy exposes `SvelteEngineHook.updater` and a native sink
  // (patches/react-native-reanimated@4.5.1.patch). Without the patch or the library both are no-ops. The sink takes the
  // per-frame writes of engine views as flat records (AnimatedBridge); the updater receives what it does not cover, as
  // the maps Reanimated builds, in the `SvelteEngine.applyAnimated` trace slice.
  private fun installAnimatedHook(manager: MountingManager) {
    setAnimatedUpdater { tag, props ->
      Trace.beginSection("SvelteEngine.applyAnimated")
      try {
        manager.applyAnimated(tag, props)
      } finally {
        Trace.endSection()
      }
    }
    AnimatedBridge.install(manager)
  }

  private fun setAnimatedUpdater(updater: ((Int, ReadableMap) -> Boolean)?) {
    try {
      Class.forName("com.swmansion.reanimated.SvelteEngineHook")
        .getMethod("setUpdater", Function2::class.java)
        .invoke(null, updater)
      android.util.Log.i("SvelteEngine", "Reanimated hook ${if (updater == null) "cleared" else "installed"}")
    } catch (e: ReflectiveOperationException) {
      android.util.Log.i("SvelteEngine", "Reanimated hook not available: ${e.javaClass.simpleName}")
    }
  }

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else mainHandler.post(block)
  }

  private fun <T> onMainBlocking(waitMs: Long = 500, block: () -> T?): T? {
    if (Looper.myLooper() == Looper.getMainLooper()) return block()
    val latch = java.util.concurrent.CountDownLatch(1)
    var result: T? = null
    mainHandler.post {
      try { result = block() } finally { latch.countDown() }
    }
    return if (latch.await(waitMs, java.util.concurrent.TimeUnit.MILLISECONDS)) result else null
  }

  private fun attachRoot(reactContext: ReactApplicationContext, root: EngineRoot) {
    val attach = Runnable {
      val activity = appContext.currentActivity ?: reactContext.currentActivity
      val content = activity?.findViewById<ViewGroup>(android.R.id.content)
      if (content == null) {
        android.util.Log.w("SvelteEngine", "no activity content view, overlay not attached")
        return@Runnable
      }
      val parent = root.parent as? ViewGroup
      if (parent === content) return@Runnable
      // The previous Activity's content view (it was recreated): the overlay and its views leave it.
      parent?.removeView(root)
      content.addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
      if (parent != null) android.util.Log.i("SvelteEngine", "overlay moved to the recreated Activity")
    }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      attach.run()
    } else {
      Handler(Looper.getMainLooper()).post(attach)
    }
  }
}
