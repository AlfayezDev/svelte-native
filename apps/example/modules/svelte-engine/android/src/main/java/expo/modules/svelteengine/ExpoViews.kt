package expo.modules.svelteengine

import com.facebook.react.ReactPackage
import com.facebook.react.ViewManagerOnDemandReactPackage
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.ViewManager
import expo.modules.adapters.react.FabricComponentsRegistry
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.DEFAULT_MODULE_VIEW
import expo.modules.kotlin.views.ViewManagerWrapperDelegate

/**
 * Views of Expo modules the host registers lazily (SPEC.md, "Foreign views", "What stays off the start"). Expo's own
 * `ModuleRegistryAdapter.createViewManagers` exports the views of every module in the registry when the host starts,
 * which builds each module's definition; a module that is still pending (`expo.modules.lazy`) has no view then. This class
 * does for one module what that call does for all of them, at the moment the first component of the module is mounted:
 * the module is built, its views' Fabric component descriptors are registered with the shared provider registry (a
 * Scheduler that already exists adds them to its own registry), and the module's view managers are served to React
 * Native's on-demand lookup through [ExpoViewsPackage].
 */
class ExpoViews(private val appContext: AppContext) {
  private val delegates = HashMap<String, ViewManagerWrapperDelegate>()
  private val managers = HashMap<String, ViewManager<*, *>>()
  // Kept alive for as long as the host: the C++ half is registered, but the hybrid object owns its native data.
  private val registrations = ArrayList<FabricComponentsRegistry>(1)

  /** Builds the module that owns the Fabric component [componentName] (`ViewManagerAdapter_<module>_<view>`) and registers its views. */
  @Synchronized
  fun prepare(componentName: String) {
    if (delegates.containsKey(componentName)) return
    val registry = appContext.registry
    // Module names may contain underscores themselves: the longest name that prefixes the component's is the owner.
    val owner = registry.moduleNames().filter { componentName == "$PREFIX$it" || componentName.startsWith("$PREFIX${it}_") }.maxByOrNull { it.length }
      ?: throw IllegalArgumentException("No Expo module owns the component $componentName")
    val holder = checkNotNull(registry.getModuleHolder(owner)) { "Expo module $owner could not be built" }
    val created = holder.definition.viewManagerDefinitions.map { (view, definition) ->
      ViewManagerWrapperDelegate(holder, definition, if (view == DEFAULT_MODULE_VIEW) holder.name else null)
    }
    registrations.add(FabricComponentsRegistry(created))
    for (delegate in created) delegates[delegate.viewManagerName] = delegate
    check(delegates.containsKey(componentName)) { "Expo module $owner has no view behind $componentName (it has ${created.map { it.viewManagerName }})" }
  }

  /** The view manager React Native's on-demand lookup asked for, or null when [prepare] has not run for its module. */
  @Synchronized
  fun manager(componentName: String): ViewManager<*, *>? {
    val delegate = delegates[componentName] ?: return null
    return managers.getOrPut(componentName) { delegate.toRNViewManager() }
  }

  companion object {
    private const val PREFIX = "ViewManagerAdapter_"

    /** The instance of the running engine; React Native creates [ExpoViewsPackage] before the engine module exists. */
    @Volatile
    @JvmStatic
    var current: ExpoViews? = null
  }
}

/** Serves the view managers of [ExpoViews] to React Native's on-demand lookup. Added to the host's package list by the Expo config plugin. */
@OptIn(UnstableReactNativeAPI::class)
class ExpoViewsPackage : ReactPackage, ViewManagerOnDemandReactPackage {
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()

  override fun getViewManagerNames(reactContext: ReactApplicationContext): Collection<String> = emptyList()

  override fun createViewManager(reactContext: ReactApplicationContext, viewManagerName: String): ViewManager<*, *>? =
    ExpoViews.current?.manager(viewManagerName)
}
