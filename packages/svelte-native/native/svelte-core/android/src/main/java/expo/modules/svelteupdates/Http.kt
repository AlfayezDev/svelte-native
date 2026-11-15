package expo.modules.svelteupdates

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.DigestInputStream
import java.security.MessageDigest

/** Plain `HttpURLConnection` GETs: the manifest request and the asset downloads. */
internal object Http {
  private const val CONNECT_TIMEOUT_MS = 15_000
  private const val READ_TIMEOUT_MS = 30_000
  private const val BUFFER_SIZE = 64 * 1024

  class Response(val status: Int, val headers: Map<String, String>, val body: String)

  private fun open(url: String, headers: Map<String, String>): HttpURLConnection {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = CONNECT_TIMEOUT_MS
    connection.readTimeout = READ_TIMEOUT_MS
    connection.requestMethod = "GET"
    for ((name, value) in headers) connection.setRequestProperty(name, value)
    return connection
  }

  /** Response headers with lowercase names; a header sent several times is joined with ", ". */
  private fun headersOf(connection: HttpURLConnection): Map<String, String> =
    connection.headerFields.entries
      .filter { it.key != null }
      .associate { it.key.lowercase() to it.value.joinToString(", ") }

  private fun text(connection: HttpURLConnection): String {
    val stream = if (connection.responseCode in 200..399) connection.inputStream else connection.errorStream
    return stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
  }

  fun request(url: String, headers: Map<String, String>): Response {
    val connection = open(url, headers)
    try {
      return Response(connection.responseCode, headersOf(connection), text(connection))
    } finally {
      connection.disconnect()
    }
  }

  /**
   * Streams `url` into a temporary file beside `destination` while hashing it, and moves it into place only if its
   * SHA-256 (base64url, no padding) is `expectedHash`. Returns the hash it computed.
   *
   * The temporary file is synced before the rename. Without that, a crash or a power cut shortly after leaves the final name
   * with no data behind it (a file of 0 bytes, which the store would trust as a bundle or as an asset it had verified).
   */
  fun download(url: String, headers: Map<String, String>, destination: File, expectedHash: String): String {
    val connection = open(url, headers)
    val temporary = File(destination.path + ".tmp")
    try {
      if (connection.responseCode !in 200..299) throw IOException("Download of $url failed with status ${connection.responseCode}: ${text(connection).take(300)}")
      destination.parentFile?.mkdirs()
      val digest = MessageDigest.getInstance("SHA-256")
      DigestInputStream(connection.inputStream, digest).use { input ->
        FileOutputStream(temporary).use { output ->
          input.copyTo(output)
          output.fd.sync()
        }
      }
      val hash = encode(digest.digest())
      if (hash != expectedHash) throw IOException("Download of $url has SHA-256 $hash, expected $expectedHash")
      // `rename` replaces an existing file in one step; two assets with identical content share a name.
      if (!temporary.renameTo(destination)) {
        temporary.copyTo(destination, true)
      }
      return hash
    } finally {
      temporary.delete()
      connection.disconnect()
    }
  }

  /**
   * The file at `destination` with SHA-256 `expectedHash`, downloaded unless it is already there. A file in place counts only if it
   * hashes to `expectedHash`: one that does not (data lost to a crash, damaged storage) is reported to `onDamaged` with its hash and
   * replaced by a download, which is itself held to `expectedHash`, so bytes that are not the manifest's are still rejected.
   * `reuse` is false for a file that belongs to one update (the bundle), which is always downloaded. Returns the hash of the file.
   */
  fun ensure(url: String, headers: Map<String, String>, destination: File, expectedHash: String, reuse: Boolean, onDamaged: (actual: String) -> Unit): String {
    if (reuse && destination.isFile) {
      val actual = sha256(destination)
      if (actual == expectedHash) return actual
      onDamaged(actual)
    }
    return download(url, headers, destination, expectedHash)
  }

  fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(BUFFER_SIZE)
    DigestInputStream(file.inputStream(), digest).use { input -> while (input.read(buffer) != -1) { /* reading feeds the digest */ } }
    return encode(digest.digest())
  }

  private const val BASE64_URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

  /** Base64url without padding, written out because `java.util.Base64` needs API 26 (minSdk is 24) and `android.util.Base64` does not run on the host the tests use. */
  internal fun encode(bytes: ByteArray): String {
    val result = StringBuilder((bytes.size * 4 + 2) / 3)
    var index = 0
    while (index < bytes.size) {
      val remaining = minOf(3, bytes.size - index)
      var group = 0
      for (offset in 0 until 3) group = (group shl 8) or (if (offset < remaining) bytes[index + offset].toInt() and 0xff else 0)
      // 3 bytes make 4 characters; a final group of 1 or 2 bytes makes 2 or 3.
      for (position in 0..remaining) result.append(BASE64_URL[(group shr (18 - 6 * position)) and 63])
      index += remaining
    }
    return result.toString()
  }
}
