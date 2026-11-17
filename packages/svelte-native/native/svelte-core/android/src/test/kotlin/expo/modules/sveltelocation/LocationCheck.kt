package expo.modules.sveltelocation

import java.io.File
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread
import kotlin.system.exitProcess

/**
 * Plain-JVM check of what the Android side of location decides without Android: whether location is on (the flag every entry asks first), the words JavaScript sends for the accuracy, the
 * permission's state from the two Android permissions, which providers a request tries (the fused provider from API 31, the GPS only with the precise permission, whichever is switched on),
 * the age of a position and the newest of several, the payloads a position makes (what the platform does not have is left out), the registry of watches, and the refusals; and, in the sources,
 * that the plain files stay plain, that the module defines what `src/geolocation.ts` calls and listens to, that location is gated (the module starts nothing and asks nothing while the flag is
 * off), that no Google library is part of it, that svelte-core's own manifests declare nothing of location, and that the module config and the config plugin say the same names.
 * Usage: LocationCheck <sveltelocation sources dir> <svelte-core's android dir> <expo-module.config.json> <src/capabilities.ts> <src/geolocation.ts>   (src/test/location.sh)
 */
private var checks = 0
private var failures = 0

private fun expect(name: String, actual: Any?, expected: Any?) {
  checks++
  if (actual != expected) {
    failures++
    System.err.println("FAIL $name\n   got      $actual\n   expected $expected")
  }
}

private fun truth(name: String, ok: Boolean, detail: () -> String = { "" }) {
  checks++
  if (!ok) {
    failures++
    System.err.println("FAIL $name ${detail()}")
  }
}

private fun gating() {
  expect("the flag is one meta-data", LocationRules.META_ENABLED, "expo.modules.sveltelocation.enabled")
  expect("the flag is on", LocationRules.enabled { mapOf<String, Any?>(LocationRules.META_ENABLED to true)[it] }, true)
  expect("no meta-data: off", LocationRules.enabled { null }, false)
  expect("false: off", LocationRules.enabled { mapOf<String, Any?>(LocationRules.META_ENABLED to false)[it] }, false)
  expect("a text is not the boolean", LocationRules.enabled { mapOf<String, Any?>(LocationRules.META_ENABLED to "true")[it] }, false)
  expect("a number is not the boolean", LocationRules.enabled { mapOf<String, Any?>(LocationRules.META_ENABLED to 1)[it] }, false)
  expect("another entry does not turn it on", LocationRules.enabled { mapOf<String, Any?>("expo.modules.sveltepush.enabled" to true)[it] }, false)
  expect("only the flag is asked", ArrayList<String>().also { asked -> LocationRules.enabled { asked.add(it); null } }, listOf(LocationRules.META_ENABLED))
}

private fun accuracyAndOptions() {
  expect("balanced is a word of the contract", LocationAccuracy.parse("balanced"), LocationAccuracy.BALANCED)
  expect("high is a word of the contract", LocationAccuracy.parse("high"), LocationAccuracy.HIGH)
  for (other in listOf<Any?>("Balanced", "highest", "", 3, 4, null)) expect("$other is not an accuracy", LocationAccuracy.parse(other), null)
  expect("the words are the two JavaScript has", LocationAccuracy.entries.map { it.wire }, listOf("balanced", "high"))
  expect("an accuracy is read from the options", LocationRules.accuracyOf(mapOf("accuracy" to "high", "distanceInterval" to 0)), LocationAccuracy.HIGH)
  expect("no accuracy in the options", LocationRules.accuracyOf(emptyMap()), null)

  // JavaScript's numbers arrive as doubles, and as an int when the bridge made one.
  expect("maxAge as a double", LocationRules.maxAgeOf(mapOf("maxAge" to 120000.0)), 120000L)
  expect("maxAge as an int", LocationRules.maxAgeOf(mapOf("maxAge" to 5000)), 5000L)
  expect("maxAge as large as JavaScript's largest (2^32 - 1)", LocationRules.maxAgeOf(mapOf("maxAge" to 4294967295.0)), 4294967295L)
  expect("no maxAge: no limit", LocationRules.maxAgeOf(emptyMap()), null)
  expect("a negative maxAge is 0", LocationRules.maxAgeOf(mapOf("maxAge" to -5.0)), 0L)
  expect("a maxAge that is not a number is none", LocationRules.maxAgeOf(mapOf("maxAge" to "soon")), null)
  expect("NaN is none", LocationRules.maxAgeOf(mapOf("maxAge" to Double.NaN)), null)
  expect("distanceInterval defaults to every position", LocationRules.distanceOf(emptyMap()), 0f)
  expect("distanceInterval in meters", LocationRules.distanceOf(mapOf("distanceInterval" to 25.0)), 25f)
  expect("a negative distanceInterval is 0", LocationRules.distanceOf(mapOf("distanceInterval" to -1)), 0f)
}

private fun permissions() {
  val granted = PermissionAnswer("granted", true)
  val fresh = PermissionAnswer("undetermined", true)
  val refused = PermissionAnswer("denied", true)
  val blocked = PermissionAnswer("denied", false)
  expect("both granted", LocationRules.permission(listOf(granted, granted)), LocationPermission("granted", true))
  // The user chose "approximate" in Android 12's dialog: the coarse permission is granted, the precise one is not, and positions still come.
  expect("the approximate one only is granted", LocationRules.permission(listOf(blocked, granted)), LocationPermission("granted", true))
  expect("the precise one only is granted", LocationRules.permission(listOf(granted, refused)), LocationPermission("granted", true))
  expect("never asked", LocationRules.permission(listOf(fresh, fresh)), LocationPermission("undetermined", true))
  expect("refused once: denied, and it may be asked again", LocationRules.permission(listOf(refused, refused)), LocationPermission("denied", true))
  expect("refused for good: denied, and not asked again", LocationRules.permission(listOf(blocked, blocked)), LocationPermission("denied", false))
  expect("one that cannot be asked again is enough", LocationRules.permission(listOf(refused, blocked)), LocationPermission("denied", false))
  expect("refused and never asked is denied", LocationRules.permission(listOf(refused, fresh)), LocationPermission("denied", true))
  expect("no answer is not asked yet", LocationRules.permission(emptyList()), LocationPermission("undetermined", true))
  expect("what JavaScript reads", LocationPermission("denied", false).toMap(), mapOf("status" to "denied", "granted" to false, "canAskAgain" to false))
  expect("what JavaScript reads of a grant", LocationPermission("granted", true).toMap(), mapOf("status" to "granted", "granted" to true, "canAskAgain" to true))
}

private fun providers() {
  val all = { _: String -> true }
  fun order(accuracy: LocationAccuracy, sdk: Int, precise: Boolean, available: (String) -> Boolean = all) = LocationRules.providers(accuracy, sdk, precise, available)

  // API 31 and later: the fused provider first.
  expect("high, API 31: fused, GPS, network", order(LocationAccuracy.HIGH, 31, true), listOf("fused", "gps", "network"))
  expect("balanced, API 31: fused, network, GPS", order(LocationAccuracy.BALANCED, 31, true), listOf("fused", "network", "gps"))
  // Before it, the platform has none: the GPS for high accuracy, the network for balanced.
  expect("high, API 30: GPS then network", order(LocationAccuracy.HIGH, 30, true), listOf("gps", "network"))
  expect("balanced, API 30: network then GPS", order(LocationAccuracy.BALANCED, 30, true), listOf("network", "gps"))
  expect("the oldest API the library runs on", order(LocationAccuracy.HIGH, 24, true).first(), "gps")
  // The approximate permission only: the GPS would be a SecurityException, so it is not tried; positions come from the others.
  expect("high with the approximate permission only: no GPS", order(LocationAccuracy.HIGH, 31, false), listOf("fused", "network"))
  expect("high with the approximate permission only, API 30: the network", order(LocationAccuracy.HIGH, 30, false), listOf("network"))
  expect("balanced with the approximate permission only", order(LocationAccuracy.BALANCED, 30, false), listOf("network"))
  // Whichever is switched on.
  expect("the GPS is off: the others answer a high request", order(LocationAccuracy.HIGH, 31, true) { it != "gps" }, listOf("fused", "network"))
  expect("the network is off, API 30: the GPS answers a balanced request", order(LocationAccuracy.BALANCED, 30, true) { it != "network" }, listOf("gps"))
  expect("the fused provider is off: the others", order(LocationAccuracy.BALANCED, 31, true) { it != "fused" }, listOf("network", "gps"))
  expect("none is on: none, which is POSITION_UNAVAILABLE and not a wait", order(LocationAccuracy.HIGH, 31, true) { false }, emptyList<String>())
  expect("the approximate permission and only the GPS on: none", order(LocationAccuracy.HIGH, 30, false) { it == "gps" }, emptyList<String>())
  val asked = ArrayList<String>()
  order(LocationAccuracy.HIGH, 30, true) { asked.add(it); true }
  expect("the platform is not asked about the fused provider before API 31", asked, listOf("gps", "network"))
  expect("the providers' names are the platform's", listOf(LocationRules.PROVIDER_FUSED, LocationRules.PROVIDER_GPS, LocationRules.PROVIDER_NETWORK), listOf("fused", "gps", "network"))
  expect("the fused provider is API 31's", LocationRules.FUSED_MIN_SDK, 31)
  expect("a watch asks about once a second", LocationRules.WATCH_INTERVAL_MS, 1000L)
}

private fun ages() {
  val now = 1_800_000_000_000L
  expect("no limit: any age", LocationRules.isYoung(now - 86_400_000, now, null), true)
  expect("a position inside the limit", LocationRules.isYoung(now - 4_999, now, 5_000), true)
  expect("exactly at the limit", LocationRules.isYoung(now - 5_000, now, 5_000), true)
  expect("a position past the limit", LocationRules.isYoung(now - 5_001, now, 5_000), false)
  expect("limit 0: only this instant", LocationRules.isYoung(now, now, 0), true)
  expect("limit 0: a second ago is old", LocationRules.isYoung(now - 1, now, 0), false)
  expect("a position from the future (the clock was set back) is young", LocationRules.isYoung(now + 60_000, now, 1_000), true)

  data class Candidate(val name: String, val time: Long, val accuracy: Float)
  val time = { c: Candidate -> c.time }
  val accuracy = { c: Candidate -> c.accuracy }
  expect("the newest of three", LocationRules.newest(listOf(Candidate("gps", 100, 5f), Candidate("network", 300, 800f), Candidate("fused", 200, 20f)), time, accuracy)?.name, "network")
  expect("at the same time, the more accurate", LocationRules.newest(listOf(Candidate("network", 300, 800f), Candidate("gps", 300, 5f)), time, accuracy)?.name, "gps")
  expect("at the same time and accuracy, the first", LocationRules.newest(listOf(Candidate("a", 300, 5f), Candidate("b", 300, 5f)), time, accuracy)?.name, "a")
  expect("one", LocationRules.newest(listOf(Candidate("only", 1, 1f)), time, accuracy)?.name, "only")
  expect("none", LocationRules.newest(emptyList<Candidate>(), time, accuracy), null)
}

private fun fixes() {
  // A position the provider knows everything of.
  val full = LocationFix.of(24.7136, 46.6753, true, 612.5, true, 5f, true, 3f, true, 90f, true, 1.5f, 1_800_000_000_123L)
  expect(
    "a full position, as JavaScript reads it",
    full.toMap(),
    mapOf(
      "coords" to mapOf("latitude" to 24.7136, "longitude" to 46.6753, "altitude" to 612.5, "accuracy" to 5.0, "altitudeAccuracy" to 3.0, "heading" to 90.0, "speed" to 1.5),
      "timestamp" to 1_800_000_000_123.0,
    ),
  )
  expect("the timestamp is a double", (full.toMap()["timestamp"]), 1_800_000_000_123.0)
  // Android reports 0 for a bearing, a speed and an altitude it does not have: the has...() says which are real, and the rest is left out.
  val bare = LocationFix.of(1.0, 2.0, false, 0.0, true, 25f, false, 0f, false, 0f, false, 0f, 1_800_000_000_000L)
  expect("what the platform does not have is left out, not 0", bare.toMap(), mapOf("coords" to mapOf("latitude" to 1.0, "longitude" to 2.0, "accuracy" to 25.0), "timestamp" to 1_800_000_000_000.0))
  expect("a position with nothing but the place", LocationFix.of(1.0, 2.0, false, 0.0, false, 0f, false, 0f, false, 0f, false, 0f, 0L).toMap()["coords"], mapOf("latitude" to 1.0, "longitude" to 2.0))
  expect("a bearing of 0 that the provider has is kept (north)", (LocationFix.of(1.0, 2.0, false, 0.0, false, 0f, false, 0f, true, 0f, true, 3f, 1L).toMap()["coords"] as Map<*, *>)["heading"], 0.0)
  expect("a NaN is none", LocationFix.of(1.0, 2.0, true, Double.NaN, true, Float.NaN, true, Float.POSITIVE_INFINITY, true, Float.NaN, true, Float.NaN, 1L).toMap()["coords"], mapOf("latitude" to 1.0, "longitude" to 2.0))
  expect("no member is null: JavaScript reads undefined", (bare.toMap()["coords"] as Map<*, *>).values.none { it == null }, true)
}

private fun watches() {
  val registry = LocationWatches<String>()
  expect("a watch starts", registry.add(1, "first"), null)
  expect("a second one", registry.add(2, "second"), null)
  expect("the same id again replaces the watch and hands the old one back", registry.add(1, "again"), "first")
  expect("two run", registry.size(), 2)
  expect("which are there", listOf(registry.contains(1), registry.contains(2), registry.contains(3)), listOf(true, true, false))
  expect("a watch is stopped by its id", registry.remove(2), "second")
  expect("an id that does not run has nothing to stop", registry.remove(2), null)
  expect("a watch that was replaced does not take its successor away", registry.removeIf(1, "first"), false)
  expect("the successor is still there", registry.contains(1), true)
  expect("the watch that is registered goes", registry.removeIf(1, "again"), true)
  expect("and is gone", registry.size(), 0)

  registry.add(3, "c")
  registry.add(4, "d")
  registry.add(5, "e")
  expect("every handle comes back, in the order they started", registry.clear(), listOf("c", "d", "e"))
  expect("and the registry is empty", registry.size(), 0)
  expect("clearing it again has nothing", registry.clear(), emptyList<String>())

  // A watch is started on the module's queue and ended from the main looper.
  val shared = LocationWatches<Int>()
  val start = CountDownLatch(1)
  val workers = (0 until 8).map { worker ->
    thread {
      start.await()
      for (i in 0 until 500) {
        val id = worker * 1000 + i
        shared.add(id, id)
        if (i % 2 == 0) shared.remove(id)
      }
    }
  }
  start.countDown()
  workers.forEach { it.join() }
  expect("eight threads starting and stopping watches lose none", shared.size(), 8 * 250)
  expect("and clear takes them all", shared.clear().size, 8 * 250)
}

private fun failuresOfTheModule() {
  expect("the codes are the module's, the same on both platforms", listOf(LocationFailures.DISABLED, LocationFailures.UNAUTHORIZED, LocationFailures.UNAVAILABLE, LocationFailures.PERMISSIONS, LocationFailures.ARGUMENTS),
    listOf("ERR_LOCATION_DISABLED", "ERR_LOCATION_UNAUTHORIZED", "ERR_LOCATION_UNAVAILABLE", "ERR_LOCATION_PERMISSIONS", "ERR_LOCATION_ARGUMENTS"))
  expect("an unauthorized position is the code JavaScript reads as PERMISSION_DENIED", LocationFailures.unauthorized.code, "ERR_LOCATION_UNAUTHORIZED")
  expect("no provider on is POSITION_UNAVAILABLE, said clearly", LocationFailures.noProvider.code, "ERR_LOCATION_UNAVAILABLE")
  truth("and says what to do", LocationFailures.noProvider.message.contains("Make sure that location services are enabled")) { LocationFailures.noProvider.message }
  expect("providers that gave nothing are named", LocationFailures.notLocated(listOf("gps", "network")).message, "Current location is unavailable: no position from gps, network")
  expect("a provider switched off under a watch is named", LocationFailures.providerOff("gps").message, "The location provider gps was switched off")
  truth("a build with location off says how to turn it on", LocationFailures.disabled.message.contains("capabilities.location") && LocationFailures.disabled.message.contains("enabled"))
  expect("every refusal but the permission's is not the code JavaScript reads as a denied permission", listOf(LocationFailures.noProvider, LocationFailures.disabled, LocationFailures.permissions("x"), LocationFailures.gone).count { it.code.contains("UNAUTHORIZED") }, 0)
}

/** The plain files: no Android, no Expo, no Google, so that this check compiles them and nothing else has to be there. */
private val PLAIN_FILES = listOf("LocationRules", "LocationFix", "LocationWatches")

private fun sources(args: Array<String>) {
  val main = File(args[0])
  val android = File(args[1])
  val moduleConfig = File(args[2]).readText()
  val capabilities = File(args[3]).readText()
  val client = File(args[4]).readText()
  fun source(name: String) = File(main, "$name.kt").readText()

  for (name in PLAIN_FILES) {
    val imports = source(name).lines().filter { it.startsWith("import ") }
    truth("$name.kt is plain Kotlin", imports.none { Regex("^import (android|androidx|expo|com|org)\\.").containsMatchIn(it) }) { imports.toString() }
  }

  // No Google library: the platform's own LocationManager, so it works on a phone without Google services.
  for (file in main.listFiles { f -> f.extension == "kt" }.orEmpty()) {
    val text = file.readText()
    truth("${file.name} imports nothing of Google", !Regex("^import com\\.google\\.", RegexOption.MULTILINE).containsMatchIn(text) && !text.contains("FusedLocationProviderClient")) { file.name }
  }
  val gradle = File(android, "build.gradle").readText()
  truth("svelte-core's Gradle project depends on no Google Play services or location library", !Regex("play-services|gms|google\\.android").containsMatchIn(gradle.lines().filter { !it.trim().startsWith("//") }.joinToString("\n"))) { "build.gradle" }
  truth("it uses androidx.core's LocationManagerCompat, which the project already depends on", gradle.contains("implementation \"androidx.core:core-ktx:") && source("LocationSource").contains("LocationManagerCompat.getCurrentLocation") && source("LocationSource").contains("LocationManagerCompat.requestLocationUpdates") && source("LocationSource").contains("LocationRequestCompat"))

  // The module's manifests declare nothing of location: the permissions are the plugin's, because svelte-core is in every app.
  val manifests = android.walkTopDown().filter { it.isFile && it.name == "AndroidManifest.xml" && !it.path.contains("/build/") }.toList()
  for (manifest in manifests) truth("${manifest.path} declares nothing of location", !Regex("LOCATION|sveltelocation", RegexOption.IGNORE_CASE).containsMatchIn(manifest.readText())) { manifest.path }

  // What the module offers is what geolocation.ts calls: the same names, the same events.
  val module = source("SvelteLocationModule")
  val clientType = client.substringAfter("export type NativeLocationModule = {").substringBefore("\n};")
  val clientCalls = Regex("\\n  (\\w+)\\(").findAll(clientType).map { it.groupValues[1] }.filter { it != "addListener" }.toList()
  val clientEvents = Regex("\\n  (\\w+): \\{").findAll(client.substringAfter("export type NativeLocationEvents = {").substringBefore("\n};")).map { it.groupValues[1] }.toList()
  expect("geolocation.ts: the calls it makes", clientCalls.sorted(), listOf("currentPosition", "lastKnownPosition", "permission", "requestPermission", "startWatch", "stopWatch"))
  expect("geolocation.ts: the events it listens to", clientEvents.sorted(), listOf("locationChanged", "locationError"))
  truth("geolocation.ts: the module's `enabled` is a readonly boolean", clientType.contains("readonly enabled: boolean;"))
  val moduleCalls = Regex("(?<![A-Za-z])AsyncFunction\\(\"(\\w+)\"\\)").findAll(module).map { it.groupValues[1] }.toList()
  expect("the module defines those calls, asynchronously", moduleCalls.sorted(), clientCalls.sorted())
  expect("and no synchronous function", Regex("(?<![A-Za-z])Function\\(\"").findAll(module).count(), 0)
  val declared = Regex("Events\\(([^)]*)\\)").find(module)?.groupValues?.get(1).orEmpty()
  val moduleEvents = Regex("EVENT_\\w+").findAll(declared).mapNotNull { constant -> Regex("const val ${constant.value} = \"(\\w+)\"").find(module)?.groupValues?.get(1) }.toList()
  expect("the module declares those events", moduleEvents.sorted(), clientEvents.sorted())
  truth("the module is named SvelteLocation", module.contains("Name(\"SvelteLocation\")"))
  truth("and has the `enabled` constant", module.contains("Constant(\"enabled\") { isEnabled() }"))
  truth("the permission is asked from the main thread, where the Activity's dialog is", module.contains("AsyncFunction(\"requestPermission\")") && module.contains(".runOnQueue(Queues.MAIN)"))
  // The accuracy words and the one code JavaScript reads.
  expect("geolocation.ts: the accuracies", Regex("export type Accuracy = ([^;]+);").find(client)?.groupValues?.get(1), LocationAccuracy.entries.joinToString(" | ") { "\"${it.wire}\"" })
  truth("geolocation.ts reads ${LocationFailures.UNAUTHORIZED} as a refused permission", client.contains("code === \"${LocationFailures.UNAUTHORIZED}\""))

  // Gated: every call asks the flag first, and nothing starts with the module (an app without location pays for nothing).
  for (call in clientCalls) truth("$call asks whether location is on before it does anything", Regex("AsyncFunction\\(\"$call\"\\)[^\\n]*\\n?[^\\n]*whenEnabled\\(promise\\)").containsMatchIn(module)) { call }
  truth("the module starts nothing when it is created", !module.contains("OnCreate"))
  truth("the source of positions is made at the first call that needs it", module.contains("source ?: LocationSource(context)"))
  truth("the module ends every watch when it goes", Regex("OnDestroy \\{[^}]*stopAll\\(\\)").containsMatchIn(module.replace("\n", " ")))
  truth("the manifest is read by one object, once", source("LocationManifest").contains("internal object LocationManifest") && source("LocationManifest").contains("getApplicationInfo"))
  truth("the source of positions reads no meta-data and the module no package manager", !source("LocationSource").contains("metaData") && !module.contains("packageManager"))

  // Registered in the one module config, and the plugin writes what this reads.
  truth("expo-module.config.json links the module in svelte-core's project", moduleConfig.contains("\"expo.modules.sveltelocation.SvelteLocationModule\""))
  truth("and the module class is defined where its package says", module.contains("class SvelteLocationModule : Module()"))
  fun pluginValue(key: String) = Regex("\\n  $key: \"([^\"]+)\"").find(capabilities.substringAfter("export const locationMetaData = {"))?.groupValues?.get(1)
  expect("meta-data: enabled", pluginValue("enabled"), LocationRules.META_ENABLED)
  val pluginPermissions = Regex("\"android\\.permission\\.(ACCESS_\\w+)\"").findAll(capabilities.substringAfter("export const locationAndroidPermissions").substringBefore(";")).map { it.groupValues[1] }.toList()
  expect("the plugin writes the two permissions the module asks for", pluginPermissions.sorted(), Regex("Manifest\\.permission\\.(ACCESS_\\w+)").findAll(module.substringBefore("/**\n * The module")).map { it.groupValues[1] }.toList().sorted())
  expect("they are the precise and the approximate permission", pluginPermissions.sorted(), listOf("ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"))
}

fun main(args: Array<String>) {
  gating()
  accuracyAndOptions()
  permissions()
  providers()
  ages()
  fixes()
  watches()
  failuresOfTheModule()
  sources(args)
  println("location: $checks checks, $failures failed")
  if (failures > 0) exitProcess(1)
}
