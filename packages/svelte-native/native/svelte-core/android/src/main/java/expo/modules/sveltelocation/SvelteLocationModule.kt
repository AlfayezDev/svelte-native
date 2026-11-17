package expo.modules.sveltelocation

import android.Manifest
import android.content.Context
import android.util.Log
import expo.modules.interfaces.permissions.PermissionsResponse
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val LOG_TAG = "SvelteLocation"

/** The two events of the contract (`NativeLocationEvents` in `src/geolocation.ts`). */
private const val EVENT_CHANGED = "locationChanged"
private const val EVENT_ERROR = "locationError"

/** The permissions of the capability, as the config plugin writes them (`locationAndroidPermissions` in `src/capabilities.ts`). */
private val PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

/**
 * The module behind `navigator.geolocation` and `navigator.permissions` (`src/geolocation.ts`; the contract is SPEC.md's "Location"): the permission, the current position, the last known one, and
 * watches by the id JavaScript gives them, with the events `locationChanged` and `locationError`. It is a thin skin: which provider answers, the payloads and the registry of watches are plain Kotlin
 * (`LocationRules`, `LocationFix`, `LocationWatches`, checked on the host), and the platform's `LocationManager` is `LocationSource`'s.
 *
 * The module is in every app, since it is part of svelte-core, and `enabled` (a constant) says whether location is on in this build: the config plugin turns it on with `capabilities.location`
 * (`LocationManifest.enabled`, the meta-data `expo.modules.sveltelocation.enabled`) and adds the permissions with it. Off, the module starts nothing and asks the system nothing; every call
 * rejects with `ERR_LOCATION_DISABLED`. JavaScript does not call any of them (it reads `enabled`).
 *
 * `OnDestroy` ends every watch and every position that is still awaited, so that nothing keeps the GPS on for a JavaScript that is gone.
 */
class SvelteLocationModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  /** Made on the first call that needs it, once location is known to be on. */
  private var source: LocationSource? = null

  /** Whether location is on in this build. Not cached here: without a context it is false, and a later call asks again (`LocationManifest` caches the answer it could read). */
  private fun isEnabled(): Boolean {
    val application = appContext.reactContext?.applicationContext ?: return false
    return LocationManifest.enabled(application)
  }

  @Synchronized
  private fun source(): LocationSource = source ?: LocationSource(context).also { source = it }

  /** Runs [action] when location is on, and rejects [promise] with `ERR_LOCATION_DISABLED` when it is off. */
  private inline fun whenEnabled(promise: Promise, action: () -> Unit) {
    if (!isEnabled()) {
      reject(promise, LocationFailures.disabled)
      return
    }
    action()
  }

  private fun reject(promise: Promise, failure: LocationFailure) = promise.reject(failure.code, failure.message, null)

  override fun definition() = ModuleDefinition {
    Name("SvelteLocation")

    // Whether location is on in this build (the config plugin's `capabilities.location`): the one thing JavaScript may ask of an app that has none.
    Constant("enabled") { isEnabled() }

    Events(EVENT_CHANGED, EVENT_ERROR)

    OnDestroy {
      synchronized(this@SvelteLocationModule) {
        this@SvelteLocationModule.source?.stopAll()
        this@SvelteLocationModule.source = null
      }
    }

    // The state without asking.
    AsyncFunction("permission") { promise: Promise -> whenEnabled(promise) { readPermission(promise) } }

    // Asked from the main thread: the question is a dialog of the current Activity.
    AsyncFunction("requestPermission") { promise: Promise -> whenEnabled(promise) { requestPermission(promise) } }.runOnQueue(Queues.MAIN)

    AsyncFunction("currentPosition") { options: Map<String, Any?>, promise: Promise -> whenEnabled(promise) { currentPosition(options, promise) } }

    AsyncFunction("lastKnownPosition") { options: Map<String, Any?>, promise: Promise -> whenEnabled(promise) { lastKnownPosition(options, promise) } }

    AsyncFunction("startWatch") { watchId: Int, options: Map<String, Any?>, promise: Promise -> whenEnabled(promise) { startWatch(watchId, options, promise) } }

    AsyncFunction("stopWatch") { watchId: Int, promise: Promise ->
      whenEnabled(promise) {
        source().stopWatch(watchId)
        promise.resolve()
      }
    }
  }

  /** `granted` when either Android permission is (the approximate one gives positions too), see `LocationRules.permission`. Never asks. */
  private fun readPermission(promise: Promise) {
    val permissions = appContext.permissions
    if (permissions == null) {
      reject(promise, LocationFailures.permissions("Expo's permissions module is not linked, so the location permission cannot be read"))
      return
    }
    permissions.getPermissions({ result -> promise.resolve(stateOf(result).toMap()) }, *PERMISSIONS)
  }

  private fun requestPermission(promise: Promise) {
    val permissions = appContext.permissions
    if (permissions == null) {
      reject(promise, LocationFailures.permissions("Expo's permissions module is not linked, so the location permission cannot be asked for"))
      return
    }
    if (appContext.currentActivity == null) {
      // Expo's service answers "denied" for every permission when there is no Activity, and records the permission as blocked for good; so it is not asked.
      Log.w(LOG_TAG, "there is no Activity to ask for the location permission from: the state is read, not asked")
      readPermission(promise)
      return
    }
    try {
      permissions.askForPermissions({ result -> promise.resolve(stateOf(result).toMap()) }, *PERMISSIONS)
    } catch (error: IllegalStateException) {
      reject(promise, LocationFailures.permissions("the location permission could not be asked for: ${error.message}"))
    }
  }

  private fun stateOf(result: Map<String, PermissionsResponse>): LocationPermission =
    LocationRules.permission(PERMISSIONS.mapNotNull { result[it] }.map { PermissionAnswer(it.status.status, it.canAskAgain) })

  private fun currentPosition(options: Map<String, Any?>, promise: Promise) {
    val accuracy = LocationRules.accuracyOf(options)
    if (accuracy == null) {
      reject(promise, LocationFailures.arguments("currentPosition takes { accuracy: \"balanced\" | \"high\" }"))
      return
    }
    source().current(accuracy) { fix, failure ->
      if (fix != null) promise.resolve(fix.toMap()) else reject(promise, failure ?: LocationFailures.noProvider)
    }
  }

  private fun lastKnownPosition(options: Map<String, Any?>, promise: Promise) {
    val source = source()
    if (!source.permitted()) {
      reject(promise, LocationFailures.unauthorized)
      return
    }
    promise.resolve(source.lastKnown(LocationRules.maxAgeOf(options))?.toMap())
  }

  private fun startWatch(watchId: Int, options: Map<String, Any?>, promise: Promise) {
    val accuracy = LocationRules.accuracyOf(options)
    if (accuracy == null) {
      reject(promise, LocationFailures.arguments("startWatch takes { accuracy: \"balanced\" | \"high\", distanceInterval?: meters }"))
      return
    }
    val failure = source().startWatch(
      watchId,
      accuracy,
      LocationRules.distanceOf(options),
      onFix = { fix -> sendEvent(EVENT_CHANGED, mapOf("watchId" to watchId, "location" to fix.toMap())) },
      onProblem = { problem -> sendEvent(EVENT_ERROR, mapOf("watchId" to watchId, "reason" to problem.message)) },
    )
    if (failure != null) reject(promise, failure) else promise.resolve()
  }
}
