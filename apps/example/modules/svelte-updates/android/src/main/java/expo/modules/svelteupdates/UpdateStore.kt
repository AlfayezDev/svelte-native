package expo.modules.svelteupdates

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** One downloaded update. `status` is "ready" or "failed"; a failed update keeps its record (so it is never fetched again) but not its files. */
internal data class StoredUpdate(
  val id: String,
  val createdAt: Long,
  val runtimeVersion: String,
  var status: String,
  val metadata: JSONObject,
  /** The update URL and request headers (channel) the update was fetched with; only an update fetched with the build's current ones launches. */
  val url: String,
  val headers: Map<String, String>,
  val launchAssetKey: String,
  val assets: List<Pair<String, String>>,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("id", id).put("createdAt", createdAt).put("runtimeVersion", runtimeVersion).put("status", status).put("metadata", metadata)
    .put("url", url).put("headers", JSONObject(headers)).put("launchAssetKey", launchAssetKey)
    .put("assets", JSONArray(assets.map { JSONObject().put("key", it.first).put("extension", it.second) }))

  companion object {
    fun fromJson(json: JSONObject): StoredUpdate {
      val headers = json.getJSONObject("headers")
      val assets = json.getJSONArray("assets")
      return StoredUpdate(
        id = json.getString("id"),
        createdAt = json.getLong("createdAt"),
        runtimeVersion = json.getString("runtimeVersion"),
        status = json.getString("status"),
        metadata = json.getJSONObject("metadata"),
        url = json.getString("url"),
        headers = headers.keys().asSequence().associateWith { headers.getString(it) },
        launchAssetKey = json.getString("launchAssetKey"),
        assets = (0 until assets.length()).map { assets.getJSONObject(it).let { asset -> asset.getString("key") to asset.getString("extension") } },
      )
    }
  }
}

/** What the next start launches: an update, or (null) the bundle embedded in the app. */
internal data class Selection(val update: StoredUpdate?, val embeddedCreatedAt: Long, val emergencyReason: String?)

/**
 * The on-disk store, `filesDir/svelte-updates`:
 *
 *     index.json                       clientId, buildTime, embedded override, launch marker, failed ids, server metadata, updates
 *     updates/<update id>/<bundle>     the launch asset of a committed update
 *     assets/<key><extension>          every other asset, shared between updates, written only after its hash matched
 *
 * Every public method takes the store lock; files are written to a temporary name and renamed.
 */
internal class UpdateStore(private val root: File) {
  private val lock = Any()
  private val indexFile = File(root, "index.json")

  private class Index(
    var clientId: String,
    var buildTime: Long,
    var embeddedCreatedAt: Long?,
    /** The update a start is launching, until its first commit is reported. A marker found at the next start is a failed launch. */
    var pending: String?,
    var failedIds: MutableList<String>,
    var serverDefinedHeaders: JSONObject?,
    var manifestFilters: JSONObject?,
    val updates: LinkedHashMap<String, StoredUpdate>,
    /** QA only: the last reset request this store honoured (`reset`). */
    var resetToken: String? = null,
  )

  private fun read(): Index {
    try {
      val json = JSONObject(indexFile.readText())
      val updates = LinkedHashMap<String, StoredUpdate>()
      val stored = json.getJSONObject("updates")
      for (id in stored.keys()) updates[id] = StoredUpdate.fromJson(stored.getJSONObject(id))
      return Index(
        clientId = json.getString("clientId"),
        buildTime = json.optLong("buildTime", 0),
        embeddedCreatedAt = if (json.has("embeddedCreatedAt")) json.getLong("embeddedCreatedAt") else null,
        pending = json.optString("pending").takeIf { it.isNotEmpty() },
        failedIds = json.getJSONArray("failedIds").let { ids -> (0 until ids.length()).mapTo(mutableListOf()) { ids.getString(it) } },
        serverDefinedHeaders = json.optJSONObject("serverDefinedHeaders"),
        manifestFilters = json.optJSONObject("manifestFilters"),
        updates = updates,
        resetToken = json.optString("resetToken").takeIf { it.isNotEmpty() },
      )
    } catch (_: Exception) {
      // No index yet, or one that cannot be read: start empty. The files of lost updates are removed by the next clean-up.
      return Index(UUID.randomUUID().toString(), 0, null, null, mutableListOf(), null, null, LinkedHashMap())
    }
  }

  private fun write(index: Index) {
    val updates = JSONObject()
    for ((id, update) in index.updates) updates.put(id, update.toJson())
    val json = JSONObject()
      .put("version", 1).put("clientId", index.clientId).put("buildTime", index.buildTime)
      .put("failedIds", JSONArray(index.failedIds)).put("updates", updates)
    index.embeddedCreatedAt?.let { json.put("embeddedCreatedAt", it) }
    index.pending?.let { json.put("pending", it) }
    index.serverDefinedHeaders?.let { json.put("serverDefinedHeaders", it) }
    index.manifestFilters?.let { json.put("manifestFilters", it) }
    index.resetToken?.let { json.put("resetToken", it) }
    root.mkdirs()
    val temporary = File(root, "index.json.tmp")
    temporary.writeText(json.toString())
    // `rename` replaces the old index in one step; copying is the fallback for a rename the file system refuses.
    if (!temporary.renameTo(indexFile)) {
      temporary.copyTo(indexFile, true)
      temporary.delete()
    }
  }

  fun bundleFile(update: StoredUpdate): File = File(File(root, "updates"), "${update.id}/$BUNDLE_NAME")
  fun assetFile(key: String, extension: String): File = File(File(root, "assets"), key + extension)
  fun bundleDestination(updateId: String): File {
    require(isSafeId(updateId)) { "Unsafe update id: $updateId" }
    return File(File(root, "updates"), "$updateId/$BUNDLE_NAME")
  }

  /** Ids name directories, so only the UUIDs the protocol uses are accepted. */
  private fun isSafeId(id: String): Boolean = SAFE_ID.matches(id)

  fun clientId(): String = synchronized(lock) {
    val index = read()
    if (!indexFile.exists()) write(index)
    index.clientId
  }

  /**
   * Picks what this start launches: the newest ready update for the build's runtime version, update URL and channel that passes the
   * server's filters and is newer than the embedded bundle; otherwise the embedded bundle. An update still marked as launching
   * never reached its first commit, so it is marked failed first (`markFailure`; a reload within a run does not mark).
   */
  fun select(config: UpdatesConfig, buildTime: Long, markFailure: Boolean): Selection = synchronized(lock) {
    val index = read()
    var changed = false
    // A new binary has a new embedded bundle; a rollback directive applied to the old one says nothing about it.
    if (index.buildTime != buildTime) {
      index.buildTime = buildTime
      index.embeddedCreatedAt = null
      changed = true
    }
    var reason: String? = null
    val pending = index.pending
    if (markFailure && pending != null) {
      markFailed(index, pending)
      reason = "Update $pending did not reach its first commit"
      changed = true
    }
    if (index.pending != null) { index.pending = null; changed = true }
    val embeddedCreatedAt = index.embeddedCreatedAt ?: buildTime
    val newest = index.updates.values
      .filter {
        it.status == "ready" && it.runtimeVersion == config.runtimeVersion && it.url == config.updateUrl && it.headers == config.requestHeaders &&
          matchesFilters(it.metadata, index.manifestFilters) && bundleFile(it).isFile
      }
      .maxByOrNull { it.createdAt }
    val chosen = newest?.takeIf { it.createdAt > embeddedCreatedAt }
    if (chosen != null) { index.pending = chosen.id; changed = true }
    if (changed || !indexFile.exists()) write(index)
    Selection(chosen, embeddedCreatedAt, reason)
  }

  /**
   * QA only (`QaReset`): puts the store back to what a fresh install has, once per `token`: no downloaded update (files included), no
   * failed list, no launch marker, no rollback override, no stored server headers or filters. The client id and the build time stay.
   * Returns how many updates were forgotten, or null when this token was already honoured.
   */
  fun reset(token: String): Int? = synchronized(lock) {
    val index = read()
    if (index.resetToken == token) return@synchronized null
    val forgotten = index.updates.size
    index.updates.clear()
    index.failedIds.clear()
    index.pending = null
    index.embeddedCreatedAt = null
    index.serverDefinedHeaders = null
    index.manifestFilters = null
    index.resetToken = token
    File(root, "updates").deleteRecursively()
    File(root, "assets").deleteRecursively()
    write(index)
    forgotten
  }

  private fun markFailed(index: Index, id: String) {
    index.updates[id]?.status = "failed"
    index.failedIds.remove(id)
    index.failedIds.add(id)
    while (index.failedIds.size > MAX_FAILED_IDS) index.failedIds.removeAt(0)
  }

  /** Same rule as the protocol client: a filtered key that the update's metadata also has must agree (keys compared lowercase). */
  private fun matchesFilters(metadata: JSONObject, filters: JSONObject?): Boolean {
    if (filters == null) return true
    val lowered = metadata.keys().asSequence().associateBy { it.lowercase() }
    for (key in filters.keys()) {
      val own = lowered[key] ?: continue
      if (metadata.get(own) != filters.get(key)) return false
    }
    return true
  }

  fun commit(update: StoredUpdate) = synchronized(lock) {
    require(isSafeId(update.id)) { "Unsafe update id: ${update.id}" }
    // Only an update whose every file is in place becomes launchable.
    check(bundleFile(update).isFile) { "Update ${update.id} has no bundle" }
    for ((key, extension) in update.assets) if (key != update.launchAssetKey) check(assetFile(key, extension).isFile) { "Update ${update.id} is missing asset $key$extension" }
    val index = read()
    index.updates[update.id] = update
    write(index)
  }

  /** A response that carried a header replaces what was stored for it; one without it leaves the stored value, as expo-updates does. */
  fun saveMetadata(serverDefinedHeaders: JSONObject?, manifestFilters: JSONObject?) = synchronized(lock) {
    val index = read()
    serverDefinedHeaders?.let { index.serverDefinedHeaders = it }
    manifestFilters?.let { index.manifestFilters = it }
    write(index)
  }

  fun rollBackToEmbedded(commitTime: Long) = synchronized(lock) {
    val index = read()
    if (commitTime > (index.embeddedCreatedAt ?: index.buildTime)) index.embeddedCreatedAt = commitTime
    write(index)
  }

  /** The index as the JavaScript client reads it: no file names, and the embedded bundle's effective commit time. */
  fun snapshot(buildTime: Long): String = synchronized(lock) {
    val index = read()
    val updates = JSONObject()
    for ((id, update) in index.updates) {
      updates.put(id, JSONObject().put("id", id).put("createdAt", update.createdAt).put("runtimeVersion", update.runtimeVersion).put("status", update.status).put("metadata", update.metadata))
    }
    JSONObject()
      .put("embeddedCreatedAt", index.embeddedCreatedAt ?: buildTime)
      .put("updates", updates)
      .put("failedIds", JSONArray(index.failedIds))
      .put("metadata", JSONObject().put("serverDefinedHeaders", index.serverDefinedHeaders ?: JSONObject.NULL).put("manifestFilters", index.manifestFilters ?: JSONObject.NULL))
      .toString()
  }

  /** The launch reached its first commit. */
  fun markLaunched(id: String) = synchronized(lock) {
    val index = read()
    if (index.pending == id) {
      index.pending = null
      write(index)
    }
  }

  /**
   * Removes what nothing will launch: failed updates' files, updates that are neither the launched one, newer than it, nor the
   * newest older one (kept so a rollback is quick), directories the index does not know, and assets no kept update lists.
   */
  fun clean(launchedCreatedAt: Long) = synchronized(lock) {
    val index = read()
    val ready = index.updates.values.filter { it.status == "ready" }
    val newestOlder = ready.filter { it.createdAt < launchedCreatedAt }.maxByOrNull { it.createdAt }
    val kept = ready.filter { it.createdAt >= launchedCreatedAt || it === newestOlder }
    val dropped = ready - kept.toSet()
    for (update in dropped) index.updates.remove(update.id)
    val failed = index.updates.values.filter { it.status == "failed" }.sortedBy { it.createdAt }
    for (update in failed.dropLast(MAX_FAILED_RECORDS)) index.updates.remove(update.id)
    write(index)
    // Files the index does not know may belong to a download in progress, so they go only once they are old.
    val now = System.currentTimeMillis()
    val stale = { file: File -> now - file.lastModified() > ORPHAN_AGE_MS }
    for (directory in File(root, "updates").listFiles() ?: emptyArray()) {
      val known = index.updates[directory.name]
      if (known?.status != "ready" && (known != null || stale(directory))) directory.deleteRecursively()
    }
    val referenced = kept.flatMapTo(mutableSetOf()) { update -> update.assets.map { it.first + it.second } }
    for (file in File(root, "assets").listFiles() ?: emptyArray()) if (file.name !in referenced && stale(file)) file.delete()
  }

  companion object {
    const val BUNDLE_NAME = "index.android.bundle"
    private val SAFE_ID = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
    private const val MAX_FAILED_IDS = 5
    private const val MAX_FAILED_RECORDS = 20
    private const val ORPHAN_AGE_MS = 60 * 60 * 1000L
  }
}
