package expo.modules.svelteupdates

import android.util.Base64
import java.io.File
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
   */
  fun download(url: String, headers: Map<String, String>, destination: File, expectedHash: String): String {
    val connection = open(url, headers)
    val temporary = File(destination.path + ".tmp")
    try {
      if (connection.responseCode !in 200..299) throw IOException("Download of $url failed with status ${connection.responseCode}: ${text(connection).take(300)}")
      destination.parentFile?.mkdirs()
      val digest = MessageDigest.getInstance("SHA-256")
      DigestInputStream(connection.inputStream, digest).use { input -> temporary.outputStream().use { output -> input.copyTo(output) } }
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

  fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(BUFFER_SIZE)
    DigestInputStream(file.inputStream(), digest).use { input -> while (input.read(buffer) != -1) { /* reading feeds the digest */ } }
    return encode(digest.digest())
  }

  private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
