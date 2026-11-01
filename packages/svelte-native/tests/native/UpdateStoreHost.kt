package expo.modules.svelteupdates

import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import kotlin.concurrent.thread

// Host-side check of the Android updates store (UpdateStore.kt) and the QA reset decision (QaReset.kt): runs scripted commands from
// stdin against a real directory and prints one line per command. tests/updates-store-native.test.ts scripts the cases. Lives in the
// store's package because the classes are internal.

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

fun main() {
  val root = File(Files.createTempDirectory("svelte-updates-host").toFile(), "svelte-updates")
  var store = UpdateStore(root)
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
        "qa-throws" -> {
          val token = QaReset.requested(QaReset.PACKAGE) { throw SecurityException("denied") }
          "token=${token ?: "-"}"
        }
        else -> "unknown command ${words[0]}"
      }
    } catch (error: Throwable) {
      "error ${error.javaClass.simpleName}: ${error.message}"
    }
    println(out)
  }
}
