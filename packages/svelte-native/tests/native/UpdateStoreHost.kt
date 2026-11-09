package expo.modules.svelteupdates

import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.InetSocketAddress
import java.nio.file.Files
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

// Host-side check of the Android updates store (UpdateStore.kt), the QA reset decision (QaReset.kt) and the download of an asset
// (Http.kt, against a local HTTP server): runs scripted commands from stdin against a real directory and prints one line per command.
// tests/updates-store-native.test.ts scripts the cases. Lives in the store's package because the classes are internal.

private val config = UpdatesConfig(
  enabled = true, updateUrl = "https://u.expo.dev/p", runtimeVersion = "0.1.0", requestHeaders = mapOf("expo-channel-name" to "qa"),
  checkOnLaunch = "ALWAYS", launchWaitMs = 0, hasEmbeddedUpdate = true,
)

private fun id(n: String): String = "00000000-0000-0000-0000-" + n.padStart(12, '0')

/** An update whose bundle exists on disk, as `commit` requires. */
private fun update(store: UpdateStore, n: String, createdAt: Long): StoredUpdate {
  val stored = StoredUpdate(id(n), createdAt, "0.1.0", "ready", org.json.JSONObject(), config.updateUrl!!, config.requestHeaders, "bundle", listOf("bundle" to ""))
  val file = store.bundleDestination(stored.id)
  file.parentFile.mkdirs()
  file.writeText("bundle $n")
  return stored
}

/** A local server for the downloads: `/<name>` answers with the body registered for it, 404 otherwise, and counts the requests it answered. */
private class Server {
  val bodies = java.util.concurrent.ConcurrentHashMap<String, ByteArray>()
  val requests = AtomicInteger()
  private val http: HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).also { server ->
    server.createContext("/") { exchange ->
      requests.incrementAndGet()
      val body = bodies[exchange.requestURI.path.removePrefix("/")]
      if (body == null) {
        exchange.sendResponseHeaders(404, -1)
      } else {
        exchange.sendResponseHeaders(200, if (body.isEmpty()) -1 else body.size.toLong())
        if (body.isNotEmpty()) exchange.responseBody.use { it.write(body) }
      }
      exchange.close()
    }
    server.start()
  }
  fun url(name: String) = "http://127.0.0.1:${http.address.port}/$name"
  fun stop() = http.stop(0)
}

fun main() {
  val root = File(Files.createTempDirectory("svelte-updates-host").toFile(), "svelte-updates")
  var store = UpdateStore(root)
  val server = Server()
  val files = root.parentFile
  val name = { s: String? -> s?.let { if (it == "embedded" || it == "-") it else it.trimStart('0', '-') } ?: "-" }
  while (true) {
    val line = readLine() ?: break
    val words = line.trim().split(" ")
    val out: String = try {
      when (words[0]) {
        // commit <n> <createdAt>
        "commit" -> { store.commit(update(store, words[1], words[2].toLong())); "ok" }
        // select <buildTime> <markFailure 0|1> [<reset token>|-]: the chosen update (or embedded), the reason, what a reset forgot
        "select" -> {
          var asked = false
          val token = words.getOrNull(3)?.takeIf { it != "-" }
          val selection = store.select(config, words[1].toLong(), words[2] == "1") { asked = true; token }
          "chosen=${selection.update?.id?.let { name(it) } ?: "embedded"} reason=${selection.emergencyReason ?: "-"} forgotten=${selection.resetForgotten ?: "-"} asked=$asked"
        }
        "launched" -> { store.markLaunched(id(words[1])); "ok" }
        "fatal" -> { store.markFatal(id(words[1])); "ok" }
        "clean" -> { store.clean(words[1].toLong()); "ok" }
        "reset" -> "forgotten=${store.reset(words[1]) ?: "-"}"
        // The index as the JavaScript client reads it, plus the launch bookkeeping.
        "state" -> {
          val json = org.json.JSONObject(File(root, "index.json").readText())
          "pending=${name(json.optString("pending", "-"))} fatal=${json.optBoolean("pendingFatal", false)} unconfirmed=${json.optJSONObject("unconfirmed")?.toString() ?: "{}"} failed=${json.getJSONArray("failedIds").length()} updates=${json.getJSONObject("updates").length()} reset=${json.optString("resetToken", "-")} client=${json.getString("clientId").take(8)}"
        }
        "status" -> "status=" + org.json.JSONObject(store.snapshot(0)).getJSONObject("updates").let { updates -> updates.keys().asSequence().sorted().joinToString(",") { name(it) + ":" + updates.getJSONObject(it).getString("status") } }
        "files" -> "files=" + (File(root, "updates").list()?.sorted()?.joinToString(",") { name(it) } ?: "")
        // A new store object for the same directory, as the module makes one per call.
        "reopen" -> { store = UpdateStore(root); "ok" }
        "corrupt" -> { File(root, "index.json").writeText(words.drop(1).joinToString(" ").ifEmpty { "{not json" }); "ok" }
        "unreadable-field" -> { File(root, "index.json").writeText("{\"version\":1}"); "ok" }
        "corrupt-file" -> "corrupt=" + (File(root, "index.json.corrupt").takeIf { it.exists() }?.readText() ?: "-")
        "index-exists" -> "index=" + File(root, "index.json").exists()
        // <threads>: each thread commits its own update through its own store object; no commit may be lost.
        "race" -> {
          val threads = words[1].toInt()
          val start = CountDownLatch(1)
          val workers = (1..threads).map { n ->
            thread {
              val own = UpdateStore(root)
              start.await()
              repeat(5) { round -> own.commit(update(own, "${n}0$round", 1000L + n * 10 + round)) }
            }
          }
          start.countDown()
          workers.forEach { it.join() }
          "updates=" + org.json.JSONObject(store.snapshot(0)).getJSONObject("updates").length()
        }
        // qa <package> <setting value|->: the reset decision, and whether the setting was read at all
        "qa" -> {
          var read = false
          val token = QaReset.requested(words[1]) { read = true; words[2].takeIf { it != "-" } }
          "token=${token ?: "-"} read=$read"
        }
        "qa-setting" -> "setting=${QaReset.SETTING} package=${QaReset.PACKAGE}"
        "qa-throws" -> {
          val token = QaReset.requested(QaReset.PACKAGE) { throw SecurityException("denied") }
          "token=${token ?: "-"}"
        }
        // base64 <max length>: Http.encode against java.util.Base64 (base64url, no padding) for every length up to it
        "base64" -> {
          val different = (0..words[1].toInt()).filter { length ->
            val bytes = ByteArray(length) { (it * 37 + length * 11 + 5).toByte() }
            Http.encode(bytes) != java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
          }
          "different=${different.joinToString(",").ifEmpty { "-" }}"
        }
        // hash <text>: the SHA-256 of the text as the protocol writes it
        "hash" -> Http.encode(MessageDigest.getInstance("SHA-256").digest(words.drop(1).joinToString(" ").toByteArray()))
        // serve <name> <body>: what the server answers at /<name>
        "serve" -> { server.bodies[words[1]] = words.drop(2).joinToString(" ").toByteArray(); "ok" }
        // put <path> <text>: a file in place; path is relative to the scratch directory
        "put" -> { File(files, words[1]).also { it.parentFile.mkdirs() }.writeText(words.drop(2).joinToString(" ")); "ok" }
        // look <path>: the file's content, or - when there is none, and whether its temporary download is left over
        "look" -> File(files, words[1]).let { file -> "content=${if (file.isFile) file.readText().ifEmpty { "<empty>" } else "-"} tmp=${File(file.path + ".tmp").exists()}" }
        // ensure <path> <name> <reuse 0|1> <text>: Http.ensure for the file, as the module calls it, with the SHA-256 of <text> as the manifest's
        "ensure" -> {
          val before = server.requests.get()
          var damaged = "-"
          val expected = Http.encode(MessageDigest.getInstance("SHA-256").digest(words.drop(4).joinToString(" ").toByteArray()))
          val hash = Http.ensure(server.url(words[2]), emptyMap(), File(files, words[1]), expected, words[3] == "1") { damaged = it }
          "hash=$hash requests=${server.requests.get() - before} damaged=$damaged"
        }
        else -> "unknown command ${words[0]}"
      }
    } catch (error: Throwable) {
      "error ${error.javaClass.simpleName}: ${error.message}"
    }
    println(out)
  }
  server.stop()
}
