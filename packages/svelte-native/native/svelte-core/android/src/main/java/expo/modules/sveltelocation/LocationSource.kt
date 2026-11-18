package expo.modules.sveltelocation

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.location.LocationRequest
import android.os.Build
import android.os.CancellationSignal
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import java.util.Collections
import java.util.concurrent.atomic.AtomicBoolean

/** How long a one-off position may take on API 31 and later, as the platform's own `getCurrentLocation` without a request allows (30 s); the web's `timeout` usually ends it first. */
private const val CURRENT_DURATION_MS = 30_000L

/**
 * The platform's `LocationManager` behind the module: no Google library, so it answers on a phone without Google services too. One-off positions are `LocationManagerCompat.getCurrentLocation`,
 * watches are `requestLocationUpdates` with a `LocationRequestCompat`, both on the main thread's executor and looper. Which provider answers is `LocationRules.providers`: the fused provider where
 * the platform has it (API 31 and later), else the GPS for `HIGH` and the network for `BALANCED`, whichever is switched on, and the GPS only with the precise permission.
 *
 * Everything that is started is remembered (`pending`, `watches`) so that [stopAll] can end it when the module goes: a watch that outlived its module would keep the GPS on for a JavaScript that is gone.
 * An answer is delivered once, to the callback it was asked with, and nothing after [stopAll].
 */
internal class LocationSource(private val context: Context) {
  private val manager: LocationManager? = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
  private val executor = ContextCompat.getMainExecutor(context)
  private val pending: MutableSet<CancellationSignal> = Collections.synchronizedSet(HashSet())
  private val watches = LocationWatches<ActiveWatch>()

  @Volatile
  private var stopped = false

  /** A running watch: the listener that stops it. */
  private class ActiveWatch(val listener: LocationListenerCompat)

  /** Whether the app may use the location at all (the precise or the approximate permission). */
  fun permitted(): Boolean = granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)

  private fun granted(permission: String) = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  /** Whether the platform has the provider and it is switched on (`isProviderEnabled` throws for none the platform does not have). */
  /** The platform's request quality for an accuracy: what a one-off position on API 31 and later asks the provider for. */
  private fun qualityOf(accuracy: LocationAccuracy): Int =
    if (accuracy == LocationAccuracy.HIGH) LocationRequest.QUALITY_HIGH_ACCURACY else LocationRequest.QUALITY_BALANCED_POWER_ACCURACY

  private fun available(manager: LocationManager, name: String): Boolean =
    try {
      LocationManagerCompat.hasProvider(manager, name) && manager.isProviderEnabled(name)
    } catch (error: IllegalArgumentException) {
      false
    }

  private fun providers(accuracy: LocationAccuracy, manager: LocationManager): List<String> =
    LocationRules.providers(accuracy, Build.VERSION.SDK_INT, granted(Manifest.permission.ACCESS_FINE_LOCATION)) { name -> available(manager, name) }

  /**
   * The current position, from the first provider that has one: a provider that gives none (the GPS indoors, which the platform gives up on after 30 s) hands over to the next. Calls [done] once,
   * with the position or the reason there is none. API 29 and earlier answer a request with a position of the last ten seconds when there is one (`LocationManagerCompat.getCurrentLocation`
   * does, and the platform's own, from API 30, does much the same).
   */
  @SuppressLint("MissingPermission")
  fun current(accuracy: LocationAccuracy, done: (LocationFix?, LocationFailure?) -> Unit) {
    val manager = manager
    if (manager == null) return done(null, LocationFailures.noProvider)
    if (!permitted()) return done(null, LocationFailures.unauthorized)
    val tried = providers(accuracy, manager)
    if (tried.isEmpty()) return done(null, LocationFailures.noProvider)
    val quality = qualityOf(LocationRules.effectiveAccuracy(accuracy) { name -> available(manager, name) })
    val finished = AtomicBoolean(false)
    fun finish(fix: LocationFix?, failure: LocationFailure?) {
      if (finished.compareAndSet(false, true) && !stopped) done(fix, failure)
    }
    fun ask(index: Int) {
      if (stopped) return
      val signal = CancellationSignal()
      pending.add(signal)
      try {
        val answer = { location: Location? ->
          pending.remove(signal)
          when {
            location != null -> finish(fixOf(location), null)
            index + 1 < tried.size -> ask(index + 1)
            else -> finish(null, LocationFailures.notLocated(tried))
          }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          // With the request's quality: without one the platform asks for a balanced position, which the fused provider takes from the network alone.
          val request = LocationRequest.Builder(0L).setQuality(quality).setDurationMillis(CURRENT_DURATION_MS).build()
          manager.getCurrentLocation(tried[index], request, signal, executor) { location -> answer(location) }
        } else {
          LocationManagerCompat.getCurrentLocation(manager, tried[index], signal, executor) { location: Location? -> answer(location) }
        }
      } catch (error: SecurityException) {
        pending.remove(signal)
        finish(null, LocationFailures.unauthorized)
      } catch (error: IllegalArgumentException) {
        // The provider went away between the question and the call.
        pending.remove(signal)
        if (index + 1 < tried.size) ask(index + 1) else finish(null, LocationFailures.notLocated(tried))
      }
    }
    ask(0)
  }

  /**
   * The newest position any enabled provider remembers, when it is no older than `maxAgeMs`; null when there is none, and without the permission. Never starts a provider. A provider that
   * refuses (`SecurityException`) is left out.
   */
  @SuppressLint("MissingPermission")
  fun lastKnown(maxAgeMs: Long?): LocationFix? {
    val manager = manager ?: return null
    if (!permitted()) return null
    val remembered = providers(LocationAccuracy.HIGH, manager).mapNotNull { name ->
      try {
        manager.getLastKnownLocation(name)
      } catch (error: SecurityException) {
        null
      } catch (error: IllegalArgumentException) {
        null
      }
    }
    val newest = LocationRules.newest(remembered, { it.time }, { if (it.hasAccuracy()) it.accuracy else Float.MAX_VALUE }) ?: return null
    return if (LocationRules.isYoung(newest.time, System.currentTimeMillis(), maxAgeMs)) fixOf(newest) else null
  }

  /**
   * Starts a watch with the id: `onFix` hears every position, `onProblem` the provider it runs on being switched off (the system goes on when it is switched on again). The id's earlier watch,
   * if there is one, is stopped. Returns the refusal when it cannot start: no permission, no provider that is on.
   */
  @SuppressLint("MissingPermission")
  fun startWatch(id: Int, accuracy: LocationAccuracy, distanceMeters: Float, onFix: (LocationFix) -> Unit, onProblem: (LocationFailure) -> Unit): LocationFailure? {
    val manager = manager ?: return LocationFailures.noProvider
    if (stopped) return LocationFailures.gone
    if (!permitted()) return LocationFailures.unauthorized
    val chosen = providers(accuracy, manager).firstOrNull() ?: return LocationFailures.noProvider
    val listener = object : LocationListenerCompat {
      override fun onLocationChanged(location: Location) {
        onFix(fixOf(location))
      }

      override fun onProviderDisabled(provider: String) {
        if (provider == chosen) onProblem(LocationFailures.providerOff(provider))
      }
    }
    val request = LocationRequestCompat.Builder(LocationRules.WATCH_INTERVAL_MS)
      .setQuality(if (LocationRules.effectiveAccuracy(accuracy) { name -> available(manager, name) } == LocationAccuracy.HIGH) LocationRequestCompat.QUALITY_HIGH_ACCURACY else LocationRequestCompat.QUALITY_BALANCED_POWER_ACCURACY)
      .setMinUpdateDistanceMeters(distanceMeters)
      .build()
    val watch = ActiveWatch(listener)
    watches.add(id, watch)?.let { stopListener(manager, it) }
    return try {
      LocationManagerCompat.requestLocationUpdates(manager, chosen, request, listener, Looper.getMainLooper())
      null
    } catch (error: SecurityException) {
      watches.removeIf(id, watch)
      LocationFailures.unauthorized
    } catch (error: IllegalArgumentException) {
      watches.removeIf(id, watch)
      LocationFailures.noProvider
    }
  }

  fun stopWatch(id: Int) {
    val manager = manager ?: return
    watches.remove(id)?.let { stopListener(manager, it) }
  }

  /** Ends every watch and every request that waits for a position, and answers none of them: the module is going. */
  fun stopAll() {
    stopped = true
    synchronized(pending) {
      pending.forEach { it.cancel() }
      pending.clear()
    }
    val manager = manager ?: return
    for (watch in watches.clear()) stopListener(manager, watch)
  }

  private fun stopListener(manager: LocationManager, watch: ActiveWatch) {
    LocationManagerCompat.removeUpdates(manager, watch.listener)
  }

  private fun fixOf(location: Location): LocationFix =
    LocationFix.of(
      location.latitude,
      location.longitude,
      location.hasAltitude(),
      location.altitude,
      location.hasAccuracy(),
      location.accuracy,
      Build.VERSION.SDK_INT >= 26 && location.hasVerticalAccuracy(),
      if (Build.VERSION.SDK_INT >= 26) location.verticalAccuracyMeters else 0f,
      location.hasBearing(),
      location.bearing,
      location.hasSpeed(),
      location.speed,
      location.time,
    )
}
