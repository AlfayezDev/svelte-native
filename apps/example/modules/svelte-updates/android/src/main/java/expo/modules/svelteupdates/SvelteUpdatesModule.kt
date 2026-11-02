package expo.modules.svelteupdates

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactApplication
import com.facebook.react.common.LifecycleState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * The native half of the updates API (`packages/svelte-native/src/updates`): the store and the launcher. The protocol (what to
 * ask the server, what counts as a newer update) runs in JavaScript; this module hands it the stored state, makes the requests
 * and downloads, and records the outcome. See the "Updates" section of `svelte-engine/SPEC.md` for the contract.
 */
class SvelteUpdatesModule : Module() {
  // Network and disk work stays off the JavaScript thread and off the shared module queue.
  private val workers = Executors.newFixedThreadPool(4)
  private val main = Handler(Looper.getMainLooper())

  private fun context(): Context = appContext.reactContext?.applicationContext ?: throw IllegalStateException("SvelteUpdates: no application context")
  private fun state(): LaunchState = Launch.get(context())
  private fun store(): UpdateStore = state().store ?: throw IllegalStateException("SvelteUpdates is not enabled in this build")

  private fun background(promise: Promise, work: () -> Any?) {
    workers.execute {
      try {
        promise.resolve(work())
      } catch (error: Throwable) {
        promise.reject("ERR_SVELTE_UPDATES", error.message ?: error.toString(), error)
      }
    }
  }

  private fun stringMap(json: JSONObject?): Map<String, String>? = json?.keys()?.asSequence()?.associateWith { json.get(it).toString() }

  override fun definition() = ModuleDefinition {
    Name("SvelteUpdates")

    OnDestroy { workers.shutdown() }

    Constant("isEnabled") { state().config.enabled }
    Constant("platform") { "android" }
    Constant("updateId") { state().updateId }
    Constant("runtimeVersion") { state().config.runtimeVersion }
    Constant("updateUrl") { state().config.updateUrl }
    Constant("requestHeaders") { state().config.requestHeaders }
    Constant("checkOnLaunch") { state().config.checkOnLaunch }
    Constant("launchWaitMs") { state().config.launchWaitMs }
    Constant("hasEmbeddedUpdate") { state().config.hasEmbeddedUpdate }
    Constant("isEmbeddedLaunch") { state().updateId == null }
    Constant("createdAt") { state().createdAt.toDouble() }
    Constant("localAssets") { state().localAssets }
    Constant("clientId") { state().clientId }

    // The manifest request: a GET with the given headers; any status is an answer.
    AsyncFunction("request") { url: String, headers: Map<String, String>, promise: Promise ->
      background(promise) {
        val response = Http.request(url, headers)
        mapOf("status" to response.status, "headers" to response.headers, "body" to response.body)
      }
    }

    // Downloads one asset of an update. The launch asset becomes the update's bundle; the rest join the shared asset directory.
    AsyncFunction("downloadAsset") { download: Map<String, Any?>, promise: Promise ->
      background(promise) {
        val store = store()
        val key = download["key"] as String
        val extension = download["extension"] as String
        val expected = download["hash"] as String
        require(Regex("[A-Za-z0-9._-]{1,128}").matches(key) && Regex("(\\.[A-Za-z0-9]{1,16})?").matches(extension)) { "Unsafe asset name: $key$extension" }
        val destination = if (download["launch"] == true) store.bundleDestination(download["updateId"] as String) else store.assetFile(key, extension)
        @Suppress("UNCHECKED_CAST")
        val headers = download["headers"] as Map<String, String>
        // An asset already in place is kept only if it hashes to the manifest's; one that does not is downloaded again (see `Http.ensure`).
        val hash = Http.ensure(download["url"] as String, headers, destination, expected, reuse = download["launch"] != true) { actual ->
          android.util.Log.w("SvelteUpdates", "Asset $key$extension in the store has SHA-256 $actual, not the manifest's $expected; downloading it again")
        }
        mapOf("key" to key, "hash" to hash)
      }
    }

    // Makes a fully downloaded update launchable on the next start.
    AsyncFunction("commitUpdate") { updateJson: String, promise: Promise ->
      background(promise) {
        val json = JSONObject(updateJson)
        val config = state().config
        val assets = json.getJSONArray("assets")
        store().commit(
          StoredUpdate(
            id = json.getString("id"),
            createdAt = json.getLong("createdAt"),
            runtimeVersion = json.getString("runtimeVersion"),
            status = "ready",
            metadata = json.getJSONObject("metadata"),
            url = config.updateUrl ?: "",
            headers = config.requestHeaders,
            launchAssetKey = json.getString("launchAssetKey"),
            assets = (0 until assets.length()).map { assets.getJSONObject(it).let { asset -> asset.getString("key") to asset.getString("extension") } },
          ),
        )
        null
      }
    }

    AsyncFunction("saveMetadata") { metadataJson: String, promise: Promise ->
      background(promise) {
        val json = JSONObject(metadataJson)
        store().saveMetadata(json.optJSONObject("serverDefinedHeaders"), json.optJSONObject("manifestFilters"))
        null
      }
    }

    AsyncFunction("readStore") { promise: Promise -> background(promise) { store().snapshot(BuildConfig.BUILD_TIME_MS) } }

    AsyncFunction("rollBackToEmbedded") { commitTime: Double, promise: Promise ->
      background(promise) { store().rollBackToEmbedded(commitTime.toLong()); null }
    }

    // The launch is confirmed (the host reached its first commit and stayed healthy for the window): the update did not fail, and clean-up can run.
    AsyncFunction("markLaunched") { promise: Promise ->
      background(promise) {
        val launched = state()
        val id = launched.updateId
        if (id != null) launched.store?.markLaunched(id)
        launched.store?.clean(launched.createdAt)
        null
      }
    }

    // Selects the launch bundle again (an update committed since the start now wins) and restarts the React host with it.
    AsyncFunction("reload") { promise: Promise ->
      background(promise) {
        val application = context() as? ReactApplication ?: throw IllegalStateException("SvelteUpdates: the application is not a ReactApplication")
        Launch.relaunch(context())
        val activity = appContext.currentActivity
        main.post {
          val host = application.reactHost ?: return@post
          if (host.lifecycleState != LifecycleState.RESUMED && activity != null) host.onHostResume(activity)
          host.reload("SvelteUpdates reload")
        }
        null
      }
    }
  }
}
