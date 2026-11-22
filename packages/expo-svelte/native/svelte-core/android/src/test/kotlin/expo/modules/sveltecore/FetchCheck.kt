package expo.modules.sveltecore

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import java.io.File
import java.io.FileInputStream
import java.net.ServerSocket
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Random
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger
import kotlin.system.exitProcess

// Host checks of the plain classes behind the SvelteFetch module (Fetcher, FetchCall, BodyBuffer, BlobData, ObjectUrls, Utf8, the file handles), against the
// repository's test server (tests/web-apis/fetch/support/server.ts) and the Encoding standard's own results (vectors.ts). No device, no Expo runtime, no Android SDK.
// Usage: FetchCheckKt <server base URL> <vectors file> <scratch directory> [lowmem]
// "lowmem" runs only the checks of large bodies and is meant for a JVM with a small heap (run.sh starts one with -Xmx64m): what must not exhaust memory.

private var passed = 0
private var failed = 0
private val settlements = AtomicInteger()
private val uncaught = AtomicInteger()

private fun check(name: String, ok: Boolean, detail: () -> String = { "" }) {
  if (ok) {
    passed++
  } else {
    failed++
    println("FAIL $name ${detail()}")
  }
}

private class Outcome<T>(val value: T?, val error: FetchError?) {
  val ok get() = error == null
}

/** Starts an operation that answers through a Reply and waits for the answer, which must come once. */
private fun <T> await(timeoutMs: Long = 20000, start: (Reply<T>) -> Unit): Outcome<T> {
  val done = CompletableFuture<Outcome<T>>()
  start(object : Reply<T> {
    override fun resolve(value: T) {
      if (!done.complete(Outcome(value, null))) settlements.incrementAndGet()
    }

    override fun reject(error: FetchError) {
      if (!done.complete(Outcome(null, error))) settlements.incrementAndGet()
    }
  })
  return try {
    done.get(timeoutMs, TimeUnit.MILLISECONDS)
  } catch (_: TimeoutException) {
    Outcome(null, FetchError("TEST_TIMEOUT", "no answer in $timeoutMs ms"))
  }
}

private fun ByteBuffer.toBytes(): ByteArray = ByteArray(remaining()).also { duplicate().get(it) }

private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

private fun sha256(bytes: ByteArray) = hex(MessageDigest.getInstance("SHA-256").digest(bytes))

private fun seeded(length: Int, seed: Int): ByteArray {
  val out = ByteArray(length)
  var x = if (seed == 0) 1 else seed
  for (i in 0 until length) {
    x = x xor (x shl 13)
    x = x xor (x ushr 17)
    x = x xor (x shl 5)
    out[i] = (x and 0xFF).toByte()
  }
  return out
}

private fun bytesOf(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

// A small reader for the server's JSON answers: enough for fields and header pairs.
private fun unquote(raw: String): String {
  val out = StringBuilder()
  var i = 1
  while (i < raw.length - 1) {
    val c = raw[i]
    if (c == '\\') {
      i++
      when (val e = raw[i]) {
        'n' -> out.append('\n')
        'r' -> out.append('\r')
        't' -> out.append('\t')
        'u' -> {
          out.append(raw.substring(i + 1, i + 5).toInt(16).toChar())
          i += 4
        }
        else -> out.append(e)
      }
    } else {
      out.append(c)
    }
    i++
  }
  return out.toString()
}

private fun field(json: String, name: String): String? {
  val match = Regex("\"$name\":(\"(?:[^\"\\\\]|\\\\.)*\"|[^,}\\]]+)").find(json) ?: return null
  val raw = match.groupValues[1]
  return if (raw.startsWith("\"")) unquote(raw) else raw
}

private val PAIR = Regex("\\[(\"(?:[^\"\\\\]|\\\\.)*\"),(\"(?:[^\"\\\\]|\\\\.)*\")\\]")

private fun echoHeaders(json: String): List<Pair<String, String>> {
  val section = json.substringAfter("\"headers\":[").substringBefore("],\"bodyLength\"")
  return PAIR.findAll(section).map { unquote(it.groupValues[1]) to unquote(it.groupValues[2]) }.toList()
}

private class Fx(val base: String, val env: Fetcher) {
  class Started(val call: FetchCall, val head: Outcome<ResponseHead>)

  fun start(
    path: String,
    method: String = "GET",
    headers: List<Pair<String, String>> = emptyList(),
    body: BlobData? = null,
    redirect: RedirectMode = RedirectMode.FOLLOW,
    credentials: Boolean = true,
    absolute: Boolean = false
  ): Started {
    val call = env.newCall()
    val head = await<ResponseHead> { call.start(if (absolute) path else base + path, RequestSpec(method, headers, credentials, redirect), body, it) }
    return Started(call, head)
  }

  fun bytes(call: FetchCall): Outcome<ByteArray> {
    val result = await<ByteBuffer> { call.arrayBuffer(it) }
    return Outcome(result.value?.toBytes(), result.error)
  }

  fun text(call: FetchCall): Outcome<String> = await { call.text(it) }

  /** The whole body of a GET, as bytes (null when anything failed). */
  fun get(path: String): Pair<ResponseHead, ByteArray>? {
    val started = start(path)
    val head = started.head.value ?: return null
    val body = bytes(started.call).value ?: return null
    return head to body
  }

  fun echo(
    method: String = "POST",
    headers: List<Pair<String, String>> = emptyList(),
    body: BlobData? = null,
    path: String = "/echo"
  ): String? {
    val started = start(path, method, headers, body)
    if (started.head.value == null) return null
    return bytes(started.call).value?.toString(Charsets.UTF_8)
  }
}

private fun ByteArray.blob() = BlobData.ofBytes(this)

private fun BlobData.bytes(): ByteArray = read(0, size) { ByteBuffer.allocateDirect(it) }.toBytes()

private fun Fx.header(head: ResponseHead, name: String) = head.headers.filter { it.first.equals(name, ignoreCase = true) }.map { it.second }

private class MemoryCookies : CookieJar {
  private val store = mutableListOf<Cookie>()

  @Synchronized
  override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
    for (cookie in cookies) {
      store.removeAll { it.name == cookie.name }
      store.add(cookie)
    }
  }

  @Synchronized
  override fun loadForRequest(url: HttpUrl): List<Cookie> = store.toList()

  @Synchronized
  fun clear() = store.clear()
}

fun main(args: Array<String>) {
  val base = args[0]
  val vectors = File(args[1])
  val scratch = File(args[2]).also { it.mkdirs() }
  val lowMemory = args.getOrNull(3) == "lowmem"
  // An exception that escapes a worker or OkHttp thread ends the app on Android; here it must not happen either.
  Thread.setDefaultUncaughtExceptionHandler { thread, error ->
    uncaught.incrementAndGet()
    println("UNCAUGHT in ${thread.name}: $error")
  }
  val executor = Executors.newCachedThreadPool { task -> Thread(task).apply { isDaemon = true } }
  val jar = MemoryCookies()
  // The client React Native builds: no timeouts, a cookie jar.
  val client = OkHttpClient.Builder().connectTimeout(0, TimeUnit.MILLISECONDS).readTimeout(0, TimeUnit.MILLISECONDS).writeTimeout(0, TimeUnit.MILLISECONDS).cookieJar(jar).build()
  val files = LocalFiles()
  // Direct buffers, as the module allocates them.
  val temps = TempFiles(File(scratch, "spill"))
  val env = Fetcher(client = { client }, files = files, executor = executor, alloc = { ByteBuffer.allocateDirect(it) }, temps = temps)
  val fx = Fx(base, env)

  // The server may still be starting.
  val deadline = System.currentTimeMillis() + 15000
  while (fx.start("/status/200").head.value == null) {
    if (System.currentTimeMillis() > deadline) {
      println("FAIL the test server at $base does not answer")
      exitProcess(1)
    }
    Thread.sleep(100)
  }

  if (lowMemory) {
    lowMemoryChecks(fx, scratch)
    check("no exception escaped a thread", uncaught.get() == 0) { "${uncaught.get()}" }
    println("fetch low-memory checks (heap ${Runtime.getRuntime().maxMemory() shr 20} MiB): $passed passed, $failed failed")
    exitProcess(if (failed == 0) 0 else 1)
  }

  utf8Checks(vectors)
  val afterUtf8 = passed
  fileHandleChecks(scratch)
  blobChecks(scratch, files)
  bytesChecks(fx)
  largeChecks(fx)
  bodyChecks(fx, scratch, files)
  multipartChecks(fx, scratch, files)
  redirectChecks(fx)
  statusAndHeaderChecks(fx)
  textChecks(fx)
  abortChecks(fx)
  streamChecks(fx)
  localFetchChecks(fx, scratch)
  errorChecks(fx)
  cookieChecks(fx, jar)
  spillChecks(fx, scratch)
  knownLengthChecks(fx, executor, scratch)
  exceptionChecks(fx, executor, scratch)
  contentChecks(fx, executor, scratch, temps)

  check("no exception escaped a thread", uncaught.get() == 0) { "${uncaught.get()}" }
  check("every reply settled exactly once", settlements.get() == 0) { "${settlements.get()} extra settlements" }
  println("  everything but the UTF-8 vectors: ${passed - afterUtf8} passed")
  println("fetch host checks: $passed passed, $failed failed")
  exitProcess(if (failed == 0) 0 else 1)
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------

private fun utf8Checks(vectors: File) {
  var decodes = 0
  var encodes = 0
  var slowPathDecodes = 0
  vectors.forEachLine { line ->
    val (kind, input, expected) = line.split(" ")
    if (kind == "D") {
      val bytes = if (input == "-") ByteArray(0) else ByteArray(input.length / 2) { input.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
      val got = hex(Utf8.decode(bytes).toByteArray(Charsets.UTF_8)).ifEmpty { "-" }
      decodes++
      check("utf8 decode $input", got == expected) { "got $got want $expected" }
      // The replacement path alone must agree with the standard too, not only the platform decoder in front of it.
      val start = if (bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()) 3 else 0
      val slow = hex(Utf8.decodeWithReplacement(bytes, start, bytes.size - start).toByteArray(Charsets.UTF_8)).ifEmpty { "-" }
      slowPathDecodes++
      check("utf8 replacement decode $input", slow == expected) { "got $slow want $expected" }
    } else {
      val units = if (input == "-") emptyList() else input.split(",").map { it.toInt(16) }
      val text = String(CharArray(units.size) { units[it].toChar() })
      val got = hex(Utf8.encode(text)).ifEmpty { "-" }
      encodes++
      check("utf8 encode $input", got == expected) { "got $got want $expected" }
    }
  }
  check("utf8 vectors were read", decodes > 60000 && encodes > 20000) { "$decodes decodes, $encodes encodes" }
  println("  utf8: $decodes decode vectors (platform decoder and replacement path), $encodes encode vectors")
  // What the platform alone does with a lone surrogate, which is why encode is written here.
  check("the platform writes ? for a lone surrogate, this does not", "\uD800".toByteArray(Charsets.UTF_8).contentEquals(bytesOf(0x3F)) && Utf8.encode("\uD800").contentEquals(bytesOf(0xEF, 0xBF, 0xBD)))
}

private fun fileHandleChecks(scratch: File) {
  val file = File(scratch, "stream-handle.bin").also { it.writeBytes(seeded(100000, 5)) }
  val handle = StreamHandle({ FileInputStream(file) })
  val expected = seeded(100000, 5)
  fun readAt(position: Long, length: Int): ByteArray {
    val buffer = ByteBuffer.allocate(length)
    val n = handle.read(position, buffer)
    return if (n < 0) ByteArray(0) else buffer.array().copyOf(n)
  }
  check("stream handle reads from the start", readAt(0, 100).contentEquals(expected.copyOfRange(0, 100)))
  check("stream handle reads forward", readAt(5000, 100).contentEquals(expected.copyOfRange(5000, 5100)))
  check("stream handle reads back", readAt(10, 100).contentEquals(expected.copyOfRange(10, 110)))
  check("stream handle reads at the end", readAt(99990, 100).contentEquals(expected.copyOfRange(99990, 100000)))
  check("stream handle past the end is -1", handle.read(100000, ByteBuffer.allocate(10)) == -1 && handle.read(200000, ByteBuffer.allocate(10)) == -1)
  check("stream handle does not count its size", handle.size == -1L && !handle.seekable)
  handle.close()
  val sized = StreamHandle({ FileInputStream(file) }, 100000)
  check("stream handle uses a declared size", sized.size == 100000L)
  sized.close()
}

private fun blobChecks(scratch: File, files: LocalFiles) {
  val fileBytes = seeded(5000, 21)
  val file = File(scratch, "blob source.bin").also { it.writeBytes(fileBytes) }
  val fileUrl = FileUrls.urlOf(file)
  check("file url escapes the space", fileUrl.contains("blob%20source.bin") && FileUrls.pathOf(fileUrl) == file.absolutePath) { fileUrl }

  val text = "héllo wörld ✓😀"
  val memory = bytesOf(1, 2, 3, 4, 5, 250, 251, 252)
  val fromFile = BlobData.ofFile(files, fileUrl)
  val blob = BlobData.concat(listOf(Utf8.encode(text).blob(), memory.blob(), fromFile, BlobData.EMPTY, bytesOf(9).blob()))
  val reference = Utf8.encode(text) + memory + fileBytes + bytesOf(9)
  check("blob size", blob.size == reference.size.toLong()) { "${blob.size} vs ${reference.size}" }
  check("blob bytes", blob.bytes().contentEquals(reference))
  check("blob memoryBytes counts memory only", blob.memoryBytes == Utf8.encode(text).size + memory.size + 1) { "${blob.memoryBytes}" }
  check("empty blob", BlobData.EMPTY.size == 0L && BlobData.EMPTY.bytes().isEmpty() && BlobData.concat(emptyList()).size == 0L)
  check("slice of everything is the blob itself", blob.slice(0, blob.size) === blob)
  check("empty slice is empty", blob.slice(7, 7).size == 0L && blob.slice(10, 3).size == 0L)
  check("read at the end is empty", blob.read(blob.size, 10) { ByteBuffer.allocate(it) }.remaining() == 0 && blob.read(blob.size + 100, 10) { ByteBuffer.allocate(it) }.remaining() == 0)
  check("read past the end is cut", blob.read(blob.size - 3, 100) { ByteBuffer.allocate(it) }.toBytes().contentEquals(reference.copyOfRange(reference.size - 3, reference.size)))

  // Random slices, slices of slices and reads, against a plain array.
  val random = Random(7)
  var fuzzOk = true
  var detail = ""
  for (round in 0 until 2000) {
    var data = blob
    var ref = reference
    repeat(1 + random.nextInt(3)) {
      val start = random.nextInt(ref.size + 1)
      val end = start + random.nextInt(ref.size - start + 1)
      data = data.slice(start.toLong(), end.toLong())
      ref = ref.copyOfRange(start, end)
    }
    val offset = random.nextInt(ref.size + 1)
    val length = random.nextInt(ref.size + 2)
    val expected = ref.copyOfRange(offset, minOf(ref.size, offset + length))
    val got = data.read(offset.toLong(), length.toLong()) { ByteBuffer.allocateDirect(it) }.toBytes()
    if (data.size != ref.size.toLong() || !got.contentEquals(expected)) {
      fuzzOk = false
      detail = "round $round"
      break
    }
  }
  check("2000 random slices and reads agree with an array", fuzzOk) { detail }

  // A Blob over a file whose file has shrunk fails to read rather than inventing bytes.
  val shrinking = File(scratch, "shrinking.bin").also { it.writeBytes(seeded(1000, 3)) }
  val over = BlobData.ofFile(files, FileUrls.urlOf(shrinking))
  shrinking.writeBytes(seeded(10, 3))
  val failure = try {
    over.bytes()
    null
  } catch (e: java.io.IOException) {
    e
  }
  check("a shrunk file is an IOException", failure != null)
  check("a missing file is a FileNotFoundException", try {
    BlobData.ofFile(files, "file:///does/not/exist/at/all")
    false
  } catch (_: java.io.FileNotFoundException) {
    true
  })

  // Object URLs.
  val dir = File(scratch, "cache/expo-svelte-blobs")
  val urls = ObjectUrls(dir)
  val url = urls.create(blob)
  val written = File(FileUrls.pathOf(url)!!)
  check("object URL is a file URL inside the directory", url.startsWith("file:///") && written.parentFile == dir && written.name.matches(Regex("[0-9a-f-]{36}"))) { url }
  check("object URL file holds the bytes", written.readBytes().contentEquals(reference))
  check("object URL exists", urls.exists(url))
  check("no partial file is left behind", dir.listFiles()!!.none { it.name.endsWith(".part") })
  val decoy = File(scratch, "decoy.txt").also { it.writeText("keep") }
  urls.revoke(FileUrls.urlOf(decoy))
  urls.revoke("file://" + dir.absolutePath + "/../decoy.txt")
  urls.revoke("https://example.com/x")
  urls.revoke("not a url")
  urls.revoke(FileUrls.urlOf(dir))
  check("revoke ignores anything outside the directory", decoy.exists() && dir.isDirectory)
  urls.revoke(url)
  check("revoke deletes the file", !written.exists() && !urls.exists(url))
  val first = urls.create(bytesOf(1).blob())
  val second = urls.create(bytesOf(2).blob())
  check("each create makes its own file", first != second)
  val old = File(dir, "old").also { it.writeBytes(bytesOf(1)); it.setLastModified(System.currentTimeMillis() - 60000) }
  urls.sweep(System.currentTimeMillis() - 1000)
  check("sweep deletes what is older than the cutoff and keeps the rest", !old.exists() && urls.exists(first) && urls.exists(second))
  urls.sweep(System.currentTimeMillis() + 60000)
  check("sweep past every file empties the directory", dir.listFiles()!!.isEmpty())
}

private fun bytesChecks(fx: Fx) {
  for (n in listOf(0, 1, 100, 65535, 65536, 1000001)) {
    val got = fx.get("/bytes?n=$n&seed=3")
    check("/bytes n=$n arrayBuffer", got != null && got.second.contentEquals(seeded(n, 3))) { "head ${got?.first?.status}" }
  }
  // read(): pieces of at most the size asked for, at least one byte, null at the end and after.
  run {
    val started = fx.start("/bytes?n=300000&seed=9")
    val call = started.call
    val out = java.io.ByteArrayOutputStream()
    var pieces = 0
    var sizesOk = true
    while (true) {
      val piece = await<ByteBuffer?> { call.read(1000, it) }
      val buffer = piece.value ?: break
      if (buffer.remaining() < 1 || buffer.remaining() > 1000) sizesOk = false
      out.write(buffer.toBytes())
      pieces++
    }
    check("read(1000) pieces are 1..1000 bytes", sizesOk)
    check("read(1000) reassembles the body", out.toByteArray().contentEquals(seeded(300000, 9))) { "${out.size()} bytes in $pieces pieces" }
    check("read at the end stays null", await<ByteBuffer?> { call.read(10, it) }.let { it.ok && it.value == null })
    check("a different consumer after read is BODY_USED", fx.bytes(call).error?.code == FetchCodes.BODY_USED)
  }
  run {
    val started = fx.start("/bytes?n=1000&seed=2")
    val first = fx.bytes(started.call)
    val second = fx.bytes(started.call)
    check("second arrayBuffer is BODY_USED", first.ok && second.error?.code == FetchCodes.BODY_USED)
    check("read after arrayBuffer is BODY_USED", await<ByteBuffer?> { started.call.read(10, it) }.error?.code == FetchCodes.BODY_USED)
    started.call.cancel()
    check("cancel after the body was read to its end has no effect", await<ByteBuffer?> { started.call.read(10, it) }.error?.code == FetchCodes.BODY_USED)
  }
  run {
    val started = fx.start("/bytes?n=70000&seed=4")
    val blob = await<BlobData> { started.call.blob(it) }
    check("blob() keeps the bytes", blob.value != null && blob.value!!.size == 70000L && blob.value!!.bytes().contentEquals(seeded(70000, 4)))
    check("blob() of an empty body", await<BlobData> { fx.start("/status/204").call.blob(it) }.value?.size == 0L)
  }
  run {
    val started = fx.start("/bytes?n=10")
    check("read right after the head works", await<ByteBuffer?> { started.call.read(100, it) }.value?.remaining() == 10)
    val unstarted = fx.env.newCall()
    check("read before start fails", await<ByteBuffer?> { unstarted.read(10, it) }.error?.code == FetchCodes.NETWORK)
    val twice = fx.start("/bytes?n=1")
    check("start twice is refused", await<ResponseHead> { twice.call.start(fx.base + "/bytes?n=1", RequestSpec("GET", emptyList(), true, RedirectMode.FOLLOW), null, it) }.error?.code == FetchCodes.NETWORK)
  }
}

private fun largeChecks(fx: Fx) {
  val expected = seeded(8 * 1024 * 1024, 11)
  // Backpressure: head received, nothing read. The pump must stop near 1 MiB although the server has 8 MiB to send.
  run {
    val started = fx.start("/large?mb=8")
    Thread.sleep(800)
    val idle = started.call.peakUnread
    check("an unread 8 MiB body is not buffered past 1 MiB", idle in 1..(BodyBuffer.HIGH_WATER + 65536L)) { "buffered $idle" }
    val out = java.io.ByteArrayOutputStream(expected.size)
    var reads = 0
    while (true) {
      val piece = await<ByteBuffer?> { started.call.read(65536, it) }
      val buffer = piece.value ?: break
      out.write(buffer.toBytes())
      // A slow consumer: the pump keeps pausing and resuming.
      if (++reads % 8 == 0) Thread.sleep(3)
    }
    check("8 MiB through a slow consumer arrives intact", out.size() == expected.size && sha256(out.toByteArray()) == sha256(expected)) { "${out.size()} bytes" }
    check("a slow consumer never had more than 1 MiB + a chunk unread", started.call.peakUnread <= BodyBuffer.HIGH_WATER + 65536L) { "peak ${started.call.peakUnread}" }
    println("  backpressure: $idle bytes buffered with nothing read, peak ${started.call.peakUnread} through a slow consumer (limit ${BodyBuffer.HIGH_WATER})")
  }
  // arrayBuffer asks for everything, so the pause is lifted.
  run {
    val started = fx.start("/large?mb=8")
    val got = fx.bytes(started.call)
    check("8 MiB arrayBuffer", got.value != null && got.value!!.size == expected.size && sha256(got.value!!) == sha256(expected))
    // The length is known, so the body is read straight into the buffer that is handed over: no heap chunks beyond what was read ahead before it was asked for.
    check("arrayBuffer fills its buffer directly, without collecting chunks", started.call.peakUnread <= BodyBuffer.HIGH_WATER + 65536L) { "peak ${started.call.peakUnread}" }
  }
  run {
    val started = fx.start("/large?mb=8")
    val blob = await<BlobData> { started.call.blob(it) }
    check("8 MiB blob stays native and intact", blob.value != null && blob.value!!.size == expected.size.toLong() && sha256(blob.value!!.bytes()) == sha256(expected))
  }
}

private fun bodyChecks(fx: Fx, scratch: File, files: LocalFiles) {
  // Each kind of request body arrives as the bytes JavaScript means.
  val mixed = "a\u00e9\u20ac\uD83D\uDE00\uD800z" // a, é, €, an emoji, a lone surrogate, z
  var echo = fx.echo(body = Utf8.encode(mixed).blob())
  check("string body is UTF-8 with U+FFFD for a lone surrogate", echo != null && field(echo, "bodyLength") == "14" && field(echo, "bodyText") == "a\u00e9\u20ac\uD83D\uDE00\uFFFDz") { echo ?: "no answer" }

  val all = ByteArray(256) { it.toByte() }
  echo = fx.echo(body = all.blob())
  check("Uint8Array body keeps every byte", echo != null && field(echo, "bodySha256") == sha256(all))

  echo = fx.echo()
  check("POST without a body sends an empty one", echo != null && field(echo, "bodyLength") == "0" && echoHeaders(echo).any { it.first == "content-length" && it.second == "0" }) { echo ?: "" }

  val big = seeded(3 * 1024 * 1024 + 17, 33)
  val bigFile = File(scratch, "upload.bin").also { it.writeBytes(big) }
  val fileBlob = BlobData.ofFile(files, FileUrls.urlOf(bigFile))
  echo = fx.echo(body = fileBlob)
  check("file-backed Blob is streamed from the file", echo != null && field(echo, "bodyLength") == big.size.toString() && field(echo, "bodySha256") == sha256(big))

  val joined = BlobData.concat(listOf(bytesOf(1, 2, 3).blob(), fileBlob.slice(1000, 2_000_000), "tail".toByteArray().blob()))
  val joinedReference = bytesOf(1, 2, 3) + big.copyOfRange(1000, 2_000_000) + "tail".toByteArray()
  echo = fx.echo(method = "PUT", body = joined)
  check("joined and sliced Blob body, PUT", echo != null && field(echo, "method") == "PUT" && field(echo, "bodySha256") == sha256(joinedReference))

  for (method in listOf("PATCH", "DELETE", "OPTIONS")) {
    echo = fx.echo(method = method, body = if (method == "OPTIONS") null else bytesOf(7, 7).blob())
    check("$method reaches the server", echo != null && field(echo, "method") == method) { echo ?: "" }
  }
  // Not /echo: under Bun the test server writes the body of a HEAD answer too, which desynchronises a reused connection (a server quirk, not the client's).
  val head = fx.start("/status/200", "HEAD")
  check("HEAD resolves with no body", head.head.value?.status == 200 && fx.bytes(head.call).value?.isEmpty() == true)

  // Headers: as given, in order, duplicates kept; no Content-Type of its own; the one given is left alone.
  echo = fx.echo(method = "POST", headers = listOf("X-A" to "1", "x-b" to "2", "X-A" to "3", "Content-Type" to "text/plain;charset=UTF-8"), body = bytesOf(65).blob())
  val sent = echo?.let { echoHeaders(it) } ?: emptyList()
  check("headers arrive in order with duplicates", sent.filter { it.first == "x-a" || it.first == "x-b" } == listOf("x-a" to "1", "x-b" to "2", "x-a" to "3")) { "$sent" }
  check("the Content-Type given is the one sent", sent.filter { it.first == "content-type" } == listOf("content-type" to "text/plain;charset=UTF-8")) { "$sent" }
  echo = fx.echo(method = "POST", body = bytesOf(65).blob())
  check("no Content-Type is added", echo != null && echoHeaders(echo).none { it.first == "content-type" }) { echo ?: "" }
  check("a header value with a line break is refused", fx.start("/echo", "GET", listOf("X-Bad" to "a\r\nX-Injected: 1")).head.error?.code == FetchCodes.NETWORK)
  check("a bad header name is refused", fx.start("/echo", "GET", listOf("bad name" to "x")).head.error?.code == FetchCodes.NETWORK)
  check("a body on GET is refused", fx.start("/echo", "GET", body = bytesOf(1).blob()).head.error?.code == FetchCodes.NETWORK)
}

private fun multipartChecks(fx: Fx, scratch: File, files: LocalFiles) {
  val file = File(scratch, "part.bin").also { it.writeBytes(seeded(300000, 77)) }
  val filePart = BlobData.ofFile(files, FileUrls.urlOf(file)).slice(1000, 201000)
  val filePartBytes = seeded(300000, 77).copyOfRange(1000, 201000)
  val memoryPart = "line one\r\nline two ✓".toByteArray()
  val crlfPart = bytesOf(13, 10, 13, 10, 0, 255, 13, 10)
  val boundary = "----expo-svelte-check-boundary"
  fun text(s: String) = s.toByteArray().blob()
  val body = BlobData.concat(
    listOf(
      text("--$boundary\r\nContent-Disposition: form-data; name=\"field\"\r\n\r\nhello\r\n"),
      text("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n"),
      filePart,
      text("\r\n--$boundary\r\nContent-Disposition: form-data; name=\"mem\"; filename=\"m.txt\"\r\nContent-Type: text/plain\r\n\r\n"),
      memoryPart.blob(),
      text("\r\n--$boundary\r\nContent-Disposition: form-data; name=\"binary\"\r\n\r\n"),
      crlfPart.blob(),
      text("\r\n--$boundary--\r\n")
    )
  )
  val answer = fx.echo(method = "POST", headers = listOf("Content-Type" to "multipart/form-data; boundary=$boundary"), body = body, path = "/multipart")
  val parts = answer?.let { Regex("\\{\"name\":.*?\"sha256\":\"([0-9a-f]+)\"").findAll(it).toList() } ?: emptyList()
  check("multipart composed from Blob segments: 4 parts", parts.size == 4) { answer ?: "no answer" }
  val expected = listOf(sha256("hello".toByteArray()), sha256(filePartBytes), sha256(memoryPart), sha256(crlfPart))
  check("multipart part sha256s", parts.map { it.groupValues[1] } == expected) { "${parts.map { it.groupValues[1] }} vs $expected" }
  check("multipart part lengths", answer != null && Regex("\"length\":(\\d+)").findAll(answer).map { it.groupValues[1].toInt() }.toList() == listOf(5, filePartBytes.size, memoryPart.size, crlfPart.size)) { answer ?: "" }
  check("multipart names and file names", answer != null && answer.contains("\"filename\":\"a.bin\"") && answer.contains("\"filename\":\"m.txt\"") && answer.contains("\"name\":\"binary\""))
}

private fun redirectChecks(fx: Fx) {
  var started = fx.start("/redirect?n=3")
  var head = started.head.value
  check("follow: 3 hops to /echo", head != null && head.status == 200 && head.url.endsWith("/echo") && head.redirected) { "${head?.status} ${head?.url}" }
  started = fx.start("/status/200")
  check("a response without redirects is not redirected", started.head.value?.redirected == false)

  val body = bytesOf(1, 2, 3, 4).blob()
  for (status in listOf(301, 302, 303)) {
    val echo = fx.echo(method = "POST", body = body, path = "/redirect?n=1&status=$status")
    check("POST $status follows as GET without the body", echo != null && field(echo, "method") == "GET" && field(echo, "bodyLength") == "0") { echo ?: "" }
  }
  for (status in listOf(307, 308)) {
    val echo = fx.echo(method = "POST", body = body, path = "/redirect?n=1&status=$status")
    check("POST $status follows as POST with the body", echo != null && field(echo, "method") == "POST" && field(echo, "bodySha256") == sha256(bytesOf(1, 2, 3, 4))) { echo ?: "" }
  }

  for (status in listOf(301, 302, 303, 307, 308)) {
    val error = fx.start("/redirect?n=1&status=$status", redirect = RedirectMode.ERROR).head.error
    check("error: $status rejects", error?.code == FetchCodes.REDIRECT) { "${error?.code}" }
  }
  check("error: a 300 or 304 is not a redirect to this mode", listOf(300, 304).all { fx.start("/status/$it", redirect = RedirectMode.ERROR).head.value?.status == it })
  check("error: a plain 200 resolves", fx.start("/bytes?n=1", redirect = RedirectMode.ERROR).head.value?.status == 200)

  started = fx.start("/redirect?n=2&status=302", redirect = RedirectMode.MANUAL)
  head = started.head.value
  check("manual: the redirect response itself resolves", head != null && head.status == 302 && !head.redirected && fx.header(head, "location") == listOf("/redirect?n=1&status=302")) { "${head?.status} ${head?.headers}" }
  check("manual: its body is empty", started.head.value != null && fx.bytes(started.call).value?.isEmpty() == true)

  for (target in listOf("ftp://example.com/x", "custom-scheme://open/it", "data:text/plain,hi", "http://")) {
    for (status in listOf(301, 302, 307)) {
      val error = fx.start("/redirect?to=${java.net.URLEncoder.encode(target, "UTF-8")}&status=$status").head.error
      check("follow: $status to $target is a network error", error?.code == FetchCodes.NETWORK) { "${error?.code} ${error?.message}" }
    }
  }
  val manualFtp = fx.start("/redirect?to=ftp%3A%2F%2Fexample.com%2Fx&status=302", redirect = RedirectMode.MANUAL).head.value
  check("manual: a redirect to ftp:// is still the 302", manualFtp?.status == 302 && fx.header(manualFtp, "location") == listOf("ftp://example.com/x"))
  check("follow: a 302 without a Location is the 302", fx.start("/status/302").head.value?.status == 302)
  check("follow: 20 redirects are followed", fx.start("/redirect?n=20").head.value?.status == 200)
  val tooMany = fx.start("/redirect?n=21").head.error
  check("follow: 21 redirects reject with ERR_FETCH_REDIRECT", tooMany?.code == FetchCodes.REDIRECT) { "${tooMany?.code} ${tooMany?.message}" }
}

private fun statusAndHeaderChecks(fx: Fx) {
  val expected = listOf(200 to "OK", 201 to "Created", 204 to "No Content", 404 to "Not Found", 418 to "I'm a Teapot", 500 to "Internal Server Error", 503 to "Service Unavailable")
  for ((code, phrase) in expected) {
    val started = fx.start("/status/$code")
    val head = started.head.value
    check("/status/$code", head != null && head.status == code && head.statusText == phrase) { "${head?.status} '${head?.statusText}'" }
    check("/status/$code has an empty body", fx.bytes(started.call).value?.isEmpty() == true)
  }
  val head = fx.start("/headers").head.value
  check("/headers resolves", head != null)
  if (head != null) {
    check("X-One", fx.header(head, "x-one") == listOf("1")) { "${head.headers}" }
    val multi = fx.header(head, "x-multi")
    check("X-Multi keeps its values (one joined line or two)", multi == listOf("a", "b") || multi == listOf("a, b")) { "$multi" }
    check("Set-Cookie stays two pairs, in order", fx.header(head, "set-cookie") == listOf("a=1", "b=2")) { "${head.headers}" }
    check("header names are as the server sent them", head.headers.any { it.first == "X-One" }) { "${head.headers}" }
  }
  val cookieless = fx.start("/headers", credentials = false).head.value
  check("omit still reports the Set-Cookie headers", cookieless != null && fx.header(cookieless, "set-cookie").size == 2)
}

private fun textChecks(fx: Fx) {
  val want = "h\u00e9llo \uFFFD( w\u00f6rld \u2713"
  var started = fx.start("/utf8")
  val text = fx.text(started.call)
  check("/utf8 text(): BOM dropped, invalid byte U+FFFD", text.value == want) { text.value?.map { "%04x".format(it.code) }.toString() }
  started = fx.start("/utf8")
  val raw = fx.bytes(started.call).value
  check("/utf8 arrayBuffer keeps the BOM and the invalid byte", raw != null && raw.take(3) == listOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) && raw.size == 3 + "h\u00e9llo ".toByteArray().size + 2 + " w\u00f6rld \u2713".toByteArray().size)
  check("/utf8 decoded from a Blob's bytes", raw != null && Utf8.decode(raw.blob().bytes()) == want)
  started = fx.start("/gzip")
  val gzip = started.head.value
  check("/gzip is decoded transparently", gzip != null && fx.header(gzip, "content-encoding").isEmpty())
  check("/gzip text", fx.text(started.call).value == "compressed ".repeat(1000))
}

private fun abortChecks(fx: Fx) {
  // Before the head.
  run {
    val call = fx.env.newCall()
    val started = System.nanoTime()
    val pending = CompletableFuture<FetchError?>()
    call.start(fx.base + "/no-head", RequestSpec("GET", emptyList(), true, RedirectMode.FOLLOW), null, object : Reply<ResponseHead> {
      override fun resolve(value: ResponseHead) {
        pending.complete(null)
      }

      override fun reject(error: FetchError) {
        pending.complete(error)
      }
    })
    Thread.sleep(300)
    check("the head is still pending after 300 ms", !pending.isDone)
    call.cancel()
    val error = try {
      pending.get(5, TimeUnit.SECONDS)
    } catch (_: TimeoutException) {
      null
    }
    val took = (System.nanoTime() - started) / 1_000_000
    check("abort before the head rejects with ERR_FETCH_ABORTED, promptly", error?.code == FetchCodes.ABORTED && took < 2000) { "${error?.code} after $took ms" }
    check("a read after the abort is ERR_FETCH_ABORTED", await<ByteBuffer?> { call.read(10, it) }.error?.code == FetchCodes.ABORTED)
    check("start after cancel is ERR_FETCH_ABORTED", await<ResponseHead> { fx.env.newCall().also { c -> c.cancel() }.start(fx.base + "/bytes", RequestSpec("GET", emptyList(), true, RedirectMode.FOLLOW), null, it) }.error?.code == FetchCodes.ABORTED)
  }
  // In the body: one byte arrives, the read after it is pending, the abort settles it.
  run {
    val started = fx.start("/hang")
    val call = started.call
    check("/hang resolves its head", started.head.value?.status == 200)
    val one = await<ByteBuffer?> { call.read(10, it) }
    check("/hang gives its one byte", one.value?.remaining() == 1)
    val pending = CompletableFuture<FetchError?>()
    call.read(10, object : Reply<ByteBuffer?> {
      override fun resolve(value: ByteBuffer?) {
        pending.complete(null)
      }

      override fun reject(error: FetchError) {
        pending.complete(error)
      }
    })
    Thread.sleep(200)
    check("the read is pending", !pending.isDone)
    val at = System.nanoTime()
    call.cancel()
    val error = try {
      pending.get(5, TimeUnit.SECONDS)
    } catch (_: TimeoutException) {
      null
    }
    check("abort in the body rejects the pending read with ERR_FETCH_ABORTED", error?.code == FetchCodes.ABORTED && (System.nanoTime() - at) / 1_000_000 < 2000) { "${error?.code}" }
    check("arrayBuffer after the abort is ERR_FETCH_ABORTED", fx.bytes(call).error?.code == FetchCodes.ABORTED)
    call.cancel()
  }
  // arrayBuffer pending on a body that never ends; release (the garbage collector) aborts it too.
  run {
    val started = fx.start("/hang")
    val pending = CompletableFuture<FetchError?>()
    started.call.arrayBuffer(object : Reply<ByteBuffer> {
      override fun resolve(value: ByteBuffer) {
        pending.complete(null)
      }

      override fun reject(error: FetchError) {
        pending.complete(error)
      }
    })
    Thread.sleep(200)
    started.call.release()
    val error = try {
      pending.get(5, TimeUnit.SECONDS)
    } catch (_: TimeoutException) {
      null
    }
    check("release rejects a pending arrayBuffer with ERR_FETCH_ABORTED", error?.code == FetchCodes.ABORTED) { "${error?.code}" }
  }
  // cancelAll, as on module destroy.
  run {
    val a = fx.start("/hang").call
    val pending = CompletableFuture<FetchError?>()
    a.arrayBuffer(object : Reply<ByteBuffer> {
      override fun resolve(value: ByteBuffer) {
        pending.complete(null)
      }

      override fun reject(error: FetchError) {
        pending.complete(error)
      }
    })
    fx.env.cancelAll()
    check("cancelAll aborts what is in flight", (try { pending.get(5, TimeUnit.SECONDS) } catch (_: TimeoutException) { null })?.code == FetchCodes.ABORTED)
  }
  // Abort while a large upload is being written.
  run {
    val upload = seeded(1 shl 20, 2).blob()
    val call = fx.env.newCall()
    val body = BlobData.concat(List(40) { upload })
    val head = CompletableFuture<FetchError?>()
    call.start(fx.base + "/no-head", RequestSpec("POST", emptyList(), true, RedirectMode.FOLLOW), body, object : Reply<ResponseHead> {
      override fun resolve(value: ResponseHead) {
        head.complete(null)
      }

      override fun reject(error: FetchError) {
        head.complete(error)
      }
    })
    Thread.sleep(300)
    call.cancel()
    check("abort during an upload rejects with ERR_FETCH_ABORTED", head.get(5, TimeUnit.SECONDS)?.code == FetchCodes.ABORTED)
  }
}

private fun streamChecks(fx: Fx) {
  val started = fx.start("/stream?chunks=5&size=1000&delay=120")
  val headAt = System.nanoTime()
  val call = started.call
  val first = await<ByteBuffer?> { call.read(100000, it) }
  val firstAt = (System.nanoTime() - headAt) / 1_000_000
  check("the first piece resolves before the body is complete", first.value != null && firstAt < 450) { "after $firstAt ms" }
  val out = java.io.ByteArrayOutputStream()
  out.write(first.value!!.toBytes())
  var pieces = 1
  while (true) {
    val piece = await<ByteBuffer?> { call.read(100000, it) }.value ?: break
    out.write(piece.toBytes())
    pieces++
  }
  check("a delayed stream arrives in several pieces, intact", pieces >= 2 && out.toByteArray().contentEquals(seeded(5000, 7))) { "$pieces pieces, ${out.size()} bytes" }
}

private fun localFetchChecks(fx: Fx, scratch: File) {
  val dir = File(scratch, "dir with space").also { it.mkdirs() }
  val file = File(dir, "a b.bin").also { it.writeBytes(seeded(100000, 12)) }
  val url = FileUrls.urlOf(file)
  val started = fx.start(url, absolute = true)
  val head = started.head.value
  check("file:// answers 200 with Content-Length only", head != null && head.status == 200 && head.statusText == "" && head.headers == listOf("Content-Length" to "100000") && head.url == url && !head.redirected) { "${head?.status} ${head?.headers}" }
  check("file:// body", fx.bytes(started.call).value?.contentEquals(seeded(100000, 12)) == true)
  check("file:// with host localhost", fx.start("file://localhost" + file.absolutePath.replace(" ", "%20"), absolute = true).head.value?.status == 200)
  val read = fx.start(url, absolute = true).call
  val pieces = mutableListOf<Int>()
  var total = 0
  while (true) {
    val piece = await<ByteBuffer?> { read.read(30000, it) }.value ?: break
    pieces.add(piece.remaining())
    total += piece.remaining()
  }
  check("file:// read() pieces", total == 100000 && pieces.all { it in 1..30000 }) { "$pieces" }
  check("file:// as a Blob", await<BlobData> { fx.start(url, absolute = true).call.blob(it) }.value?.bytes()?.contentEquals(seeded(100000, 12)) == true)
  check("file:// empty file", fx.start(FileUrls.urlOf(File(dir, "empty").also { it.writeBytes(ByteArray(0)) }), absolute = true).let { it.head.value?.status == 200 && fx.bytes(it.call).value?.isEmpty() == true })
  for (bad in listOf("file:///does/not/exist", FileUrls.urlOf(dir), "file://otherhost/etc/passwd", "content://media/external/file/1")) {
    check("file fetch of $bad is ERR_FETCH_NETWORK", fx.start(bad, absolute = true).head.error?.code == FetchCodes.NETWORK)
  }
  val abort = fx.start(url, absolute = true).call
  abort.cancel()
  check("a file fetch can be aborted", await<ByteBuffer?> { abort.read(10, it) }.error?.code == FetchCodes.ABORTED)
}

private fun errorChecks(fx: Fx) {
  check("ftp:// is ERR_FETCH_URL", fx.start("ftp://example.com/x", absolute = true).head.error?.code == FetchCodes.URL)
  check("a URL without a scheme is ERR_FETCH_URL", fx.start("example.com/x", absolute = true).head.error?.code == FetchCodes.URL)
  check("http:// with no host is ERR_FETCH_URL", fx.start("http://", absolute = true).head.error?.code == FetchCodes.URL)
  val refused = ServerSocket(0).let { s -> s.localPort.also { s.close() } }
  val refusal = fx.start("http://127.0.0.1:$refused/", absolute = true).head.error
  check("a refused connection is ERR_FETCH_NETWORK and says so", refusal?.code == FetchCodes.NETWORK && refusal.message!!.isNotEmpty()) { "${refusal?.code} ${refusal?.message}" }
  val dns = fx.start("http://no-such-host.invalid/", absolute = true).head.error
  check("a failed DNS lookup is ERR_FETCH_NETWORK", dns?.code == FetchCodes.NETWORK) { "${dns?.code} ${dns?.message}" }
  println("  network messages: refused='${refusal?.message}' dns='${dns?.message}'")

  // A body cut short: the server promises 100 bytes, sends 3, and closes.
  val server = ServerSocket(0)
  Thread {
    server.accept().use { socket ->
      val input = socket.getInputStream()
      var tail = 0
      while (tail != 0x0d0a0d0a) tail = (tail shl 8) or input.read()
      socket.getOutputStream().apply {
        write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\nContent-Type: text/plain\r\n\r\nabc".toByteArray())
        flush()
      }
      Thread.sleep(100)
    }
  }.apply { isDaemon = true }.start()
  val cut = fx.start("http://127.0.0.1:${server.localPort}/", absolute = true)
  val cutBody = fx.bytes(cut.call)
  check("a body cut short is ERR_FETCH_NETWORK", cut.head.ok && cutBody.error?.code == FetchCodes.NETWORK) { "${cutBody.error?.code} ${cutBody.error?.message}" }
  println("  cut short: '${cutBody.error?.message}'")
  server.close()
}

private fun cookieChecks(fx: Fx, jar: MemoryCookies) {
  jar.clear() // earlier checks (/headers sends Set-Cookie) filled it
  fx.start("/set-cookie?name=a&value=1").also { fx.bytes(it.call) }
  var answer = fx.echo("GET", path = "/cookies")
  check("include: the cookie set is sent back", answer != null && field(answer, "cookie") == "a=1") { answer ?: "" }
  fx.start("/set-cookie?name=b&value=2", credentials = false).also { fx.bytes(it.call) }
  answer = fx.start("/cookies").let { fx.bytes(it.call).value?.toString(Charsets.UTF_8) }
  check("omit: Set-Cookie is ignored", answer != null && field(answer, "cookie") == "a=1") { answer ?: "" }
  answer = fx.start("/cookies", credentials = false).let { fx.bytes(it.call).value?.toString(Charsets.UTF_8) }
  check("omit: no Cookie is sent", answer != null && field(answer, "cookie") == "null") { answer ?: "" }
  check("the shared jar saw only the include request's cookie", jar.loadForRequest(HttpUrl.Builder().scheme("http").host("localhost").build()).map { it.name } == listOf("a"))
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Memory: a body that does not fit is an error or a file, never a dead thread; a Blob that is too big to keep goes to a file that goes away with the Blob.

private fun seededDigest(length: Long, seed: Int): String {
  val digest = MessageDigest.getInstance("SHA-256")
  var x = if (seed == 0) 1 else seed
  val buffer = ByteArray(1 shl 20)
  var left = length
  while (left > 0) {
    val n = minOf(left, buffer.size.toLong()).toInt()
    for (i in 0 until n) {
      x = x xor (x shl 13)
      x = x xor (x ushr 17)
      x = x xor (x shl 5)
      buffer[i] = (x and 0xFF).toByte()
    }
    digest.update(buffer, 0, n)
    left -= n
  }
  return hex(digest.digest())
}

/** The SHA-256 of a Blob, read a MiB at a time, so a Blob larger than the heap can be checked. */
private fun blobDigest(blob: BlobData): String {
  val digest = MessageDigest.getInstance("SHA-256")
  var offset = 0L
  while (offset < blob.size) {
    val piece = blob.read(offset, 1L shl 20) { ByteBuffer.allocateDirect(it) }
    digest.update(piece.toBytes())
    offset += piece.remaining()
  }
  return hex(digest.digest())
}

private fun waitUntil(timeoutMs: Long, condition: () -> Boolean): Boolean {
  val end = System.currentTimeMillis() + timeoutMs
  while (System.currentTimeMillis() < end) {
    if (condition()) return true
    System.gc()
    Thread.sleep(100)
  }
  return condition()
}

private fun spillChecks(fx: Fx, scratch: File) {
  val spillDir = File(scratch, "spill")
  fun spillFiles() = spillDir.listFiles()?.size ?: 0

  // Under 16 MiB the bytes stay in memory.
  val before = spillFiles()
  val small = await<BlobData> { fx.start("/large?mb=8").call.blob(it) }.value
  check("an 8 MiB body as a Blob stays in memory", small != null && small.size == 8L * 1024 * 1024 && small.memoryBytes == 8 * 1024 * 1024 && spillFiles() == before)

  // Past it they go to a file: the Blob is a file range plus what had arrived since the last write. Everything that refers to the Blob stays inside this
  // function, so what is left afterwards is the slice in `held`, and the garbage collector can tell when the file is not needed.
  fun spilledSlice(held: Array<BlobData?>): File? {
    val whole = await<BlobData> { fx.start("/large?mb=20").call.blob(it) }.value
    val file = spillDir.listFiles()?.maxByOrNull { it.lastModified() }
    if (whole == null || file == null) {
      check("a 20 MiB body as a Blob arrives", false)
      return null
    }
    check("a 20 MiB body as a Blob: size", whole.size == 20L * 1024 * 1024) { "${whole.size}" }
    check("a 20 MiB body as a Blob: bytes intact", blobDigest(whole) == seededDigest(20L * 1024 * 1024, 11))
    check("a 20 MiB body as a Blob went to a file and left little in memory", file.length() >= 16L * 1024 * 1024 && whole.memoryBytes < 2 * 1024 * 1024) { "file ${file.length()}, memory ${whole.memoryBytes}" }
    val slice = whole.slice(3_000_000, 4_000_000)
    check("a slice of a spilled Blob reads right", slice.bytes().contentEquals(seeded(4_000_000, 11).copyOfRange(3_000_000, 4_000_000)))
    held[0] = slice
    return file
  }
  val held = arrayOfNulls<BlobData>(1)
  val file = spilledSlice(held) ?: return
  check("the file is kept while a slice of it is reachable", !waitUntil(1500) { !file.exists() })
  check("the slice still reads", held[0]!!.bytes().size == 1_000_000)
  held[0] = null
  check("the file is deleted once nothing refers to it", waitUntil(20000) { !file.exists() }) { "still there" }
}

private fun knownLengthChecks(fx: Fx, executor: java.util.concurrent.Executor, scratch: File) {
  // A body longer than one buffer holds is refused up front, without trying to allocate it.
  // (The source is more than the pump reads ahead: a body that has already arrived whole needs no buffer to be filled.)
  val tooLong = BodyBuffer(okio.Buffer().write(ByteArray(2 shl 20)), {}, executor, { ByteBuffer.allocate(it) }, expectedLength = 3L shl 30)
  tooLong.start()
  val refusal = await<ByteBuffer> { tooLong.readAllBytes({ ByteBuffer.allocate(it) }, it) }.error
  check("a body of 3 GiB is ERR_FETCH_NETWORK, not an overflow", refusal?.code == FetchCodes.NETWORK && refusal.message!!.contains("more than one buffer")) { "${refusal?.code} ${refusal?.message}" }

  // An unknown length stops collecting at the limit.
  val limited = BodyBuffer(okio.Buffer().write(ByteArray(300_000)), {}, executor, { ByteBuffer.allocate(it) }, highWater = 65536, maxBuffer = 100_000)
  limited.start()
  val limit = await<ByteBuffer> { limited.readAllBytes({ ByteBuffer.allocate(it) }, it) }.error
  check("a body past the buffer limit is ERR_FETCH_NETWORK", limit?.code == FetchCodes.NETWORK) { "${limit?.code} ${limit?.message}" }
  val within = BodyBuffer(okio.Buffer().write(ByteArray(50_000) { 7 }), {}, executor, { ByteBuffer.allocate(it) }, maxBuffer = 100_000)
  check("a body within the limit is collected", await<ByteBuffer> { within.readAllBytes({ ByteBuffer.allocate(it) }, it) }.value?.remaining() == 50_000)

  // A body that falls short of its declared length, without an error from the transport: the buffer handed over has the length that arrived.
  val short = Fetcher(client = { OkHttpClient() }, files = FilesThat(1000, 600), executor = executor, alloc = { ByteBuffer.allocateDirect(it) })
  val shortCall = short.newCall()
  val head = await<ResponseHead> { shortCall.start("file:///short", RequestSpec("GET", emptyList(), true, RedirectMode.FOLLOW), null, it) }
  val answer = await<ByteBuffer> { shortCall.arrayBuffer(it) }.value
  check("a file shorter than its size is an exact buffer of what arrived", head.value?.headers == listOf("Content-Length" to "1000") && answer != null && answer.remaining() == 600 && answer.capacity() == 600) { "${answer?.remaining()} of ${answer?.capacity()}" }

  // Spill, with the limits made small so that a MiB-sized body shows it.
  val spillDir = File(scratch, "unit-spill")
  val temps = TempFiles(spillDir)
  val payload = seeded(5 * 1024 * 1024, 41)
  val spilling = BodyBuffer(okio.Buffer().write(payload), {}, executor, { ByteBuffer.allocateDirect(it) }, temps = temps, spillAfter = 1024 * 1024)
  spilling.start()
  val spilled = await<BlobData> { spilling.readAllBlob(it) }.value
  check("a Blob past the spill limit is intact", spilled != null && spilled.size == payload.size.toLong() && spilled.bytes().contentEquals(payload))
  check("a Blob past the spill limit keeps only a tail in memory", spilled != null && spilled.memoryBytes <= BodyBuffer.SPILL_STEP + 65536 && spillDir.listFiles()!!.size == 1) { "${spilled?.memoryBytes} in memory" }
  val keeping = BodyBuffer(okio.Buffer().write(payload), {}, executor, { ByteBuffer.allocateDirect(it) }, temps = null, spillAfter = 1024 * 1024)
  keeping.start()
  check("without a place to spill the Blob stays in memory", await<BlobData> { keeping.readAllBlob(it) }.value?.memoryBytes == payload.size)
  val broken = BodyBuffer(okio.Buffer().write(payload), {}, executor, { ByteBuffer.allocateDirect(it) }, temps = TempFiles(File("/proc/no/such/directory")), spillAfter = 1024 * 1024)
  broken.start()
  check("a spill that cannot be written is ERR_FETCH_NETWORK", await<BlobData> { broken.readAllBlob(it) }.error?.code == FetchCodes.NETWORK)
}

/** Files whose handle says `declared` bytes and yields `actual`: the shrunk-file case without a race. */
private class FilesThat(private val declared: Long, private val actual: Int) : FileAccess {
  override fun open(uri: String): FileHandle = object : FileHandle {
    override val size = declared

    override fun read(position: Long, dst: ByteBuffer): Int {
      if (position >= actual) return -1
      val n = minOf(dst.remaining().toLong(), actual - position).toInt()
      dst.put(ByteArray(n) { 9 })
      return n
    }

    override fun close() {}
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Exceptions from providers and replies: each ends in the contract's error (or is swallowed where nobody can be told), none on a thread that dies.

private class ThrowingFiles(private val openFails: () -> RuntimeException?, private val readFails: () -> RuntimeException? = { null }, private val inner: FileAccess? = null) : FileAccess {
  var opens = 0

  override fun open(uri: String): FileHandle {
    opens++
    openFails()?.let { throw it }
    val real = inner?.open(uri)
    return object : FileHandle {
      override val size: Long = real?.size ?: 10

      override fun read(position: Long, dst: ByteBuffer): Int {
        readFails()?.let { throw it }
        return real?.read(position, dst) ?: -1
      }

      override fun close() {
        real?.close()
      }
    }
  }
}

private fun exceptionChecks(fx: Fx, executor: java.util.concurrent.Executor, scratch: File) {
  val request = RequestSpec("GET", emptyList(), true, RedirectMode.FOLLOW)

  // A provider that throws something other than an IOException when opened.
  for ((name, error) in listOf("IllegalStateException" to IllegalStateException("provider bug"), "SecurityException" to SecurityException("no permission"), "NullPointerException" to NullPointerException(), "UnsupportedOperationException" to UnsupportedOperationException())) {
    val env = Fetcher(client = { OkHttpClient() }, files = ThrowingFiles({ error }), executor = executor, alloc = { ByteBuffer.allocateDirect(it) })
    val call = env.newCall()
    val answer = await<ResponseHead> { call.start("content://provider/item", request, null, it) }.error
    check("a provider's $name on open is ERR_FETCH_NETWORK", answer?.code == FetchCodes.NETWORK && answer.message!!.contains("Cannot open")) { "${answer?.code} ${answer?.message}" }
    check("a provider's $name on open is an IOException for a Blob", try {
      BlobData.ofFile(ThrowingFiles({ error }), "content://provider/item")
      false
    } catch (_: java.io.IOException) {
      true
    })
  }

  // A provider that fails while reading, mid-body.
  val readFails = ThrowingFiles({ null }, { IllegalStateException("provider died") })
  val reading = Fetcher(client = { OkHttpClient() }, files = readFails, executor = executor, alloc = { ByteBuffer.allocateDirect(it) }).newCall()
  check("a provider that throws on read is a rejected body", await<ResponseHead> { reading.start("content://provider/item", request, null, it) }.ok && await<ByteBuffer> { reading.arrayBuffer(it) }.error?.code == FetchCodes.NETWORK)

  // A Blob over a file that opened once and then does not: uploaded, the failure comes on OkHttp's own thread, where it must become the head's error.
  val file = File(scratch, "flaky.bin").also { it.writeBytes(seeded(100000, 6)) }
  var failNow = false
  val flaky = ThrowingFiles({ if (failNow) SecurityException("revoked") else null }, inner = LocalFiles())
  val flakyBlob = BlobData.ofFile(flaky, FileUrls.urlOf(file))
  failNow = true
  val upload = fx.start("/echo", "POST", body = flakyBlob).head.error
  check("a file that cannot be opened while uploading is ERR_FETCH_NETWORK", upload?.code == FetchCodes.NETWORK) { "${upload?.code} ${upload?.message}" }

  // A stream that cannot be reopened (a revoked permission), asked for an earlier position.
  var reopens = 0
  val stream = StreamHandle({
    if (reopens++ > 0) throw SecurityException("revoked") else java.io.FileInputStream(file)
  })
  stream.read(0, ByteBuffer.allocate(1000))
  check("a stream that cannot be reopened is an IOException", try {
    stream.read(10, ByteBuffer.allocate(10))
    false
  } catch (_: java.io.IOException) {
    true
  })

  // A source that fails to close, and replies that throw: nothing may take the pump thread down.
  val closing = BodyBuffer(okio.Buffer().write(ByteArray(5000) { 3 }), { throw IllegalStateException("cannot close") }, executor, { ByteBuffer.allocateDirect(it) })
  closing.start()
  var total = 0
  while (true) {
    val piece = await<ByteBuffer?> { closing.read(1000, it) }.value ?: break
    total += piece.remaining()
  }
  check("a release that throws does not stop the body", total == 5000) { "$total" }
  val replying = BodyBuffer(okio.Buffer().write(ByteArray(4000) { 5 }), {}, executor, { ByteBuffer.allocateDirect(it) })
  replying.start()
  replying.read(10, object : Reply<ByteBuffer?> {
    override fun resolve(value: ByteBuffer?) = throw IllegalStateException("the promise is gone")

    override fun reject(error: FetchError) = throw IllegalStateException("the promise is gone")
  })
  Thread.sleep(100)
  check("a reply that throws does not stop the body", await<ByteBuffer?> { replying.read(100000, it) }.value?.remaining() == 3990)
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// content:// through a provider that gives only a stream.

private fun contentChecks(fx: Fx, executor: java.util.concurrent.Executor, scratch: File, temps: TempFiles) {
  val data = seeded(300_000, 52)
  val source = File(scratch, "pipe.bin").also { it.writeBytes(data) }
  var opens = 0
  val pipes = object : FileAccess {
    override fun open(uri: String): FileHandle {
      opens++
      return StreamHandle({ java.io.FileInputStream(source) })
    }
  }
  val blob = BlobData.ofFile(pipes, "content://provider/pipe", temps)
  check("a stream with no size is copied once into a Blob of the right size", blob.size == 300_000L && blob.bytes().contentEquals(data)) { "${blob.size}" }
  val openedForCopy = opens
  check("the stream was opened once for the copy", openedForCopy == 1) { "$openedForCopy" }
  val random = Random(11)
  var allRight = true
  repeat(200) {
    val offset = random.nextInt(300_000)
    val length = 1 + random.nextInt(20_000)
    if (!blob.read(offset.toLong(), length.toLong()) { ByteBuffer.allocate(it) }.toBytes().contentEquals(data.copyOfRange(offset, minOf(300_000, offset + length)))) allRight = false
  }
  check("200 reads at random positions are right", allRight)
  check("reading the Blob never reopens the provider's stream", opens == openedForCopy) { "$opens opens" }
  check("without a place for the copy a pipe cannot be a Blob", try {
    BlobData.ofFile(pipes, "content://provider/pipe")
    false
  } catch (_: java.io.IOException) {
    true
  })

  // Fetched, the stream is read forward once, with no Content-Length as the size is unknown.
  opens = 0
  val env = Fetcher(client = { OkHttpClient() }, files = pipes, executor = executor, alloc = { ByteBuffer.allocateDirect(it) }, temps = temps)
  val call = env.newCall()
  val head = await<ResponseHead> { call.start("content://provider/pipe", RequestSpec("GET", emptyList(), true, RedirectMode.FOLLOW), null, it) }.value
  val body = await<ByteBuffer> { call.arrayBuffer(it) }.value
  check("a content:// stream is fetched once, forward, without a size", head?.status == 200 && head.headers.isEmpty() && body != null && body.toBytes().contentEquals(data) && opens == 1) { "${head?.headers} opens $opens" }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Run with a 64 MiB heap: what is too big to hold fails the one fetch (or goes to a file), and the process carries on.

private fun lowMemoryChecks(fx: Fx, scratch: File) {
  val mib = 1024L * 1024
  val spillDir = File(scratch, "spill")
  check("the heap is small", Runtime.getRuntime().maxMemory() < 100 * mib) { "${Runtime.getRuntime().maxMemory() shr 20} MiB" }

  var started = fx.start("/large?mb=200")
  var error = fx.bytes(started.call).error
  check("200 MiB as arrayBuffer: ERR_FETCH_NETWORK, not out of memory", error?.code == FetchCodes.NETWORK && error.message!!.contains("memory")) { "${error?.code} ${error?.message}" }

  started = fx.start("/large?mb=200")
  error = fx.text(started.call).error
  check("200 MiB as text: ERR_FETCH_NETWORK, not out of memory", error?.code == FetchCodes.NETWORK && error.message!!.contains("memory")) { "${error?.code} ${error?.message}" }

  // No Content-Length (chunked): the pump collects chunks until it cannot, and says so.
  started = fx.start("/stream?chunks=100&size=2097152&delay=0")
  error = fx.bytes(started.call).error
  check("200 MiB of unknown length as arrayBuffer: ERR_FETCH_NETWORK from the pump, which lives", error?.code == FetchCodes.NETWORK && error.message!!.contains("memory")) { "${error?.code} ${error?.message}" }
  started = fx.start("/stream?chunks=100&size=2097152&delay=0")
  error = fx.text(started.call).error
  check("200 MiB of unknown length as text: ERR_FETCH_NETWORK", error?.code == FetchCodes.NETWORK) { "${error?.code} ${error?.message}" }

  // As a Blob the same bodies are fine: they go to files.
  started = fx.start("/large?mb=200")
  val blob = await<BlobData> { started.call.blob(it) }
  check("200 MiB as a Blob arrives", blob.ok && blob.value!!.size == 200 * mib) { "${blob.error?.code} ${blob.error?.message}" }
  check("200 MiB as a Blob is intact", blob.value != null && blobDigest(blob.value!!) == seededDigest(200 * mib, 11))
  check("200 MiB as a Blob left little in memory", blob.value != null && blob.value!!.memoryBytes < 2 * mib && (spillDir.listFiles()?.size ?: 0) >= 1) { "${blob.value?.memoryBytes}" }

  started = fx.start("/stream?chunks=100&size=2097152&delay=0")
  val chunked = await<BlobData> { started.call.blob(it) }
  check("200 MiB of unknown length as a Blob is intact", chunked.ok && chunked.value!!.size == 200 * mib && blobDigest(chunked.value!!) == seededDigest(200 * mib, 7)) { "${chunked.error?.message}" }

  // And the process still fetches.
  val small = fx.get("/bytes?n=1000&seed=3")
  check("an ordinary fetch works afterwards", small != null && small.second.contentEquals(seeded(1000, 3)))
}
