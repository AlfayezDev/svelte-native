package expo.modules.sveltelocation

/**
 * How precise a request asks to be: the one word JavaScript sends (`Accuracy` in `src/geolocation.ts`). `BALANCED` is about a city block, which the network and Wi-Fi give; `HIGH`
 * asks for the GPS (`enableHighAccuracy` on the web).
 */
enum class LocationAccuracy(val wire: String) {
  BALANCED("balanced"),
  HIGH("high"),
  ;

  companion object {
    fun parse(wire: Any?): LocationAccuracy? = entries.firstOrNull { it.wire == wire }
  }
}

/** A refusal JavaScript is told about: the `code` of the rejected promise (`src/geolocation.ts` reads `UNAUTHORIZED` as `PERMISSION_DENIED`, the rest as `POSITION_UNAVAILABLE`) and what the app may show. */
data class LocationFailure(val code: String, val message: String)

/** The refusals this module has. The same codes on iOS (`SvelteLocationFailure`). */
object LocationFailures {
  const val DISABLED = "ERR_LOCATION_DISABLED"
  const val UNAUTHORIZED = "ERR_LOCATION_UNAUTHORIZED"
  const val UNAVAILABLE = "ERR_LOCATION_UNAVAILABLE"
  const val PERMISSIONS = "ERR_LOCATION_PERMISSIONS"
  const val ARGUMENTS = "ERR_LOCATION_ARGUMENTS"

  val disabled = LocationFailure(
    DISABLED,
    "Location is off in this build: turn it on with capabilities.location in the @alfayez/svelte-native config plugin, and build again (the module's `enabled` constant says which)",
  )
  val unauthorized = LocationFailure(UNAUTHORIZED, "Not authorized to use location services")

  /** No provider that could answer is switched on: the user turned location off, or the only provider left needs a permission that was not given (the GPS without the precise one). */
  val noProvider = LocationFailure(UNAVAILABLE, "Location is unavailable. Make sure that location services are enabled: no location provider (fused, GPS or network) is switched on for this app's permission")

  /** Every provider that was tried answered with no position (a GPS indoors, a network provider with nothing to go by). */
  fun notLocated(tried: List<String>) = LocationFailure(UNAVAILABLE, "Current location is unavailable: no position from ${tried.joinToString(", ")}")

  /** A provider turned off while a watch ran on it. */
  fun providerOff(provider: String) = LocationFailure(UNAVAILABLE, "The location provider $provider was switched off")

  /** A watch was asked for after the module was shut down. */
  val gone = LocationFailure(UNAVAILABLE, "The location module was shut down")

  fun permissions(reason: String) = LocationFailure(PERMISSIONS, reason)
  fun arguments(reason: String) = LocationFailure(ARGUMENTS, reason)
}

/** One permission as Expo's permissions service answers for it: `granted`, `denied` or `undetermined`, and whether the system will still ask. */
data class PermissionAnswer(val status: String, val canAskAgain: Boolean)

/** What JavaScript reads of the permission: `status` and `canAskAgain` as `NativePermission` in `src/geolocation.ts` has them, and `granted` for the one who only wants that. */
data class LocationPermission(val status: String, val canAskAgain: Boolean) {
  val granted: Boolean get() = status == "granted"

  fun toMap(): Map<String, Any?> = mapOf("status" to status, "granted" to granted, "canAskAgain" to canAskAgain)
}

/**
 * What the module decides without Android: whether location is on in this build, the permission's state from the two Android permissions, which providers a request
 * tries and in which order, the age of a position, and the newest of several. Plain Kotlin so that the host check (`src/test/location.sh`) runs it.
 */
object LocationRules {
  /** The meta-data name the config plugin writes (`locationMetaData.enabled` in `src/capabilities.ts`; the host check reads that file and compares). */
  const val META_ENABLED = "expo.modules.sveltelocation.enabled"

  /** `LocationManager.FUSED_PROVIDER`, `GPS_PROVIDER` and `NETWORK_PROVIDER`: spelled out here so that this file needs no Android (the Android file compares them). */
  const val PROVIDER_FUSED = "fused"
  const val PROVIDER_GPS = "gps"
  const val PROVIDER_NETWORK = "network"

  /** The fused provider is part of the platform from Android 12 (API 31). */
  const val FUSED_MIN_SDK = 31

  /** How often a watch asks for a position: the web's browsers report about once a second while one moves. The system may be slower (the network provider is). */
  const val WATCH_INTERVAL_MS = 1000L

  /**
   * Whether location is on in this build (`read` is `Bundle.get(name)`): the config plugin writes `<meta-data android:name="expo.modules.sveltelocation.enabled" android:value="true" />`
   * when `capabilities.location` is set. This code is in every app (it is part of svelte-core), so everything it does starts from this answer. Only the boolean `true` is on: a text,
   * a number or no entry is off.
   */
  fun enabled(read: (String) -> Any?): Boolean = read(META_ENABLED) == true

  /**
   * The state JavaScript reads from the answers for `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION`: either one granted is `granted` (a user who allowed the approximate location only
   * still gets positions, from the providers that need no precise permission: `providers`); else `denied` once any of them was refused, `undetermined` when none was asked.
   * `canAskAgain` is false when the system will not show the question for one of them.
   */
  fun permission(answers: List<PermissionAnswer>): LocationPermission {
    if (answers.any { it.status == "granted" }) return LocationPermission("granted", true)
    if (answers.all { it.status == "undetermined" }) return LocationPermission("undetermined", true)
    return LocationPermission("denied", answers.all { it.canAskAgain })
  }

  /**
   * The providers a request tries, best first. The fused provider where the platform has it (API 31 and later; on a phone with Google services it is theirs, elsewhere the
   * platform's own, which combines the GPS and the network), then, for `HIGH`, the GPS and the network; for `BALANCED`, the network and the GPS. The GPS needs the precise permission,
   * and asking it for a position with the approximate one only is a `SecurityException`, so it is left out then. `available` says whether the platform has the provider and it is switched on:
   * what is not is left out, so the list is "whichever is enabled", and empty when none is.
   */
  fun providers(accuracy: LocationAccuracy, sdk: Int, preciseGranted: Boolean, available: (String) -> Boolean): List<String> {
    val order = when (effectiveAccuracy(accuracy, available)) {
      LocationAccuracy.HIGH -> listOf(PROVIDER_FUSED, PROVIDER_GPS, PROVIDER_NETWORK)
      LocationAccuracy.BALANCED -> listOf(PROVIDER_FUSED, PROVIDER_NETWORK, PROVIDER_GPS)
    }
    return order.filter { name ->
      (name != PROVIDER_FUSED || sdk >= FUSED_MIN_SDK) && (name != PROVIDER_GPS || preciseGranted) && available(name)
    }
  }

  /**
   * The accuracy a request is served with. `BALANCED` is the web's `enableHighAccuracy: false`, a hint to save power and not a ban on the GPS: on a device with no network location
   * (no network provider switched on: an emulator, a phone without a location service) the fused provider serves a balanced request from the network alone and never answers, so
   * there it is a `HIGH` request.
   */
  fun effectiveAccuracy(accuracy: LocationAccuracy, available: (String) -> Boolean): LocationAccuracy =
    if (accuracy == LocationAccuracy.BALANCED && !available(PROVIDER_NETWORK)) LocationAccuracy.HIGH else accuracy

  /** Whether a position taken at `timeMs` is young enough for a `maxAgeMs` (none: any age). A position from the future (the clock was set back) is young. */
  fun isYoung(timeMs: Long, nowMs: Long, maxAgeMs: Long?): Boolean = maxAgeMs == null || nowMs - timeMs <= maxAgeMs

  /** The newest of the positions, the more accurate (the smaller `accuracy`) of two taken at the same time. None for none. */
  fun <Fix> newest(fixes: List<Fix>, time: (Fix) -> Long, accuracy: (Fix) -> Float): Fix? {
    var best: Fix? = null
    for (fix in fixes) {
      val current = best
      if (current == null || time(fix) > time(current) || (time(fix) == time(current) && accuracy(fix) < accuracy(current))) best = fix
    }
    return best
  }

  /** A number JavaScript sent (it reads as a `Double`, an `Int` or a `Long`), or null for anything else or a value that is not a number. */
  fun number(value: Any?): Double? = (value as? Number)?.toDouble()?.takeIf { !it.isNaN() }

  /** `{ accuracy }` of a `currentPosition` or a watch: refused when the word is not one of the two. */
  fun accuracyOf(options: Map<String, Any?>): LocationAccuracy? = LocationAccuracy.parse(options["accuracy"])

  /** `{ maxAge }` of a `lastKnownPosition`, in milliseconds: none is no limit, and a negative one is 0 (only a position from this instant is young enough). */
  fun maxAgeOf(options: Map<String, Any?>): Long? = number(options["maxAge"])?.let { if (it < 0) 0L else it.toLong() }

  /** `{ distanceInterval }` of a watch, in meters: none is 0, every position. */
  fun distanceOf(options: Map<String, Any?>): Float = number(options["distanceInterval"])?.coerceAtLeast(0.0)?.toFloat() ?: 0f
}
