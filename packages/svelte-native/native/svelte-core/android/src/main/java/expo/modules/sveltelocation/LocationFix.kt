package expo.modules.sveltelocation

/**
 * A position as the module gives it to JavaScript (`NativeLocation` in `src/geolocation.ts`): `coords` with `latitude` and `longitude`, and `altitude`, `accuracy`, `altitudeAccuracy`,
 * `heading` and `speed` where the platform has them, and the `timestamp`, in milliseconds since the epoch, the platform took the position at. What the platform does not have is left out
 * of the map, so JavaScript reads `undefined` (Android reports 0 for a bearing, a speed or an altitude it does not have, and `hasBearing()` and the others tell the two apart).
 */
data class LocationFix(
  val latitude: Double,
  val longitude: Double,
  val altitude: Double?,
  /** The horizontal accuracy, the radius of 68% confidence, in meters. */
  val accuracy: Double?,
  val altitudeAccuracy: Double?,
  /** The direction of travel, in degrees east of true north. */
  val heading: Double?,
  /** Meters per second. */
  val speed: Double?,
  val timeMs: Long,
) {
  fun toMap(): Map<String, Any?> {
    val coords = linkedMapOf<String, Any?>("latitude" to latitude, "longitude" to longitude)
    altitude?.let { coords["altitude"] = it }
    accuracy?.let { coords["accuracy"] = it }
    altitudeAccuracy?.let { coords["altitudeAccuracy"] = it }
    heading?.let { coords["heading"] = it }
    speed?.let { coords["speed"] = it }
    // A double: a Long in a map crosses as a number too, but only a double is certain to.
    return mapOf("coords" to coords, "timestamp" to timeMs.toDouble())
  }

  companion object {
    /**
     * The fix of the values an Android `Location` has, each member only when its `has…()` says so, and only when it is a number (a provider that reports NaN has none). The
     * caller reads them off the `Location` (`LocationSource`), so that this file needs no Android.
     */
    fun of(
      latitude: Double,
      longitude: Double,
      hasAltitude: Boolean,
      altitude: Double,
      hasAccuracy: Boolean,
      accuracy: Float,
      hasVerticalAccuracy: Boolean,
      verticalAccuracy: Float,
      hasBearing: Boolean,
      bearing: Float,
      hasSpeed: Boolean,
      speed: Float,
      timeMs: Long,
    ): LocationFix {
      fun known(has: Boolean, value: Double): Double? = if (has && !value.isNaN() && !value.isInfinite()) value else null
      return LocationFix(
        latitude,
        longitude,
        known(hasAltitude, altitude),
        known(hasAccuracy, accuracy.toDouble()),
        known(hasVerticalAccuracy, verticalAccuracy.toDouble()),
        known(hasBearing, bearing.toDouble()),
        known(hasSpeed, speed.toDouble()),
        timeMs,
      )
    }
  }
}
