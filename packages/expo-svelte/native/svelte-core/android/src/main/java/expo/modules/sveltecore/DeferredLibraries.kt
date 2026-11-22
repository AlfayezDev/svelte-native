package expo.modules.sveltecore

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * The native libraries of the Nitro modules the library depends on (react-native-mmkv's `NitroMmkv`, react-native-quick-crypto's `QuickCrypto`),
 * loaded after the start instead of during it. The rules are in [DeferredLoadsCore]; this gives them the platform.
 *
 * Why: each of those packages loads its library in a static initializer, so React Native's `PackageList` loads both on the main thread
 * when the Application builds the host, right before React Native starts: 4.5 ms (QuickCrypto, OpenSSL inside) and 2.5 ms (NitroMmkv) of every
 * cold start on the Galaxy A16 (median of 13 traced starts), for libraries that the start does not use (`crypto` and `localStorage` are made on
 * their first read, `polyfills.ts`). The linker lets one load run at a time, so moving them to another thread during the start would only make
 * the start-up's own libraries wait (`BootBoost`): they load after it.
 *
 * How: `expo-svelte android-autolinking` (`src/autolinking.ts`), which `settings.gradle` runs around React Native's config command, links
 * [DeferredNitroPackage] in place of each package (its library is registered, not loaded) and [NitroGate] around Nitro's own package. Every use of
 * a Nitro module from JavaScript goes through Nitro's TurboModule (`NitroModules`, made on its first use), and the gate loads what is still pending
 * before that module is made: a Nitro module used early pays for its library then, as it did at the start. Otherwise the libraries load on a thread
 * of their own, [DeferredLoadsCore.DELAY_MS] after the first mount ([firstMount], `BootBoost.release`).
 */
object DeferredLibraries {
  private val core = DeferredLoadsCore(object : DeferredEnvironment {
    override fun load(name: String) = System.loadLibrary(name)
    override fun startThread(name: String, task: () -> Unit) {
      Thread(task, name).apply { isDaemon = true }.start()
    }
    override fun postToMain(delayMs: Long, task: () -> Unit) {
      Handler(Looper.getMainLooper()).postDelayed({ task() }, delayMs)
    }
    override fun warn(message: String, error: Throwable) {
      Log.w("SvelteCore", message, error)
    }
  })

  @JvmStatic fun register(name: String) = core.register(name)

  /** The first screen is being mounted (`BootBoost.release`): what is pending loads a little later, in the background. */
  @JvmStatic fun firstMount() = core.firstMount()

  /** Returns once every registered library is loaded; throws the error of one that could not be. */
  @JvmStatic fun awaitAll() = core.awaitAll()
}

/**
 * Linked in place of a Nitro module's own package (`expo-svelte android-autolinking`), which has no modules and exists to load the module's native
 * library: this one registers the library with [DeferredLibraries] instead.
 */
class DeferredNitroPackage(library: String) : BaseReactPackage() {
  init {
    DeferredLibraries.register(library)
  }

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { emptyMap() }
}

/**
 * Nitro's own package (react-native-nitro-modules' `NitroModulesPackage`, one TurboModule: `NitroModules`, which installs Nitro in the JavaScript
 * runtime), linked around by `expo-svelte android-autolinking`: the deferred libraries are loaded before the module is made, so the hybrid
 * objects they register are there when JavaScript first asks for one.
 */
class NitroGate(private val nitro: BaseReactPackage) : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    DeferredLibraries.awaitAll()
    return nitro.getModule(name, reactContext)
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = nitro.getReactModuleInfoProvider()
}
